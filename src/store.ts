import { useEffect } from 'preact/hooks'
import { db, type CardRow, type Fsrs, type Word } from './db'
import { computeLevel, newFsrs } from './srs'
import { dayKey } from './util'
import { type Lemma, accent, gloss, lemmaNote, norm, plain } from './dict'

// ---------- words ----------
export interface WordInfo {
  id: string
  lemma: string
  accented: string
  pos: string
  meaning: string
  note: string
  lemmaId?: number
}

export function infoFromLemma(l: Lemma, meaning?: string): WordInfo {
  return { id: `l${l.i}`, lemma: l.b, accented: l.w, pos: l.p, meaning: meaning || gloss(l), note: lemmaNote(l), lemmaId: l.i }
}

export async function ensureWord(info: WordInfo): Promise<Word> {
  const ex = await db.words.get(info.id)
  if (ex) return ex
  const now = Date.now()
  const w: Word = {
    ...info,
    forms: [],
    firstSeen: now,
    lastSeen: now,
    exposures: 0,
    flashReviews: 0,
    sentenceReviews: 0,
    sentGood: 0,
    sentRecent: [],
    sentTags: [],
    level: 'new',
    stability: 0,
    addedAt: now,
  }
  await db.words.put(w)
  return w
}

export async function addCard(
  info: WordInfo,
  form: string,
  tag: string,
  meaning: string,
  dir: 'ru-en' | 'en-ru' = 'ru-en',
): Promise<{ card: CardRow; created: boolean }> {
  const w = await ensureWord(info)
  const formKey = norm(form)
  const existing = await db.cards.where('wordId').equals(info.id).filter((c) => c.formKey === formKey && c.dir === dir).first()
  if (existing) return { card: existing, created: false }
  const now = Date.now()
  const card: CardRow = {
    wordId: info.id,
    dir,
    form: accent(form),
    formKey,
    tag,
    meaning,
    created: now,
    ...newFsrs(now),
  }
  card.id = await db.cards.add(card)
  const disp = plain(form).toLowerCase()
  if (!w.forms.includes(disp)) {
    w.forms.push(disp)
    await db.words.put(w)
  }
  return { card, created: true }
}

/** Recompute mastery level; introduce the English→Russian card once recognition is solid. Returns id of any created card. */
export async function refreshWord(wordId: string): Promise<number | undefined> {
  const w = await db.words.get(wordId)
  if (!w) return
  const cards = await db.cards.where('wordId').equals(wordId).toArray()
  let createdId: number | undefined
  const hasProd = cards.some((c) => c.dir === 'en-ru')
  if (!hasProd) {
    const ready = cards.find((c) => c.dir === 'ru-en' && c.state === 2 && c.stability >= 10)
    if (ready) {
      const now = Date.now()
      const c: CardRow = { ...ready, id: undefined, dir: 'en-ru', created: now, ...newFsrs(now) }
      createdId = await db.cards.add(c)
      cards.push({ ...c, id: createdId })
    }
  }
  const { level, stability } = computeLevel(w, cards)
  w.level = level
  w.stability = stability
  if (level === 'mastered' && !w.masteredAt) w.masteredAt = Date.now()
  await db.words.put(w)
  return createdId
}

export async function rateCard(card: CardRow, rating: number, next: Fsrs, ms: number) {
  const prevCard = { ...card }
  const w = await db.words.get(card.wordId)
  const prevWord = w ? structuredClone(w) : undefined
  const now = Date.now()
  const updated: CardRow = { ...card, ...next }
  await db.cards.put(updated)
  const logId = await db.log.add({ ts: now, kind: 'card', wordId: card.wordId, rating, ms })
  if (w) {
    w.flashReviews++
    w.lastSeen = now
    w.lastRating = rating
    await db.words.put(w)
  }
  const created = await refreshWord(card.wordId)
  const undo = async () => {
    await db.cards.put(prevCard)
    if (prevWord) await db.words.put(prevWord)
    await db.log.delete(logId)
    if (created) await db.cards.delete(created)
  }
  return { updated, undo }
}

const newKey = () => `ru-new-${dayKey()}`
export function newIntroducedToday(): number {
  try {
    return Number(localStorage.getItem(newKey()) || 0)
  } catch {
    return 0
  }
}
export function bumpNewIntroduced(by = 1) {
  try {
    localStorage.setItem(newKey(), String(newIntroducedToday() + by))
  } catch {}
}

// ---------- study time ----------
const IDLE_MS = 30000
export function useStudyTimer(kind: 'cards' | 'sentences' | 'reading', enabled = true) {
  useEffect(() => {
    if (!enabled) return
    let last = Date.now()
    let pending = 0
    let tick = Date.now()
    const touch = () => (last = Date.now())
    const evs = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel']
    evs.forEach((e) => addEventListener(e, touch, { passive: true }))
    const flush = async () => {
      if (pending < 500) return
      const ms = pending
      pending = 0
      const day = dayKey()
      const key = `${day}|${kind}`
      await db.transaction('rw', db.time, async () => {
        const row = (await db.time.get(key)) ?? { key, day, kind, ms: 0 }
        row.ms += ms
        await db.time.put(row)
      })
    }
    const iv = setInterval(() => {
      const now = Date.now()
      const dt = now - tick
      tick = now
      if (document.visibilityState === 'visible' && now - last < IDLE_MS && dt < 5000) pending += dt
      if (pending >= 10000) void flush()
    }, 1000)
    const vis = () => document.visibilityState === 'hidden' && void flush()
    document.addEventListener('visibilitychange', vis)
    return () => {
      clearInterval(iv)
      evs.forEach((e) => removeEventListener(e, touch))
      document.removeEventListener('visibilitychange', vis)
      void flush()
    }
  }, [kind, enabled])
}

// ---------- backup ----------
export async function exportAll(): Promise<string> {
  const data: Record<string, unknown[]> = {}
  for (const t of db.tables) data[t.name] = await t.toArray()
  return JSON.stringify({ app: 'russian', version: 1, exported: new Date().toISOString(), data })
}
export async function importAll(json: string) {
  const o = JSON.parse(json)
  if (o.app !== 'russian') throw new Error('Not a backup from this app')
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) {
      await t.clear()
      if (o.data[t.name]?.length) await t.bulkPut(o.data[t.name])
    }
  })
}
