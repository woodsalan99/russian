import { db } from '../db'
import { useLive } from '../components'
import { buildQueue } from './Review'
import { go, getSettings } from '../util'

export function Home() {
  const q = useLive(async () => {
    const [qq, stories, words] = await Promise.all([buildQueue(), db.stories.orderBy('lastOpened').reverse().first(), db.words.count()])
    return { qq, stories, words }
  })
  const qq = q?.qq
  const total = qq ? qq.learning.length + qq.due.length + qq.news.length : 0
  const mins = Math.max(1, Math.round(total * 0.2))
  return (
    <div class="page">
      <div class="top">
        <h1>Русский</h1>
        <button class="icon-btn" onClick={() => go('import')} aria-label="Import">＋</button>
        <button class="icon-btn" onClick={() => go('settings')} aria-label="Settings">⚙︎</button>
      </div>

      <div class="card deck">
        <div class="row"><h2 class="grow">My Russian</h2><span class="muted small">{q?.words ?? 0} words</span></div>
        <div class="counts">
          <div class="cnt n">{qq?.news.length ?? 0}<small>New</small></div>
          <div class="cnt l">{qq?.learning.length ?? 0}<small>Learning</small></div>
          <div class="cnt d">{qq?.due.length ?? 0}<small>To review</small></div>
        </div>
        <button class="btn block" disabled={!total} onClick={() => go('review')}>
          {total ? `Study now · ${total} card${total === 1 ? '' : 's'} · ~${mins} min` : 'Nothing due — nice'}
        </button>
      </div>

      {q && q.words === 0 && (
        <div class="card" style={{ marginTop: 12 }}>
          <b>Start here</b>
          <p class="muted" style={{ margin: '6px 0 12px' }}>Paste a few words from your notes — you choose which ones become flashcards.</p>
          <button class="btn ghost" onClick={() => go('import')}>Import vocabulary</button>
        </div>
      )}

      <div class="actions" style={{ marginTop: 12 }}>
        <button class="action hot" onClick={() => go('sentences')}>
          <b>Practice sentences</b>
          <span>{getSettings().sentencesPerSession} to say out loud</span>
        </button>
        <button class="action" onClick={() => (q?.stories ? go(`reader/${q.stories.id}`) : go('reader'))}>
          <b>{q?.stories ? 'Continue story' : 'Read a story'}</b>
          <span class="small">{q?.stories ? q.stories.title : 'Generate or paste one'}</span>
        </button>
        <button class="action" onClick={() => go('reader/gen')}>
          <b>Generate a story</b>
          <span>5-minute read from your words</span>
        </button>
        <button class="action" onClick={() => go('import')}>
          <b>Import</b>
          <span>Words or a story</span>
        </button>
      </div>
    </div>
  )
}
