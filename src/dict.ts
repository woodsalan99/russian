// Offline dictionary access (shards built by scripts/build-dict.mjs from OpenRussian, CC BY-SA 4.0).
export interface Lemma {
  i: number
  w: string // accented lemma, stress marked with '
  b: string // bare lemma
  p: 'verb' | 'noun' | 'adj' | 'other'
  e: string[]
  f: Record<string, string[]>
  g?: string
  a?: 'pf' | 'impf'
  pt?: string[]
  r: number // frequency rank (0 = most common)
}
export interface Hit {
  lemma: Lemma
  tags: string[]
}

const base = import.meta.env.BASE_URL
const jcache = new Map<string, Promise<any>>()
function fetchJson(path: string): Promise<any> {
  let p = jcache.get(path)
  if (!p) {
    p = fetch(`${base}dict/${path}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j) => {
        if (j === null) jcache.delete(path)
        return j
      })
    jcache.set(path, p)
  }
  return p
}

export const norm = (s: string) => s.toLowerCase().replace(/[́']/g, '').replace(/ё/g, 'е').trim()
export const plain = (s: string) => s.replace(/[́']/g, '')
export const accent = (s: string) => s.replace(/'/g, '́')

const hex = (s: string) => Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, '0')).join('')

export async function getLemma(id: number): Promise<Lemma | null> {
  const shard: Lemma[] | null = await fetchJson(`lemmas/${Math.floor(id / 400)}.json`)
  return shard?.[id % 400] ?? null
}

/** All dictionary hits for a surface form, most frequent lemma first. */
export async function lookup(word: string): Promise<Hit[]> {
  const key = norm(word)
  if (!key) return []
  const shard = await fetchJson(`forms/${hex(key.slice(0, 2))}.json`)
  const cands: [number, string[]][] | undefined = shard?.[key]
  if (!cands) return []
  const hits = await Promise.all(
    cands.map(async ([id, tags]) => {
      const lemma = await getLemma(id)
      return lemma ? ({ lemma, tags } as Hit) : null
    }),
  )
  return hits.filter(Boolean) as Hit[]
}

const lookupCache = new Map<string, Promise<Hit[]>>()
export function lookupCached(word: string): Promise<Hit[]> {
  const k = norm(word)
  let p = lookupCache.get(k)
  if (!p) lookupCache.set(k, (p = lookup(k)))
  return p
}

export const wordId = (l: Lemma) => `l${l.i}`

// ---- grammar labels ----
const CASE: Record<string, string> = { nom: 'nominative', gen: 'genitive', dat: 'dative', acc: 'accusative', inst: 'instrumental', prep: 'prepositional' }
const GEND: Record<string, string> = { m: 'masculine', f: 'feminine', n: 'neuter', pl: 'plural' }
const PERS: Record<string, string> = { sg1: 'I', sg2: 'you (sg.)', sg3: 'he / she / it', pl1: 'we', pl2: 'you (pl.)', pl3: 'they' }

export function tagLabel(tag: string): string {
  if (tag === 'lemma' || tag === 'base') return 'dictionary form'
  if (tag === 'inf') return 'infinitive'
  if (tag === 'imp_sg') return 'imperative (you, sg.)'
  if (tag === 'imp_pl') return 'imperative (you, pl.)'
  if (tag === 'comp') return 'comparative'
  if (tag === 'sup') return 'superlative'
  let m: RegExpMatchArray | null
  if ((m = tag.match(/^past_(m|f|n|pl)$/))) return `past, ${GEND[m[1]]}`
  if ((m = tag.match(/^(pres|fut)_(sg[123]|pl[123])$/))) return `${m[1] === 'pres' ? 'present' : 'future'}, ${PERS[m[2]]}`
  if ((m = tag.match(/^short_(m|f|n|pl)$/))) return `short form, ${GEND[m[1]]}`
  if ((m = tag.match(/^(sg|pl)_(nom|gen|dat|acc|inst|prep)$/))) return `${CASE[m[2]]} ${m[1] === 'sg' ? 'singular' : 'plural'}`
  if ((m = tag.match(/^(m|f|n|pl)_(nom|gen|dat|acc|inst|prep)$/))) return `${GEND[m[1]]} ${CASE[m[2]]}`
  return tag
}

/** Best single tag for display. */
export function primaryTag(tags: string[]): string {
  const non = tags.filter((t) => t !== 'lemma')
  return non[0] ?? 'lemma'
}
export function hitLabel(h: Hit): string {
  const non = h.tags.filter((t) => t !== 'lemma')
  if (!non.length) return 'dictionary form'
  return [...new Set(non.slice(0, 3).map(tagLabel))].join(' / ')
}

export const POS: Record<string, string> = { verb: 'verb', noun: 'noun', adj: 'adjective', other: 'word' }

export function gloss(l: Lemma, n = 3): string {
  return l.e.slice(0, n).join(', ') || '—'
}

export function lemmaNote(l: Lemma): string {
  const bits: string[] = []
  if (l.a) bits.push(l.a === 'pf' ? 'perfective' : 'imperfective')
  if (l.pt?.length) bits.push('pair: ' + l.pt.slice(0, 2).map(plain).join(', '))
  if (l.g) bits.push({ m: 'masculine', f: 'feminine', n: 'neuter' }[l.g] ?? l.g)
  return bits.join(' · ')
}

/** Accented spelling of `key` inside the lemma's forms, if the dictionary has it. */
export function accentedForm(l: Lemma, key: string): string | null {
  const k = norm(key)
  if (norm(l.b) === k) return l.w
  for (const arr of Object.values(l.f)) for (const f of arr) if (norm(f) === k) return f
  return null
}

/** Exact (accented) surface form for a tag. */
export function formFor(l: Lemma, tag: string): string | null {
  if (tag === 'lemma') return l.w
  return l.f[tag]?.[0] ?? null
}

/** Pre-download everything so the Reader works fully offline. */
export async function downloadAll(onProgress: (done: number, total: number) => void) {
  const man = await fetchJson('manifest.json')
  if (!man) throw new Error('Could not reach the dictionary files')
  const paths: string[] = []
  for (let i = 0; i < man.lemmaShards; i++) paths.push(`lemmas/${i}.json`)
  for (const n of man.formShards) paths.push(`forms/${n}.json`)
  let done = 0
  let next = 0
  const worker = async () => {
    while (next < paths.length) {
      const p = paths[next++]
      await fetch(`${base}dict/${p}`).then((r) => r.arrayBuffer()).catch(() => {})
      onProgress(++done, paths.length)
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
}

// ---- tokenizer ----
export interface Tok {
  w: boolean
  s: string
  k: string // normalized key (words only)
}
const WORD = /[А-Яа-яЁё́]+(?:[-][А-Яа-яЁё́]+)*/g
export function tokenize(text: string): Tok[] {
  const out: Tok[] = []
  let last = 0
  for (const m of text.matchAll(WORD)) {
    const i = m.index ?? 0
    if (i > last) out.push({ w: false, s: text.slice(last, i), k: '' })
    out.push({ w: true, s: m[0], k: norm(m[0]) })
    last = i + m[0].length
  }
  if (last < text.length) out.push({ w: false, s: text.slice(last), k: '' })
  return out
}
