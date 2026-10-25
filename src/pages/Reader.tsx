import { useEffect, useMemo, useState } from 'preact/hooks'
import { db, type StoryRow, type Word } from '../db'
import { type Hit, POS, accent, accentedForm, gloss, hitLabel, lookupCached, plain, primaryTag, tokenize } from '../dict'
import { FormsTable, Sheet, Spinner, Empty, useLive, LevelBadge } from '../components'
import { addCard, infoFromLemma, useStudyTimer } from '../store'
import { generateStory } from '../ai'
import { go, toast } from '../util'

// ---------------- list ----------------
export function ReaderList({ autoGen }: { autoGen?: boolean }) {
  const stories = useLive(() => db.stories.orderBy('lastOpened').reverse().toArray())
  const [gen, setGen] = useState(!!autoGen)
  return (
    <div class="page">
      <div class="top">
        <h1>Reader</h1>
        <button class="icon-btn" onClick={() => go('import')} aria-label="Paste a story">＋</button>
      </div>
      <div class="row" style={{ marginBottom: 14 }}>
        <button class="btn grow" onClick={() => setGen(true)}>Generate a story</button>
        <button class="btn ghost grow" onClick={() => go('import')}>Paste one</button>
      </div>
      {stories && stories.length === 0 && (
        <Empty title="No stories yet">Generate one from your words, or paste a story from ChatGPT.</Empty>
      )}
      {stories?.map((s) => (
        <button class="item" style={{ width: '100%', textAlign: 'left' }} onClick={() => go(`reader/${s.id}`)}>
          <div class="grow">
            <div class="t ru">{s.title}</div>
            <div class="small muted">
              {s.source === 'generated' ? 'Generated' : 'Imported'} · {new Date(s.created).toLocaleDateString()}
              {s.reads > 0 && ` · read ${s.reads}×`}
              {s.familiarPct !== undefined && ` · ${Math.round(s.familiarPct * 100)}% familiar`}
            </div>
          </div>
          <span class="muted">›</span>
        </button>
      ))}
      {gen && <GenSheet onClose={() => setGen(false)} />}
    </div>
  )
}

function GenSheet({ onClose }: { onClose: () => void }) {
  const [minutes, setMinutes] = useState(5)
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [err, setErr] = useState('')
  async function run() {
    setBusy(true)
    setErr('')
    try {
      const id = await generateStory({ minutes, topic: topic.trim() }, setStatus)
      go(`reader/${id}`)
    } catch (e: any) {
      setErr(e.message || String(e))
      setBusy(false)
    }
  }
  return (
    <Sheet onClose={busy ? () => {} : onClose}>
      <h2 style={{ fontSize: 22 }}>Generate a story</h2>
      <p class="muted small">Built from the words you're learning — mostly vocabulary you already know, so it's easy to read.</p>
      <label class="lbl">Length</label>
      <div class="seg">
        {[2, 5, 8].map((m) => <button class={minutes === m ? 'on' : ''} onClick={() => setMinutes(m)}>{m} min</button>)}
      </div>
      <label class="lbl">Topic (optional)</label>
      <input class="txt" value={topic} placeholder="e.g. a trip to the market" onInput={(e) => setTopic((e.target as HTMLInputElement).value)} />
      {err && <div class="err" style={{ marginTop: 12 }}>{err}</div>}
      <button class="btn block" style={{ marginTop: 16 }} disabled={busy} onClick={run}>
        {busy ? <><Spinner /> {status || 'Working…'}</> : 'Generate'}
      </button>
    </Sheet>
  )
}

// ---------------- story view ----------------
interface Sel {
  surface: string
  key: string
  hits: Hit[]
  idx: number
}

export function StoryView({ id }: { id: number }) {
  useStudyTimer('reading')
  const [story, setStory] = useState<StoryRow | null>(null)
  const [hits, setHits] = useState<Map<string, Hit[]>>(new Map())
  const [sel, setSel] = useState<Sel | null>(null)
  const words = useLive(async () => new Map((await db.words.toArray()).map((w) => [w.id, w])), [])

  useEffect(() => {
    ;(async () => {
      const s = await db.stories.get(id)
      if (!s) return go('reader')
      s.lastOpened = Date.now()
      await db.stories.put(s)
      setStory(s)
      const keys = [...new Set(tokenize(s.text).filter((t) => t.w).map((t) => t.k))]
      const m = new Map<string, Hit[]>()
      await Promise.all(keys.map(async (k) => m.set(k, await lookupCached(k))))
      setHits(m)
    })()
  }, [id])

  const paras = useMemo(() => (story ? story.text.split(/\n+/).filter((p) => p.trim()).map(tokenize) : []), [story?.text])

  async function mark(key: string, m: 'tap' | 'hard' | 'learn') {
    if (!story) return
    const marks = { ...story.marks }
    const rank = { tap: 0, hard: 1, learn: 2 }
    if (!marks[key] || rank[m] >= rank[marks[key]]) marks[key] = m
    const next = { ...story, marks }
    setStory(next)
    await db.stories.put(next)
  }

  function open(surface: string, key: string) {
    const h = hits.get(key) ?? []
    setSel({ surface, key, hits: h, idx: 0 })
    if (h.length) mark(key, 'tap')
  }

  async function learn(s: Sel) {
    const h = s.hits[s.idx]
    if (!h) return
    const tag = primaryTag(h.tags)
    const form = accentedForm(h.lemma, s.key) ?? plain(s.surface)
    const { created } = await addCard(infoFromLemma(h.lemma), form, tag, gloss(h.lemma))
    await mark(s.key, 'learn')
    toast(created ? `Added “${plain(form)}” to your words` : 'Already in your words')
    setSel(null)
  }
  async function hard(s: Sel) {
    const h = s.hits[s.idx]
    if (h) await db.hard.put({ id: `l${h.lemma.i}`, ts: Date.now(), form: plain(s.surface).toLowerCase() })
    await mark(s.key, 'hard')
    toast('Marked hard — it will show up in future stories')
    setSel(null)
  }

  async function finish() {
    if (!story) return
    // count contextual exposures for words you're tracking
    const counts = new Map<string, { n: number; forms: Set<string> }>()
    for (const p of paras) for (const t of p) {
      if (!t.w) continue
      const h = hits.get(t.k)?.[0]
      if (!h) continue
      const wid = `l${h.lemma.i}`
      const c = counts.get(wid) ?? { n: 0, forms: new Set<string>() }
      c.n++
      c.forms.add(t.k)
      counts.set(wid, c)
    }
    const ws = await db.words.bulkGet([...counts.keys()])
    const now = Date.now()
    let tracked = 0
    for (const w of ws) {
      if (!w) continue
      const c = counts.get(w.id)!
      w.exposures += c.n
      w.lastSeen = now
      for (const f of c.forms) if (!w.forms.includes(f)) w.forms.push(f)
      await db.words.put(w)
      tracked++
    }
    const next = { ...story, reads: story.reads + 1 }
    await db.stories.put(next)
    toast(`Done — ${tracked} of your words appeared`)
    go('reader')
  }

  if (!story) return <div class="page"><Spinner /></div>

  const cur = sel?.hits[sel.idx]
  const trackedWord: Word | undefined = cur ? words?.get(`l${cur.lemma.i}`) : undefined
  return (
    <div class="page full" style={{ paddingBottom: 'calc(24px + var(--safe-b))' }}>
      <div class="top">
        <button class="icon-btn" onClick={() => go('reader')}>←</button>
        <h1 class="ru" style={{ fontSize: 20 }}>{story.title}</h1>
      </div>
      {story.familiarPct !== undefined && (
        <div class="muted small" style={{ marginBottom: 12 }}>
          {Math.round(story.familiarPct * 100)}% familiar vocabulary
          {story.targets.length > 0 && ` · built around ${story.targets.length} of your words`}
        </div>
      )}
      <div class="story ru">
        {paras.map((p) => (
          <p>
            {p.map((t) => {
              if (!t.w) return t.s
              const h = hits.get(t.k)?.[0]
              const w = h ? words?.get(`l${h.lemma.i}`) : undefined
              const m = story.marks[t.k]
              const cls = ['w', w ? `t-${w.level}` : '', m === 'hard' ? 'm-hard' : m === 'learn' ? 'm-learn' : '', sel?.key === t.k ? 'sel' : ''].join(' ')
              return <span class={cls} onClick={() => open(t.s, t.k)}>{t.s}</span>
            })}
          </p>
        ))}
      </div>
      <div style={{ marginTop: 'auto', paddingTop: 20 }}>
        <button class="btn block" onClick={finish}>Done reading ✓</button>
        <p class="muted small center">Tap any word for its meaning. Words only become flashcards if you tap Learn.</p>
      </div>

      {sel && (
        <Sheet onClose={() => setSel(null)}>
          {cur ? (
            <>
              <div class="row">
                <h2 class="ru grow">{accent(accentedForm(cur.lemma, sel.key) ?? sel.surface)}</h2>
                {trackedWord && <LevelBadge level={trackedWord.level} />}
              </div>
              <div style={{ fontSize: 18, margin: '4px 0 10px' }}>{gloss(cur.lemma, 4)}</div>
              <dl class="kv">
                <dt>{cur.lemma.p === 'verb' ? 'infinitive' : 'lemma'}</dt><dd class="ru"><b>{accent(cur.lemma.w)}</b> · {POS[cur.lemma.p]}</dd>
                <dt>form</dt><dd>{hitLabel(cur)}</dd>
                {(cur.lemma.a || cur.lemma.pt) && <><dt>aspect</dt><dd>{cur.lemma.a === 'pf' ? 'perfective' : 'imperfective'}{cur.lemma.pt?.length ? ` · pair: ${cur.lemma.pt.slice(0, 2).map(plain).join(', ')}` : ''}</dd></>}
              </dl>
              {sel.hits.length > 1 && (
                <div style={{ margin: '12px 0 0' }}>
                  <div class="muted small">Could also be:</div>
                  <div class="row" style={{ flexWrap: 'wrap', marginTop: 4 }}>
                    {sel.hits.map((h, k) => (
                      <button class={`chip`} style={{ opacity: k === sel.idx ? 1 : 0.55 }} onClick={() => setSel({ ...sel, idx: k })}>{plain(h.lemma.b)}</button>
                    ))}
                  </div>
                </div>
              )}
              <FormsDetails lemma={cur.lemma} />
              <div class="row" style={{ marginTop: 16 }}>
                <button class="btn grow" onClick={() => learn(sel)}>＋ Learn</button>
                <button class="btn ghost grow" onClick={() => hard(sel)}>Hard</button>
              </div>
            </>
          ) : (
            <>
              <h2 class="ru">{sel.surface}</h2>
              <p class="muted">Not found in the offline dictionary — it may be a name, a typo, or a rare word.</p>
            </>
          )}
        </Sheet>
      )}
    </div>
  )
}

function FormsDetails({ lemma }: { lemma: Hit['lemma'] }) {
  const [on, setOn] = useState(false)
  return (
    <div style={{ marginTop: 10 }}>
      <button class="small" style={{ color: 'var(--accent)', fontWeight: 600 }} onClick={() => setOn(!on)}>{on ? 'Hide' : 'Show'} all forms</button>
      {on && <FormsTable lemma={lemma} />}
    </div>
  )
}
