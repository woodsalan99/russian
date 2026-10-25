import { db, LEVELS } from '../db'
import { Empty, useLive } from '../components'
import { LEVEL_LABEL, isWeak } from '../srs'
import { DAY, dayKey, fmtDur } from '../util'

const LV_COLOR: Record<string, string> = {
  new: '#9aa3b8', learning: '#ef5b5b', familiar: '#f0a23a', strong: '#3bb273', productive: '#4f6bff', mastered: '#9b51e0',
}

export function ProgressPage() {
  const d = useLive(async () => {
    const now = Date.now()
    const words = await db.words.toArray()
    const time = await db.time.toArray()
    const logs = await db.log.where('ts').above(now - 90 * DAY).toArray()
    return { words, time, logs, now }
  })
  if (!d) return <div class="page" />
  const { words, time, logs, now } = d
  if (!words.length)
    return (
      <div class="page">
        <div class="top"><h1>Progress</h1></div>
        <Empty title="Nothing to show yet">Add words and study a little — progress is measured by words that stick, not minutes spent.</Empty>
      </div>
    )

  const today = dayKey()
  const tMs = (kind: string, from: string) => time.filter((t) => t.kind === kind && t.day >= from).reduce((s, t) => s + t.ms, 0)
  const weekFrom = dayKey(now - 6 * DAY)
  const monthFrom = dayKey(now - 29 * DAY)
  const todayCards = logs.filter((l) => l.kind === 'card' && dayKey(l.ts) === today).length
  const todaySent = logs.filter((l) => l.kind === 'sentence' && dayKey(l.ts) === today).length

  const mastered = words.filter((w) => w.level === 'mastered')
  const masteredWeek = words.filter((w) => w.masteredAt && w.masteredAt > now - 7 * DAY).length
  const masteredMonth = words.filter((w) => w.masteredAt && w.masteredAt > now - 30 * DAY).length
  const learning = words.filter((w) => w.level !== 'new' && w.level !== 'mastered').length
  const weak = words.filter(isWeak).length

  const weekMs = ['cards', 'sentences', 'reading'].reduce((s, k) => s + tMs(k, weekFrom), 0)
  const perHour = weekMs > 5 * 60000 ? masteredWeek / (weekMs / 3600000) : null

  const acc = (kind: string) => {
    const l = logs.filter((x) => x.kind === kind && x.ts > now - 30 * DAY)
    return l.length ? Math.round((l.filter((x) => x.rating >= 2).length / l.length) * 100) : null
  }

  // streak
  const activeDays = new Set<string>([...logs.map((l) => dayKey(l.ts)), ...time.filter((t) => t.ms > 120000).map((t) => t.day)])
  let streak = 0
  for (let i = activeDays.has(today) ? 0 : 1; i < 400; i++) {
    if (activeDays.has(dayKey(now - i * DAY))) streak++
    else break
  }

  // cumulative mastered per week, last 12 weeks
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const end = now - (11 - i) * 7 * DAY
    return words.filter((w) => w.masteredAt && w.masteredAt <= end).length
  })
  const maxW = Math.max(1, ...weeks)

  const lvCount = (l: string) => words.filter((w) => w.level === l).length

  return (
    <div class="page">
      <div class="top"><h1>Progress</h1></div>

      <div class="card">
        <div class="muted small">Words mastered</div>
        <div class="row" style={{ alignItems: 'flex-end', gap: 14, margin: '4px 0 10px' }}>
          <div class="big-num">{mastered.length}</div>
          <div style={{ paddingBottom: 6 }}>
            <div style={{ color: 'var(--good)', fontWeight: 700 }}>+{masteredWeek} this week</div>
            <div class="muted small">+{masteredMonth} this month</div>
          </div>
        </div>
        <svg viewBox="0 0 300 70" style={{ width: '100%', height: 70 }} preserveAspectRatio="none">
          <polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"
            points={weeks.map((v, i) => `${(i / 11) * 296 + 2},${66 - (v / maxW) * 60}`).join(' ')} />
          {weeks.map((v, i) => <circle cx={(i / 11) * 296 + 2} cy={66 - (v / maxW) * 60} r={i === 11 ? 3.5 : 0} fill="var(--accent)" />)}
        </svg>
        <div class="muted small" style={{ display: 'flex', justifyContent: 'space-between' }}><span>12 weeks ago</span><span>now</span></div>
      </div>

      <div class="grid2" style={{ marginTop: 12 }}>
        <div class="card stat"><b>{learning}</b><span>learning</span></div>
        <div class="card stat"><b style={{ color: weak ? 'var(--again)' : undefined }}>{weak}</b><span>currently weak</span></div>
        <div class="card stat"><b>{words.length}</b><span>active words</span></div>
        <div class="card stat"><b>{words.reduce((s, w) => s + w.exposures, 0)}</b><span>story exposures</span></div>
      </div>

      <div class="card" style={{ marginTop: 12 }}>
        <div class="row"><b class="grow">Today</b><span class="muted small">{streak > 0 ? `🔥 ${streak}-day streak` : 'no streak yet'}</span></div>
        <div class="grid2" style={{ marginTop: 10 }}>
          <div class="stat"><b>{fmtDur(tMs('cards', today) + tMs('sentences', today) + tMs('reading', today))}</b><span>studied</span></div>
          <div class="stat"><b>{todayCards}</b><span>flashcards</span></div>
          <div class="stat"><b>{todaySent}</b><span>sentences</span></div>
          <div class="stat"><b>{fmtDur(tMs('reading', today))}</b><span>reading</span></div>
        </div>
      </div>

      <div class="card" style={{ marginTop: 12 }}>
        <b>This week</b>
        <div class="muted" style={{ margin: '2px 0 10px' }}>
          {fmtDur(weekMs)} studied · {masteredWeek} word{masteredWeek === 1 ? '' : 's'} mastered
          {perHour !== null && ` · ${perHour.toFixed(1)} mastered/hour`}
        </div>
        {(['cards', 'sentences', 'reading'] as const).map((k) => {
          const ms = tMs(k, weekFrom)
          return (
            <div class="row small" style={{ marginBottom: 6 }}>
              <span style={{ width: 80, textTransform: 'capitalize' }}>{k === 'cards' ? 'Flashcards' : k}</span>
              <div class="bar" style={{ flex: 1 }}><i style={{ width: `${weekMs ? (ms / weekMs) * 100 : 0}%` }} /></div>
              <span class="muted" style={{ width: 52, textAlign: 'right' }}>{fmtDur(ms)}</span>
            </div>
          )
        })}
        <div class="grid2" style={{ marginTop: 10 }}>
          <div class="stat"><b>{acc('card') ?? '—'}{acc('card') !== null && '%'}</b><span>flashcards remembered (30d)</span></div>
          <div class="stat"><b>{acc('sentence') ?? '—'}{acc('sentence') !== null && '%'}</b><span>sentences remembered (30d)</span></div>
        </div>
        <div class="muted small" style={{ marginTop: 8 }}>Month: {fmtDur(tMs('cards', monthFrom) + tMs('sentences', monthFrom) + tMs('reading', monthFrom))} studied · {masteredMonth} mastered</div>
      </div>

      <div class="card" style={{ marginTop: 12 }}>
        <b>Where your words are</b>
        <div class="lvbar" style={{ margin: '10px 0' }}>
          {LEVELS.map((l) => <i style={{ width: `${(lvCount(l) / words.length) * 100}%`, background: LV_COLOR[l] }} />)}
        </div>
        <div class="row small" style={{ flexWrap: 'wrap', gap: '4px 14px' }}>
          {LEVELS.map((l) => <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: LV_COLOR[l], marginRight: 5 }} />{LEVEL_LABEL[l]} {lvCount(l)}</span>)}
        </div>
      </div>
    </div>
  )
}
