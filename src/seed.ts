import { db } from './db'
import { parseNotes } from './importer'
import { addCard } from './store'

const FLAG = 'ru-seeded-noji'

/** Loads the starter deck (the user's Noji cards) through the normal import pipeline. */
export async function loadStarterDeck(onProgress?: (msg: string) => void): Promise<number> {
  const r = await fetch(`${import.meta.env.BASE_URL}seed/noji.tsv`)
  if (!r.ok) throw new Error('Starter deck not found')
  onProgress?.('Matching words to the dictionary…')
  const text = await r.text()
  if (text.trimStart().startsWith('<')) throw new Error('Starter deck not found')
  const items = await parseNotes(text)
  let n = 0
  for (const it of items) {
    if (it.status === 'dupe') continue
    const { created } = await addCard(it.info, it.form, it.tag, it.meaning || it.info.meaning)
    if (created) n++
  }
  try {
    localStorage.setItem(FLAG, '1')
  } catch {}
  return n
}

export async function seedIfFirstRun(onProgress?: (msg: string) => void): Promise<number> {
  try {
    if (localStorage.getItem(FLAG)) return 0
  } catch {}
  if ((await db.words.count()) > 0) return 0
  return loadStarterDeck(onProgress)
}
