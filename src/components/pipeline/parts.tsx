import { Fragment, useState } from 'react'
import { Ban, Check, CircleHelp, MessageCircleQuestion, RotateCcw, ShieldCheck, UserCheck, X } from 'lucide-react'
import { Spinner, stroke } from '../icons'
import { GATES, STAGES, type GateId, type PipelineState, type ReadinessAnswer, type StageId } from '../../pipeline/types'
import { formatTime } from '../../lib/format'
import { useStore } from '../../state/store'
import { reviewSummary, useReviews } from '../team/TeamReview'

/* ---------- Readiness answers: icon + label, never colour alone ---------- */

export const ANSWERS: Record<ReadinessAnswer, { label: string; Icon: typeof Check; next: string }> = {
  ready: { label: 'Ready', Icon: Check, next: 'Passes the gate automatically' },
  needs_clarification: { label: 'Needs clarification', Icon: MessageCircleQuestion, next: 'Feedback sent to the author in Jira; checked again after the update' },
  not_testable: { label: 'Not testable', Icon: Ban, next: 'Goes back to the product owner' },
  uncertain: { label: 'Uncertain', Icon: CircleHelp, next: 'QA decides' },
}

export function AnswerLabel({ answer }: { answer: ReadinessAnswer }) {
  const { label, Icon } = ANSWERS[answer]
  return (
    <span className={`answer answer-${answer}`}>
      <Icon size={15} {...stroke} />
      {label}
    </span>
  )
}

/* ---------- Stage rail ---------- */

export const VIEW_FOR_STAGE: Record<StageId, string> = {
  intake: 'readiness',
  readiness: 'readiness',
  design: 'design',
  automation: 'automation',
  execute: 'execution',
  deliver: 'delivery',
}

export function currentView(p: PipelineState) {
  if (p.status === 'completed' && p.outcome === 'delivered') return 'delivery'
  const running = p.stages.find((s) => s.status === 'running')
  if (running) return VIEW_FOR_STAGE[running.id]
  const waiting = (Object.keys(p.gates) as GateId[]).find((g) => p.gates[g].status === 'waiting')
  if (waiting) return { readiness: 'readiness', design: 'design', code: 'automation', release: 'execution' }[waiting]
  const lastDone = [...p.stages].reverse().find((s) => s.status === 'done')
  return lastDone ? VIEW_FOR_STAGE[lastDone.id] : 'readiness'
}

function StageIcon({ status, size = 20 }: { status: string; size?: number }) {
  if (status === 'done')
    return (
      <span className="step-icon-done" style={{ width: size, height: size }}>
        <Check size={size * 0.55} strokeWidth={3} aria-hidden />
      </span>
    )
  if (status === 'running') return <Spinner size={size} />
  if (status === 'skipped')
    return (
      <span className="step-icon-pending" style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' }}>
        <X size={size * 0.5} strokeWidth={2} aria-hidden />
      </span>
    )
  return <span className="step-icon-pending" style={{ width: size, height: size }} />
}

const GATE_TEXT: Record<string, string> = { pending: 'not reached', waiting: 'needs you', passed: 'passed', changes: 'reworking', rejected: 'rejected' }

export function GateChip({ gate, state, compact }: { gate: GateId; state: PipelineState['gates'][GateId]; compact?: boolean }) {
  const meta = GATES[gate]
  const status = state.status
  const label = gate === 'readiness' && status === 'passed' && state.auto ? 'passed automatically' : GATE_TEXT[status]
  return (
    <span className={`gate gate-${status} ${compact ? 'compact' : ''}`} title={`${meta.title}: ${meta.who}`}>
      {/* Gates never use a plain check, so they can't be mistaken for a finished stage:
          a shield for the automatic readiness gate, a person-check for human gates. */}
      {status === 'changes' ? (
        <RotateCcw size={13} {...stroke} />
      ) : status === 'rejected' ? (
        <X size={13} strokeWidth={2.25} aria-hidden />
      ) : gate === 'readiness' ? (
        <ShieldCheck size={13} strokeWidth={status === 'passed' ? 2.25 : 1.75} aria-hidden />
      ) : (
        <UserCheck size={13} strokeWidth={status === 'passed' ? 2.25 : 1.75} aria-hidden />
      )}
      {!compact && <span className="gate-title">{meta.short}</span>}
      {compact && <span className="sr-only">{meta.title}</span>}
      {label && (compact ? <span className="sr-only">{label}</span> : <span className="sr-only">· {label}</span>)}
      {status === 'waiting' && <span className="gate-dot" aria-hidden="true" />}
    </span>
  )
}

const SHORT: Record<StageId, string> = { intake: 'Intake', readiness: 'Readiness', design: 'Design', automation: 'Automation', execute: 'Execute', deliver: 'Deliver' }

export function StageRail({ p, view, onSelect, compact }: { p: PipelineState; view?: string; onSelect?: (view: string) => void; compact?: boolean }) {
  const stages = p.stages.length ? p.stages : STAGES.map((s) => ({ id: s.id, status: 'pending' as const }))
  if (!compact) {
    // Panel: one column per stage, its gate attached underneath.
    return (
      <ol className="rail-grid" aria-label="Pipeline stages">
        {STAGES.map((def, i) => {
          const st = stages[i]
          const target = VIEW_FOR_STAGE[def.id]
          const reached = st.status !== 'pending' && st.status !== 'skipped'
          const selected = view === target && def.id !== 'intake'
          return (
            <li key={def.id} className={`rail-cell ${st.status} ${selected ? 'selected' : ''}`}>
              <button type="button" disabled={!reached || !onSelect} aria-current={selected ? 'step' : undefined} onClick={() => onSelect?.(target)}>
                <StageIcon status={st.status} size={20} />
                <span className="rail-n">{def.n}</span>
                <span className="rail-title">{def.title}</span>
              </button>
              {def.gate ? <GateChip gate={def.gate} state={p.gates[def.gate]} /> : <span className="gate-spacer" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
    )
  }
  return (
    <ol className={`rail ${compact ? 'compact' : ''}`} aria-label="Pipeline stages">
      {STAGES.map((def, i) => {
        const st = stages[i]
        const target = VIEW_FOR_STAGE[def.id]
        const reached = st.status !== 'pending' && st.status !== 'skipped'
        const selected = view === target
        const content = (
          <>
            <StageIcon status={st.status} size={compact ? 18 : 20} />
            <span className="rail-text">
              <span className="rail-n">{def.n}</span> {compact ? SHORT[def.id] : def.title}
            </span>
          </>
        )
        return (
          <Fragment key={def.id}>
            <li className={`rail-stage ${st.status} ${selected && onSelect ? 'selected' : ''}`}>
              {onSelect ? (
                <button type="button" disabled={!reached} aria-current={selected ? 'step' : undefined} onClick={() => onSelect(target)}>
                  {content}
                </button>
              ) : (
                <span className="rail-static">{content}</span>
              )}
            </li>
            {def.gate && (
              <li className="rail-gate" aria-label={`${GATES[def.gate].title}: ${p.gates[def.gate].status}`}>
                <GateChip gate={def.gate} state={p.gates[def.gate]} compact={compact} />
              </li>
            )}
          </Fragment>
        )
      })}
    </ol>
  )
}

/* ---------- Gate bar: where people decide ---------- */

export function GateBar({
  p,
  gate,
  approve,
  alternative,
  summary,
}: {
  p: PipelineState
  gate: Exclude<GateId, 'readiness'>
  approve: string
  alternative: { label: string; decision: 'changes' | 'reject'; placeholder: string }
  summary: string
}) {
  const { decideGate, state } = useStore()
  const isOwner = (p.owner ?? 'sp') === state.viewer
  const reviews = useReviews({ kind: 'stage', pipelineId: p.id, stage: ({ design: 'design', code: 'automation', release: 'execution' } as const)[gate] })
  const teamLine = reviewSummary(reviews)
  const g = p.gates[gate]
  const [mode, setMode] = useState<'idle' | 'note'>('idle')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const meta = GATES[gate]

  const decide = async (decision: 'approve' | 'changes' | 'reject') => {
    setBusy(true)
    try {
      await decideGate(p.id, gate, decision, note.trim() || undefined)
      setMode('idle')
      setNote('')
    } finally {
      setBusy(false)
    }
  }

  if (g.status === 'passed' || g.status === 'rejected' || g.status === 'changes') {
    const verb = g.status === 'passed' ? 'Approved' : g.status === 'rejected' ? 'Rejected' : 'Changes requested'
    return (
      <div className="gate-record" role="status">
        {g.status === 'passed' ? <Check size={15} strokeWidth={2.5} aria-hidden /> : g.status === 'rejected' ? <X size={15} strokeWidth={2.5} aria-hidden /> : <RotateCcw size={15} {...stroke} />}
        <span>
          <strong style={{ fontWeight: 500 }}>
            {meta.title}: {verb}
          </strong>{' '}
          by {g.by ?? '—'}
          {g.at ? ` · ${formatTime(g.at)}` : ''}
          {g.note && <span className="secondary"> — “{g.note}”</span>}
          {g.status === 'changes' && <span className="secondary"> Matrix is reworking this stage.</span>}
        </span>
      </div>
    )
  }
  if (g.status !== 'waiting') return null

  return (
    <section className="gate-bar" aria-label={meta.title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
          <UserCheck size={16} {...stroke} />
          {meta.title} <span className="secondary" style={{ fontWeight: 400 }}>· {meta.who}</span>
        </span>
        <span className="secondary" style={{ fontSize: 13.5 }}>
          {summary}
        </span>
        {teamLine && (
          <a href="#team-review" className="team-line">
            {teamLine}
          </a>
        )}
      </div>
      {mode === 'note' && (
        <>
          <label htmlFor={`note-${gate}`} className="sr-only">
            {alternative.label} note
          </label>
          <textarea id={`note-${gate}`} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={alternative.placeholder} />
        </>
      )}
      {!isOwner ? (
        <span className="panel-meta">Only SP, who owns this pipeline, can decide this gate. Your review goes to them.</span>
      ) : (
      <div className="card-actions" style={{ marginTop: 0, justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        {mode === 'idle' ? (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide('approve')}>
              <Check size={15} strokeWidth={2} aria-hidden />
              {approve}
            </button>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setMode('note')}>
              {alternative.label}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary" disabled={busy || !note.trim()} onClick={() => decide(alternative.decision)}>
              {alternative.label}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setMode('idle')}>
              Cancel
            </button>
          </>
        )}
      </div>
      )}
    </section>
  )
}
