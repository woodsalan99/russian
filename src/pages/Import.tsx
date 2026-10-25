import { useState } from 'preact/hooks'
import { db } from '../db'
import { type ImpItem, parseNotes, restatus } from '../importer'
import { addCard } from '../store'
import { accent } from '../dict'
import { Spinner } from '../components'
import { go, toast } from '../util'

const SAMPLE = `вышел - went out
стояла - was standing
смеялась - was laughing
решил = decided
тихий quiet`

export function ImportPage() {
  const [mode, setMode] = useState<'words' | 'story'>('words')
  return (
    <div class="page">
      <div class="top">
        <button class="icon-btn" onClick={() => history.length > 1 ? history.back() : go('home')}>←</button>
        <h1>Import</h1>
      </div>
      <div class="seg" style={{ marginBottom: 16 }}>
        <button class={mode === 'words' ? 'on' : ''} onClick={() => setMode('words')}>Vocabulary</button>
        <button class={mode === 'story' ? 'on' : ''} onClick={() => setMode('story')}>Story</button>
      </div>
      {mode === 'words' ? <WordsImport /> : <StoryImport />}
    </div>
  )
}

function WordsImport() {
  const [text, setText] = useState('')
  const [items, setItems] = useState<ImpItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<number | null>(null)

  async function parse() {
    setBusy(true)
    try {
      setItems(await parseNotes(text))
    } finally {
      setBusy(false)
    }
  }
  async function repick(i: number, pick: number) {
    const next = items!.map((x) => ({ ...x }))
    next[i].pick = pick
    await restatus(next)
    setItems(next)
    setOpen(null)
  }
  async function commit() {
    const chosen = items!.filter((x) => x.checked && x.status !== 'dupe')
    let n = 0
    for (const it of chosen) {
      const { created } = await addCard(it.info, it.form, it.tag, it.meaning || it.info.meaning)
      if (created) n++
    }
    toast(`Added ${n} card${n === 1 ? '' : 's'}`)
    setItems(null)
    setText('')
    go('home')
  }

  if (!items)
    return (
      <div>
        <label class="lbl" style={{ marginTop: 0 }}>Paste your notes — any messy format</label>
        <textarea class="big ru" placeholder={SAMPLE} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        <button class="btn block" style={{ marginTop: 12 }} disabled={!text.trim() || busy} onClick={parse}>
          {busy ? <Spinner /> : 'Find words'}
        </button>
        <p class="muted small">Nothing becomes a flashcard until you approve it on the next screen.</p>
      </div>
    )

  const nNew = items.filter((x) => x.status === 'new' || x.status === 'missing').length
  const nLib = items.length - nNew
  const sel = items.filter((x) => x.checked && x.status !== 'dupe').length
  return (
    <div>
      <div class="summary">
        <span><b>{items.length}</b>found</span>
        <span style={{ color: 'var(--accent)' }}><b>{nNew}</b>new</span>
        <span class="muted"><b>{nLib}</b>already in library</span>
      </div>
      <div class="row" style={{ marginBottom: 10 }}>
        <button class="btn sm ghost" onClick={() => setItems(items.map((x) => ({ ...x, checked: x.status === 'new' || x.status === 'missing' })))}>Select new</button>
        <button class="btn sm plain" onClick={() => setItems(items.map((x) => ({ ...x, checked: false })))}>None</button>
        <span class="grow" />
        <button class="btn sm plain" onClick={() => setItems(null)}>Edit text</button>
      </div>
      {items.map((it, i) => (
        <div>
          <div class="item" style={{ opacity: it.status === 'dupe' ? 0.55 : 1 }}>
            <button
              class={`check ${it.checked && it.status !== 'dupe' ? 'on' : ''}`}
              disabled={it.status === 'dupe'}
              onClick={() => setItems(items.map((x, j) => (j === i ? { ...x, checked: !x.checked } : x)))}
            >
              {it.checked && it.status !== 'dupe' ? '✓' : ''}
            </button>
            <div class="grow">
              <div class="t ru">{accent(it.form)}</div>
              <div class="small">{it.meaning || <span class="muted">no meaning found — add one in Words later</span>}</div>
              <div class="small muted">
                {it.info.pos !== 'phrase' && <>→ <b class="ru">{accent(it.info.accented)}</b> · </>}
                {it.label}
                {it.hits.length > 1 && (
                  <button class="chip" style={{ marginLeft: 6 }} onClick={() => setOpen(open === i ? null : i)}>{it.hits.length} meanings</button>
                )}
              </div>
            </div>
            <span class={`badge b-${it.status}`}>{it.status === 'newform' ? 'new form' : it.status === 'dupe' ? 'in library' : it.status === 'missing' ? 'no match' : 'new'}</span>
          </div>
          {open === i && (
            <div class="card" style={{ margin: '6px 0 8px' }}>
              {it.hits.map((h, k) => (
                <button class="row" style={{ width: '100%', padding: '8px 0', textAlign: 'left', fontWeight: k === it.pick ? 700 : 400 }} onClick={() => repick(i, k)}>
                  <span class="ru">{accent(h.lemma.w)}</span>
                  <span class="muted small grow">{h.lemma.e.slice(0, 3).join(', ')}</span>
                  {k === it.pick && <span>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <div style={{ position: 'sticky', bottom: 'calc(76px + var(--safe-b))', marginTop: 16 }}>
        <button class="btn block" disabled={!sel} onClick={commit}>Learn {sel} word{sel === 1 ? '' : 's'}</button>
      </div>
    </div>
  )
}

function StoryImport() {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  async function save() {
    const t = text.trim()
    const first = t.split('\n')[0].slice(0, 40)
    const id = (await db.stories.add({
      title: title.trim() || first || 'Story',
      text: t,
      source: 'imported',
      created: Date.now(),
      lastOpened: Date.now(),
      reads: 0,
      marks: {},
      targets: [],
    })) as number
    go(`reader/${id}`)
  }
  return (
    <div>
      <label class="lbl" style={{ marginTop: 0 }}>Title (optional)</label>
      <input class="txt" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} placeholder="e.g. Утро в Москве" />
      <label class="lbl">Paste the Russian story</label>
      <textarea class="big ru" style={{ minHeight: 240 }} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      <button class="btn block" style={{ marginTop: 12 }} disabled={text.trim().length < 5} onClick={save}>Save &amp; open in Reader</button>
    </div>
  )
}
