import { db, type SentenceRow, type StoryRow, type Word } from './db'
import { type Lemma, type Hit, formFor, getLemma, lookupCached, norm, plain, tagLabel, tokenize, accent } from './dict'
import { newFsrs, isWeak } from './srs'
import { DAY, getSettings, shuffle } from './util'

// ---------- DeepSeek ----------
export async function chat(system: string, user: string, maxTokens = 1800): Promise<any> {
  const { apiKey, model } = getSettings()
  if (!apiKey) throw new Error('Add your DeepSeek API key in Settings first.')
  let r: Response
  try {
    r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        max_tokens: maxTokens,
        temperature: 0.9,
        messages: [
          { role: 'system', content: system + '\nReply with a single JSON object only.' },
          { role: 'user', content: user },
        ],
      }),
    })
  } catch {
    throw new Error('Could not reach DeepSeek — check your connection.')
  }
  if (r.status === 401) throw new Error('DeepSeek rejected the API key (401). Re-enter it in Settings.')
  if (r.status === 402) throw new Error('DeepSeek balance is empty (402). Top up your account.')
  if (!r.ok) throw new Error(`DeepSeek error ${r.status}`)
  const j = await r.json()
  const txt: string = j.choices?.[0]?.message?.content ?? ''
  try {
    return JSON.parse(txt.replace(/^```(?:json)?|```$/g, '').trim())
  } catch {
    throw new Error('DeepSeek returned something unreadable. Try again.')
  }
}

// ---------- known-vocabulary analysis ----------
const COMMON_RANK = 1500 // lemmas this frequent count as "free" known vocabulary

export interface Analysis {
  total: number
  known: number
  unknown: string[]
  pct: number
}

async function trackedLemmaIds(): Promise<Set<number>> {
  const ws = await db.words.toArray()
  return new Set(ws.filter((w) => w.lemmaId !== undefined).map((w) => w.lemmaId!))
}

function hitsKnown(hits: Hit[], tracked: Set<number>, rank = COMMON_RANK) {
  return hits.some((h) => tracked.has(h.lemma.i) || h.lemma.r < rank)
}

export async function analyzeText(text: string, tracked?: Set<number>, rank = COMMON_RANK): Promise<Analysis> {
  tracked ??= await trackedLemmaIds()
  const toks = tokenize(text)
  const uniq = [...new Set(toks.filter((t) => t.w).map((t) => t.k))]
  const res = new Map<string, Hit[]>()
  await Promise.all(uniq.map(async (k) => res.set(k, await lookupCached(k))))
  let total = 0
  let known = 0
  const unknown = new Set<string>()
  toks.forEach((t, idx) => {
    if (!t.w) return
    total++
    const hits = res.get(t.k) ?? []
    let ok = hitsKnown(hits, tracked!, rank)
    if (!hits.length && /^[А-ЯЁ]/.test(t.s)) ok = true // name
    if (ok) known++
    else unknown.add(t.k)
    void idx
  })
  return { total, known, unknown: [...unknown], pct: total ? known / total : 1 }
}

// ---------- sentence generation ----------
const VERB_IMPF = ['pres_sg3', 'past_m', 'pres_sg1', 'past_f', 'pres_pl1', 'pres_sg2', 'past_pl', 'pres_pl3', 'pres_pl2', 'inf', 'imp_sg']
const VERB_PF = ['past_m', 'past_f', 'fut_sg1', 'past_pl', 'fut_sg3', 'fut_pl1', 'inf', 'fut_sg2', 'fut_pl3', 'imp_sg']
const NOUN = ['sg_nom', 'sg_acc', 'sg_prep', 'pl_nom', 'sg_gen', 'sg_dat', 'sg_inst', 'pl_acc', 'pl_gen', 'pl_prep', 'pl_dat', 'pl_inst']
const ADJ = ['m_nom', 'f_nom', 'n_nom', 'pl_nom', 'm_acc', 'f_acc', 'short_m', 'short_f', 'm_prep', 'f_gen', 'pl_acc', 'm_inst']

function tagOrder(l: Lemma): string[] {
  if (l.p === 'verb') return l.a === 'pf' ? VERB_PF : VERB_IMPF
  if (l.p === 'noun') return NOUN
  if (l.p === 'adj') return ADJ
  return ['base']
}

interface Spec {
  word: Word
  lemma: Lemma | null
  tag: string
  target: string // accented target surface
}

async function makeSpec(w: Word): Promise<Spec | null> {
  if (w.lemmaId === undefined) return { word: w, lemma: null, tag: 'phrase', target: w.accented }
  const l = await getLemma(w.lemmaId)
  if (!l) return null
  const order = tagOrder(l).filter((t) => (t === 'base' ? !!l.f.base : !!l.f[t]?.[0]))
  if (!order.length) return { word: w, lemma: l, tag: 'lemma', target: l.w }
  const unused = order.filter((t) => !w.sentTags.includes(t))
  const tag = unused.length ? unused[0] : order[Math.floor(Math.random() * order.length)]
  const target = tag === 'base' ? (l.f.base?.[0] ?? l.w) : (formFor(l, tag) ?? l.w)
  return { word: w, lemma: l, tag, target }
}

/** Pick which words to practise producing, weakest / least-practised first. */
export async function pickSentenceWords(n: number): Promise<Word[]> {
  const ws = (await db.words.toArray()).filter((w) => !w.suspended && (w.level !== 'new' || w.flashReviews > 0 || w.sentenceReviews > 0))
  const now = Date.now()
  const scored = ws.map((w) => {
    let s = Math.random() * 1.5
    if (isWeak(w)) s += 3
    s += Math.max(0, 3 - w.sentenceReviews) * 0.7
    s += Math.min(3, (now - w.lastSeen) / (4 * DAY))
    if (w.level === 'mastered') s -= 2
    return { w, s }
  })
  return scored.sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.w)
}

export async function generateSentences(words: Word[]): Promise<number> {
  const specs = (await Promise.all(words.map(makeSpec))).filter(Boolean) as Spec[]
  if (!specs.length) return 0
  const tracked = await trackedLemmaIds()
  const allWords = await db.words.toArray()
  const vocab = shuffle(allWords.map((w) => plain(w.lemma))).slice(0, 80).join(', ')
  const lines = specs
    .map((s, i) => {
      const l = s.lemma
      const gram = s.tag === 'phrase' ? 'use the phrase exactly as given' : tagLabel(s.tag)
      const asp = l?.a ? ` (${l.a === 'pf' ? 'perfective' : 'imperfective'} verb)` : ''
      return `${i + 1}. required form: "${plain(s.target)}" — lemma ${plain(l?.b ?? s.word.lemma)}${asp}, meaning "${s.word.meaning}", form: ${gram}`
    })
    .join('\n')
  const system = `You write practice sentences for an English speaker who is a little above A1 in Russian. Sentences must be natural, correct, everyday Russian, 3–8 words, with ONE main grammatical difficulty. Use very common A1–A2 vocabulary around the target. The required form is already inflected correctly: copy it EXACTLY, do not change its ending, and do not swap it for another aspect or lemma. Reuse these learner words where natural: ${vocab || '(none yet)'}.
The English line must be a natural translation that makes the tense, person and number of the required form clear. When the Russian form depends on the gender of "I" or "you" and the English can't show it, add "(m)" or "(f)" at the end of the English.`
  const user = `Write exactly one sentence for each item.\n${lines}\n\nReturn JSON: {"items":[{"n":1,"en":"...","ru":"..."}]}`
  const out = await chat(system, user, 1500)
  const items: { n: number; en: string; ru: string }[] = out.items ?? []
  const now = Date.now()
  const rows: SentenceRow[] = []
  for (const it of items) {
    const s = specs[(it.n ?? 0) - 1]
    if (!s || !it.ru || !it.en) continue
    // must contain the exact required form
    const ruN = ` ${norm(it.ru).replace(/[^а-я0-9\s-]/g, ' ').replace(/\s+/g, ' ')} `
    if (!ruN.includes(` ${norm(s.target)} `)) continue
    const a = await analyzeText(it.ru, tracked, 3000)
    const extra = a.unknown.filter((u) => !norm(s.target).split(' ').includes(u))
    if (extra.length > 1) continue
    rows.push({ wordId: s.word.id, tag: s.tag, target: plain(s.target), en: it.en.trim(), ru: it.ru.trim(), created: now, ...newFsrs(now) })
  }
  if (rows.length) await db.sentences.bulkAdd(rows)
  return rows.length
}

// ---------- story generation ----------
export interface StoryOpts {
  minutes: number
  topic: string
}

export async function generateStory(opts: StoryOpts, onStatus: (s: string) => void = () => {}): Promise<number> {
  const ws = await db.words.toArray()
  const hard = await db.hard.toArray()
  const now = Date.now()
  // priority score per tracked word
  const scored = ws
    .filter((w) => !w.suspended)
    .map((w) => {
      let s = Math.random()
      if (isWeak(w)) s += 3
      if (w.level === 'learning' || w.level === 'familiar') s += 2
      if (w.level === 'new') s += 1
      if (w.level === 'mastered') s -= 1
      s += Math.min(3, (now - w.lastSeen) / (5 * DAY))
      return { w, s }
    })
    .sort((a, b) => b.s - a.s)
  const nTargets = Math.min(scored.length, Math.max(3, Math.round(opts.minutes * 1.2)))
  const targets = scored.slice(0, nTargets).map((x) => x.w)
  const tracked = await trackedLemmaIds()

  const targetLines: string[] = []
  for (const w of targets) {
    const l = w.lemmaId !== undefined ? await getLemma(w.lemmaId) : null
    if (!l) {
      targetLines.push(`- ${w.accented} ("${w.meaning}")`)
      continue
    }
    const order = tagOrder(l).filter((t) => l.f[t]?.[0] || t === 'base')
    const metForms = new Set(w.forms.map(norm))
    const fresh = order.map((t) => plain(formFor(l, t) ?? '')).filter((f) => f && !metForms.has(norm(f)))
    const pick = shuffle([...new Set(fresh)]).slice(0, 3)
    targetLines.push(`- ${plain(l.b)} ("${w.meaning}")${pick.length ? ` — try forms like: ${pick.join(', ')}` : ''}`)
  }
  // untracked words recently tapped "Hard"
  const hardRecent = hard.filter((h) => now - h.ts < 21 * DAY && !ws.some((w) => w.id === h.id)).slice(-3)
  for (const h of hardRecent) targetLines.push(`- ${plain(h.form)} (optional, recently looked up)`)

  // frequent vocabulary list to anchor on
  const common: string[] = []
  const sample = (await Promise.all(Array.from({ length: 700 }, (_, i) => getLemma(i)))).filter(Boolean) as Lemma[]
  for (const l of sample) if (l.p !== 'other' || l.r < 120) common.push(plain(l.b))

  const words = Math.round(opts.minutes * 70)
  const system = `You write short graded-reader stories in natural Russian for an English speaker who is a little above A1. Keep sentences short and simple (mostly present and past tense), with a clear small plot and a bit of dialogue. At least 92% of the words must come from basic everyday vocabulary. Do not add glosses or English text inside the story.`
  let best: { title: string; text: string; a: Analysis } | null = null
  let avoid: string[] = []
  for (let attempt = 0; attempt < 3; attempt++) {
    onStatus(attempt ? `Polishing the story (try ${attempt + 1})…` : 'Writing your story…')
    const user = `Write a story of about ${words} words${opts.topic ? ` about: ${opts.topic}` : ' about an ordinary day with a small surprise'}.
Weave these learner words in naturally — a few forms of each is great, but don't force all of them into every paragraph:
${targetLines.join('\n')}

Everything else should be common beginner vocabulary, for example from: ${common.slice(0, 450).join(', ')}.
${avoid.length ? `Avoid these hard words from your last draft: ${avoid.slice(0, 25).join(', ')}.\n` : ''}Return JSON: {"title_ru":"...","title_en":"...","text":"paragraphs separated by \\n\\n"}`
    const out = await chat(system, user, 2500)
    const text: string = out.text ?? ''
    if (!text) continue
    onStatus('Checking vocabulary level…')
    const a = await analyzeText(text, tracked)
    if (!best || a.pct > best.a.pct) best = { title: out.title_ru || 'История', text, a }
    if (a.pct >= 0.9) break
    avoid = a.unknown
  }
  if (!best) throw new Error('No story came back. Try again.')
  const st: StoryRow = {
    title: best.title,
    text: best.text.replace(/\\n/g, '\n'),
    source: 'generated',
    created: Date.now(),
    lastOpened: Date.now(),
    reads: 0,
    marks: {},
    targets: targets.map((t) => t.id),
    familiarPct: best.a.pct,
  }
  return (await db.stories.add(st)) as number
}
export { accent }
