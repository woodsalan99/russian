import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { liveQuery } from 'dexie'
import { type Lemma, accent, tagLabel } from './dict'
import { LEVEL_LABEL } from './srs'
import type { Level } from './db'

export function useLive<T>(fn: () => Promise<T> | T, deps: unknown[] = []): T | undefined {
  const [v, setV] = useState<T>()
  useEffect(() => {
    const sub = liveQuery(async () => fn()).subscribe({ next: setV, error: () => {} })
    return () => sub.unsubscribe()
    // eslint-disable-next-line
  }, deps)
  return v
}

export function Sheet({ onClose, children }: { onClose: () => void; children: ComponentChildren }) {
  return (
    <>
      <div class="scrim" onClick={onClose} />
      <div class="sheet" role="dialog">
        <div class="grab" />
        {children}
      </div>
    </>
  )
}

export const LevelBadge = ({ level }: { level: Level }) => <span class={`badge b-${level}`}>{LEVEL_LABEL[level]}</span>

export function Empty({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <b>{title}</b>
      {children}
    </div>
  )
}

export const Spinner = () => <span class="spinner" />

export const Icon = {
  review: (
    <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M9 12h6" /></svg>
  ),
  speak: (
    <svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16.5 8.5a5 5 0 010 7" /></svg>
  ),
  book: (
    <svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 016.5 3H20v16H6.5A2.5 2.5 0 004 21.5v-16z" /><path d="M4 18.5A2.5 2.5 0 016.5 16H20" /></svg>
  ),
  words: (
    <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
  ),
}

type Grid = { rows: [string, string][]; cols: [string, string][]; tag: (r: string, c: string) => string }

export function FormsTable({ lemma }: { lemma: Lemma }) {
  const f = lemma.f
  const cell = (tag: string) => (f[tag]?.length ? f[tag].map(accent).join(' / ') : '—')
  if (lemma.p === 'verb') {
    const pre = lemma.a === 'pf' ? 'fut' : 'pres'
    const pers: [string, string][] = [['sg1', 'I'], ['sg2', 'you'], ['sg3', 'he/she'], ['pl1', 'we'], ['pl2', 'you (pl.)'], ['pl3', 'they']]
    return (
      <table class="ftable ru">
        <tbody>
          <tr><th>infinitive</th><td colSpan={2}>{cell('inf')}</td></tr>
          {pers.map(([p, l]) => (
            <tr><th>{pre === 'pres' ? 'present' : 'future'} · {l}</th><td colSpan={2}>{cell(`${pre}_${p}`)}</td></tr>
          ))}
          {(['m', 'f', 'n', 'pl'] as const).map((g) => (
            <tr><th>past · {g === 'pl' ? 'plural' : g === 'm' ? 'masc.' : g === 'f' ? 'fem.' : 'neuter'}</th><td colSpan={2}>{cell(`past_${g}`)}</td></tr>
          ))}
          <tr><th>imperative</th><td colSpan={2}>{cell('imp_sg')}</td></tr>
        </tbody>
      </table>
    )
  }
  const cases: [string, string][] = [['nom', 'nom.'], ['gen', 'gen.'], ['dat', 'dat.'], ['acc', 'acc.'], ['inst', 'instr.'], ['prep', 'prep.']]
  if (lemma.p === 'noun') {
    return (
      <table class="ftable ru">
        <tbody>
          <tr><th></th><th>singular</th><th>plural</th></tr>
          {cases.map(([c, l]) => (
            <tr><th>{l}</th><td>{cell(`sg_${c}`)}</td><td>{cell(`pl_${c}`)}</td></tr>
          ))}
        </tbody>
      </table>
    )
  }
  if (lemma.p === 'adj') {
    return (
      <table class="ftable ru">
        <tbody>
          <tr><th></th><th>m.</th><th>f.</th><th>n.</th><th>pl.</th></tr>
          {cases.map(([c, l]) => (
            <tr><th>{l}</th>{(['m', 'f', 'n', 'pl'] as const).map((g) => <td>{cell(`${g}_${c}`)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    )
  }
  return <div class="muted small">No inflection.</div>
}
void tagLabel
export type { Grid }
