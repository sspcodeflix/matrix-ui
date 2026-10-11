import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronUp, CircleCheck, Clock } from 'lucide-react'
import { Spinner, StopGlyph, stroke } from './icons'
import { REPORT } from '../data/report'
import { COMPONENTS } from '../data/components'
import { formatDuration, formatTime } from '../lib/format'
import type { RunState, RunStep } from '../state/types'
import type { ScopeChoices } from '../state/store'

/* ---------------- ScopeCard: approval gate before a run ---------------- */

export function ScopeCard({ onStart, onCancel }: { onStart: (c: ScopeChoices) => Promise<void> | void; onCancel: () => void }) {
  const [choices, setChoices] = useState<ScopeChoices>({ repoScope: 'all', mode: 'cached', compare: false })
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="tool-card scope-card"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await onStart(choices)
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="scope-grid">
        <fieldset>
          <legend>What I'll analyse</legend>
          <ul className="component-list">
            {COMPONENTS.map((c) => (
              <li key={c.id}>
                <Check size={14} strokeWidth={2.5} aria-hidden />
                <span className="mono">{c.id}</span>
                <span className="secondary">{c.kind === 'tests' ? 'Test evidence' : c.role}</span>
              </li>
            ))}
          </ul>
        </fieldset>

        <fieldset>
          <legend>Which scan mode should I use?</legend>
          <div className="opts">
            <label className="opt">
              <input type="radio" name="mode" checked={choices.mode === 'cached'} onChange={() => setChoices({ ...choices, mode: 'cached' })} />
              <span className="opt-text">
                <span className="opt-title">
                  Accurate and cached <span className="secondary" style={{ fontWeight: 400 }}>· recommended</span>
                </span>
                <span className="opt-hint">Uses cached data where available for faster analysis.</span>
              </span>
            </label>
            <label className="opt">
              <input type="radio" name="mode" checked={choices.mode === 'fresh'} onChange={() => setChoices({ ...choices, mode: 'fresh' })} />
              <span className="opt-text">
                <span className="opt-title">Fresh analysis</span>
                <span className="opt-hint">Bypasses the cache and runs on the latest data. Takes longer.</span>
              </span>
            </label>
          </div>
        </fieldset>
      </div>

      <label className="switch-row">
        <input type="checkbox" className="switch" role="switch" checked={choices.compare} onChange={(e) => setChoices({ ...choices, compare: e.target.checked })} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>Compare with the previous scan</span>
          <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>Include the latest scan from {REPORT.previousScan} to show trends and changes.</span>
        </span>
      </label>

      <div className="card-actions">
        <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-go" disabled={busy}>
          {busy ? 'Starting…' : 'Start analysis'}
        </button>
      </div>
    </form>
  )
}

/* ---------------- StepList ---------------- */

export function StepList({ steps }: { steps: RunStep[] }) {
  return (
    <ol className="steps">
      {steps.map((s) => (
        <li key={s.id} className={`step ${s.status}`}>
          {s.status === 'done' && (
            <span className="step-icon-done">
              <Check size={12} strokeWidth={3} aria-hidden />
            </span>
          )}
          {s.status === 'running' && <Spinner />}
          {s.status === 'pending' && <span className="step-icon-pending" />}
          <span className="step-text">
            <span className="step-title">{s.title}</span>
            <span className="step-sub">{s.status === 'done' ? s.summary : s.description}</span>
          </span>
          <span className="step-meta">
            {s.status === 'done' && s.durationMs !== undefined ? formatDuration(s.durationMs) : s.status === 'running' ? 'Running…' : 'Pending'}
            <span className="sr-only">{s.status === 'done' ? ', done' : ''}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

function runMeta(run: RunState) {
  const repos = `${run.repoCount} components`
  const mode = run.mode === 'fresh' ? 'fresh analysis' : 'accurate and cached'
  return `${repos} · ${mode}${run.compare ? ` · compared with ${REPORT.previousScan}` : ''}`
}

/* ---------------- ProgressCard (foreground run) ---------------- */

export function ProgressCard({ run, onStop }: { run: RunState; onStop: () => void }) {
  return (
    <section className="tool-card progress-card" aria-label="Analysis progress" id={`run-${run.id}`}>
      <div className="progress-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2>Analysing {run.app}</h2>
          <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>{runMeta(run)}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>
            {run.pct}%
          </span>
          <span className="num" style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>
            {formatDuration(run.elapsedMs)} elapsed
          </span>
        </div>
      </div>
      <Bar pct={run.pct} active={run.status === 'running'} />
      <StepList steps={run.steps} />
      <div className="progress-foot">
        <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>Runs in the background if you send another message.</span>
        <button type="button" className="btn ghost" style={{ height: 36, padding: '0 12px', fontSize: 13.5 }} onClick={onStop}>
          <StopGlyph />
          <span>Stop analysis</span>
        </button>
      </div>
    </section>
  )
}

export function Bar({ pct, thin, active }: { pct: number; thin?: boolean; active?: boolean }) {
  return (
    <div className={`bar ${thin ? 'thin' : ''} ${active ? 'active' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Analysis progress">
      <div style={{ width: `${pct}%` }} />
    </div>
  )
}

/* ---------------- RunStrip (background run, pinned above composer) ---------------- */

export function RunStrip({ run, onStop, onExpand }: { run: RunState; onStop: () => void; onExpand: () => void }) {
  const idx = run.steps.findIndex((s) => s.status === 'running')
  const current = run.steps[idx]
  return (
    <div className="run-strip" role="status" aria-live="polite">
      <Spinner size={20} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div className="run-strip-text">
          <span style={{ minWidth: 0 }}>
            <strong>Analysing {run.app}</strong> {current && <span className="secondary">· {current.title}</span>}
          </span>
          <span className="secondary num">
            {run.pct}%{idx >= 0 ? ` · step ${idx + 1} of ${run.steps.length}` : ''} · {formatDuration(run.elapsedMs)}
          </span>
        </div>
        <Bar pct={run.pct} thin active />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 'none' }}>
        <button type="button" className="btn ghost" style={{ height: 34, padding: '0 10px', fontSize: 13, borderRadius: 8, gap: 7 }} onClick={onStop}>
          <StopGlyph size={12} />
          <span>Stop</span>
        </button>
        <button type="button" className="ghost icon-btn sm" aria-label="Show analysis steps" onClick={onExpand}>
          <ChevronUp size={16} {...stroke} />
        </button>
      </div>
    </div>
  )
}

/* ---------------- RunSummaryRow (collapsed, expandable) ---------------- */

export function RunSummaryRow({ icon, label, children, onClick, expanded }: { icon: 'clock' | 'done'; label: ReactNode; children?: ReactNode; onClick?: () => void; expanded?: boolean }) {
  const [open, setOpen] = useState(false)
  const isOpen = expanded ?? open
  return (
    <>
      <button type="button" className="ghost run-row" aria-expanded={isOpen} onClick={onClick ?? (() => setOpen(!open))}>
        {icon === 'clock' ? <Clock size={16} {...stroke} /> : <CircleCheck size={16} {...stroke} />}
        <span>{label}</span>
        <ChevronDown className="chev" size={14} {...stroke} />
      </button>
      {isOpen && children}
    </>
  )
}

export function completedLabel(run: RunState, withTime: boolean) {
  const repos = `${run.repoCount} components`
  return `Analysed ${repos} · ${run.steps.length} steps${withTime && run.completedAt ? ` · completed ${formatTime(run.completedAt)}` : ''}`
}
