import { fsrs, generatorParameters, createEmptyCard, type Card, type State, type Grade } from 'ts-fsrs'
import type { CardRow, Fsrs, Level, Word } from './db'
import { fmtInterval } from './util'

const f = fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9, maximum_interval: 365 }))

const toCard = (r: Fsrs): Card => ({
  due: new Date(r.due),
  stability: r.stability,
  difficulty: r.difficulty,
  elapsed_days: r.elapsed_days,
  scheduled_days: r.scheduled_days,
  learning_steps: r.learning_steps,
  reps: r.reps,
  lapses: r.lapses,
  state: r.state as State,
  last_review: r.last_review ? new Date(r.last_review) : undefined,
})
const fromCard = (c: Card): Fsrs => ({
  due: c.due.getTime(),
  stability: c.stability,
  difficulty: c.difficulty,
  elapsed_days: c.elapsed_days,
  scheduled_days: c.scheduled_days,
  learning_steps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state as number,
  last_review: c.last_review?.getTime(),
})

export const newFsrs = (now = Date.now()): Fsrs => fromCard(createEmptyCard(new Date(now)))

export interface Preview {
  fsrs: Fsrs
  label: string
}
/** What each of Again/Hard/Good/Easy (1..4) would do. */
export function preview(r: Fsrs, now = Date.now()): Record<1 | 2 | 3 | 4, Preview> {
  const rec = f.repeat(toCard(r), new Date(now))
  const out = {} as Record<1 | 2 | 3 | 4, Preview>
  for (const g of [1, 2, 3, 4] as const) {
    const c = rec[g as Grade].card
    out[g] = { fsrs: fromCard(c), label: fmtInterval(c.due.getTime() - now) }
  }
  return out
}

// ---- mastery levels ----
export function computeLevel(w: Word, cards: CardRow[]): { level: Level; stability: number } {
  const reviewed = cards.filter((c) => c.reps > 0)
  const recog = reviewed.filter((c) => c.dir === 'ru-en')
  const stab = recog.length ? recog.reduce((s, c) => s + c.stability, 0) / recog.length : 0
  if (!reviewed.length && w.sentenceReviews === 0) return { level: 'new', stability: 0 }
  const prodCard = cards.some((c) => c.dir === 'en-ru' && c.state === 2 && c.stability >= 14)
  const last3 = w.sentRecent.slice(-3)
  const sentOk = w.sentGood >= 3 && last3.length >= 3 && last3.every((x) => x >= 3)
  const productive = prodCard || sentOk
  let level: Level
  if (stab >= 45 && productive) level = 'mastered'
  else if (stab >= 14 && productive) level = 'productive'
  else if (stab >= 21) level = 'strong'
  else if (stab >= 7) level = 'familiar'
  else level = 'learning'
  return { level, stability: stab }
}

export const LEVEL_LABEL: Record<Level, string> = {
  new: 'New',
  learning: 'Learning',
  familiar: 'Familiar',
  strong: 'Strong recognition',
  productive: 'Productive',
  mastered: 'Mastered',
}

export const isWeak = (w: Word) => w.level !== 'new' && w.level !== 'mastered' && w.lastRating !== undefined && w.lastRating <= 2 && w.stability < 14
