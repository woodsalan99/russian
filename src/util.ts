import { useEffect, useState } from 'preact/hooks'

export const dayKey = (t = Date.now()) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const DAY = 86400000

export function fmtDur(ms: number) {
  const m = Math.round(ms / 60000)
  if (m < 1) return ms >= 10000 ? '<1m' : '0m'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

export function fmtInterval(ms: number) {
  const m = ms / 60000
  if (m < 1) return '<1m'
  if (m < 60) return `${Math.round(m)}m`
  const h = m / 60
  if (h < 24) return `${Math.round(h)}h`
  const d = h / 24
  if (d < 30) return `${Math.round(d)}d`
  if (d < 365) return `${(d / 30).toFixed(d < 90 ? 1 : 0).replace(/\.0$/, '')}mo`
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')}y`
}

export function shuffle<T>(a: T[]): T[] {
  const r = a.slice()
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

export function speak(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ru-RU'
    u.rate = 0.9
    const v = speechSynthesis.getVoices().find((x) => x.lang.toLowerCase().startsWith('ru'))
    if (v) u.voice = v
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  } catch {}
}

// ---- settings (localStorage, with safe fallback) ----
export interface Settings {
  apiKey: string
  model: string
  thinkSecs: number
  newPerDay: number
  sentencesPerSession: number
  autoSpeak: boolean
}
const DEFAULTS: Settings = { apiKey: '', model: 'deepseek-v4-flash', thinkSecs: 5, newPerDay: 20, sentencesPerSession: 10, autoSpeak: false }
let mem: Settings | null = null
export function getSettings(): Settings {
  if (mem) return mem
  try {
    mem = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('ru-settings') || '{}') }
  } catch {
    mem = { ...DEFAULTS }
  }
  return mem!
}
export function setSettings(p: Partial<Settings>) {
  mem = { ...getSettings(), ...p }
  try {
    localStorage.setItem('ru-settings', JSON.stringify(mem))
  } catch {}
}

// ---- tiny toast ----
type ToastFn = (msg: string) => void
let toastFn: ToastFn = () => {}
export const registerToast = (f: ToastFn) => (toastFn = f)
export const toast = (m: string) => toastFn(m)

// ---- hash router ----
export function useRoute(): string[] {
  const get = () => (location.hash.replace(/^#\/?/, '') || 'home').split('/')
  const [r, setR] = useState(get)
  useEffect(() => {
    const h = () => setR(get())
    addEventListener('hashchange', h)
    return () => removeEventListener('hashchange', h)
  }, [])
  return r
}
export const go = (p: string) => {
  location.hash = '#/' + p
}
