import { useEffect, useRef, useState } from 'preact/hooks'
import { db, type SentenceRow, type Word } from '../db'
import { generateSentences, pickSentenceWords } from '../ai'
import { preview } from '../srs'
import { refreshWord, useStudyTimer } from '../store'
import { Empty, Icon, Spinner } from '../components'
import { getSettings, go, shuffle, speak, toast } from '../util'

type Phase = 'loading' | 'empty' | 'error' | 'run' | 'done'

export function SentencePage() {
  useStudyTimer('sentences')
  const [phase, setPhase] = useState<Phase>('loading')
  const [err, setErr] = useState('')
  const [queue, setQueue] = useState<SentenceRow[]>([])
  const [words, setWords] = useState<Map<string, Word>>(new Map())
  const [shown, setShown] = useState(false)
  const [secs, setSecs] = useState(0)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [good, setGood] = useState(0)
  const started = useRef(Date.now())
  const N = getSettings().sentencesPerSession

  async function prepare() {
    setPhase('loading')
    setErr('')
    const cand = await pickSentenceWords(N * 2)
    if (!cand.length) return setPhase('empty')
    const dueNow = async () => {
      const now = Date.now()
      return db.sentences.filter((s) => !s.flagged && s.due <= now).toArray()
    }
    let pool = await dueNow()
    // sentences for words we still can't cover → generate
    const have = new Set(pool.map((s) => s.wordId))
    if (pool.length < N) {
      try {
        const need = cand.filter((w) => !have.has(w.id)).slice(0, N - pool.length + 2)
        if (need.length) await generateSentences(need)
        pool = await dueNow()
      } catch (e: any) {
        if (!pool.length) {
          setErr(e.message || String(e))
          return setPhase('error')
        }
      }
    }
    if (!pool.length) {
      setErr('No sentences could be generated. Try again in a moment.')
      return setPhase('error')
    }
    // never-seen first, then due; one per word at a time for variety
    const byWord = new Map<string, SentenceRow>()
    for (const s of shuffle(pool).sort((a, b) => a.reps - b.reps)) if (!byWord.has(s.wordId)) byWord.set(s.wordId, s)
    const q = shuffle([...byWord.values()]).slice(0, N)
    const ws = await db.words.bulkGet(q.map((s) => s.wordId))
    setWords(new Map(ws.filter(Boolean).map((w) => [w!.id, w!])))
    setQueue(q)
    setTotal(q.length)
    setDone(0)
    setGood(0)
    setPhase('run')
  }
  useEffect(() => { prepare() }, [])

  const cur = queue[0]
  useEffect(() => {
    setShown(false)
    started.current = Date.now()
    const t = getSettings().thinkSecs
    setSecs(t)
    if (!cur || !t) return
    const iv = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(iv)
  }, [cur?.id])

  async function grade(g: 1 | 2 | 3 | 4) {
    if (!cur) return
    const next = preview(cur)[g].fsrs
    const ms = Date.now() - started.current
    const now = Date.now()
    await db.sentences.put({ ...cur, ...next })
    await db.log.add({ ts: now, kind: 'sentence', wordId: cur.wordId, rating: g, ms })
    const w = await db.words.get(cur.wordId)
    if (w) {
      w.sentenceReviews++
      if (g >= 3) w.sentGood++
      w.sentRecent = [...w.sentRecent, g].slice(-6)
      if (!w.sentTags.includes(cur.tag)) w.sentTags.push(cur.tag)
      w.lastSeen = now
      w.lastRating = g
      await db.words.put(w)
      await refreshWord(w.id)
    }
    if (g >= 3) setGood((x) => x + 1)
    setDone((d) => d + 1)
    const rest = queue.slice(1)
    setQueue(rest)
    if (!rest.length) {
      setPhase('done')
      // warm the bank for next time
      pickSentenceWords(8).then((c) => generateSentences(c).catch(() => {}))
    }
  }

  async function flag() {
    if (!cur) return
    await db.sentences.update(cur.id!, { flagged: true })
    toast('Removed — thanks')
    setQueue((q) => q.slice(1))
    if (queue.length <= 1) setPhase('done')
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (phase !== 'run') return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        shown ? grade(3) : setShown(true)
      } else if (shown && ['1', '2', '3', '4'].includes(e.key)) grade(Number(e.key) as 1 | 2 | 3 | 4)
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  })

  if (phase === 'loading')
    return (
      <div class="page center" style={{ paddingTop: 120 }}>
        <Spinner />
        <p class="muted">Preparing sentences from your words…</p>
      </div>
    )
  if (phase === 'empty')
    return (
      <div class="page">
        <div class="top"><button class="icon-btn" onClick={() => go('home')}>←</button><h1>Sentences</h1></div>
        <Empty title="Learn a few words first">Sentence practice uses words you've started reviewing. Import some vocabulary and do a flashcard session.</Empty>
        <div class="row" style={{ justifyContent: 'center' }}><button class="btn" onClick={() => go('import')}>Import words</button></div>
      </div>
    )
  if (phase === 'error')
    return (
      <div class="page">
        <div class="top"><button class="icon-btn" onClick={() => go('home')}>←</button><h1>Sentences</h1></div>
        <div class="err">{err}</div>
        <div class="row" style={{ marginTop: 14 }}>
          <button class="btn grow" onClick={prepare}>Try again</button>
          <button class="btn plain grow" onClick={() => go('settings')}>Settings</button>
        </div>
      </div>
    )
  if (phase === 'done')
    return (
      <div class="page full" style={{ justifyContent: 'center' }}>
        <div class="card center" style={{ padding: 28 }}>
          <div style={{ fontSize: 48 }}>🗣️</div>
          <h2>{total} sentences done</h2>
          <p class="muted">{good} of {total} felt good</p>
          <div class="stack" style={{ marginTop: 16 }}>
            <button class="btn block" onClick={prepare}>Practice more</button>
            <button class="btn ghost block" onClick={() => go('reader')}>Read a story</button>
            <button class="btn plain block" onClick={() => go('home')}>Back</button>
          </div>
        </div>
      </div>
    )

  const w = words.get(cur.wordId)
  const prev = shown ? preview(cur) : null
  const think = getSettings().thinkSecs
  return (
    <div class="page full" style={{ paddingBottom: 'calc(16px + var(--safe-b))' }}>
      <div class="rv-top">
        <button class="icon-btn" onClick={() => go('home')}>✕</button>
        <div class="bar"><i style={{ width: `${(done / Math.max(1, total)) * 100}%` }} /></div>
        <span class="muted small">{done}/{total}</span>
      </div>
      <div class="card-face" onClick={() => !shown && setShown(true)}>
        <div class="prompt">{cur.en}</div>
        {w && <span class="chip">{w.lemma}</span>}
        {!shown && think > 0 && <div class="muted small">{secs > 0 ? `Say it out loud… ${secs}` : 'Ready when you are'}</div>}
        {shown && (
          <>
            <div class="divider" />
            <div class="face-main ru" style={{ fontSize: 34 }}>{cur.ru}</div>
            <div class="row">
              <button class="icon-btn" style={{ width: 38, height: 38 }} onClick={(e) => (e.stopPropagation(), speak(cur.ru))}>{Icon.speak}</button>
              <button class="small muted" onClick={(e) => (e.stopPropagation(), flag())}>Sounds wrong</button>
            </div>
          </>
        )}
      </div>
      {!shown ? (
        <button class={`btn show-btn ${think > 0 && secs === 0 ? 'pulse' : ''}`} onClick={() => setShown(true)}>Reveal</button>
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
  )
}
