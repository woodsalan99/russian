import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { db, type CardRow, type Word } from '../db'
import { bumpNewIntroduced, newIntroducedToday, rateCard, useStudyTimer } from '../store'
import { preview } from '../srs'
import { accent, tagLabel } from '../dict'
import { Icon } from '../components'
import { getSettings, go, speak } from '../util'

export async function buildQueue() {
  const now = Date.now()
  const susp = new Set((await db.words.filter((w) => !!w.suspended).toArray()).map((w) => w.id))
  const live = (await db.cards.toArray()).filter((c) => !c.suspended && !susp.has(c.wordId))
  const learning = live.filter((c) => c.reps > 0 && (c.state === 1 || c.state === 3) && c.due <= now + 20 * 60000).sort((a, b) => a.due - b.due)
  const due = live.filter((c) => c.state === 2 && c.due <= now).sort((a, b) => a.due - b.due)
  const newAll = live.filter((c) => c.reps === 0).sort((a, b) => a.created - b.created)
  const allowed = Math.max(0, getSettings().newPerDay - newIntroducedToday())
  return { learning, due, news: newAll.slice(0, allowed), newTotal: newAll.length }
}

export function ReviewSession() {
  useStudyTimer('cards')
  const [queue, setQueue] = useState<CardRow[] | null>(null)
  const [words, setWords] = useState<Map<string, Word>>(new Map())
  const [shown, setShown] = useState(false)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 })
  const undoRef = useRef<{ undo: () => Promise<void>; card: CardRow; wasNew: boolean; rating: number } | null>(null)
  const started = useRef(Date.now())

  useEffect(() => {
    ;(async () => {
      const q = await buildQueue()
      const list = [...q.learning, ...q.due, ...q.news]
      const ws = await db.words.bulkGet([...new Set(list.map((c) => c.wordId))])
      setWords(new Map(ws.filter(Boolean).map((w) => [w!.id, w!])))
      setQueue(list)
      setTotal(list.length)
    })()
  }, [])

  const cur = queue?.[0]
  const word = cur ? words.get(cur.wordId) : undefined
  const prev = useMemo(() => (cur ? preview(cur) : null), [cur?.id, cur?.due, cur?.reps])
  useEffect(() => {
    started.current = Date.now()
    setShown(false)
  }, [cur?.id, cur?.reps])

  async function grade(g: 1 | 2 | 3 | 4) {
    if (!cur || !prev) return
    const ms = Date.now() - started.current
    const wasNew = cur.reps === 0
    const { updated, undo } = await rateCard(cur, g, prev[g].fsrs, ms)
    if (wasNew) bumpNewIntroduced()
    undoRef.current = { undo, card: cur, wasNew, rating: g }
    setStats((s) => ({ ...s, [['', 'again', 'hard', 'good', 'easy'][g]]: (s as any)[['', 'again', 'hard', 'good', 'easy'][g]] + 1 }))
    setQueue((q) => {
      const rest = (q ?? []).slice(1)
      if ((updated.state === 1 || updated.state === 3) && updated.due < Date.now() + 20 * 60000) {
        // re-queue a few cards later so it's not instant when there are others
        const at = Math.min(rest.length, 4)
        rest.splice(at, 0, updated)
      } else setDone((d) => d + 1)
      return rest
    })
    // refresh the word record (level/lastRating changed)
    const w = await db.words.get(cur.wordId)
    if (w) setWords((m) => new Map(m).set(w.id, w))
  }

  async function undo() {
    const u = undoRef.current
    if (!u) return
    await u.undo()
    if (u.wasNew) bumpNewIntroduced(-1)
    undoRef.current = null
    setQueue((q) => {
      const rest = (q ?? []).filter((c) => c.id !== u.card.id)
      return [u.card, ...rest]
    })
    setDone((d) => Math.max(0, d - 1))
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (!shown) setShown(true)
        else grade(3)
      } else if (shown && ['1', '2', '3', '4'].includes(e.key)) grade(Number(e.key) as 1 | 2 | 3 | 4)
      else if ((e.metaKey || e.ctrlKey) && e.key === 'z') undo()
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  })

  if (!queue) return <div class="page full center muted" style={{ justifyContent: 'center' }}>Loading…</div>

  if (!cur) {
    const n = stats.again + stats.hard + stats.good + stats.easy
    return (
      <div class="page full" style={{ justifyContent: 'center' }}>
        <div class="card center" style={{ padding: 28 }}>
          <div style={{ fontSize: 48 }}>🎉</div>
          <h2 style={{ marginTop: 8 }}>{n ? 'Session complete' : 'Nothing due right now'}</h2>
          {n > 0 && (
            <p class="muted">
              {n} reviews · {Math.round(((n - stats.again) / n) * 100)}% remembered
            </p>
          )}
          <div class="stack" style={{ marginTop: 16 }}>
            <button class="btn block" onClick={() => go('sentences')}>Practice sentences</button>
            <button class="btn ghost block" onClick={() => go('reader')}>Read a story</button>
            <button class="btn plain block" onClick={() => go('home')}>Back</button>
          </div>
        </div>
      </div>
    )
  }

  const nNew = queue.filter((c) => c.reps === 0).length
  const nLearn = queue.filter((c) => c.reps > 0 && (c.state === 1 || c.state === 3)).length
  const nDue = queue.length - nNew - nLearn
  const isRuEn = cur.dir === 'ru-en'
  const lemmaLabel = word ? (word.pos === 'verb' ? 'infinitive' : word.pos === 'phrase' ? '' : 'dictionary form') : ''

  return (
    <div class="page full" onClick={() => !shown && setShown(true)}>
      <div class="rv-top" onClick={(e) => e.stopPropagation()}>
        <button class="icon-btn" onClick={() => go('home')} aria-label="Close">✕</button>
        <div class="bar"><i style={{ width: `${(done / Math.max(1, done + queue.length)) * 100}%` }} /></div>
        <div class="rv-counts">
          <span style={{ color: 'var(--new)' }}>{nNew}</span>
          <span style={{ color: 'var(--learn)' }}>{nLearn}</span>
          <span style={{ color: 'var(--due)' }}>{nDue}</span>
        </div>
        <button class="icon-btn" disabled={!undoRef.current} style={{ opacity: undoRef.current ? 1 : 0.35 }} onClick={(e) => (e.stopPropagation(), undo())} aria-label="Undo">↺</button>
      </div>

      <div class="card-face">
        {isRuEn ? (
          <>
            <div class="face-main ru">{accent(cur.form)}</div>
            {!shown && <button class="icon-btn" style={{ width: 36, height: 36 }} onClick={(e) => (e.stopPropagation(), speak(cur.form.replace(/́/g, '')))}>{Icon.speak}</button>}
            {shown && (
              <>
                <div class="divider" />
                <div class="face-main en">{cur.meaning}</div>
                <div class="face-sub">
                  {cur.tag !== 'phrase' && tagLabel(cur.tag)}
                  {word && word.pos !== 'phrase' && word.lemma !== cur.formKey && <div>{lemmaLabel}: <b class="ru">{accent(word.accented)}</b></div>}
                  {word?.note && <div class="small">{word.note}</div>}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div class="face-main en">{cur.meaning}</div>
            <div class="face-sub">{cur.tag !== 'phrase' ? tagLabel(cur.tag) : 'phrase'}{word && word.pos !== 'phrase' && <> · {word.pos}</>}</div>
            {shown && (
              <>
                <div class="divider" />
                <div class="face-main ru">{accent(cur.form)}</div>
                <button class="icon-btn" style={{ width: 36, height: 36 }} onClick={(e) => (e.stopPropagation(), speak(cur.form.replace(/́/g, '')))}>{Icon.speak}</button>
                {word && word.pos !== 'phrase' && <div class="face-sub">{lemmaLabel}: <b class="ru">{accent(word.accented)}</b></div>}
              </>
            )}
          </>
        )}
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        {!shown ? (
          <button class="btn show-btn" onClick={() => setShown(true)}>Show answer</button>
        ) : (
          <div class="grades">
            {([1, 2, 3, 4] as const).map((g) => (
              <button class={`grade g${g}`} onClick={() => grade(g)}>
                {['', 'Again', 'Hard', 'Good', 'Easy'][g]}
                <small>{prev?.[g].label}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
