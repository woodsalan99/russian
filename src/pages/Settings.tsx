import { useState } from 'preact/hooks'
import { downloadAll } from '../dict'
import { exportAll, importAll } from '../store'
import { getSettings, go, setSettings, toast } from '../util'

export function SettingsPage() {
  const [s, setS] = useState(getSettings())
  const [prog, setProg] = useState<[number, number] | null>(null)
  const upd = (p: Partial<typeof s>) => {
    setSettings(p)
    setS({ ...s, ...p })
  }

  async function dl() {
    try {
      await downloadAll((d, t) => setProg([d, t]))
      toast('Dictionary saved for offline use')
    } catch (e: any) {
      toast(e.message)
    }
    setProg(null)
  }
  async function backup() {
    const blob = new Blob([await exportAll()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `russian-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
  }
  function restore() {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'application/json'
    inp.onchange = async () => {
      const f = inp.files?.[0]
      if (!f) return
      if (!confirm('This replaces everything in the app with the backup. Continue?')) return
      try {
        await importAll(await f.text())
        toast('Backup restored')
        go('home')
      } catch (e: any) {
        toast(e.message)
      }
    }
    inp.click()
  }

  return (
    <div class="page">
      <div class="top">
        <button class="icon-btn" onClick={() => go('home')}>←</button>
        <h1>Settings</h1>
      </div>

      <div class="card">
        <b>AI (DeepSeek)</b>
        <p class="muted small" style={{ margin: '4px 0 0' }}>Used for sentence practice and story generation. Stored only on this device.</p>
        <label class="lbl">API key</label>
        <input class="txt" type="password" autocomplete="off" placeholder="sk-…" value={s.apiKey} onInput={(e) => upd({ apiKey: (e.target as HTMLInputElement).value.trim() })} />
        <label class="lbl">Model</label>
        <select class="txt" value={s.model} onChange={(e) => upd({ model: (e.target as HTMLSelectElement).value })}>
          <option value="deepseek-v4-flash">deepseek-v4-flash (cheap, fast)</option>
          <option value="deepseek-v4-pro">deepseek-v4-pro (better Russian, pricier)</option>
        </select>
      </div>

      <div class="card" style={{ marginTop: 12 }}>
        <b>Study</b>
        <label class="lbl">New cards per day: {s.newPerDay}</label>
        <input type="range" min="0" max="60" step="5" value={s.newPerDay} style={{ width: '100%' }} onInput={(e) => upd({ newPerDay: Number((e.target as HTMLInputElement).value) })} />
        <label class="lbl">Sentences per session: {s.sentencesPerSession}</label>
        <input type="range" min="5" max="30" step="5" value={s.sentencesPerSession} style={{ width: '100%' }} onInput={(e) => upd({ sentencesPerSession: Number((e.target as HTMLInputElement).value) })} />
        <label class="lbl">Thinking time before reveal: {s.thinkSecs ? `${s.thinkSecs}s` : 'off'}</label>
        <input type="range" min="0" max="15" step="1" value={s.thinkSecs} style={{ width: '100%' }} onInput={(e) => upd({ thinkSecs: Number((e.target as HTMLInputElement).value) })} />
      </div>

      <div class="card" style={{ marginTop: 12 }}>
        <b>Offline dictionary</b>
        <p class="muted small" style={{ margin: '4px 0 10px' }}>Words you look up are saved automatically. Download everything once (~10 MB) to read anywhere with no connection.</p>
        <button class="btn ghost block" disabled={!!prog} onClick={dl}>
          {prog ? `Downloading… ${Math.round((prog[0] / prog[1]) * 100)}%` : 'Download full dictionary'}
        </button>
      </div>

      <div class="card" style={{ marginTop: 12 }}>
        <b>Your data</b>
        <p class="muted small" style={{ margin: '4px 0 10px' }}>Everything lives on this device. Save a backup now and then.</p>
        <div class="row">
          <button class="btn plain grow" onClick={backup}>Export backup</button>
          <button class="btn plain grow" onClick={restore}>Restore</button>
        </div>
      </div>

      <p class="muted small center" style={{ marginTop: 18 }}>
        Dictionary data: OpenRussian.org (CC BY-SA 4.0). Frequency data: FrequencyWords (MIT).
      </p>
    </div>
  )
}
