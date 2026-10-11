import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, ShieldAlert, UserCheck } from 'lucide-react'
import { Spinner, StopGlyph, stroke } from '../icons'
import { SEV_LABEL, approach, findingById, parseIds } from '../../remediation/data'
import { Diff } from './RemediationPanel'
import { REM_GATES, REM_STAGES, type RemGateId } from '../../remediation/types'
import { CODE_COMPONENTS, TEST_REPO } from '../../data/components'
import { person } from '../../team/roster'
import { isExpired, useConnections } from '../../lib/api'
import { paths } from '../../lib/format'
import { useStore } from '../../state/store'
import type { RemediationRecord } from '../../state/types'

/** Remediation works in the code only, so GitHub is the one account it needs. */
const NEEDED = ['github']

/* ---------------- Scope card ---------------- */

export function RemScopeCard({ convoId, messageId, imported }: { convoId: string; messageId: string; imported: string[] }) {
  const { startRemediation, setBlocks, runChip } = useStore()
  const { connections, refresh } = useConnections()
  const [mode, setMode] = useState<'scan' | 'import'>(imported.length ? 'import' : 'scan')
  const [ids, setIds] = useState(imported.join(', '))
  const [base, setBase] = useState<'develop' | 'main'>('develop')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parsed = parseIds(ids)
  const missing = (connections ?? []).filter((c) => NEEDED.includes(c.tool) && (!c.connected || isExpired(c)))
  const canStart = !!connections && !missing.length && (mode === 'scan' || parsed.length > 0)

  return (
    <form
      className="tool-card scope-card"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        const r = await startRemediation(convoId, messageId, { mode, imported: mode === 'import' ? parsed : [], base })
        if (!r.ok) {
          setError(r.error)
          refresh()
        }
        setBusy(false)
      }}
    >
      <fieldset>
        <legend>What should I remediate?</legend>
        <div className="opts">
          <label className="opt">
            <input type="radio" name="rem-mode" checked={mode === 'scan'} onChange={() => setMode('scan')} />
            <span className="opt-text">
              <span className="opt-title">Scan the ABCD components</span>
              <span className="opt-hint">Code (SAST), dependencies (SCA) and secrets in {CODE_COMPONENTS.map((c) => c.id).join(', ')}.</span>
            </span>
          </label>
          <label className="opt">
            <input type="radio" name="rem-mode" checked={mode === 'import'} onChange={() => setMode('import')} />
            <span className="opt-text">
              <span className="opt-title">I already have findings</span>
              <span className="opt-hint">Paste CWE or CVE IDs, for example from a pen test or your scanner. I’ll find them in the code and fix them.</span>
            </span>
          </label>
        </div>
      </fieldset>

      {mode === 'import' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
          <label htmlFor={`rem-ids-${messageId}`} style={{ fontSize: 14, fontWeight: 600 }}>
            CWE or CVE IDs
          </label>
          <textarea
            id={`rem-ids-${messageId}`}
            className="rem-ids"
            value={ids}
            onChange={(e) => setIds(e.target.value)}
            placeholder="e.g. CWE-89, CWE-79, CVE-2021-44228"
            spellCheck={false}
          />
          <span className="panel-meta">
            {parsed.length ? `Recognised: ${parsed.join(', ')}` : 'Separate IDs with commas, spaces or new lines.'}
            {' · '}Try:{' '}
            {['CWE-89', 'CVE-2021-44228', 'CWE-22'].map((x) => (
              <button key={x} type="button" className="linkish" onClick={() => setIds(parseIds(`${ids} ${x}`).join(', '))}>
                {x}
              </button>
            ))}
          </span>
        </div>
      )}

      <div className="scope-grid" style={{ marginTop: 18 }}>
        <fieldset>
          <legend>Which branch should the PR target?</legend>
          <div className="opts">
            {(['develop', 'main'] as const).map((b) => (
              <label key={b} className="opt">
                <input type="radio" name="rem-base" checked={base === b} onChange={() => setBase(b)} />
                <span className="opt-text">
                  <span className="opt-title mono" style={{ fontSize: 13.5 }}>
                    {b}
                  </span>
                  <span className="opt-hint">{b === 'develop' ? 'Fixes ride the next release. Recommended.' : 'Hotfix straight to production code.'}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="switch-row" style={{ cursor: 'default', alignItems: 'flex-start', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>Coverage is checked before any PR</span>
        <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>
          Fixes go on a feature branch in each component they touch. Before raising the PRs into {base}, I check that {TEST_REPO} has tests for the behaviour each fix changes. If it does, the PRs go ahead; if not, I show the gaps and you can have me write the tests or ask a developer. Then your Harness pipeline runs tests on HyperExecute post-commit (before Code review) and the full automation suite post-merge on {base} (before Release sign-off), each followed by a re-scan. You also decide at Triage review. Secrets found in code still need rotating by you.
        </span>
        {missing.length > 0 && (
          <span style={{ fontSize: 13, marginTop: 4 }} role="alert">
            Connect {missing.map((c) => c.name).join(', ')} first. <Link to="/settings/connections">Open Connections</Link>
          </span>
        )}
        {error && !missing.length && (
          <span style={{ fontSize: 13 }} role="alert">
            {error}
          </span>
        )}
      </div>

      <p className="panel-meta" style={{ margin: '14px 0 0' }}>
        Prefer to go one finding at a time?{' '}
        <button type="button" className="linkish" style={{ fontFamily: 'inherit', fontSize: 13 }} onClick={() => runChip(convoId, { kind: 'say', text: 'Fix vulnerabilities with me, one at a time.' })}>
          Fix them with me in chat
        </button>
      </p>

      <div className="card-actions">
        <button type="button" className="btn ghost" disabled={busy} onClick={() => setBlocks(convoId, messageId, [{ type: 'text', text: 'Cancelled. Nothing was scanned or changed.', tone: 'secondary' }])}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !canStart}>
          {busy ? 'Starting…' : mode === 'scan' ? 'Scan and remediate' : `Remediate ${parsed.length || ''} ${parsed.length === 1 ? 'ID' : 'IDs'}`.replace('  ', ' ')}
        </button>
      </div>
    </form>
  )
}

/* ---------------- Status, card and strip ---------------- */

export const REM_VIEW: Record<string, string> = { discover: 'findings', triage: 'findings', fix: 'fixes', coverage: 'coverage', pr_checks: 'fixes', post_merge: 'merge', deliver: 'delivery' }
const GATE_VIEW: Record<RemGateId, string> = { triage: 'findings', coverage: 'coverage', code: 'fixes', release: 'merge' }
const REVIEW_LABEL: Record<RemGateId, string> = { triage: 'Review triage', coverage: 'Review coverage gaps', code: 'Review the PRs', release: 'Review for sign-off' }

/** Who may act at a gate: the owner, or for coverage gaps, a teammate who was asked to add the tests. */
export function canDecide(r: RemediationRecord, gate: RemGateId, viewer: string) {
  return (r.owner ?? 'sp') === viewer || (gate === 'coverage' && !!r.coverage?.requested?.to.includes(viewer))
}

export function remCurrentView(r: RemediationRecord) {
  if (r.status === 'completed' && r.outcome === 'resolved' && r.fix.length) return 'delivery'
  const running = r.stages.find((s) => s.status === 'running')
  if (running) return REM_VIEW[running.id]
  const waiting = (Object.keys(r.gates) as RemGateId[]).find((g) => r.gates[g].status === 'waiting')
  return waiting ? GATE_VIEW[waiting] : 'findings'
}

export function remStatus(r: RemediationRecord, viewer: string) {
  const waiting = (Object.keys(r.gates) as RemGateId[]).find((g) => r.gates[g].status === 'waiting')
  const i = r.stages.findIndex((s) => s.status === 'running')
  if (r.error) return { kind: 'stopped' as const, text: r.error, detail: '' }
  if (waiting) {
    const asked = waiting === 'coverage' ? r.coverage?.requested : undefined
    const mine = canDecide(r, waiting, viewer)
    const detail = asked ? `asked ${asked.to.map((id) => person(id).name).join(', ')}` : waiting === 'coverage' ? `${r.coverage?.gaps.filter((id) => !r.coverage?.closed.includes(id)).length ?? 0} requirements untested` : ''
    return { kind: 'waiting' as const, gate: waiting, mine, text: mine ? `${REM_GATES[waiting].title} ${waiting === 'coverage' ? 'need' : 'needs'} you` : `${REM_GATES[waiting].title} · waiting for SP`, detail }
  }
  if (i >= 0) {
    const def = REM_STAGES[i]
    const c = def.id === 'pr_checks' ? r.prChecks : def.id === 'post_merge' ? r.postMerge : undefined
    const where = def.id === 'pr_checks' ? r.branch : r.base
    const detail = c
      ? c.phase === 'waiting'
        ? `waiting for the PR to merge into ${r.base}`
        : c.phase === 'harness'
          ? `Harness #${c.harnessExecutionId} on ${where}`
          : c.phase === 'hyperexecute'
            ? `HyperExecute · ${c.done} of ${c.total} tests done`
            : `re-scanning ${where}`
      : def.id === 'coverage' && r.coverage?.closedBy === 'matrix' && !r.prChecks
        ? `writing ${r.coverage.closed.length} requirements' tests in ${TEST_REPO}`
        : def.doing
    return { kind: 'running' as const, text: `${def.n} ${def.title}`, detail, step: i + 1 }
  }
  if (r.status === 'completed') {
    if (r.outcome === 'resolved') return { kind: 'done' as const, text: r.fix.length ? `${r.fix.length} remediated` : 'All dismissed', detail: '' }
    if (r.outcome === 'nothing_found') return { kind: 'done' as const, text: 'Nothing to remediate', detail: 'no matches in the code' }
    return { kind: 'done' as const, text: 'Release sign-off rejected', detail: 'nothing marked resolved' }
  }
  if (r.status === 'stopped') return { kind: 'stopped' as const, text: 'Stopped', detail: '' }
  return { kind: 'running' as const, text: 'Starting', detail: '', step: 1 }
}

export function RemediationCard({ r }: { r: RemediationRecord }) {
  const navigate = useNavigate()
  const { state, stopRemediation } = useStore()
  const isOwner = (r.owner ?? 'sp') === state.viewer
  const st = remStatus(r, state.viewer)
  const open = (view?: string) => navigate(paths.remediation(r.conversationId, r.id, view ?? remCurrentView(r)))
  const active = r.status === 'running' || r.status === 'waiting'
  return (
    <section className="tool-card progress-card" aria-label="Vulnerability remediation">
      <div className="progress-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldAlert size={20} {...stroke} /> Matrix · Vulnerabilities
          </h2>
          <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>
            {r.app} · {r.mode === 'scan' ? `scan of ${CODE_COMPONENTS.length} components` : r.mode === 'direct' ? 'fix agreed in chat' : `${r.imported.length} imported ${r.imported.length === 1 ? 'ID' : 'IDs'}`}
            {r.branch ? ` · ${r.branch} → ${r.base}` : ` · PR into ${r.base}`}
          </span>
        </div>
      </div>
      <RemRail r={r} compact />
      <div className="pipe-status" role="status" aria-live="polite">
        {st.kind === 'running' ? <Spinner size={18} /> : st.kind === 'done' ? <Check size={18} strokeWidth={2.5} style={{ color: 'var(--mx-accent)' }} aria-hidden /> : null}
        <span style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontWeight: 600 }} className={st.kind === 'running' ? 'is-running' : undefined}>
            {st.text}
          </strong>
          {st.detail && <span className="secondary"> · {st.detail}</span>}
        </span>
        {st.kind === 'waiting' && (
          <button type="button" className={`btn ${st.mine ? 'btn-primary' : 'btn-outline'}`} style={{ height: 36 }} onClick={() => open(GATE_VIEW[st.gate])}>
            {st.mine ? REVIEW_LABEL[st.gate] : 'View'}
          </button>
        )}
      </div>
      <div className="progress-foot">
        <button type="button" className="btn ghost" style={{ height: 36, padding: '0 12px', fontSize: 13.5 }} onClick={() => open()}>
          Open remediation
        </button>
        {active && isOwner && (
          <button type="button" className="btn ghost" style={{ height: 36, padding: '0 12px', fontSize: 13.5 }} onClick={() => stopRemediation(r.id)}>
            <StopGlyph />
            <span>Stop</span>
          </button>
        )}
      </div>
    </section>
  )
}

/* ---------------- Stage rail (stages + gates) ---------------- */

export function RemRail({ r, view, onSelect, compact }: { r: RemediationRecord; view?: string; onSelect?: (v: string) => void; compact?: boolean }) {
  const stages = r.stages.length ? r.stages : REM_STAGES.map((s) => ({ id: s.id, status: 'pending' as const }))
  const icon = (status: string, size: number) =>
    status === 'done' ? (
      <span className="step-icon-done" style={{ width: size, height: size }}>
        <Check size={size * 0.55} strokeWidth={3} aria-hidden />
      </span>
    ) : status === 'running' ? (
      <Spinner size={size} />
    ) : (
      <span className="step-icon-pending" style={{ width: size, height: size, borderStyle: status === 'skipped' ? 'dashed' : undefined }} />
    )
  const gateChip = (g: RemGateId) => (
    <span className={`gate gate-${r.gates[g].status} ${compact ? 'compact' : ''}`} title={`${REM_GATES[g].title}: ${REM_GATES[g].who}`}>
      <UserCheck size={13} strokeWidth={r.gates[g].status === 'passed' ? 2.25 : 1.75} aria-hidden />
      {compact ? <span className="sr-only">{REM_GATES[g].title}</span> : <span className="gate-title">{REM_GATES[g].short}</span>}
      {r.gates[g].status === 'waiting' && <span className="gate-dot" aria-hidden="true" />}
    </span>
  )
  if (compact) {
    return (
      <ol className="rail compact" aria-label="Remediation stages">
        {REM_STAGES.map((def, i) => (
          <li key={def.id} style={{ display: 'contents' }}>
            <span className={`rail-stage ${stages[i].status}`}>
              <span className="rail-static">
                {icon(stages[i].status, 18)}
                <span className="rail-text">{def.title}</span>
              </span>
            </span>
            {def.gate && <span className="rail-gate">{gateChip(def.gate)}</span>}
          </li>
        ))}
      </ol>
    )
  }
  return (
    <ol className="rail-grid" aria-label="Remediation stages">
      {REM_STAGES.map((def, i) => {
        const target = REM_VIEW[def.id]
        const reached = stages[i].status !== 'pending' && stages[i].status !== 'skipped'
        const selected = view === target && (def.id === 'triage' || def.id === 'coverage' || def.id === 'pr_checks' || def.id === 'post_merge' || def.id === 'deliver')
        return (
          <li key={def.id} className={`rail-cell ${stages[i].status} ${selected ? 'selected' : ''}`}>
            <button type="button" disabled={!reached || !onSelect} aria-current={selected ? 'step' : undefined} onClick={() => onSelect?.(target)}>
              {icon(stages[i].status, 20)}
              <span className="rail-n">{def.n}</span>
              <span className="rail-title">{def.title}</span>
            </button>
            {def.gate ? gateChip(def.gate) : <span className="gate-spacer" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}

/* ---------------- A fix proposed interactively in chat ---------------- */

export function FixProposal({ findingId, variant }: { findingId: string; variant: number }) {
  const f = findingById(findingId)
  if (!f) return null
  const a = approach(f, variant)
  return (
    <section className="tool-card fix-proposal" aria-label={`Proposed fix for ${f.title}`}>
      <div className="finding-head">
        <span className={`sev sev-${f.severity}`}>{SEV_LABEL[f.severity]}</span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <strong style={{ fontWeight: 600 }}>{f.title}</strong>
          <span className="panel-meta">
            <span className="mono">{f.cve ? `${f.cve} · ${f.cwe}` : f.cwe}</span> · {a.label === 'Recommended' ? 'recommended fix' : a.label}
          </span>
        </span>
      </div>
      <Diff f={f} variant={variant} />
      <span className="panel-meta">
        {f.tests.length} security {f.tests.length === 1 ? 'test' : 'tests'} come with it. Nothing is committed until you apply it; then it goes on <span className="mono">fix/{f.slug}</span> in {f.repo}, and I check test coverage for what it changes before raising the PR into develop.
      </span>
    </section>
  )
}
