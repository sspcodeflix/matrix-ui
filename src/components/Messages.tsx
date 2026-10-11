import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, FileText } from 'lucide-react'
import { Spark, stroke } from './icons'
import { ProgressCard, RunSummaryRow, ScopeCard, StepList, completedLabel } from './run'
import { HandoffCard, PipelineCard } from './pipeline/chat'
import { BatchCard, BatchScopeCard } from './pipeline/batch'
import { FixProposal, RemScopeCard, RemediationCard } from './remediation/chat'
import { REPORT } from '../data/report'
import { formatDateTime, paths } from '../lib/format'
import { scopeLabel } from '../state/agent'
import { useStore } from '../state/store'
import type { Block, Conversation, Message, RunState } from '../state/types'

/** Tiny renderer for the agent's prose: **bold**, `code`, blank-line paragraphs and "- " lists. `reveal` fades new replies in word by word. */
function Prose({ text, secondary, reveal }: { text: string; secondary?: boolean; reveal?: boolean }) {
  let word = 0
  // Each word fades in a moment after the last, capped so long replies don't drag.
  const words = (str: string) =>
    reveal
      ? str.split(/(\s+)/).map((w, i) =>
          /^\s+$/.test(w) || !w ? (
            <Fragment key={i}>{w}</Fragment>
          ) : (
            <span key={i} className="word-in" style={{ animationDelay: `${Math.min(word++ * 22, 1400)}ms` }}>
              {w}
            </span>
          ),
        )
      : str
  const inline = (str: string) =>
    str.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
      if (p.startsWith('**')) return <strong key={i}>{words(p.slice(2, -2))}</strong>
      if (p.startsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>
      return <Fragment key={i}>{words(p)}</Fragment>
    })
  const cls = `prose ${secondary ? 'secondary' : ''}`
  const paras = text.split(/\n{2,}/)
  if (paras.length === 1 && !text.includes('\n- ')) return <p className={cls}>{inline(text)}</p>
  return (
    <div className="prose-stack">
      {paras.map((para, i) => {
        const lines = para.split('\n')
        const items = lines.filter((l) => l.startsWith('- '))
        if (!items.length) return <p key={i} className={cls}>{inline(para)}</p>
        const lead = lines.filter((l) => !l.startsWith('- ')).join(' ')
        return (
          <Fragment key={i}>
            {lead && <p className={cls}>{inline(lead)}</p>}
            <ul className={`${cls} prose-list`}>
              {items.map((l, j) => (
                <li key={j}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          </Fragment>
        )
      })}
    </div>
  )
}

/** What Matrix is doing while it prepares a reply, guessed from the request. */
const THINKING: [RegExp, string[]][] = [
  [/vulnerab|cwe|cve|fix|security|remediat/i, ['Looking at the code', 'Checking the finding', 'Drafting a fix']],
  [/analy[sz]e|scan/i, ['Reading the workspace', 'Finding the components', 'Preparing the scan']],
  [/gap|coverage|fr-?\d|requirement|untested/i, ['Reading the report', 'Checking the requirements', 'Matching test evidence']],
  [/review|team/i, ['Reading the stage', 'Checking who to ask']],
]

function ThinkingLine({ hint }: { hint: string }) {
  const steps = THINKING.find(([re]) => re.test(hint))?.[1] ?? ['Thinking', 'Reading the workspace', 'Writing the answer']
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setI((x) => Math.min(x + 1, steps.length - 1)), 420)
    return () => window.clearInterval(t)
  }, [steps.length])
  return (
    <span className="thinking-line" role="status" aria-label="Matrix is working">
      <span className="shimmer">{steps[i]}…</span>
    </span>
  )
}

export function UserMessage({ text }: { text: string }) {
  return <div className="user-msg">{text}</div>
}

export function AssistantTurn({ children, gap = 14, mode }: { children: ReactNode; gap?: number; mode?: 'thinking' | 'working' }) {
  return (
    <div className="assistant">
      <Spark className={mode === 'thinking' ? 'spark-thinking' : mode === 'working' ? 'spark-working' : undefined} />
      <div className="assistant-body" style={{ gap }}>
        {children}
      </div>
    </div>
  )
}

export function ArtifactCard({ convoId, run }: { convoId: string; run: RunState }) {
  const location = useLocation()
  const to = paths.report(convoId, run.id)
  const current = location.pathname.startsWith(to)
  return (
    <Link to={to} className="artifact-card" aria-current={current ? 'true' : undefined}>
      <span className="icon-tile">
        <FileText size={18} {...stroke} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>
          {REPORT.title} — {run.app}
        </span>
        <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>Report · {run.completedAt ? formatDateTime(run.completedAt) : ''} · open in the side panel</span>
      </span>
      <ChevronRight size={16} color="var(--mx-text-secondary)" {...stroke} />
    </Link>
  )
}

/** The turn that started a run. Its look follows the run: card in the foreground, a row once the user moves on. */
function RunStartBlock({ run }: { run: RunState }) {
  const { stopRun, setForeground } = useStore()
  const scope = scopeLabel(run)

  if (run.status === 'running' && run.foreground) {
    return (
      <>
        <Prose text={`I've started the analysis for ${run.app} — ${scope}.`} />
        <ProgressCard run={run} onStop={() => stopRun(run.id)} />
        <Prose secondary text="You can keep asking questions while this runs — the run stays pinned above the composer, and I'll let you know when the report is ready." />
      </>
    )
  }
  if (run.status === 'stopped' || run.status === 'failed') {
    const done = run.steps.filter((s) => s.status === 'done').length
    return (
      <>
        <Prose
          text={
            run.status === 'stopped'
              ? `I stopped the analysis of ${run.app} at ${run.pct}% (${done} of ${run.steps.length} steps finished). No report was produced; nothing else changed.`
              : `The analysis of ${run.app} failed: ${run.error ?? 'unknown error'}`
          }
        />
        <RunSummaryRow icon="clock" label={`Analysis of ${run.app} ${run.status} · step ${Math.min(done + 1, run.steps.length)} of ${run.steps.length}`}>
          <div className="run-row-detail">
            <StepList steps={run.steps} />
          </div>
        </RunSummaryRow>
      </>
    )
  }
  return (
    <>
      <Prose text={`I've started the analysis for ${run.app} — ${scope}. It'll keep running while we talk; the live status is pinned above the composer.`} />
      <RunSummaryRow
        icon="clock"
        label={`Analysis of ${run.app} started · ${run.repoCount} components`}
        expanded={run.status === 'running' ? false : undefined}
        onClick={
          run.status === 'running'
            ? () => {
                setForeground(run.id, true)
                setTimeout(() => document.getElementById(`run-${run.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
              }
            : undefined
        }
      >
        <div className="run-row-detail">
          <StepList steps={run.steps} />
        </div>
      </RunSummaryRow>
    </>
  )
}

function BlockView({ block, convo, message, reveal }: { block: Block; convo: Conversation; message: Message; reveal?: boolean }) {
  const { state, runChip, startRun, cancelScope } = useStore()
  switch (block.type) {
    case 'text':
      return <Prose text={block.text} secondary={block.tone === 'secondary'} reveal={reveal} />
    case 'scope':
      return <ScopeCard onStart={(c) => startRun(convo.id, message.id, block.app, c)} onCancel={() => cancelScope(convo.id, message.id, block.app)} />
    case 'runStart': {
      const run = state.runs[block.runId]
      return run ? <RunStartBlock run={run} /> : null
    }
    case 'runDone': {
      const run = state.runs[block.runId]
      if (!run) return null
      return (
        <RunSummaryRow icon="done" label={completedLabel(run, run.everBackgrounded)}>
          <div className="run-row-detail">
            <StepList steps={run.steps} />
          </div>
        </RunSummaryRow>
      )
    }
    case 'artifact': {
      const run = state.runs[block.runId]
      return run ? <ArtifactCard convoId={convo.id} run={run} /> : null
    }
    case 'handoff':
      return <HandoffCard convoId={convo.id} messageId={message.id} areaSlug={block.areaSlug} frIds={block.frIds} />
    case 'pipeline': {
      const p = state.pipelines[block.pipelineId]
      return p ? <PipelineCard p={p} /> : null
    }
    case 'fixProposal':
      return <FixProposal findingId={block.findingId} variant={block.variant} />
    case 'remScope':
      return <RemScopeCard convoId={convo.id} messageId={message.id} imported={block.imported} />
    case 'remediation': {
      const r = state.remediations[block.remediationId]
      return r ? <RemediationCard r={r} /> : null
    }
    case 'batchScope':
      return <BatchScopeCard convoId={convo.id} messageId={message.id} />
    case 'batch': {
      const b = state.batches[block.batchId]
      return b ? <BatchCard batch={b} /> : null
    }
    case 'chips':
      if (block.chips.length === 0) return null
      return (
        <div className="chips">
          {block.chips.map((c) => (
            <button key={c.label} type="button" className="chip chip-follow" onClick={() => runChip(convo.id, c.action)}>
              {c.label}
            </button>
          ))}
        </div>
      )
  }
}

export function MessageList({ convo }: { convo: Conversation }) {
  const { state } = useStore()
  // Finished messages already here when the conversation opened don't animate; anything that
  // arrives (or finishes thinking) after that does.
  const initial = useRef(new Set(convo.messages.filter((m) => !m.pending).map((m) => m.id)))

  // A turn whose work is still running keeps its spark breathing.
  const working = (m: Message) =>
    m.blocks?.some(
      (b) =>
        (b.type === 'runStart' && state.runs[b.runId]?.status === 'running') ||
        (b.type === 'pipeline' && state.pipelines[b.pipelineId]?.status === 'running') ||
        (b.type === 'remediation' && state.remediations[b.remediationId]?.status === 'running') ||
        (b.type === 'batch' && state.batches[b.batchId] && !state.batches[b.batchId].done && state.batches[b.batchId].pipelineIds.some((id) => state.pipelines[id]?.status === 'running')),
    )

  return (
    <div className="messages" aria-live="polite" aria-relevant="additions">
      {convo.messages.map((m, idx) => {
        if (m.role === 'user') return <UserMessage key={m.id} text={m.text ?? ''} />
        if (m.pending) {
          const hint = [...convo.messages.slice(0, idx)].reverse().find((x) => x.role === 'user')?.text ?? ''
          return (
            <AssistantTurn key={m.id} mode="thinking">
              <ThinkingLine hint={hint} />
            </AssistantTurn>
          )
        }
        const tight = m.blocks?.[0]?.type === 'runStart'
        const reveal = !initial.current.has(m.id)
        return (
          <AssistantTurn key={m.id} mode={working(m) ? 'working' : undefined} gap={tight ? 10 : m.blocks?.some((b) => b.type === 'scope' || b.type === 'handoff' || b.type === 'batchScope' || b.type === 'remScope') ? 16 : 14}>
            {m.blocks?.map((b, i) => <BlockView key={i} block={b} convo={convo} message={m} reveal={reveal} />)}
          </AssistantTurn>
        )
      })}
    </div>
  )
}
