import { useState } from 'preact/hooks'
import { db, LEVELS, type Level, type Word } from '../db'
import { FormsTable, LevelBadge, Sheet, Empty, useLive } from '../components'
import { getLemma, accent, type Lemma } from '../dict'
import { LEVEL_LABEL, isWeak } from '../srs'
import { refreshWord } from '../store'
import { fmtInterval } from '../util'
import { go, toast } from '../util'

type Filter = Level | 'all' | 'weak'

export function WordsPage() {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const words = useLive(() => db.words.toArray(), [])
  const list = (words ?? [])
    .filter((w) => (filter === 'all' ? true : filter === 'weak' ? isWeak(w) : w.level === filter))
    .filter((w) => !q || (w.lemma + ' ' + w.meaning + ' ' + w.forms.join(' ')).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.addedAt - a.addedAt)
  const count = (l: Filter) => (words ?? []).filter((w) => (l === 'all' ? true : l === 'weak' ? isWeak(w) : w.level === l)).length
  return (
    <div class="page">
      <div class="top">
        <h1>Words</h1>
        <button class="icon-btn" onClick={() => go('import')}>＋</button>
      </div>
      <input class="txt" placeholder="Search Russian or English" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      <div class="row" style={{ overflowX: 'auto', margin: '12px -16px', padding: '0 16px', gap: 6 }}>
        {(['all', ...LEVELS, 'weak'] as Filter[]).map((f) => (
          <button class="chip" style={{ whiteSpace: 'nowrap', opacity: filter === f ? 1 : 0.5, padding: '6px 12px' }} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'weak' ? 'Weak' : LEVEL_LABEL[f]} {count(f)}
          </button>
        ))}
      </div>
      {words && list.length === 0 && <Empty title={words.length ? 'No matches' : 'No words yet'}>{!words.length && 'Import some vocabulary to get started.'}</Empty>}
      {list.map((w) => (
        <button class="item" style={{ width: '100%', textAlign: 'left' }} onClick={() => setOpen(w.id)}>
          <div class="grow">
            <div class="t ru">{accent(w.accented)}</div>
            <div class="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.meaning}</div>
          </div>
          <LevelBadge level={w.level} />
        </button>
      ))}
      {open && <WordSheet id={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function WordSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const w = useLive(() => db.words.get(id), [id])
  const cards = useLive(() => db.cards.where('wordId').equals(id).toArray(), [id])
  const [lemma, setLemma] = useState<Lemma | null>(null)
  const [showForms, setShowForms] = useState(false)
  const [editing, setEditing] = useState(false)
  const [meaning, setMeaning] = useState('')
  if (!w) return null
  const load = async () => {
    if (w.lemmaId !== undefined && !lemma) setLemma(await getLemma(w.lemmaId))
    setShowForms(!showForms)
  }
  async function saveMeaning() {
    await db.words.update(id, { meaning })
    await db.cards.where('wordId').equals(id).modify((c) => {
      if (c.dir === 'ru-en' || c.dir === 'en-ru') c.meaning = meaning
    })
    setEditing(false)
  }
  async function remove() {
    if (!confirm(`Delete “${w!.lemma}” and all its cards?`)) return
    await db.cards.where('wordId').equals(id).delete()
    await db.sentences.where('wordId').equals(id).delete()
    await db.words.delete(id)
    onClose()
    toast('Deleted')
  }
  async function toggleSuspend() {
    await db.words.update(id, { suspended: !w!.suspended })
    toast(w!.suspended ? 'Back in rotation' : 'Paused — no reviews')
  }
  async function addProd() {
    const c = cards?.find((x) => x.dir === 'ru-en')
    if (!c || cards?.some((x) => x.dir === 'en-ru')) return toast('Already has an English → Russian card')
    const { newFsrs } = await import('../srs')
    const now = Date.now()
    await db.cards.add({ ...c, id: undefined, dir: 'en-ru', created: now, ...newFsrs(now) })
    await refreshWord(id)
    toast('English → Russian card added')
  }
  return (
    <Sheet onClose={onClose}>
      <div class="row">
        <h2 class="ru grow">{accent(w.accented)}</h2>
        <LevelBadge level={w.level} />
      </div>
      {editing ? (
        <div class="row" style={{ margin: '8px 0' }}>
          <input class="txt" value={meaning} onInput={(e) => setMeaning((e.target as HTMLInputElement).value)} />
          <button class="btn sm" onClick={saveMeaning}>Save</button>
        </div>
      ) : (
        <div style={{ fontSize: 18, margin: '4px 0 10px' }} onClick={() => (setMeaning(w.meaning), setEditing(true))}>
          {w.meaning || <span class="muted">Tap to add a meaning</span>} <span class="muted small">✎</span>
        </div>
      )}
      {w.note && <div class="muted small">{w.note}</div>}
      <dl class="kv" style={{ marginTop: 10 }}>
        <dt>Forms met</dt><dd class="ru">{w.forms.join(', ') || '—'}</dd>
        <dt>First seen</dt><dd>{new Date(w.firstSeen).toLocaleDateString()}</dd>
        <dt>Last seen</dt><dd>{new Date(w.lastSeen).toLocaleDateString()}</dd>
        <dt>In stories</dt><dd>{w.exposures}× in context</dd>
        <dt>Flashcards</dt><dd>{w.flashReviews} reviews</dd>
        <dt>Sentences</dt><dd>{w.sentenceReviews} practised{w.sentenceReviews ? ` · ${w.sentGood} good` : ''}</dd>
        <dt>Memory</dt><dd>{w.stability ? `stable for ~${fmtInterval(w.stability * 86400000)}` : 'not yet reviewed'}</dd>
      </dl>
      {cards && cards.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div class="muted small" style={{ marginBottom: 4 }}>Cards</div>
          {cards.map((c) => (
            <div class="row small" style={{ padding: '3px 0' }}>
              <span class="grow ru">{c.dir === 'ru-en' ? 'RU→EN' : 'EN→RU'} · {accent(c.form)}</span>
              <span class="muted">{c.reps === 0 ? 'new' : c.due <= Date.now() ? 'due' : `in ${fmtInterval(c.due - Date.now())}`}</span>
            </div>
          ))}
        </div>
      )}
      {w.lemmaId !== undefined && (
        <div style={{ marginTop: 10 }}>
          <button class="small" style={{ color: 'var(--accent)', fontWeight: 600 }} onClick={load}>{showForms ? 'Hide' : 'Show'} all forms</button>
          {showForms && lemma && <FormsTable lemma={lemma} />}
        </div>
      )}
      <div class="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
        <button class="btn sm ghost" onClick={addProd}>＋ English → Russian</button>
        <button class="btn sm plain" onClick={toggleSuspend}>{w.suspended ? 'Resume' : 'Pause'}</button>
        <button class="btn sm danger" onClick={remove}>Delete</button>
      </div>
    </Sheet>
  )
}
export type { Word }
