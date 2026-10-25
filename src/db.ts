import Dexie, { type Table } from 'dexie'

export type Level = 'new' | 'learning' | 'familiar' | 'strong' | 'productive' | 'mastered'
export const LEVELS: Level[] = ['new', 'learning', 'familiar', 'strong', 'productive', 'mastered']

export interface Fsrs {
  due: number
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: number // 0 New, 1 Learning, 2 Review, 3 Relearning
  last_review?: number
}

export interface Word {
  id: string // 'l123' = dictionary lemma id, 'p:<phrase>' = free phrase
  lemma: string // bare
  accented: string
  pos: string
  meaning: string
  note: string // e.g. "perfective · pair: решать"
  lemmaId?: number
  forms: string[] // forms encountered (display)
  firstSeen: number
  lastSeen: number
  exposures: number
  flashReviews: number
  sentenceReviews: number
  sentGood: number
  sentRecent: number[]
  sentTags: string[]
  lastRating?: number
  level: Level
  stability: number
  masteredAt?: number
  addedAt: number
  suspended?: boolean
}

export interface CardRow extends Fsrs {
  id?: number
  wordId: string
  dir: 'ru-en' | 'en-ru'
  form: string // display form (accented when known)
  formKey: string // normalized
  tag: string
  meaning: string
  created: number
  suspended?: boolean
}

export interface SentenceRow extends Fsrs {
  id?: number
  wordId: string
  tag: string
  target: string // exact surface form expected inside the sentence
  en: string
  ru: string
  created: number
  flagged?: boolean
}

export interface LogRow {
  id?: number
  ts: number
  kind: 'card' | 'sentence'
  wordId: string
  rating: number
  ms: number
}

export interface StoryRow {
  id?: number
  title: string
  text: string
  source: 'imported' | 'generated'
  created: number
  lastOpened: number
  reads: number
  marks: Record<string, 'tap' | 'hard' | 'learn'>
  targets: string[] // wordIds
  familiarPct?: number
}

export interface TimeRow {
  key: string // `${day}|${kind}`
  day: string
  kind: 'cards' | 'sentences' | 'reading'
  ms: number
}

export interface HardRow {
  id: string // wordId
  ts: number
  form: string
}

class RuDB extends Dexie {
  words!: Table<Word, string>
  cards!: Table<CardRow, number>
  sentences!: Table<SentenceRow, number>
  log!: Table<LogRow, number>
  stories!: Table<StoryRow, number>
  time!: Table<TimeRow, string>
  hard!: Table<HardRow, string>
  constructor() {
    super('russian')
    this.version(1).stores({
      words: 'id, level, lastSeen',
      cards: '++id, wordId, due, state, [wordId+dir]',
      sentences: '++id, wordId, due',
      log: '++id, ts, kind, wordId',
      stories: '++id, lastOpened',
      time: 'key, day',
      hard: 'id',
    })
  }
}

export const db = new RuDB()
