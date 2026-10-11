import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Check, ChevronDown, ExternalLink, FileText, GitPullRequest, RotateCcw, UserCheck, X } from 'lucide-react'
import { Spinner, StopGlyph, stroke } from '../icons'
import { SidePanel } from '../panel/SidePanel'
import { Kpi } from '../panel/ReportView'
import { RemRail, canDecide, remCurrentView } from './chat'
import { PeoplePicker } from '../team/PeoplePicker'
import { SEVERITY_ORDER, SEV_LABEL, approach, findingById, gapTests, impactedFrs, prLabel, remPrs, remTests, type Finding } from '../../remediation/data'
import { REM_GATES, remStageIndex, type CheckRun, type RemGateId, type RemStageId } from '../../remediation/types'
import { CODE_COMPONENTS, TEST_REPO, testFileFor } from '../../data/components'
import { findRequirement } from '../../data/report'
import { storyFor, testStem } from '../../pipeline/data'
import { person } from '../../team/roster'
import { formatDateTime, formatTime, paths } from '../../lib/format'
import { useStore } from '../../state/store'
import type { RemediationRecord } from '../../state/types'

const VIEWS = ['findings', 'coverage', 'fixes', 'merge', 'delivery'] as const
const stageOf = (r: RemediationRecord, id: RemStageId) => r.stages[remStageIndex(id)]

export function RemediationPanel() {
  const { conversationId = '', remediationId = '', view } = useParams()
  const { state, stopRemediation } = useStore()
  const navigate = useNavigate()
  const r = state.remediations[remediationId]
  const now = r ? remCurrentView(r) : undefined
  const prevNow = useRef(now)
  useEffect(() => {
    if (r && now && prevNow.current && now !== prevNow.current && view === prevNow.current) navigate(paths.remediation(conversationId, r.id, now), { replace: true })
    prevNow.current = now
  }, [now]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!r) {
    return (
      <SidePanel label="Remediation not found" title="Remediation not found" closeTo={paths.conversation(conversationId)}>
        <div className="panel-body">
          <p className="prose secondary">This remediation isn’t in this browser.</p>
        </div>
      </SidePanel>
    )
  }
  if (!view || !VIEWS.includes(view as (typeof VIEWS)[number])) return <Navigate to={paths.remediation(conversationId, r.id, remCurrentView(r))} replace />
  const isOwner = (r.owner ?? 'sp') === state.viewer
  const active = r.status === 'running' || r.status === 'waiting'

  return (
    <SidePanel
      label="Vulnerability remediation"
      crumbs={[{ label: 'Matrix' }, { label: r.app }]}
      title="Vulnerability remediation"
      meta={`${r.mode === 'scan' ? `Scan of ${CODE_COMPONENTS.length} components` : r.mode === 'direct' ? 'Fix agreed in chat' : `Imported: ${r.imported.join(', ')}`} · ${r.branch ? `${r.branch} → ${r.base}` : `PR into ${r.base}`} · started ${formatDateTime(r.startedAt)}`}
      closeTo={paths.conversation(conversationId)}
      actions={
        active && isOwner ? (
          <button type="button" className="ghost panel-btn" onClick={() => stopRemediation(r.id)}>
            <StopGlyph size={12} />
            <span className="label">Stop</span>
          </button>
        ) : undefined
      }
    >
      <div className="panel-body" style={{ gap: 26 }}>
        <RemRail r={r} view={view} onSelect={(v) => navigate(paths.remediation(conversationId, r.id, v), { replace: true })} />
        {r.error && <p className="prose secondary">{r.error}</p>}
        {view === 'findings' && <FindingsView r={r} isOwner={isOwner} />}
        {view === 'coverage' && <CoverageView r={r} canAct={canDecide(r, 'coverage', state.viewer)} />}
        {view === 'fixes' && <FixesView r={r} isOwner={isOwner} />}
        {view === 'merge' && <MergeView r={r} isOwner={isOwner} />}
        {view === 'delivery' && <DeliveryView r={r} />}
      </div>
    </SidePanel>
  )
}

function Working({ text }: { text: string }) {
  return (
    <div className="working" role="status">
      <Spinner size={20} />
      <span>{text}</span>
    </div>
  )
}

function SeverityBadge({ s }: { s: Finding['severity'] }) {
  return <span className={`sev sev-${s}`}>{SEV_LABEL[s]}</span>
}

/** A decision recorded at a gate. */
function GateRecord({ r, gate }: { r: RemediationRecord; gate: RemGateId }) {
  const g = r.gates[gate]
  if (g.status !== 'passed' && g.status !== 'rejected' && g.status !== 'changes') return null
  const verb = g.status === 'passed' ? (gate === 'triage' ? 'Confirmed' : gate === 'coverage' ? (g.auto ? 'No gaps' : 'Resolved') : 'Approved') : g.status === 'rejected' ? 'Rejected' : 'Changes requested'
  return (
    <div className="gate-record" role="status">
      {g.status === 'passed' ? <Check size={15} strokeWidth={2.5} aria-hidden /> : g.status === 'rejected' ? <X size={15} strokeWidth={2.5} aria-hidden /> : <RotateCcw size={15} {...stroke} />}
      <span>
        <strong style={{ fontWeight: 500 }}>
          {REM_GATES[gate].title}: {verb}
        </strong>{' '}
        by {g.by ?? '—'}
        {g.at ? ` · ${formatTime(g.at)}` : ''}
        {g.note && <span className="secondary"> — “{g.note}”</span>}
      </span>
    </div>
  )
}

/** Approve / alternative with a required note, for the code and release gates. */
function DecisionBar({ r, gate, approve, alt, summary, isOwner }: { r: RemediationRecord; gate: 'code' | 'release'; approve: string; alt: { label: string; decision: 'changes' | 'reject' }; summary: string; isOwner: boolean }) {
  const { decideRemGate } = useStore()
  const [noteMode, setNoteMode] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  if (r.gates[gate].status !== 'waiting') return <GateRecord r={r} gate={gate} />
  const decide = async (decision: string) => {
    setBusy(true)
    await decideRemGate(r.id, gate, { decision, note: note.trim() || undefined })
    setBusy(false)
  }
  return (
    <section className="gate-bar" aria-label={REM_GATES[gate].title}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
        <UserCheck size={16} {...stroke} />
        {REM_GATES[gate].title} <span className="secondary" style={{ fontWeight: 400 }}>· {REM_GATES[gate].who}</span>
      </span>
      <span className="secondary" style={{ fontSize: 13.5 }}>
        {summary}
      </span>
      {!isOwner ? (
        <span className="panel-meta">Only SP, who started this remediation, can decide this gate.</span>
      ) : (
        <>
          {noteMode && <textarea autoFocus aria-label={`${alt.label} note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={alt.decision === 'changes' ? 'What should change in the fixes or tests?' : 'Why are you rejecting this?'} />}
          <div className="card-actions" style={{ marginTop: 0, justifyContent: 'flex-start' }}>
            {!noteMode ? (
              <>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide('approve')}>
                  <Check size={15} strokeWidth={2} aria-hidden />
                  {approve}
                </button>
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setNoteMode(true)}>
                  {alt.label}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-primary" disabled={busy || !note.trim()} onClick={() => decide(alt.decision)}>
                  {alt.label}
                </button>
                <button type="button" className="btn ghost" onClick={() => setNoteMode(false)}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  )
}

/* ---------------- Findings + triage ---------------- */

function FindingsView({ r, isOwner }: { r: RemediationRecord; isOwner: boolean }) {
  const { decideRemGate, runChip } = useStore()
  const findings = r.findings.map(findingById).filter(Boolean) as Finding[]
  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
  const [pick, setPick] = useState<string[] | null>(null)
  const chosen = pick ?? findings.filter((f) => f.triage.verdict === 'fix').map((f) => f.id)
  const [busy, setBusy] = useState(false)
  const triageWaiting = r.gates.triage.status === 'waiting'
  const triaged = r.stages[1]?.status === 'done'

  if (!findings.length) {
    return r.status === 'completed' ? <p className="prose secondary">Nothing matched in the code.</p> : <Working text={r.mode === 'scan' ? `Scanning code, dependencies and secrets in ${CODE_COMPONENTS.map((c) => c.id).join(', ')}…` : `Looking for ${r.imported.join(', ')} in the code…`} />
  }

  return (
    <>
      <section className="kpis wide" aria-label="Findings summary">
        {SEVERITY_ORDER.map((s) => (
          <Kpi key={s} value={findings.filter((f) => f.severity === s).length} label={SEV_LABEL[s]} />
        ))}
      </section>
      {r.unmatched.length > 0 && <p className="secondary" style={{ margin: 0, fontSize: 13.5 }}>No match in the code for {r.unmatched.join(', ')}.</p>}
      {!triaged && <Working text="Triaging: rating severity and exploitability, and spotting false positives…" />}

      {triageWaiting && (
        <section className="gate-bar" aria-label="Triage review">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
            <UserCheck size={16} {...stroke} />
            Triage review <span className="secondary" style={{ fontWeight: 400 }}>· Security champion</span>
          </span>
          <span className="secondary" style={{ fontSize: 13.5 }}>
            Tick what Matrix should fix. Anything left unticked is dismissed and kept on record with the triage reason.
          </span>
          {isOwner ? (
            <div className="card-actions" style={{ marginTop: 0, justifyContent: 'flex-start' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  await decideRemGate(r.id, 'triage', { decision: 'approve', fix: chosen })
                  setBusy(false)
                }}
              >
                <Check size={15} strokeWidth={2} aria-hidden />
                {chosen.length ? `Fix ${chosen.length} · dismiss ${findings.length - chosen.length}` : 'Dismiss all'}
              </button>
            </div>
          ) : (
            <span className="panel-meta">Only SP, who started this remediation, can confirm triage.</span>
          )}
        </section>
      )}
      <GateRecord r={r} gate="triage" />

      <ul className="finding-list">
        {sorted.map((f) => (
          <FindingRow
            key={f.id}
            f={f}
            triaged={triaged}
            editable={triageWaiting && isOwner}
            checked={triageWaiting ? chosen.includes(f.id) : r.fix.includes(f.id)}
            decided={r.gates.triage.status === 'passed' ? (r.fix.includes(f.id) ? 'Fixing' : 'Dismissed') : undefined}
            onToggle={(on) => setPick(on ? [...chosen, f.id] : chosen.filter((x) => x !== f.id))}
            onChat={isOwner && triaged ? () => runChip(r.conversationId, { kind: 'say', text: `Fix ${f.id} (${f.title.toLowerCase()}) with me.` }) : undefined}
          />
        ))}
      </ul>
    </>
  )
}

function FindingRow({ f, triaged, editable, checked, decided, onToggle, onChat }: { f: Finding; triaged: boolean; editable: boolean; checked: boolean; decided?: string; onToggle: (on: boolean) => void; onChat?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="finding">
      <div className="finding-head">
        {editable && <input type="checkbox" className="check" aria-label={`Fix ${f.title}`} checked={checked} onChange={(e) => onToggle(e.target.checked)} />}
        <SeverityBadge s={f.severity} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <strong style={{ fontWeight: 600 }}>{f.title}</strong>
          <span className="panel-meta">
            <span className="mono">{f.cve ? `${f.cve} · ${f.cwe}` : f.cwe}</span> {f.cweName} · {f.scanner} · <span className="mono">{f.repo} · {f.file.split('/').pop()}:{f.line}</span>
          </span>
        </span>
        {decided && <span className={`tag ${decided === 'Fixing' ? 'pointed-tag' : ''}`}>{decided}</span>}
        {onChat && (
          <button type="button" className="btn btn-outline" style={{ height: 30, fontSize: 12.5, padding: '0 10px' }} onClick={onChat}>
            Fix in chat
          </button>
        )}
        <button type="button" className="ghost icon-btn xs" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} details for ${f.title}`} onClick={() => setOpen(!open)}>
          <ChevronDown size={15} {...stroke} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
        </button>
      </div>
      {triaged && (
        <div className="triage-line">
          <strong style={{ fontWeight: 500 }}>{f.triage.verdict === 'fix' ? 'Fix' : 'Likely false positive'}</strong> · confidence {f.triage.confidence.toFixed(2)} · {f.triage.reason}
        </div>
      )}
      {open && (
        <div className="finding-body">
          <span className="panel-meta">{f.triage.exploitability}</span>
          <div className="code">
            <div className="code-grid">
              {f.evidence.map((l) => (
                <span key={l.n} style={{ display: 'contents' }}>
                  <span className={`ln ${l.hit ? 'hl' : ''}`}>{l.n}</span>
                  <span className={l.hit ? 'hl' : ''}>{l.text}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </li>
  )
}

/* ---------------- CI run tracker (Harness → HyperExecute → re-scan) ---------------- */

function RunTracker({ run, title, where, waitingText, tests }: { run?: CheckRun; title: string; where: string; waitingText?: string; tests: string }) {
  const steps = [
    ...(waitingText ? [{ key: 'waiting', title: 'Merge', sub: run && run.phase !== 'waiting' ? `Merged into ${where} as ${run.commit}` : waitingText }] : []),
    { key: 'harness', title: 'Harness pipeline', sub: run?.harnessExecutionId ? `${title} · execution #${run.harnessExecutionId}` : `${title} starts on the commit` },
    { key: 'hyperexecute', title: `${tests} on HyperExecute`, sub: run?.jobId ? `Job ${run.jobId} · ${run.done} of ${run.total} done` : `${run?.total ?? ''} tests` },
    { key: 'rescan', title: `Re-scan ${where}`, sub: run?.rescanClean ? 'Clean: none of the fixed findings are reported' : 'Scanning the changed code and dependencies' },
  ]
  const order = steps.map((x) => x.key)
  const at = run ? (run.phase === 'done' ? order.length : order.indexOf(run.phase)) : 0
  return (
    <section className="tool-card progress-card" aria-label={title} style={{ paddingBottom: 12 }}>
      <ol className="steps">
        {steps.map((x, i) => {
          const st = i < at ? 'done' : i === at ? 'running' : 'pending'
          return (
            <li key={x.key} className={`step ${st}`}>
              {st === 'done' ? (
                <span className="step-icon-done">
                  <Check size={12} strokeWidth={3} aria-hidden />
                </span>
              ) : st === 'running' ? (
                <Spinner />
              ) : (
                <span className="step-icon-pending" />
              )}
              <span className="step-text">
                <span className="step-title">{x.title}</span>
                <span className="step-sub">{x.sub}</span>
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

const exploitLine = (n: number) => (n === 1 ? '1 exploit test that tries the attack and expects it to fail' : `${n} exploit tests that try the attack and expect it to fail`)

/** The functional tests that guard what a fix changes, for the pass tables. */
function functionalLine(r: RemediationRecord, f: Finding) {
  if (!f.impact.length) return 'None needed'
  const tested = f.impact.filter((id) => findRequirement(id)?.status === 'covered' || r.coverage?.closed.includes(id)).length
  return tested === f.impact.length ? `${f.impact.length} ${f.impact.length === 1 ? 'requirement' : 'requirements'} tested · passed` : `${tested} of ${f.impact.length} requirements tested`
}

function PassTable({ r, rescanLabel }: { r: RemediationRecord; rescanLabel: string }) {
  return (
    <div className="table-wrap">
      <table className="data-table dense" style={{ minWidth: 520 }}>
        <thead>
          <tr>
            <th scope="col">Finding</th>
            <th scope="col">Security tests</th>
            <th scope="col">Functional tests</th>
            <th scope="col">{rescanLabel}</th>
          </tr>
        </thead>
        <tbody>
          {r.fix.map((id) => {
            const f = findingById(id)!
            return (
              <tr key={id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{f.title}</div>
                  <div className="panel-meta mono">{f.cve ?? f.cwe}</div>
                </td>
                <td>
                  <span className="result result-passed">
                    <Check size={14} strokeWidth={2.25} aria-hidden /> {f.tests.length} passed
                  </span>
                </td>
                <td className="secondary">{functionalLine(r, f)}</td>
                <td>
                  <span className="result result-passed">
                    <Check size={14} strokeWidth={2.25} aria-hidden /> No longer reported
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------- Coverage check (before the PR) ---------------- */

const DEVELOPERS = ['aisha', 'daniel']

function CoverageView({ r, canAct }: { r: RemediationRecord; canAct: boolean }) {
  const { decideRemGate } = useStore()
  const [mode, setMode] = useState<'ask' | 'accept' | null>(null)
  const [people, setPeople] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const st = stageOf(r, 'coverage')
  const cov = r.coverage
  if (!st || st.status === 'pending' || st.status === 'skipped' || !cov) {
    const n = impactedFrs(r).length
    return <p className="prose secondary">Once the fixes are on the branch, I check whether {TEST_REPO} has tests for {n ? `the ${n} requirements they touch` : 'what they change'} before raising any PR.</p>
  }
  const open = cov.gaps.filter((id) => !cov.closed.includes(id))
  const writing = st.status === 'running' && cov.closedBy === 'matrix' && !r.prChecks
  const waiting = r.gates.coverage.status === 'waiting'
  const decide = async (decision: string, extra: Record<string, unknown> = {}) => {
    setBusy(true)
    await decideRemGate(r.id, 'coverage', { decision, ...extra })
    setBusy(false)
    setMode(null)
    setNote('')
  }
  const tests = gapTests(r)

  return (
    <>
      {st.status === 'running' && <Working text={writing ? `Writing tests for ${cov.closed.length} requirements in ${TEST_REPO}, then checking again…` : `Checking whether ${TEST_REPO} tests the ${cov.impacted.length} requirements these fixes touch…`} />}
      <section className="kpis wide" aria-label="Coverage summary">
        <Kpi value={cov.impacted.length} label="Requirements touched" />
        <Kpi value={cov.impacted.length - cov.gaps.length} label="Already tested" />
        <Kpi value={open.length} label="Untested" />
        <Kpi value={tests.length} label="Tests added" />
      </section>

      {waiting && (
        <section className="gate-bar" aria-label="Coverage gaps">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
            <UserCheck size={16} {...stroke} />
            Coverage gaps <span className="secondary" style={{ fontWeight: 400 }}>· Developer</span>
          </span>
          <span className="secondary" style={{ fontSize: 13.5 }}>
            {open.length} of the requirements these fixes touch {open.length === 1 ? 'has' : 'have'} no full test, so the PR checks wouldn’t catch a fix that breaks {open.length === 1 ? 'it' : 'them'}. No PR is raised until the gaps are closed or someone accepts the risk.
          </span>
          {cov.requested && (
            <span className="panel-meta">
              Asked {cov.requested.to.map((id) => person(id).name).join(', ')} at {formatTime(cov.requested.at)}
              {cov.requested.note ? ` — “${cov.requested.note}”` : ''}
            </span>
          )}
          {!canAct ? (
            <span className="panel-meta">Only SP, or a developer SP asks, can decide this gate.</span>
          ) : mode === 'ask' ? (
            <>
              <PeoplePicker value={people} onChange={setPeople} suggested={DEVELOPERS} />
              <textarea aria-label="Message to the developer" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything they should know? Optional." />
              <div className="card-actions" style={{ marginTop: 0, justifyContent: 'flex-start' }}>
                <button type="button" className="btn btn-primary" disabled={busy || !people.length} onClick={() => decide('request', { to: people, note: note.trim() || undefined })}>
                  Send request
                </button>
                <button type="button" className="btn ghost" onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
            </>
          ) : mode === 'accept' ? (
            <>
              <textarea autoFocus aria-label="Why go ahead without tests" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is it safe to raise the PR without these tests?" />
              <div className="card-actions" style={{ marginTop: 0, justifyContent: 'flex-start' }}>
                <button type="button" className="btn btn-primary" disabled={busy || !note.trim()} onClick={() => decide('accept', { note: note.trim() })}>
                  Raise the PRs anyway
                </button>
                <button type="button" className="btn ghost" onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="card-actions" style={{ marginTop: 0, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide('generate')}>
                <Check size={15} strokeWidth={2} aria-hidden />
                Write the {open.length} missing tests with Matrix
              </button>
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setMode('ask')}>
                Ask a developer
              </button>
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => decide('added')}>
                I’ve pushed tests to the branch
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => setMode('accept')}>
                Go ahead without them
              </button>
            </div>
          )}
        </section>
      )}
      <GateRecord r={r} gate="coverage" />

      <div className="table-wrap">
        <table className="data-table dense" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th scope="col">Requirement</th>
              <th scope="col">Fix</th>
              <th scope="col">Tests in {TEST_REPO}</th>
            </tr>
          </thead>
          <tbody>
            {[...cov.impacted].sort((x, y) => Number(cov.gaps.includes(y)) - Number(cov.gaps.includes(x))).map((id) => {
              const req = findRequirement(id)
              const f = r.fix.map(findingById).find((x) => x?.impact.includes(id))
              const closed = cov.closed.includes(id)
              const gap = cov.gaps.includes(id)
              return (
                <tr key={id} className={gap && !closed ? 'pointed' : ''}>
                  <td>
                    <div style={{ fontWeight: 500 }}>
                      <span className="mono">{id}</span> {req?.title}
                    </div>
                    <div className="panel-meta">Through {req?.components.join(' → ')}</div>
                  </td>
                  <td className="secondary">{f?.title}</td>
                  <td>
                    {closed ? (
                      <span className="result result-passed">
                        <Check size={14} strokeWidth={2.25} aria-hidden /> Added{cov.closedBy === 'developer' ? ' by developer' : ` by Matrix · ${tests.filter((t) => t.frId === id).length} tests`}
                      </span>
                    ) : !gap ? (
                      <span className="result result-passed">
                        <Check size={14} strokeWidth={2.25} aria-hidden /> {req?.evidence?.split(' · ')[1]}
                      </span>
                    ) : (
                      <span className="secondary">{req?.status === 'partial' ? `Smoke test only (${req.evidence?.split(' · ')[1]})` : 'None'}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {tests.length > 0 && cov.closedBy === 'matrix' && !writing && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-label="Tests Matrix wrote">
          <div className="section-head">
            <h3 style={{ fontSize: 18 }}>Tests Matrix wrote</h3>
            <span className="secondary" style={{ fontSize: 13 }}>
              {TEST_REPO} · {r.branch}
            </span>
          </div>
          <ul className="link-list">
            {tests.map((t) => {
              const story = storyFor(t.frId)
              return (
                <li key={t.id}>
                  <span className="mono secondary" style={{ fontSize: 12.5, width: 92 }}>
                    {t.id}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span>{t.title}</span>
                    <span className="panel-meta mono">{testFileFor(story.req, testStem(story))}</span>
                  </span>
                  <span className="tag">{t.frId}</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </>
  )
}

/* ---------------- Fix on a branch + PR checks ---------------- */

function FixesView({ r, isOwner }: { r: RemediationRecord; isOwner: boolean }) {
  const fixStage = stageOf(r, 'fix')
  const checks = stageOf(r, 'pr_checks')
  if (!fixStage || fixStage.status === 'pending' || fixStage.status === 'skipped') return <p className="prose secondary">Fixes start once you confirm triage.</p>
  if (fixStage.status === 'running') return <Working text={r.revision > 1 ? `Committing a revised fix to ${r.branch}…` : `Committing patches and security tests to ${r.branch}…`} />
  const tests = remTests(r)
  const raised = !!checks && checks.status !== 'pending' && checks.status !== 'skipped'
  const extra = gapTests(r).length
  return (
    <>
      {checks?.status === 'done' && (
        <DecisionBar r={r} gate="code" approve="Approve code review" alt={{ label: 'Request changes', decision: 'changes' }} summary={`The post-commit checks passed on every PR. After you approve, merge ${remPrs(r).length === 1 ? 'the PR' : 'the PRs'} into ${r.base} in GitHub; that triggers the post-merge run of the full automation suite.`} isOwner={isOwner} />
      )}
      {!raised ? (
        <p className="callout" style={{ margin: 0, fontSize: 14 }}>
          The fixes are committed to <span className="mono">{r.branch}</span>. The PRs are raised once the coverage check confirms there are tests for what the fixes change.
        </p>
      ) : (
        <>
          {remPrs(r).map((pr) => {
            const own = pr.repo === TEST_REPO ? [] : r.fix.filter((id) => findingById(id)?.repo === pr.repo)
            const ownTests = own.flatMap((id) => findingById(id)!.tests)
            return (
              <section key={pr.repo} className="pr-card" aria-label={`Pull request in ${pr.repo}`}>
                <span className="icon-tile">
                  <GitPullRequest size={18} {...stroke} />
                </span>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 500 }}>
                    {pr.repo} PR #{pr.number} · {pr.repo === TEST_REPO ? `Tests for ${r.coverage?.closed.length} untested requirements` : `Fix ${own.length} ${own.length === 1 ? 'vulnerability' : 'vulnerabilities'}`}
                  </span>
                  <span className="mono secondary" style={{ fontSize: 12.5 }}>
                    {r.branch} → {r.base}
                  </span>
                  <span className="panel-meta">
                    {pr.repo === TEST_REPO
                      ? r.coverage?.closedBy === 'developer'
                        ? 'Functional tests added by the developer for the coverage gaps'
                        : `${extra} functional tests written in the style of each component's existing tests`
                      : `${ownTests.length} security ${ownTests.length === 1 ? 'test' : 'tests'} · ${exploitLine(ownTests.filter((t) => t.kind === 'exploit').length)}`}
                  </span>
                </div>
                <a href="#" onClick={(e) => e.preventDefault()} className="ghost row-btn" style={{ gap: 6 }}>
                  View in GitHub <ExternalLink size={14} {...stroke} />
                </a>
              </section>
            )
          })}

          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-label="PR checks">
            <div className="section-head">
              <h3 style={{ fontSize: 18 }}>PR checks · post-commit</h3>
              <span className="secondary" style={{ fontSize: 13 }}>
                on {r.branch}
              </span>
            </div>
            <RunTracker
              run={r.prChecks}
              title={`${r.app.toLowerCase()}-security-postcommit`}
              where={r.branch}
              tests={`${tests.length} security${extra ? `, ${extra} new functional` : ''} and the existing tests for the touched requirements`}
            />
            {checks?.status === 'done' && <PassTable r={r} rescanLabel="Branch re-scan" />}
          </section>
        </>
      )}

      {r.fix.map((id) => {
        const f = findingById(id)!
        const a = approach(f, r.variants[id] ?? 0)
        return (
          <section key={id} className="fix-block" aria-label={`Fix for ${f.title}`}>
            <div className="section-head">
              <h3 style={{ fontSize: 18 }}>{f.title}</h3>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {a.label !== 'Recommended' && <span className="tag">{a.label}</span>}
                <SeverityBadge s={f.severity} />
              </span>
            </div>
            <p className="prose" style={{ fontSize: 14.5 }}>
              {a.summary}
            </p>
            <Diff f={f} variant={r.variants[id] ?? 0} />
            <ul className="link-list">
              {f.tests.map((t) => (
                <li key={t.id}>
                  <span className="mono secondary" style={{ fontSize: 12.5, width: 92 }}>
                    {t.id}
                  </span>
                  <span style={{ flex: 1 }}>{t.title}</span>
                  <span className="tag">{t.kind}</span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </>
  )
}

export function Diff({ f, variant = 0 }: { f: Finding; variant?: number }) {
  const a = approach(f, variant)
  return (
    <div className="code diff" aria-label="Change">
      <span className="mono panel-meta" style={{ display: 'block', marginBottom: 6 }}>
        {f.repo}/{f.file}
      </span>
      {a.before.map((l, i) => (
        <div key={`b${i}`} className="diff-line del">
          <span aria-hidden="true">−</span> {l}
        </div>
      ))}
      {a.after.map((l, i) => (
        <div key={`a${i}`} className="diff-line add">
          <span aria-hidden="true">+</span> {l}
        </div>
      ))}
    </div>
  )
}

/* ---------------- Post-merge ---------------- */

function MergeView({ r, isOwner }: { r: RemediationRecord; isOwner: boolean }) {
  const st = stageOf(r, 'post_merge')
  if (!st || st.status === 'pending' || st.status === 'skipped') return <p className="prose secondary">The post-merge pipeline runs the full automation suite once the code review is approved and the PRs are merged into {r.base}.</p>
  return (
    <>
      {st.status === 'done' && <DecisionBar r={r} gate="release" approve="Sign off" alt={{ label: 'Reject', decision: 'reject' }} summary={`The full automation suite passed on ${r.base}. Signing off closes the findings in the scanner.`} isOwner={isOwner} />}
      <div className="section-head">
        <h3 style={{ fontSize: 18 }}>Post-merge · {r.base}</h3>
        <span className="secondary" style={{ fontSize: 13 }}>
          {prLabel(r)} · {r.branch} → {r.base}
        </span>
      </div>
      <RunTracker
        run={r.postMerge}
        title={`${r.app.toLowerCase()}-regression-postmerge`}
        where={r.base}
        tests={`Full ${TEST_REPO} suite (${r.postMerge?.total ?? ''} tests)`}
        waitingText={`Waiting for ${prLabel(r)} to merge into ${r.base} in GitHub`}
      />
      {st.status === 'done' && <PassTable r={r} rescanLabel={`Re-scan of ${r.base}`} />}
    </>
  )
}

/* ---------------- Delivery ---------------- */

function DeliveryView({ r }: { r: RemediationRecord }) {
  if (r.outcome === 'rejected') return <p className="prose secondary">Release sign-off was rejected. Nothing was marked resolved.</p>
  const st = stageOf(r, 'deliver')
  if (!st || st.status === 'pending' || st.status === 'skipped') return <p className="prose secondary">Delivery happens after release sign-off.</p>
  if (st.status === 'running') return <Working text="Closing the findings in the scanner and resolving the security tickets…" />
  return (
    <>
      <section className="kpis wide" aria-label="Summary">
        <Kpi value={r.fix.length} label="Remediated" />
        <Kpi value={r.dismissed.length} label="Dismissed at triage" />
        <Kpi value={remTests(r).length} label="Security tests added" />
        <Kpi value={gapTests(r).length} label="Functional tests added" />
        <Kpi value={r.base} label="Merged into" />
      </section>
      <ul className="link-list">
        {r.fix.map((id) => {
          const f = findingById(id)!
          return (
            <li key={id}>
              <span className="mono" style={{ fontSize: 13, width: 80 }}>
                {f.id}
              </span>
              <span style={{ flex: 1 }}>{f.title}</span>
              <span className="secondary">
                Scanner → <strong style={{ fontWeight: 500, color: 'var(--mx-text)' }}>Resolved</strong>
              </span>
            </li>
          )
        })}
        {r.dismissed.map((id) => {
          const f = findingById(id)!
          return (
            <li key={id}>
              <span className="mono" style={{ fontSize: 13, width: 80 }}>
                {f.id}
              </span>
              <span style={{ flex: 1 }}>{f.title}</span>
              <span className="secondary">Dismissed · {f.triage.reason}</span>
            </li>
          )
        })}
        <li>
          <FileText size={15} color="var(--mx-text-secondary)" {...stroke} />
          <span style={{ flex: 1 }}>
            Attestation: each fix linked to its finding, {prLabel(r)} ({r.branch} → {r.base}, merged at <span className="mono">{r.mergeCommit}</span>), the coverage check, its tests and both re-scans
          </span>
          <span className="mono secondary" style={{ fontSize: 12.5 }}>
            sha256:7d1e…c90a
          </span>
        </li>
      </ul>
      {r.fix.includes('VULN-103') && <p className="callout" style={{ margin: 0, fontSize: 14 }}>Reminder: the SFTP password that was in the code is still in Git history. Rotate it; Matrix only removed it from the source.</p>}
    </>
  )
}
