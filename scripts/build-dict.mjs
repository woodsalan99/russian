// Builds the offline dictionary shards from OpenRussian CSVs (CC BY-SA 4.0) + a frequency list.
// Output: public/dict/lemmas/<n>.json (lemma entries, 400 per shard)
//         public/dict/forms/<prefix>.json (normalized form -> [[lemmaId, tag], ...])
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve('dictsrc')
const OUT = path.resolve('public/dict')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(path.join(OUT, 'lemmas'), { recursive: true })
fs.mkdirSync(path.join(OUT, 'forms'), { recursive: true })

const norm = (s) => s.toLowerCase().replace(/['́]/g, '').replace(/ё/g, 'е').trim()

function readTsv(file) {
  const lines = fs.readFileSync(path.join(SRC, file), 'utf8').split(/\r?\n/).filter(Boolean)
  const head = lines[0].split('\t')
  return lines.slice(1).map((l) => {
    const c = l.split('\t')
    const o = {}
    head.forEach((h, i) => (o[h] = (c[i] ?? '').trim()))
    return o
  })
}

// frequency: normalized word -> count
const freq = new Map()
for (const l of fs.readFileSync(path.join(SRC, 'freq.txt'), 'utf8').split('\n')) {
  const [w, n] = l.trim().split(' ')
  if (w && n) freq.set(norm(w), (freq.get(norm(w)) ?? 0) + Number(n))
}

const lemmas = []
const clean = (s) => s.replace(/[*\/]/g, '').trim()
const splitForms = (s) => (s ? s.split(',').map((x) => clean(x)).filter(Boolean) : [])
const splitEn = (s) => s.split(/[;,]/).map((x) => x.trim()).filter(Boolean).slice(0, 8)

function add(o, pos, forms) {
  const e = {
    w: o.accented || o.bare,
    b: o.bare,
    p: pos,
    e: splitEn(o.translations_en),
    f: {},
  }
  if (o.gender) e.g = o.gender
  if (o.aspect) e.a = o.aspect === 'perfective' ? 'pf' : 'impf'
  if (o.partner) e.pt = o.partner.split(';').map((x) => x.trim()).filter(Boolean)
  for (const [tag, val] of Object.entries(forms)) {
    const arr = splitForms(val)
    if (arr.length) e.f[tag] = arr
  }
  lemmas.push(e)
}

for (const o of readTsv('verbs.csv')) {
  const pf = o.aspect === 'perfective'
  const f = {
    inf: o.accented,
    imp_sg: o.imperative_sg, imp_pl: o.imperative_pl,
    past_m: o.past_m, past_f: o.past_f, past_n: o.past_n, past_pl: o.past_pl,
  }
  const pre = pf ? 'fut' : 'pres'
  for (const k of ['sg1', 'sg2', 'sg3', 'pl1', 'pl2', 'pl3']) f[`${pre}_${k}`] = o[`presfut_${k}`]
  add(o, 'verb', f)
}
for (const o of readTsv('nouns.csv')) {
  const f = {}
  for (const n of ['sg', 'pl']) for (const c of ['nom', 'gen', 'dat', 'acc', 'inst', 'prep']) f[`${n}_${c}`] = o[`${n}_${c}`]
  add(o, 'noun', f)
}
for (const o of readTsv('adjectives.csv')) {
  const f = { comp: o.comparative, sup: o.superlative, short_m: o.short_m, short_f: o.short_f, short_n: o.short_n, short_pl: o.short_pl }
  for (const g of ['m', 'f', 'n', 'pl']) for (const c of ['nom', 'gen', 'dat', 'acc', 'inst', 'prep']) f[`${g}_${c}`] = o[`decl_${g}_${c}`]
  add(o, 'adj', f)
}
for (const o of readTsv('others.csv')) add(o, 'other', { base: o.accented || o.bare })

// score each lemma by summed frequency of its distinct forms
for (const e of lemmas) {
  const seen = new Set([norm(e.b)])
  for (const arr of Object.values(e.f)) for (const x of arr) seen.add(norm(x))
  let s = 0
  for (const x of seen) s += freq.get(x) ?? 0
  e.s = s
}
// stable id by descending frequency so common words get low ids (and a rank)
lemmas.sort((a, b) => b.s - a.s || a.b.localeCompare(b.b))
lemmas.forEach((e, i) => (e.i = i))

// form index
const forms = new Map() // norm -> Map(id -> Set(tags))
const addForm = (f, id, tag) => {
  const k = norm(f)
  if (!k || k.includes(' ') && false) return
  let m = forms.get(k)
  if (!m) forms.set(k, (m = new Map()))
  let t = m.get(id)
  if (!t) m.set(id, (t = new Set()))
  t.add(tag)
}
for (const e of lemmas) {
  addForm(e.b, e.i, 'lemma')
  for (const [tag, arr] of Object.entries(e.f)) for (const x of arr) addForm(x, e.i, tag)
}

const SHARD = 400
for (let i = 0; i * SHARD < lemmas.length; i++) {
  const slice = lemmas.slice(i * SHARD, (i + 1) * SHARD).map((e) => {
    const { s, ...rest } = e
    return { ...rest, r: e.i } // r = frequency rank
  })
  fs.writeFileSync(path.join(OUT, 'lemmas', `${i}.json`), JSON.stringify(slice))
}

const prefOf = (k) => k.slice(0, 2)
const shards = new Map()
for (const [k, m] of forms) {
  const p = prefOf(k)
  if (!shards.has(p)) shards.set(p, {})
  // candidates sorted by lemma id (== frequency order)
  shards.get(p)[k] = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([id, tags]) => [id, [...tags]])
}
let maxSize = 0, total = 0
const names = []
for (const [p, obj] of shards) {
  const name = Buffer.from(p).toString('hex')
  const s = JSON.stringify(obj)
  fs.writeFileSync(path.join(OUT, 'forms', `${name}.json`), s)
  maxSize = Math.max(maxSize, s.length)
  total += s.length
  names.push(name)
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ lemmaShardSize: SHARD, lemmaShards: Math.ceil(lemmas.length / SHARD), formShards: names, lemmas: lemmas.length, forms: forms.size }))
console.log({ lemmas: lemmas.length, forms: forms.size, formShards: shards.size, maxShardKB: Math.round(maxSize / 1024), totalFormsMB: (total / 1048576).toFixed(1) })
