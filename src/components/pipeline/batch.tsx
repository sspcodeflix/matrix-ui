import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, ChevronUp, Layers } from 'lucide-react'
import { Spinner, stroke } from '../icons'
import { SidePanel } from '../panel/SidePanel'
import { Kpi } from '../panel/ReportView'
import { StageRail, currentView } from './parts'
import { pipelineStatus } from './chat'
import { AREAS, REPORT } from '../../data/report'
import { allTestCases, readyFrIds } from '../../pipeline/data'
import type { GateId } from '../../pipeline/types'
import { REQUIRED_FOR_PIPELINE, isExpired, useConnections } from '../../lib/api'
import { formatDateTime, paths } from '../../lib/format'
import { useStore } from '../../state/store'
import type { Batch, PipelineRecord } from '../../state/types'
import { RepoChooser } from './RepoChooser'

const GATE_ORDER: GateId[] = ['readiness', 'design', 'code', 'release']
const PLURAL: Record<GateId, string> = { readiness: 'readiness decisions', design: 'design reviews', code: 'code reviews', release: 'release sign-offs' }

export function batchSummary(b: Batch, all: Record<string, PipelineRecord>) {
  const ps = b.pipelineIds.map((id) => all[id]).filter(Boolean)
  const waiting = Object.fromEntries(GATE_ORDER.map((g) => [g, ps.filter((p) => p.gates[g].status === 'waiting')])) as Record<GateId, PipelineRecord[]>
  const stagesDone = ps.reduce((n, p) => n + p.stages.filter((s) => s.status === 'done' || s.status === 'skipped').length, 0)
  const delivered = ps.filter((p) => p.outcome === 'delivered')
  return {
    ps,
    waiting,
    waitingTotal: GATE_ORDER.reduce((n, g) => n + waiting[g].length, 0),
    requirements: ps.reduce((n, p) => n + p.frIds.length, 0),
    closed: delivered.reduce((n, p) => n + readyFrIds(p).length, 0),
    delivered: delivered.length,
    finished: ps.filter((p) => p.status === 'completed' || p.status === 'stopped').length,
    pct: ps.length ? Math.round((stagesDone / (ps.length * 6)) * 100) : 0,
    uncertain: ps.reduce((n, p) => n + p.frIds.filter((id) => p.readiness[id]?.answer === 'uncertain' && !p.readiness[id].decision).length, 0),
  }
}

/* ---------------- Scope card: approval before the batch starts ---------------- */

export function BatchScopeCard({ convoId, messageId }: { convoId: string; messageId: string }) {
  const { startBatch, openGaps, setBlocks } = useStore()
  const { connections, refresh } = useConnections()
  const [repo, setRepo] = useState('ABCD-TestingScript')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const gaps = openGaps()
  const total = gaps.reduce((n, g) => n + g.frIds.length, 0)
  const missing = (connections ?? []).filter((c) => REQUIRED_FOR_PIPELINE.includes(c.tool) && (!c.connected || isExpired(c)))

  return (
    <form
      className="tool-card scope-card"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        const r = await startBatch(convoId, messageId, repo)
        if (!r.ok) {
          setError(r.error)
          refresh()
        }
        setBusy(false)
      }}
    >
      <div className="section-head" style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 19 }}>
          {total} gaps across {gaps.length} areas
        </h3>
        <span className="secondary" style={{ fontSize: 13 }}>
          {REPORT.app} · one pipeline per area
        </span>
      </div>
      <div className="table-wrap">
        <table className="data-table dense" style={{ minWidth: 420 }}>
          <thead>
            <tr>
              <th scope="col">Functional area</th>
              <th scope="col" className="r">
                Gaps to close
              </th>
            </tr>
          </thead>
          <tbody>
            {gaps.map(({ area, frIds }) => (
              <tr key={area.slug}>
                <td>{area.name}</td>
                <td className="r">{frIds.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="scope-grid" style={{ marginTop: 20 }}>
        <fieldset>
          <legend>Where should the automation go?</legend>
          <RepoChooser name="batch-repo" value={repo} onChange={setRepo} />
        </fieldset>
      </div>

      <div className="switch-row" style={{ cursor: 'default', alignItems: 'flex-start', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>You still decide every gate, in bulk if you like</span>
        <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>
          Design reviews, code reviews and sign-offs wait for you in one batch view, where you can approve them area by area or all at once. Each area’s scripts go on a feature branch; tests run on HyperExecute post-commit on the branch and again post-merge on main.
        </span>
        {missing.length > 0 && (
          <span style={{ fontSize: 13, marginTop: 4 }} role="alert">
            Connect {missing.map((c) => c.name).join(', ')} first. <Link to="/settings/connections">Open Connections</Link>
          </span>
        )}
        {error && missing.length === 0 && (
          <span style={{ fontSize: 13 }} role="alert">
            {error}
          </span>
        )}
      </div>

      <div className="card-actions">
        <button type="button" className="btn ghost" disabled={busy} onClick={() => setBlocks(convoId, messageId, [{ type: 'text', text: 'Cancelled. Nothing was started.', tone: 'secondary' }])}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !connections || missing.length > 0 || total === 0 || !repo}>
          {busy ? 'Starting…' : `Close all ${total} gaps`}
        </button>
      </div>
    </form>
  )
}

/* ---------------- Batch card in the conversation ---------------- */

export function BatchCard({ batch }: { batch: Batch }) {
  const { state } = useStore()
  const navigate = useNavigate()
  const sum = batchSummary(batch, state.pipelines)
  const open = () => navigate(paths.batch(batch.conversationId, batch.id))
  return (
    <section className="tool-card progress-card" aria-label="Matrix batch">
      <div className="progress-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2>Matrix · All gaps</h2>
          <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>
            {sum.ps.length} areas · {sum.requirements} requirements · {batch.repo}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          <span className="num" style={{ fontSize: 15, fontWeight: 600 }}>
            {sum.pct}%
          </span>
          <span className="num" style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>
            {sum.closed} gaps closed
          </span>
        </div>
      </div>
      <div className={`bar ${batch.done ? '' : 'active'}`} role="progressbar" aria-valuenow={sum.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Batch progress">
        <div style={{ width: `${sum.pct}%` }} />
      </div>
      <div className="pipe-status" role="status" aria-live="polite">
        {batch.done ? <Check size={18} strokeWidth={2.5} style={{ color: 'var(--mx-accent)' }} aria-hidden /> : sum.waitingTotal ? <span className="gate-dot static" style={{ margin: 0 }} aria-hidden="true" /> : <Spinner size={18} />}
        <span style={{ flex: 1, minWidth: 0 }}>
          {batch.done ? (
            <>
              <strong style={{ fontWeight: 600 }}>Finished</strong>
              <span className="secondary"> · {sum.delivered} of {sum.ps.length} areas delivered</span>
            </>
          ) : sum.waitingTotal ? (
            <>
              <strong style={{ fontWeight: 600 }}>{sum.waitingTotal} waiting for you</strong>
              <span className="secondary">
                {' '}
                · {GATE_ORDER.filter((g) => sum.waiting[g].length).map((g) => `${sum.waiting[g].length} ${PLURAL[g]}`).join(', ')}
              </span>
            </>
          ) : (
            <>
              <strong style={{ fontWeight: 600 }} className="is-running">
                Running
              </strong>
              <span className="secondary">
                {' '}
                · {sum.finished} of {sum.ps.length} areas finished
              </span>
            </>
          )}
        </span>
        <button type="button" className={`btn ${sum.waitingTotal ? 'btn-primary' : 'btn-outline'}`} style={{ height: 36 }} onClick={open}>
          {sum.waitingTotal ? 'Decide in batch view' : 'Open batch'}
        </button>
      </div>
    </section>
  )
}

export function BatchStrip({ batch }: { batch: Batch }) {
  const { state } = useStore()
  const navigate = useNavigate()
  const sum = batchSummary(batch, state.pipelines)
  return (
    <div className="run-strip" role="status" aria-live="polite">
      {sum.waitingTotal ? <span className="gate-dot static" aria-hidden="true" /> : <Spinner size={20} />}
      <div style={{ flex: 1, minWidth: 0 }} className="run-strip-text">
        <span style={{ minWidth: 0 }}>
          <strong>Matrix · All gaps</strong> <span className="secondary">· {sum.waitingTotal ? `${sum.waitingTotal} waiting for you` : `${sum.finished} of ${sum.ps.length} areas finished`}</span>
        </span>
        <span className="secondary num">
          {sum.pct}% · {sum.closed} closed
        </span>
      </div>
      <button type="button" className={sum.waitingTotal ? 'btn btn-primary' : 'ghost icon-btn sm'} style={sum.waitingTotal ? { height: 34, fontSize: 13, padding: '0 12px', borderRadius: 8 } : undefined} aria-label="Open batch" onClick={() => navigate(paths.batch(batch.conversationId, batch.id))}>
        {sum.waitingTotal ? 'Decide' : <ChevronUp size={16} {...stroke} />}
      </button>
    </div>
  )
}

/* ---------------- Batch view (side panel) ---------------- */

export function BatchPanel() {
  const { conversationId = '', batchId = '' } = useParams()
  const { state, bulkDecide, bulkReadiness } = useStore()
  const [confirm, setConfirm] = useState<{ gate: GateId; decision: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const batch = state.batches[batchId]
  if (!batch) {
    return (
      <SidePanel label="Batch not found" title="Batch not found" closeTo={paths.conversation(conversationId)}>
        <div className="panel-body">
          <p className="prose secondary">This batch isn't in this browser.</p>
        </div>
      </SidePanel>
    )
  }
  const sum = batchSummary(batch, state.pipelines)
  const isOwner = (state.conversations[conversationId]?.owner ?? 'sp') === state.viewer

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const casesWaiting = sum.waiting.design.reduce((n, p) => n + allTestCases(p).length, 0)
  const actions: { gate: GateId; label: string; detail: string; decision: string; go: () => Promise<void> }[] = []
  if (sum.waiting.readiness.length) {
    actions.push({ gate: 'readiness', decision: 'ready', label: `Mark ${sum.uncertain} uncertain ${sum.uncertain === 1 ? 'story' : 'stories'} ready to test`, detail: `QA decision across ${sum.waiting.readiness.length} areas. Use “Open” on an area to decide story by story instead.`, go: () => bulkReadiness(batch.id, 'ready') })
  }
  if (sum.waiting.design.length) {
    actions.push({ gate: 'design', decision: 'approve', label: `Approve ${sum.waiting.design.length} design ${sum.waiting.design.length === 1 ? 'review' : 'reviews'}`, detail: `${casesWaiting} test cases, each tied to its acceptance criterion.`, go: () => bulkDecide(batch.id, 'design', 'approve') })
  }
  if (sum.waiting.code.length) {
    actions.push({ gate: 'code', decision: 'approve', label: `Approve ${sum.waiting.code.length} code ${sum.waiting.code.length === 1 ? 'review' : 'reviews'}`, detail: 'One pull request per area. Merging still happens in GitHub.', go: () => bulkDecide(batch.id, 'code', 'approve') })
  }
  if (sum.waiting.release.length) {
    actions.push({ gate: 'release', decision: 'approve', label: `Sign off ${sum.waiting.release.length} ${sum.waiting.release.length === 1 ? 'area' : 'areas'}`, detail: 'Sends results to Octane and marks stories Tested in Jira.', go: () => bulkDecide(batch.id, 'release', 'approve') })
  }

  return (
    <SidePanel
      label="Matrix batch"
      crumbs={[{ label: 'Matrix' }, { label: REPORT.app }]}
      title="All gaps · batch"
      meta={`${sum.ps.length} areas · ${sum.requirements} requirements · ${batch.repo} · started ${formatDateTime(batch.createdAt)}`}
      closeTo={paths.conversation(conversationId)}
    >
      <div className="panel-body" style={{ gap: 26 }}>
        <section className="kpis wide" aria-label="Batch progress">
          <Kpi value={`${sum.pct}%`} label="Progress" />
          <Kpi value={sum.closed} label="Gaps closed" />
          <Kpi value={`${sum.finished}/${sum.ps.length}`} label="Areas finished" />
          <Kpi value={sum.waitingTotal} label="Waiting for you" />
        </section>

        {isOwner && actions.length > 0 && (
          <section className="gate-bar" aria-label="Decide in bulk">
            <span style={{ fontSize: 14, fontWeight: 600 }}>Decide in bulk</span>
            <span className="secondary" style={{ fontSize: 13.5 }}>
              Each action records your decision on every waiting area, exactly as if you’d decided them one by one. Nothing is decided by a model.
            </span>
            <ul className="bulk-list">
              {actions.map((a) => (
                <li key={a.gate}>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <strong style={{ fontWeight: 600 }}>{a.label}</strong>
                    <span className="panel-meta">{a.detail}</span>
                  </span>
                  {confirm?.gate === a.gate ? (
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn ghost" style={{ height: 34, fontSize: 13 }} disabled={busy} onClick={() => setConfirm(null)}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-primary" style={{ height: 34, fontSize: 13 }} disabled={busy} onClick={() => run(a.go)}>
                        {busy ? 'Recording…' : 'Confirm'}
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="btn btn-primary" style={{ height: 34, fontSize: 13 }} onClick={() => setConfirm({ gate: a.gate, decision: a.decision })}>
                      {a.gate === 'release' ? 'Sign off all' : a.gate === 'readiness' ? 'Mark ready' : 'Approve all'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="Areas" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="section-head">
            <h3>Areas</h3>
            <span className="secondary" style={{ fontSize: 13 }}>
              Open an area to review its stories, test cases, code and results
            </span>
          </div>
          <ul className="batch-list">
            {sum.ps.map((p) => {
              const area = AREAS.find((a) => a.slug === p.areaSlug)
              const st = pipelineStatus(p)
              return (
                <li key={p.id} className="batch-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <Layers size={16} {...stroke} />
                    <strong style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{area?.name}</strong>
                    <span className="panel-meta">{p.frIds.length} requirements</span>
                    <Link to={paths.pipeline(conversationId, p.id, currentView(p))} className={`btn ${st.kind === 'waiting' && isOwner ? 'btn-primary' : 'btn-outline'}`} style={{ height: 32, fontSize: 13 }}>
                      Open
                    </Link>
                  </div>
                  <StageRail p={p} compact />
                  <span style={{ fontSize: 13.5 }}>
                    {st.kind === 'running' && <Spinner size={14} />} <strong style={{ fontWeight: 500 }}>{st.text}</strong>
                    {st.detail && <span className="secondary"> · {st.detail}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </SidePanel>
  )
}
