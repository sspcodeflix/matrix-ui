import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Check, ChevronDown, ExternalLink, FileText, GitPullRequest, Minus, X } from 'lucide-react'
import { Spinner, StopGlyph, stroke } from '../icons'
import { SidePanel } from '../panel/SidePanel'
import { Kpi } from '../panel/ReportView'
import { ANSWERS, AnswerLabel, GateBar, StageRail, currentView } from './parts'
import { Bar } from '../run'
import { AREAS, coveragePct } from '../../data/report'
import {
  FR214_TEST_EXCERPT,
  automationFor,
  coverageDelta,
  criteriaFor,
  deliveryFor,
  executionFor,
  readyFrIds,
  storyFor,
  testCasesFor,
  type TestResult,
} from '../../pipeline/data'
import { CONFIDENCE_FLOOR, type PipelineState } from '../../pipeline/types'
import { formatDateTime, formatDuration, formatTime, paths } from '../../lib/format'
import { useStore } from '../../state/store'
import { TeamReviewSection, useFocusedReviewItems } from '../team/TeamReview'

const VIEWS = ['readiness', 'design', 'automation', 'execution', 'delivery'] as const

export function PipelinePanel() {
  const { conversationId = '', pipelineId = '', view } = useParams()
  const { state, stopPipeline } = useStore()
  const navigate = useNavigate()
  const p = state.pipelines[pipelineId]
  const now = p ? currentView(p) : undefined

  // Follow the pipeline: if you're looking at the stage it was on, move with it.
  const prevNow = useRef(now)
  useEffect(() => {
    if (p && now && prevNow.current && now !== prevNow.current && view === prevNow.current) {
      navigate(paths.pipeline(conversationId, p.id, now), { replace: true })
    }
    prevNow.current = now
  }, [now]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) {
    return (
      <SidePanel label="Pipeline not found" title="Pipeline not found" closeTo={paths.conversation(conversationId)}>
        <div className="panel-body">
          <p className="prose secondary">This Matrix pipeline isn't in this browser.</p>
        </div>
      </SidePanel>
    )
  }
  if (!view || !VIEWS.includes(view as (typeof VIEWS)[number])) return <Navigate to={paths.pipeline(conversationId, p.id, currentView(p))} replace />

  const area = AREAS.find((a) => a.slug === p.areaSlug)
  const active = p.status === 'running' || p.status === 'waiting'

  return (
    <SidePanel
      label={`Matrix pipeline, ${area?.name}`}
      crumbs={p.batchId ? [{ label: 'All gaps batch', to: paths.batch(conversationId, p.batchId) }, { label: p.app }] : [{ label: 'Matrix' }, { label: p.app }]}
      title={`${area?.name} · ${p.frIds.length} ${p.frIds.length === 1 ? 'requirement' : 'requirements'}`}
      meta={`${p.repo} · started ${formatDateTime(p.startedAt)}${p.error ? ' · unavailable' : ''}`}
      closeTo={paths.conversation(conversationId)}
      actions={
        active ? (
          <button type="button" className="ghost panel-btn" onClick={() => stopPipeline(p.id)}>
            <StopGlyph size={12} />
            <span className="label">Stop</span>
          </button>
        ) : undefined
      }
    >
      <div className="panel-body" style={{ gap: 26 }}>
        <StageRail p={p} view={view} onSelect={(v) => navigate(paths.pipeline(conversationId, p.id, v), { replace: true })} />
        {p.error && <p className="prose secondary">{p.error}</p>}
        {view === 'readiness' && <ReadinessView p={p} />}
        {view === 'design' && <DesignView p={p} />}
        {view === 'automation' && <AutomationView p={p} />}
        {view === 'execution' && <ExecutionView p={p} />}
        {view === 'delivery' && <DeliveryView p={p} />}
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

/* ---------------- 01 + 02: intake and readiness ---------------- */

function ReadinessView({ p }: { p: PipelineState }) {
  const { decideReadiness } = useStore()
  const convoId = useParams().conversationId ?? ''
  const judged = Object.keys(p.readiness).length > 0
  const intakeRunning = p.stages[0]?.status === 'running'
  const g = p.gates.readiness

  return (
    <>
      <section className="section-head">
        <h3>Readiness</h3>
        <span className="secondary" style={{ fontSize: 13 }}>
          Confidence floor {CONFIDENCE_FLOOR.toFixed(2)} ·{' '}
          {g.status === 'passed' ? (g.auto ? 'gate passed automatically' : `gate passed after QA decision`) : g.status === 'waiting' ? 'waiting for a QA decision' : 'gate not reached yet'}
        </span>
      </section>
      {!judged && <Working text={intakeRunning ? 'Reading the stories, acceptance criteria and linked pages…' : 'Checking each story is ready to test…'} />}
      <div className="table-wrap">
        <table className="data-table" style={{ minWidth: 600 }}>
          <thead>
            <tr>
              <th scope="col" style={{ width: 120 }}>
                Story
              </th>
              <th scope="col">Requirement</th>
              <th scope="col" style={{ width: 170 }}>
                Readiness
              </th>
              <th scope="col" className="r" style={{ width: 110 }}>
                Confidence
              </th>
            </tr>
          </thead>
          <tbody>
            {p.frIds.map((id) => {
              const s = storyFor(id)
              const r = p.readiness[id]
              return (
                <tr key={id}>
                  <td style={{ verticalAlign: 'top' }}>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
                      {s.key}
                    </span>
                    <div className="mono secondary" style={{ fontSize: 12 }}>
                      {id}
                    </div>
                  </td>
                  <td style={{ verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 500 }}>{s.title}</div>
                    {r && (
                      <div className="secondary" style={{ fontSize: 13, marginTop: 2 }}>
                        {r.reason}
                      </div>
                    )}
                    {r && (
                      <div style={{ fontSize: 13, marginTop: 6 }}>
                        {r.answer === 'uncertain' && !r.decision ? (
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span className="secondary">QA decides:</span>
                            <button type="button" className="btn btn-outline" style={{ height: 32, fontSize: 13, padding: '0 10px' }} onClick={() => decideReadiness(p.id, id, 'ready')}>
                              Ready to test
                            </button>
                            <button type="button" className="btn btn-outline" style={{ height: 32, fontSize: 13, padding: '0 10px' }} onClick={() => decideReadiness(p.id, id, 'not_ready')}>
                              Not ready
                            </button>
                          </span>
                        ) : r.answer === 'uncertain' ? (
                          <span className="secondary">
                            QA decided <strong style={{ fontWeight: 500, color: 'var(--mx-text)' }}>{r.decision === 'ready' ? 'ready to test' : 'not ready'}</strong> · {r.decidedBy}
                          </span>
                        ) : (
                          <span className="secondary">{ANSWERS[r.answer].next}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ verticalAlign: 'top' }}>{r ? <AnswerLabel answer={r.answer} /> : <span className="secondary">{intakeRunning ? 'Reading…' : 'Checking…'}</span>}</td>
                  <td className="r" style={{ verticalAlign: 'top' }}>
                    {r && (
                      <>
                        <span style={{ fontWeight: 500 }}>{r.confidence.toFixed(2)}</span>
                        <div className="secondary" style={{ fontSize: 12 }}>
                          {r.judge === 'model' ? 'Readiness model' : 'Gemini via Tachyon'}
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <TeamReviewSection
        conversationId={convoId}
        target={{ kind: 'stage', pipelineId: p.id, stage: 'readiness' }}
        items={p.frIds.map((id) => ({ id: storyFor(id).key, label: storyFor(id).title }))}
      />
      <section className="callout" aria-label="How readiness is judged">
        <h3>How readiness is judged</h3>
        <ul>
          <li>
            <span className="marker uncovered sm" aria-hidden="true" />
            <span>A small readiness model gives the answer, the gaps and a confidence score in milliseconds.</span>
          </li>
          <li>
            <span className="marker uncovered sm" aria-hidden="true" />
            <span>If it's unsure, Gemini via Tachyon decides with the readiness skill. If that's still uncertain, QA decides. Your decisions become labels for the next offline model update.</span>
          </li>
        </ul>
      </section>
    </>
  )
}

/* ---------------- 03: test design ---------------- */

function DesignView({ p }: { p: PipelineState }) {
  const convoId = useParams().conversationId ?? ''
  const { decideGate } = useStore()
  const stage = p.stages[2]
  if (!stage || stage.status === 'pending' || stage.status === 'skipped') return <NotYet what="Test design starts once stories pass the readiness gate." />
  const ready = readyFrIds(p)
  const running = stage.status === 'running'
  const total = ready.reduce((n, id) => n + testCasesFor(storyFor(id), p.revisions.design).length, 0)
  return (
    <>
      <GateBar
        p={p}
        gate="design"
        approve="Approve test design"
        alternative={{ label: 'Request changes', decision: 'changes', placeholder: 'What should change? e.g. add a boundary case for the cut-off time' }}
        summary={`${total} test cases across ${ready.length} ${ready.length === 1 ? 'story' : 'stories'}. Each one cites the criterion it came from.`}
      />
      {running && <Working text={p.revisions.design > 1 ? `Revising the test design with the change request (revision ${p.revisions.design})…` : 'Writing test cases for each acceptance criterion…'} />}
      {!running && (
        <TeamReviewSection
          conversationId={convoId}
          target={{ kind: 'stage', pipelineId: p.id, stage: 'design' }}
          items={ready.flatMap((id) => testCasesFor(storyFor(id), p.revisions.design).map((tc) => ({ id: tc.id, label: tc.title })))}
          onUseSuggestion={p.gates.design.status === 'waiting' ? (text) => decideGate(p.id, 'design', 'changes', text) : undefined}
        />
      )}
      {!running &&
        ready.map((id) => {
          const s = storyFor(id)
          return (
            <section key={id} className="story-block" aria-label={`${s.key} test cases`}>
              <div className="section-head">
                <h3>
                  <span className="mono" style={{ fontSize: 14 }}>
                    {s.key}
                  </span>{' '}
                  {s.title}
                </h3>
              </div>
              <ul className="criteria">
                {criteriaFor(s).map((c) => (
                  <li key={c.id}>
                    <span className="id-chip">{c.id}</span>
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
              <ul className="cases">
                {testCasesFor(s, p.revisions.design).map((tc) => (
                  <CaseRow key={tc.id} tc={tc} />
                ))}
              </ul>
            </section>
          )
        })}
    </>
  )
}

function CaseRow({ tc }: { tc: ReturnType<typeof testCasesFor>[number] }) {
  const focused = useFocusedReviewItems().has(tc.id)
  const [open, setOpen] = useState(focused)
  return (
    <li className={`case ${focused ? 'pointed' : ''}`}>
      <button type="button" className="case-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="mono secondary" style={{ fontSize: 12.5, width: 92, flex: 'none' }}>
          {tc.id}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 500 }}>
          {tc.title}
          {tc.addedInRevision && <span className="tag">New in revision {tc.addedInRevision}</span>}
          {focused && <span className="tag pointed-tag">Asked to review</span>}
        </span>
        <span className="id-chip" style={{ padding: '3px 6px', fontSize: 12 }}>
          {tc.criterion}
        </span>
        <ChevronDown className="chev" size={15} {...stroke} />
      </button>
      {open && (
        <div className="case-body">
          <ol>
            {tc.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <div>
            <span className="secondary">Expected: </span>
            {tc.expected}
          </div>
          <div className="secondary" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            Sources:
            {tc.sources.map((s) => (
              <span key={s} className="mono source">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </li>
  )
}

/* ---------------- 04: automation ---------------- */

function AutomationView({ p }: { p: PipelineState }) {
  const pointed = useFocusedReviewItems()
  const convoId = useParams().conversationId ?? ''
  const { decideGate } = useStore()
  const stage = p.stages[3]
  if (!stage || stage.status === 'pending' || stage.status === 'skipped') return <NotYet what="Automation starts after the test design is approved." />
  if (stage.status === 'running' && (!p.prChecks || p.prChecks.phase === 'writing'))
    return (
      <>
        <GateBar p={p} gate="code" approve="" alternative={{ label: '', decision: 'changes', placeholder: '' }} summary="" />
        <Working text={p.revisions.automation > 1 ? 'Committing the updated scripts to the feature branch…' : `Writing scripts the ${p.repo} way and committing them to a feature branch…`} />
      </>
    )
  const a = automationFor(p)
  const checksDone = stage.status === 'done'
  const ex = executionFor(p)
  const failed = ex.results.filter((r) => r.result === 'failed').length
  const flaky = ex.results.filter((r) => r.result === 'flaky').length
  const passed = ex.results.length - failed - flaky
  const hasFr214 = readyFrIds(p).includes('FR-214')
  return (
    <>
      <GateBar
        p={p}
        gate="code"
        approve="Approve code review"
        alternative={{ label: 'Request changes', decision: 'changes', placeholder: 'What should change in the scripts?' }}
        summary={`PR checks on the branch: ${passed} passed${failed ? `, ${failed} failed` : ''}${flaky ? `, ${flaky} flaky` : ''}${failed ? ' (triage below)' : ''}. After you approve, merge the PR into main in GitHub; that triggers the post-merge pipeline.`}
      />
      <section className="pr-card" aria-label="Pull request">
        <span className="icon-tile">
          <GitPullRequest size={18} {...stroke} />
        </span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontWeight: 500 }}>
            {a.repo} #{a.pr} · {a.title}
          </span>
          <span className="mono secondary" style={{ fontSize: 12.5 }}>
            {a.branch} → main
          </span>
          <span style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6, fontSize: 13 }}>
            {a.checks.map((c) => (
              <span key={c.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Check size={14} strokeWidth={2.5} aria-hidden /> {c.name}
              </span>
            ))}
          </span>
        </div>
        <a href="#" onClick={(e) => e.preventDefault()} className="ghost row-btn" style={{ gap: 6 }}>
          View in GitHub <ExternalLink size={14} {...stroke} />
        </a>
      </section>

      <section aria-label="PR checks" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="section-head">
          <h3 style={{ fontSize: 18 }}>PR checks · post-commit</h3>
          <span className="secondary" style={{ fontSize: 13 }}>
            on {a.branch}
          </span>
        </div>
        <PrChecksTracker p={p} />
        {checksDone && (
          <ul className="link-list">
            {ex.results
              .filter((r) => r.result !== 'passed')
              .map(({ tc, result, triage }) => (
                <li key={tc.id} style={{ alignItems: 'flex-start' }}>
                  <span className="mono secondary" style={{ fontSize: 12.5, width: 100 }}>
                    {tc.id}
                  </span>
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>{tc.title}</span>
                    {triage && <span className="triage">Triage: {triage}</span>}
                  </span>
                  <span className={`result result-${result}`}>{result === 'failed' ? 'Failed' : 'Flaky'}</span>
                </li>
              ))}
            <li>
              <span className="result result-passed">
                <Check size={14} strokeWidth={2.25} aria-hidden /> {passed} passed
              </span>
            </li>
          </ul>
        )}
      </section>
      <div className="table-wrap">
        <table className="data-table" style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Story</th>
              <th scope="col" className="r">
                Tests
              </th>
              <th scope="col" className="r">
                Lines
              </th>
            </tr>
          </thead>
          <tbody>
            {a.files.map((f) => (
              <tr key={f.path} className={pointed.has(f.path.split('/').pop()!) ? 'pointed' : ''}>
                <td style={{ overflowWrap: 'anywhere' }}>
                  <div className="mono" style={{ fontSize: 12.5 }}>
                    {f.path}
                  </div>
                  <div className="panel-meta">Through {f.components.join(' → ')}</div>
                </td>
                <td className="mono secondary" style={{ fontSize: 12.5 }}>
                  {f.story}
                </td>
                <td className="r">{f.cases}</td>
                <td className="r secondary">+{f.added}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasFr214 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Excerpt">
          <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500 }}>
            <FileText size={15} color="var(--mx-text-secondary)" {...stroke} />
            {a.files.find((f) => f.story.endsWith('1421'))?.path.split('/').pop()}
          </span>
          <div className="code">
            <div className="code-grid">
              {FR214_TEST_EXCERPT.map((line, i) => (
                <span key={i} style={{ display: 'contents' }}>
                  <span className="ln">{41 + i}</span>
                  <span className={i === 1 ? 'hl' : ''}>{line}</span>
                </span>
              ))}
            </div>
          </div>
          <span className="secondary" style={{ fontSize: 12.5 }}>
            Every test is annotated with the criterion it proves, so the traceability chain survives in the code.
          </span>
        </section>
      )}
      <TeamReviewSection
        conversationId={convoId}
        target={{ kind: 'stage', pipelineId: p.id, stage: 'automation' }}
        items={a.files.map((f) => ({ id: f.path.split('/').pop()!, label: `${f.cases} tests · ${f.story}` }))}
        onUseSuggestion={p.gates.code.status === 'waiting' ? (text) => decideGate(p.id, 'code', 'changes', text) : undefined}
      />
    </>
  )
}

/* ---------------- 05: execute and evidence ---------------- */

const RESULT: Record<TestResult, { label: string; Icon: typeof Check }> = {
  passed: { label: 'Passed', Icon: Check },
  failed: { label: 'Failed', Icon: X },
  flaky: { label: 'Flaky', Icon: Minus },
}

function ExecutionView({ p }: { p: PipelineState }) {
  const pointed = useFocusedReviewItems()
  const convoId = useParams().conversationId ?? ''
  const stage = p.stages[4]
  if (!stage || stage.status === 'pending' || stage.status === 'skipped') return <NotYet what="Tests run once the code review is approved." />
  if (stage.status === 'running') return <ExecutionTrack p={p} />
  const ex = executionFor(p)
  const d = coverageDelta(p)
  const n = (r: TestResult) => ex.results.filter((x) => x.result === r).length
  return (
    <>
      <GateBar
        p={p}
        gate="release"
        approve="Sign off"
        alternative={{ label: 'Reject', decision: 'reject', placeholder: 'Why are you rejecting this release?' }}
        summary="Signing off sends results to Octane and updates Jira. No sign-off comes from a model."
      />
      <section className="kpis wide" aria-label="Run summary">
        <Kpi value={n('passed')} label="Passed" />
        <Kpi value={n('failed')} label="Failed" />
        <Kpi value={n('flaky')} label="Flaky" />
        <Kpi value={formatDuration(ex.results.reduce((s, r) => s + r.durationMs, 0))} label={`Test time · ${ex.hyperexecute?.concurrency ?? 1} in parallel`} />
      </section>

      <RunProvenance p={p} />

      <section aria-label="Coverage change" className="delta">
        <h3 className="serif" style={{ margin: 0, fontWeight: 500, fontSize: 18 }}>
          Testmind re-measured {d.area.name}
        </h3>
        <div className="delta-row">
          <span className="delta-num">{coveragePct(d.before.covered, d.before.total)}%</span>
          <ArrowRight size={18} {...stroke} />
          <span className="delta-num">{coveragePct(d.after.covered, d.after.total)}%</span>
          <span className="secondary" style={{ fontSize: 13.5 }}>
            {d.before.covered} → {d.after.covered} of {d.area.total} requirements with test evidence · overall {d.overallBefore} → {d.overallAfter} of 657
          </span>
        </div>
      </section>

      <div className="table-wrap">
        <table className="data-table dense" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th scope="col" style={{ width: 100 }}>
                Test
              </th>
              <th scope="col">Case</th>
              <th scope="col" style={{ width: 110 }}>
                Result
              </th>
              <th scope="col" className="r" style={{ width: 80 }}>
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            {ex.results.map(({ tc, result, durationMs, triage }) => {
              const R = RESULT[result]
              return (
                <tr key={tc.id} className={pointed.has(tc.id) ? 'pointed' : ''}>
                  <td className="mono secondary" style={{ fontSize: 12.5, verticalAlign: 'top' }}>
                    {tc.id}
                  </td>
                  <td style={{ verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 500 }}>{tc.title}</div>
                    {triage && (
                      <div className="triage">
                        <strong style={{ fontWeight: 500 }}>Triage:</strong> {triage}
                      </div>
                    )}
                  </td>
                  <td style={{ verticalAlign: 'top' }}>
                    <span className={`result result-${result}`}>
                      <R.Icon size={14} strokeWidth={2.25} aria-hidden />
                      {R.label}
                    </span>
                  </td>
                  <td className="r secondary" style={{ verticalAlign: 'top' }}>
                    {(durationMs / 1000).toFixed(1)}s
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <TeamReviewSection
        conversationId={convoId}
        target={{ kind: 'stage', pipelineId: p.id, stage: 'execution' }}
        items={ex.results.filter((r) => r.result !== 'passed').map((r) => ({ id: r.tc.id, label: `${RESULT[r.result].label} · ${r.tc.title}` }))}
      />
      <section aria-label="Evidence" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="section-head">
          <h3>Evidence</h3>
          <span className="secondary" style={{ fontSize: 13 }}>
            Write-once, hashed
          </span>
        </div>
        <ul className="link-list">
          {ex.evidence.map((e) => (
            <li key={e.name}>
              <FileText size={15} color="var(--mx-text-secondary)" {...stroke} />
              <span style={{ flex: 1 }}>{e.name}</span>
              <span className="mono secondary" style={{ fontSize: 12.5 }}>
                {e.hash}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

/* ---------------- 06: deliver + traceability ---------------- */

function DeliveryView({ p }: { p: PipelineState }) {
  const ready = readyFrIds(p)
  const [storyId, setStoryId] = useState(ready[0])
  if (p.status === 'completed' && p.outcome === 'nothing_ready') return <NotYet what="No story passed the readiness gate, so nothing was designed, run or delivered." />
  if (p.outcome === 'rejected') return <NotYet what="Release sign-off was rejected. Nothing was sent to Octane or Jira." />
  const stage = p.stages[5]
  if (!stage || stage.status === 'pending' || stage.status === 'skipped') return <NotYet what="Delivery happens after release sign-off." />
  if (stage.status === 'running') return <Working text="Sending results to Octane and updating Jira…" />

  const dv = deliveryFor(p)
  const s = storyFor(storyId ?? ready[0])
  const r = p.readiness[s.frId]
  const cases = testCasesFor(s, p.revisions.design)
  const a = automationFor(p)
  const ex = executionFor(p)
  const file = a.files.find((f) => f.story === s.key)
  const gates = (['design', 'code', 'release'] as const).map((g) => p.gates[g])
  const chain = [
    { title: 'Story', detail: `${s.key} · ${s.req.priority} priority` },
    { title: 'Readiness', detail: `${ANSWERS[r.answer].label}${r.decision ? ' (QA)' : ''} · ${r.confidence.toFixed(2)} · ${r.judge === 'model' ? 'readiness model v4' : 'readiness skill v3'}` },
    { title: 'Acceptance criteria', detail: `${criteriaFor(s).map((c) => c.id).join(', ')} · text hash 3e9a…` },
    { title: 'Test cases', detail: `${cases[0].id}–${cases[cases.length - 1].id.split('-').pop()} · cited sources` },
    { title: 'Automation', detail: `${file?.path.split('/').pop()} · PR #${a.pr}` },
    { title: 'Test runs', detail: `PR checks: Harness #${p.prChecks?.harnessExecutionId} on ${p.prChecks?.branch} · post-merge: Harness #${ex.harness?.executionId}, HyperExecute ${ex.runId}, commit ${ex.commit} · ${ex.env}` },
    { title: 'Coverage', detail: 'Testmind report hash 51c0…' },
    { title: 'Gate decisions', detail: gates.map((g) => `${g.by} ${g.at ? formatTime(g.at) : ''}`).join(' · ') + ' · policy v3' },
    { title: 'Release decision', detail: `Signed off · snapshot ${p.id.slice(-6)}` },
  ]

  return (
    <>
      <section className="kpis wide" aria-label="Delivered">
        <Kpi value={dv.octane.testSet} label="Octane test set" />
        <Kpi value={dv.jira.length} label="Jira stories marked Tested" />
        <Kpi value={cases.length} label={`Test cases for ${s.key}`} />
      </section>
      <ul className="link-list">
        {dv.jira.map((j) => (
          <li key={j.key}>
            <span className="mono" style={{ fontSize: 13, width: 100 }}>
              {j.key}
            </span>
            <span style={{ flex: 1 }}>{storyFor(ready.find((id) => storyFor(id).key === j.key)!).title}</span>
            <span className="secondary">
              Jira status → <strong style={{ fontWeight: 500, color: 'var(--mx-text)' }}>{j.status}</strong>
            </span>
          </li>
        ))}
        <li>
          <span className="secondary" style={{ width: 100 }}>
            Attestation
          </span>
          <span className="mono" style={{ fontSize: 12.5 }}>
            {dv.attestation}
          </span>
        </li>
      </ul>

      <section aria-label="Traceability" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="section-head">
          <h3>Traceability</h3>
          {ready.length > 1 && (
            <div role="group" aria-label="Story" className="segmented">
              {ready.map((id) => (
                <button key={id} type="button" aria-pressed={id === s.frId} onClick={() => setStoryId(id)}>
                  {storyFor(id).key}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="secondary" style={{ fontSize: 13.5 }}>
          Every result traces back to the story. Each link carries the identity of the one before it.
        </span>
        <ol className="chain">
          {chain.map((c) => (
            <li key={c.title}>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{c.title}</span>
              <span className="secondary" style={{ fontSize: 12.5 }}>
                {c.detail}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}

function NotYet({ what }: { what: string }) {
  return <p className="prose secondary">{what}</p>
}

/* ---------------- 05: merge → Harness → HyperExecute ---------------- */

const EXEC_STEPS = [
  { phase: 'awaiting_merge', title: 'Pull request merged to main' },
  { phase: 'harness_triggered', title: 'Harness post-merge pipeline' },
  { phase: 'hyperexecute_running', title: 'Tests on HyperExecute' },
  { phase: 'collecting', title: 'Results and evidence' },
] as const

function ExecutionTrack({ p }: { p: PipelineState }) {
  const e = p.execution
  const order = EXEC_STEPS.map((s) => s.phase as string)
  const at = e ? order.indexOf(e.phase === 'done' ? 'collecting' : e.phase) : 0
  const state = (i: number) => (e?.phase === 'done' || i < at ? 'done' : i === at ? 'running' : 'pending')
  const sub = (i: number) => {
    if (!e) return 'Waiting for the merge'
    switch (EXEC_STEPS[i].phase) {
      case 'awaiting_merge':
        return e.commit ? `PR #${e.pr} merged to ${e.branch} as ${e.commit}` : `Waiting for PR #${e.pr} to merge in GitHub`
      case 'harness_triggered':
        return e.harness.executionId ? `${e.harness.pipeline} · execution #${e.harness.executionId} · triggered by ${e.commit}` : `${e.harness.pipeline} starts on the merge commit`
      case 'hyperexecute_running':
        return e.hyperexecute.jobId ? `Job ${e.hyperexecute.jobId} · ${e.hyperexecute.concurrency} in parallel · ${e.hyperexecute.done} of ${e.hyperexecute.total} done · against ${p.env}` : `${e.hyperexecute.total} tests, ${e.hyperexecute.concurrency} in parallel`
      default:
        return 'Pulling the JUnit report, logs, screenshots and videos from HyperExecute'
    }
  }
  return (
    <section className="tool-card progress-card" aria-label="Test execution" style={{ paddingBottom: 12 }}>
      <div className="progress-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h2 style={{ fontSize: 19 }}>Running outside Matrix</h2>
          <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>
            The tests run in your Harness pipeline on HyperExecute. Matrix follows along and collects the results.
          </span>
        </div>
      </div>
      {e?.phase === 'hyperexecute_running' && <Bar pct={Math.round((e.hyperexecute.done / Math.max(1, e.hyperexecute.total)) * 100)} />}
      <ol className="steps">
        {EXEC_STEPS.map((s, i) => {
          const st = state(i)
          return (
            <li key={s.phase} className={`step ${st}`}>
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
                <span className="step-title">{s.title}</span>
                <span className="step-sub">{sub(i)}</span>
              </span>
              {(s.phase === 'harness_triggered' || s.phase === 'hyperexecute_running') && st !== 'pending' && (
                <a href="#" onClick={(ev) => ev.preventDefault()} className="ghost row-btn" style={{ gap: 6, whiteSpace: 'nowrap' }}>
                  Open in {s.phase === 'harness_triggered' ? 'Harness' : 'HyperExecute'} <ExternalLink size={13} {...stroke} />
                </a>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function RunProvenance({ p }: { p: PipelineState }) {
  const e = p.execution
  if (!e) return null
  return (
    <section className="provenance" aria-label="Where the tests ran">
      <div>
        <span className="panel-meta">Commit</span>
        <span className="mono">{e.commit}</span>
        <span className="panel-meta">PR #{e.pr} → {e.branch}</span>
      </div>
      <div>
        <span className="panel-meta">Harness</span>
        <span className="mono">#{e.harness.executionId}</span>
        <span className="panel-meta">{e.harness.pipeline}</span>
      </div>
      <div>
        <span className="panel-meta">HyperExecute</span>
        <span className="mono">{e.hyperexecute.jobId}</span>
        <span className="panel-meta">
          {e.hyperexecute.total} tests · {e.hyperexecute.concurrency} in parallel · {p.env}
        </span>
      </div>
    </section>
  )
}

/** Post-commit run on the feature branch: Harness → HyperExecute, shown in the PR before Code review. */
function PrChecksTracker({ p }: { p: PipelineState }) {
  const c = p.prChecks
  const steps = [
    { key: 'harness', title: 'Harness post-commit pipeline', sub: c?.harnessExecutionId ? `${c.pipeline} · execution #${c.harnessExecutionId} · commit ${c.commit}` : 'Starts on the commit to the branch' },
    { key: 'hyperexecute', title: 'Tests on HyperExecute', sub: c?.jobId ? `Job ${c.jobId} · ${c.done} of ${c.total} done · against ${p.env}` : `${c?.total ?? ''} tests` },
  ]
  const at = !c || c.phase === 'writing' ? -1 : c.phase === 'done' ? 2 : c.phase === 'harness' ? 0 : 1
  return (
    <section className="tool-card progress-card" aria-label="PR checks progress" style={{ paddingBottom: 12 }}>
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
