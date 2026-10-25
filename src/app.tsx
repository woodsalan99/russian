import { useEffect, useState } from 'preact/hooks'
import { Icon } from './components'
import { go, registerToast, useRoute } from './util'
import { Home } from './pages/Home'
import { ReviewSession } from './pages/Review'
import { ImportPage } from './pages/Import'
import { WordsPage } from './pages/Words'
import { ReaderList, StoryView } from './pages/Reader'
import { SentencePage } from './pages/Sentences'
import { ProgressPage } from './pages/Progress'
import { SettingsPage } from './pages/Settings'

const TABS: [string, string, any][] = [
  ['home', 'Review', Icon.review],
  ['sentences', 'Sentences', Icon.speak],
  ['reader', 'Reader', Icon.book],
  ['words', 'Words', Icon.words],
  ['progress', 'Progress', Icon.chart],
]

export function App() {
  const route = useRoute()
  const [msg, setMsg] = useState('')
  useEffect(() => {
    let t: any
    registerToast((m) => {
      setMsg(m)
      clearTimeout(t)
      t = setTimeout(() => setMsg(''), 2200)
    })
  }, [])
  useEffect(() => {
    try {
      navigator.storage?.persist?.()
    } catch {}
  }, [])

  const [r, arg] = route
  const fullscreen = r === 'review' || r === 'sentences' || (r === 'reader' && !!arg && arg !== 'gen')
  let page
  switch (r) {
    case 'review': page = <ReviewSession />; break
    case 'import': page = <ImportPage />; break
    case 'words': page = <WordsPage />; break
    case 'reader': page = arg && arg !== 'gen' ? <StoryView id={Number(arg)} /> : <ReaderList autoGen={arg === 'gen'} />; break
    case 'sentences': page = <SentencePage />; break
    case 'progress': page = <ProgressPage />; break
    case 'settings': page = <SettingsPage />; break
    default: page = <Home />
  }
  const active = r === 'import' || r === 'settings' ? '' : r === 'review' ? 'home' : r
  return (
    <>
      {page}
      {!fullscreen && (
        <nav class="tabs">
          <div class="tabs-in">
            {TABS.map(([id, label, icon]) => (
              <button class={`tab ${(active || 'home') === id && active !== '' ? 'on' : ''}`} onClick={() => go(id)}>
                {icon}
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}
      {msg && <div class="toast">{msg}</div>}
    </>
  )
}
