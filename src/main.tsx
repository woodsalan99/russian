import { render } from 'preact'
import { registerSW } from 'virtual:pwa-register'
import './styles.css'
import { App } from './app'
import { setSettings } from './util'

// One-tap key setup: open  <app-url>/#setkey=YOUR_KEY  once; the key is stored on this device and removed from the URL.
const m = location.hash.match(/^#setkey=(.+)$/)
if (m) {
  setSettings({ apiKey: decodeURIComponent(m[1]) })
  history.replaceState(null, '', location.pathname + location.search)
}

registerSW({ immediate: true })
render(<App />, document.getElementById('app')!)
