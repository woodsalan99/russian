import { db } from './db'
import { type Hit, accentedForm, gloss, hitLabel, lookup, norm, plain, primaryTag, tokenize } from './dict'
import { type WordInfo, infoFromLemma } from './store'

export interface ImpItem {
  raw: string
  ru: string // Russian as typed
  en: string // English supplied by the user ('' if none)
  hits: Hit[]
  pick: number
  status: 'new' | 'dupe' | 'newform' | 'missing'
  checked: boolean
  // resolved for the current pick:
  info: WordInfo
  form: string
  tag: string
  meaning: string
  label: string
}

const CYR = /[А-Яа-яЁё]/
const LAT = /[A-Za-z]/

function splitLine(line: string): { ru: string; en: string } | null {
  let l = line.trim()
  l = l.replace(/^[-•*·]\s+/, '').replace(/^\d+[.)]\s+/, '')
  if (!CYR.test(l)) return null
  // explicit delimiters
  const m = l.match(/^(.*?)(?:\t+|\s+[-–—]+\s+|\s*[=:→]+>?\s*|\s*->\s*)(.+)$/)
  if (m && CYR.test(m[1])) {
    const ru = m[1].trim()
    const en = m[2].trim()
    if (CYR.test(en) && !LAT.test(en)) return { ru: l, en: '' } // dash inside a Russian phrase
    return { ru, en: /[A-Za-z0-9]/.test(en) ? en : '' }
  }
  // "тихий quiet" — Cyrillic run followed by Latin text
  const li = l.search(LAT)
  if (li > 0) return { ru: l.slice(0, li).trim(), en: l.slice(li).trim() }
  return { ru: l, en: '' }
}

function bestPick(hits: Hit[], en: string): number {
  if (hits.length < 2 || !en) return 0
  const words = new Set(en.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && w !== 'the' && w !== 'was' && w !== 'were'))
  let best = 0
  let bestScore = -1
  hits.forEach((h, i) => {
    const text = h.lemma.e.join(' ').toLowerCase()
    let s = 0
    words.forEach((w) => {
      if (text.includes(w.replace(/(ed|ing|s)$/, ''))) s++
    })
    if (s > bestScore) {
      bestScore = s
      best = i
    }
  })
  return best
}

export async function resolveItem(it: ImpItem, existingCards: Set<string>, existingWords: Set<string>, seen: Set<string>) {
  const toks = tokenize(it.ru).filter((t) => t.w)
  if (it.hits.length) {
    const h = it.hits[it.pick]
    it.info = infoFromLemma(h.lemma)
    const tag = primaryTag(h.tags)
    it.tag = tag
    const typed = toks[0]?.s ?? it.ru
    it.form = accentedForm(h.lemma, typed) ?? plain(typed)
    it.label = hitLabel(h)
    it.meaning = it.en || gloss(h.lemma)
  } else {
    const key = norm(it.ru)
    it.info = { id: `p:${key}`, lemma: it.ru, accented: it.ru, pos: 'phrase', meaning: it.en || '', note: '' }
    it.tag = 'phrase'
    it.form = it.ru
    it.label = toks.length > 1 ? 'phrase' : 'not in dictionary'
    it.meaning = it.en
  }
  const sig = `${it.info.id}|${norm(it.form)}`
  if (existingCards.has(sig) || seen.has(sig)) it.status = 'dupe'
  else if (existingWords.has(it.info.id)) it.status = 'newform'
  else it.status = it.hits.length || it.en ? 'new' : 'missing'
  if (it.status === 'new' || it.status === 'missing') it.checked = it.status === 'new'
  else it.checked = false
  seen.add(sig)
}

export async function parseNotes(text: string): Promise<ImpItem[]> {
  const rows: { raw: string; ru: string; en: string }[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const s = splitLine(line)
    if (!s || !s.ru) continue
    // "вышел, вышла - went out" → one item per Russian piece, sharing the English
    const split = s.ru.split(/\s*[,;/]\s*/).filter((p) => CYR.test(p))
    const parts = split.every((p) => !/\s/.test(p.trim())) ? split : [s.ru]
    for (const p of parts.length ? parts : [s.ru]) rows.push({ raw: line.trim(), ru: p.replace(/^[«"“(]+|[»"”).!?…]+$/g, '').trim(), en: s.en })
  }
  const cards = await db.cards.toArray()
  const existingCards = new Set(cards.map((c) => `${c.wordId}|${c.formKey}`))
  const existingWords = new Set((await db.words.toArray()).map((w) => w.id))
  const seen = new Set<string>()
  const items: ImpItem[] = []
  for (const r of rows) {
    const toks = tokenize(r.ru).filter((t) => t.w)
    let hits: Hit[] = []
    if (toks.length === 1) hits = await lookup(toks[0].s)
    else if (toks.length > 1) hits = await lookup(r.ru) // dictionary has some fixed phrases
    const it: ImpItem = {
      ...r,
      hits,
      pick: bestPick(hits, r.en),
      status: 'new',
      checked: true,
      info: { id: '', lemma: '', accented: '', pos: '', meaning: '', note: '' },
      form: '',
      tag: '',
      meaning: '',
      label: '',
    }
    await resolveItem(it, existingCards, existingWords, seen)
    items.push(it)
  }
  return items
}

/** Re-run duplicate/status detection for the whole list (after the user switches a candidate). */
export async function restatus(items: ImpItem[]) {
  const cards = await db.cards.toArray()
  const existingCards = new Set(cards.map((c) => `${c.wordId}|${c.formKey}`))
  const existingWords = new Set((await db.words.toArray()).map((w) => w.id))
  const seen = new Set<string>()
  for (const it of items) {
    const was = it.checked
    await resolveItem(it, existingCards, existingWords, seen)
    if (it.status === 'new' && was) it.checked = true
  }
}
