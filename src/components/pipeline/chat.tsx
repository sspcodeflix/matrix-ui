import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { Spinner, StopGlyph, stroke } from '../icons'
import { StageRail, currentView } from './parts'
import { AREAS, findRequirement } from '../../data/report'
import { allTestCases, automationFor, deliveryFor, storyFor } from '../../pipeline/data'
import { GATES, STAGES, type GateId } from '../../pipeline/types'
import { paths } from '../../lib/format'
import { REQUIRED_FOR_PIPELINE, isExpired, useConnections } from '../../lib/api'
import { useStore } from '../../state/store'
import type { PipelineRecord } from '../../state/types'
import { RepoChooser } from './RepoChooser'


/* ---------- Hand-off card: approval before Matrix starts ---------- */

export function HandoffCard({ convoId, messageId, areaSlug, frIds }: { convoId: string; messageId: string; areaSlug: string; frIds: string[] }) {
  const { startPipeline, setBlocks } = useStore()
  const [picked, setPicked] = useState<string[]>(frIds)
  const [showAll, setShowAll] = useState(false)
  const [repo, setRepo] = useState('ABCD-TestingScript')
  const [busy, setBusy] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const { connections, refresh } = useConnections()
  const area = AREAS.find((a) => a.slug === areaSlug)
  const needed = connections?.filter((c) => REQUIRED_FOR_PIPELINE.includes(c.tool)) ?? []
  const missing = needed.filter((c) => !c.connected || isExpired(c))

  return (
    <form
      className="tool-card scope-card"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!picked.length) return
        setBusy(true)
        setStartError(null)
        try {
          const r = await startPipeline(convoId, messageId, areaSlug, picked, repo)
          if (!r.ok) {
            setStartError(r.error)
            refresh()
          }
        } finally {
          setBusy(false)
        }
      }}
    >
      <fieldset>
        <legend>
          Requirements to send <span className="secondary" style={{ fontWeight: 400 }}>· {area?.name}</span>
        </legend>
        {frIds.length > 1 && (
          // Many requirements: one summary row; the checklist opens on demand.
          <button type="button" className="opt req-summary" aria-expanded={showAll} aria-controls={`reqs-${messageId}`} onClick={() => setShowAll(!showAll)}>
            <span className="opt-text" style={{ flex: 1, minWidth: 0 }}>
              <span className="opt-title">
                {picked.length} of {frIds.length} requirements selected
              </span>
              <span className="opt-hint mono">
                {frIds.slice(0, 3).join(', ')}
                {frIds.length > 3 ? ` +${frIds.length - 3}` : ''}
              </span>
            </span>
            <span className="secondary" style={{ fontSize: 13, fontWeight: 500 }}>
              {showAll ? 'Hide' : 'Show all'}
            </span>
            <ChevronDown size={16} {...stroke} style={{ transform: showAll ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
          </button>
        )}
        {frIds.length > 1 && showAll && (
          <div className="req-tools">
            <button type="button" className="linkish" style={{ fontFamily: 'inherit', fontSize: 13 }} onClick={() => setPicked(frIds)}>
              Select all
            </button>
            <button type="button" className="linkish" style={{ fontFamily: 'inherit', fontSize: 13 }} onClick={() => setPicked([])}>
              Select none
            </button>
          </div>
        )}
        <div className="opts" id={`reqs-${messageId}`} hidden={frIds.length > 1 && !showAll}>
          {frIds.map((id) => {
            const r = findRequirement(id)
            const s = storyFor(id)
            return (
              <label key={id} className="opt" style={{ alignItems: 'center' }}>
                <input type="checkbox" className="check" checked={picked.includes(id)} onChange={(e) => setPicked(e.target.checked ? [...picked, id] : picked.filter((x) => x !== id))} />
                <span className="opt-text" style={{ flex: 1, minWidth: 0 }}>
                  <span className="opt-title">{r?.title}</span>
                  <span className="opt-hint">
                    <span className="mono">{id}</span> · Jira <span className="mono">{s.key}</span>
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="scope-grid" style={{ marginTop: 24 }}>
        <fieldset>
          <legend>Where should the automation go?</legend>
          <RepoChooser name="repo" value={repo} onChange={setRepo} />
        </fieldset>
      </div>

      <p className="opt-hint" style={{ margin: '10px 0 0' }}>
        Scripts go on a feature branch with a PR into main. Tests always run through your Harness pipelines on HyperExecute, which decide the environment: post-commit on the branch before Code review, and post-merge on main before Release sign-off.
      </p>

      <div className="switch-row" style={{ cursor: 'default', alignItems: 'flex-start', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>You decide at three gates</span>
        <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>
          Design review, Code review and Release sign-off. The Readiness gate is automatic above the 0.80 confidence floor; uncertain stories come to QA.
        </span>
      </div>

      <div className="switch-row" style={{ cursor: 'default', alignItems: 'flex-start', flexDirection: 'column', gap: 6, marginTop: 18 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>Acts as you in</span>
        <span style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13.5 }}>
          {needed.map((c) => (
            <span key={c.tool} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} className={c.connected && !isExpired(c) ? '' : 'secondary'}>
              {c.connected && !isExpired(c) ? <Check size={14} strokeWidth={2.5} aria-hidden /> : <span className="step-icon-pending" style={{ width: 14, height: 14 }} aria-hidden="true" />}
              {c.name}
              <span className="sr-only">{c.connected && !isExpired(c) ? 'connected' : 'not connected'}</span>
            </span>
          ))}
          {!connections && <span className="secondary">Checking your connections…</span>}
        </span>
        {missing.length > 0 && (
          <span style={{ fontSize: 13 }} role="alert">
            Connect {missing.map((c) => c.name).join(', ')} before starting.{' '}
            <Link to="/settings/connections" style={{ fontWeight: 500 }}>
              Open Connections
            </Link>{' '}
            <button type="button" className="btn ghost" style={{ height: 28, fontSize: 12.5, padding: '0 8px' }} onClick={refresh}>
              Check again
            </button>
          </span>
        )}
        {startError && missing.length === 0 && (
          <span style={{ fontSize: 13 }} role="alert">
            {startError}
          </span>
        )}
      </div>

      <div className="card-actions">
        <span className="secondary" style={{ fontSize: 13, marginRight: 'auto' }}>
          {picked.length} of {frIds.length} selected
        </span>
        <button type="button" className="btn ghost" onClick={() => setBlocks(convoId, messageId, [{ type: 'text', text: 'Cancelled. Nothing was sent to Matrix.', tone: 'secondary' }])} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-go" disabled={busy || !picked.length || !connections || missing.length > 0 || !repo}>
          {busy ? 'Starting…' : 'Start Matrix'}
        </button>
      </div>
    </form>
  )
}

/* ---------- Status line shared by the card and the strip ---------- */

export function pipelineStatus(p: PipelineRecord) {
  const waiting = (Object.keys(p.gates) as GateId[]).find((g) => p.gates[g].status === 'waiting')
  const runningIdx = p.stages.findIndex((s) => s.status === 'running')
  if (p.error) return { kind: 'stopped' as const, text: p.error }
  if (waiting) {
    const detail =
      waiting === 'design' ? `${allTestCases(p).length} test cases to review` : waiting === 'code' ? `${automationFor(p).repo} PR #${automationFor(p).pr}` : waiting === 'release' ? 'results and evidence ready' : 'uncertain stories need a QA call'
    return { kind: 'waiting' as const, gate: waiting, text: `${GATES[waiting].title} needs you`, detail }
  }
  if (runningIdx >= 0 && p.stages[runningIdx].id === 'automation') {
    const c = p.prChecks
    const detail =
      !c || c.phase === 'writing'
        ? 'committing scripts to the feature branch'
        : c.phase === 'harness'
          ? `PR checks · Harness #${c.harnessExecutionId} on ${c.branch}`
          : `PR checks · HyperExecute ${c.done} of ${c.total} tests done`
    return { kind: 'running' as const, text: '04 Automation & PR checks', detail, step: runningIdx + 1 }
  }
  if (runningIdx >= 0 && p.stages[runningIdx].id === 'execute' && p.execution) {
    const e = p.execution
    const detail =
      e.phase === 'awaiting_merge'
        ? `waiting for PR #${e.pr} to merge in GitHub`
        : e.phase === 'harness_triggered'
          ? `Harness #${e.harness.executionId} triggered by ${e.commit}`
          : e.phase === 'hyperexecute_running'
            ? `HyperExecute · ${e.hyperexecute.done} of ${e.hyperexecute.total} tests done`
            : 'collecting results and evidence'
    return { kind: 'running' as const, text: '05 Post-merge run', detail, step: runningIdx + 1 }
  }
  if (runningIdx >= 0) {
    const def = STAGES[runningIdx]
    return { kind: 'running' as const, text: `${def.n} ${def.title}`, detail: def.doing, step: runningIdx + 1 }
  }
  if (p.status === 'completed') {
    if (p.outcome === 'delivered') return { kind: 'done' as const, text: 'Delivered', detail: `Octane ${deliveryFor(p).octane.testSet}` }
    if (p.outcome === 'nothing_ready') return { kind: 'done' as const, text: 'Stopped at readiness', detail: 'no story was ready to test' }
    return { kind: 'done' as const, text: 'Release sign-off rejected', detail: 'nothing delivered' }
  }
  if (p.status === 'stopped') return { kind: 'stopped' as const, text: 'Stopped', detail: 'you stopped this pipeline' }
  return { kind: 'running' as const, text: 'Starting', detail: '', step: 1 }
}

/** For anyone but the owner, a waiting gate is someone else's job, not "needs you". */
function ownerView<T extends ReturnType<typeof pipelineStatus>>(st: T, isOwner: boolean): T {
  if (isOwner || st.kind !== 'waiting') return st
  return { ...st, text: `${GATES[st.gate].title} · waiting for SP` }
}

const REVIEW_LABEL: Record<GateId, string> = { readiness: 'Decide readiness', design: 'Review test design', code: 'Review the code', release: 'Review for sign-off' }
const GATE_VIEW: Record<GateId, string> = { readiness: 'readiness', design: 'design', code: 'automation', release: 'execution' }

/* ---------- Pipeline card in the conversation ---------- */

export function PipelineCard({ p }: { p: PipelineRecord }) {
  const navigate = useNavigate()
  const { stopPipeline, state } = useStore()
  const area = AREAS.find((a) => a.slug === p.areaSlug)
  const isOwner = (p.owner ?? 'sp') === state.viewer
  const st = ownerView(pipelineStatus(p), isOwner)
  const open = (view?: string) => navigate(paths.pipeline(p.conversationId, p.id, view))
  const active = p.status === 'running' || p.status === 'waiting'

  return (
    <section className="tool-card progress-card" aria-label="Matrix pipeline" id={`pipe-${p.id}`}>
      <div className="progress-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2>Matrix · {area?.name}</h2>
          <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>
            {p.frIds.length} {p.frIds.length === 1 ? 'requirement' : 'requirements'} · {p.repo}
          </span>
        </div>
      </div>
      <StageRail p={p} compact />
      <div className="pipe-status" role="status" aria-live="polite">
        {st.kind === 'running' && <Spinner size={18} />}
        <span style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontWeight: 600 }} className={st.kind === 'running' ? 'is-running' : undefined}>
            {st.text}
          </strong>
          {st.detail && <span className="secondary"> · {st.detail}</span>}
        </span>
        {st.kind === 'waiting' && (
          <button type="button" className={`btn ${isOwner ? 'btn-primary' : 'btn-outline'}`} style={{ height: 36 }} onClick={() => open(GATE_VIEW[st.gate])}>
            {isOwner ? REVIEW_LABEL[st.gate] : 'View'}
          </button>
        )}
      </div>
      <div className="progress-foot">
        <button type="button" className="btn ghost" style={{ height: 36, padding: '0 12px', fontSize: 13.5 }} onClick={() => open(p.outcome === 'delivered' ? 'delivery' : currentView(p))}>
          Open pipeline
        </button>
        {active && isOwner && (
          <button type="button" className="btn ghost" style={{ height: 36, padding: '0 12px', fontSize: 13.5 }} onClick={() => stopPipeline(p.id)}>
            <StopGlyph />
            <span>Stop pipeline</span>
          </button>
        )}
      </div>
    </section>
  )
}

/* ---------- Strip above the composer while a pipeline is active ---------- */

export function PipelineStrip({ p }: { p: PipelineRecord }) {
  const navigate = useNavigate()
  const { state } = useStore()
  const isOwner = (p.owner ?? 'sp') === state.viewer
  const st = ownerView(pipelineStatus(p), isOwner)
  const area = AREAS.find((a) => a.slug === p.areaSlug)
  return (
    <div className="run-strip" role="status" aria-live="polite">
      {st.kind === 'running' ? <Spinner size={20} /> : isOwner ? <span className="gate-dot static" aria-hidden="true" /> : null}
      <div style={{ flex: 1, minWidth: 0 }} className="run-strip-text">
        <span style={{ minWidth: 0 }}>
          <strong>Matrix · {area?.name}</strong> <span className="secondary">· {st.text}</span>
        </span>
        {st.kind === 'running' && <span className="secondary num">step {st.step} of 6</span>}
      </div>
      {st.kind === 'waiting' && isOwner ? (
        <button type="button" className="btn btn-primary" style={{ height: 34, fontSize: 13, padding: '0 12px', borderRadius: 8 }} onClick={() => navigate(paths.pipeline(p.conversationId, p.id, GATE_VIEW[st.gate]))}>
          {REVIEW_LABEL[st.gate]}
        </button>
      ) : (
        <button type="button" className="ghost icon-btn sm" aria-label="Open pipeline" onClick={() => navigate(paths.pipeline(p.conversationId, p.id, currentView(p)))}>
          <ChevronUp size={16} {...stroke} />
        </button>
      )}
    </div>
  )
}
