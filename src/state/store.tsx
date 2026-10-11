import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AREAS, REPORT, requirementsFor } from '../data/report'
import { transitions } from '../pipeline/messages'
import { readyFrIds } from '../pipeline/data'
import { remTransitions, remediationIntro } from '../remediation/messages'
import type { RemGateId, RemediationState } from '../remediation/types'
import type { GateId, PipelineState } from '../pipeline/types'
import { paths, uid } from '../lib/format'
import { api } from '../lib/api'
import { completionReply, reply, scopeLabel, type Reply } from './agent'
import type { Batch, Block, ChipAction, Conversation, RemediationRecord, Feedback, Message, Notification, PipelineRecord, RepoScope, ReviewTarget, RunEvent, RunState, ScanMode, TeamReview } from './types'
import { person, plannedResponse, targetLabel } from '../team/roster'

interface State {
  conversations: Record<string, Conversation>
  runs: Record<string, RunState>
  pipelines: Record<string, PipelineRecord>
  batches: Record<string, Batch>
  remediations: Record<string, RemediationRecord>
  reviews: Record<string, TeamReview>
  notifications: Notification[]
  feedback: Record<string, Feedback>
  /** Who the prototype is showing the app as. "sp" = the author. */
  viewer: string
}

type Action =
  | { type: 'convo.create'; convo: Conversation }
  | { type: 'convo.setApp'; id: string; app: string }
  | { type: 'convo.delete'; id: string }
  | { type: 'msg.add'; convoId: string; message: Message }
  | { type: 'msg.set'; convoId: string; messageId: string; patch: Partial<Message> }
  | { type: 'run.create'; run: RunState }
  | { type: 'run.patch'; id: string; patch: Partial<RunState> }
  | { type: 'run.event'; id: string; event: RunEvent }
  | { type: 'notif.patch'; id: string; patch: Partial<Notification> }
  | { type: 'notif.readAll' }
  | { type: 'feedback.set'; frId: string; patch: Partial<Feedback> }
  | { type: 'pipeline.create'; pipeline: PipelineRecord }
  | { type: 'batch.create'; batch: Batch }
  | { type: 'remediation.create'; remediation: RemediationRecord }
  | { type: 'remediation.state'; id: string; remediation: RemediationState }
  | { type: 'remediation.failed'; id: string; error: string }
  | { type: 'pipeline.state'; id: string; pipeline: PipelineState }
  | { type: 'pipeline.failed'; id: string; error: string }
  | { type: 'review.create'; review: TeamReview }
  | { type: 'review.resolve'; id: string; resolved: boolean }
  | { type: 'review.reply'; id: string; personId: string; status: 'approved' | 'commented' | 'changes'; comment: string }
  | { type: 'review.nudge'; id: string; personId: string }
  | { type: 'viewer.set'; viewer: string }

const STORAGE_KEY = 'matrix.prototype.v1'
const empty: State = { conversations: {}, runs: {}, pipelines: {}, batches: {}, remediations: {}, reviews: {}, notifications: [], feedback: {}, viewer: 'sp' }

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? migrate({ ...empty, ...JSON.parse(raw) }) : empty
  } catch {
    return empty
  }
}

/** Remediations saved before the coverage check existed: add its stage and gate so they still render. */
function migrate(s: State): State {
  for (const r of Object.values(s.remediations)) {
    if (r.gates.coverage) continue
    r.gates.coverage = { status: 'pending' }
    if (r.stages.length === 6) {
      const reachedPr = r.stages[3].status !== 'pending' && r.stages[3].status !== 'skipped'
      r.stages.splice(3, 0, { id: 'coverage', status: reachedPr ? 'done' : 'pending' })
    }
  }
  return s
}

/** Cards that set something up and wait for Start. Only the newest one in a conversation stays live. */
const SETUP_BLOCKS = new Set<Block['type']>(['scope', 'handoff', 'batchScope', 'remScope'])
const isSetup = (m: Message) => !!m.blocks?.some((b) => SETUP_BLOCKS.has(b.type))

function patchMessage(state: State, convoId: string, messageId: string, patch: Partial<Message>): State {
  const c = state.conversations[convoId]
  if (!c) return state
  // A new setup card replaces any earlier one that was never started, so they don't stack up.
  const opensSetup = !!patch.blocks?.some((b) => SETUP_BLOCKS.has(b.type))
  return {
    ...state,
    conversations: {
      ...state.conversations,
      [convoId]: {
        ...c,
        messages: c.messages.map((m) => {
          if (m.id === messageId) return { ...m, ...patch }
          if (opensSetup && isSetup(m)) return { ...m, blocks: [{ type: 'text', text: 'Replaced by the newer request below. Nothing was started.', tone: 'secondary' }] }
          return m
        }),
      },
    },
  }
}

const GATE_NAMES: Record<string, string> = { readiness: 'readiness decision', design: 'design review', code: 'code review', release: 'release sign-off' }

/** One heads-up per gate type as batch pipelines reach it, and a summary when the batch finishes. */
function batchProgress(state: State, batchId: string): State {
  const b = state.batches[batchId]
  const c = b && state.conversations[b.conversationId]
  if (!b || !c) return state
  const ps = b.pipelineIds.map((id) => state.pipelines[id]).filter(Boolean)
  let s = state
  let notified = b.notified
  const say = (text: string, view?: string) => {
    const blocks: Block[] = [{ type: 'text', text }, { type: 'chips', chips: [{ label: 'Open the batch', action: { kind: 'pipeline', id: `batch:${b.id}`, view } }] }]
    const cc = s.conversations[c.id]
    s = { ...s, conversations: { ...s.conversations, [c.id]: { ...cc, updatedAt: Date.now(), messages: [...cc.messages, { id: uid('m_'), role: 'assistant', blocks }] } } }
  }
  const notify = (title: string, body: string) => {
    s = {
      ...s,
      notifications: [
        { id: uid('n_'), title, body, action: 'Open', conversationId: c.id, href: paths.batch(c.id, b.id), read: false, toast: true, createdAt: Date.now() },
        ...s.notifications.map((n) => (n.conversationId === c.id ? { ...n, toast: false } : n)),
      ],
    }
  }
  for (const g of ['readiness', 'design', 'code', 'release'] as const) {
    const waiting = ps.filter((p) => p.gates[g].status === 'waiting').length
    if (waiting && !notified.includes(g)) {
      notified = [...notified, g]
      say(`Areas are reaching their ${GATE_NAMES[g]} (${waiting} of ${ps.length} so far). You can decide them one by one or all at once from the batch view.`)
      notify(`Batch: ${GATE_NAMES[g]}s waiting`, `${waiting} of ${ps.length} areas need you`)
    }
  }
  let next: Batch = { ...b, notified }
  const finished = ps.length > 0 && ps.every((p) => p.status === 'completed' || p.status === 'stopped')
  if (finished && !b.done) {
    next = { ...next, done: true, completedAt: Date.now() }
    const delivered = ps.filter((p) => p.outcome === 'delivered')
    const closed = delivered.reduce((n, p) => n + readyFrIds(p).length, 0)
    const total = ps.reduce((n, p) => n + p.frIds.length, 0)
    const left = total - closed
    say(
      `The batch is finished: ${delivered.length} of ${ps.length} areas delivered, closing **${closed} of ${total} gaps**. Coverage is re-measured in the report.` +
        (left ? ` The other ${left} weren't ready to test: their stories need clarification (feedback went to the authors in Jira) or aren't testable as written.` : ''),
    )
    notify('Batch finished', `${closed} gaps closed across ${delivered.length} areas`)
  }
  return { ...s, batches: { ...s.batches, [b.id]: next } }
}

/** Deep link to the thing under review, carrying the review id so the panel can focus it. */
function reviewHref(r: TeamReview) {
  const base = r.target.kind === 'stage' ? paths.pipeline(r.conversationId, r.target.pipelineId, r.target.stage) : paths.requirement(r.conversationId, r.target.runId, r.target.frId)
  return `${base}?review=${r.id}`
}

function applyRunEvent(state: State, run: RunState, event: RunEvent): State {
  const next: RunState = { ...run }
  switch (event.type) {
    case 'run.started':
      next.steps = event.steps.map((s) => ({ ...s, status: 'pending' }))
      break
    case 'step.started':
      next.steps = next.steps.map((s) => (s.id === event.stepId ? { ...s, status: 'running' } : s))
      break
    case 'step.progress':
      next.steps = next.steps.map((s) => (s.id === event.stepId ? { ...s, description: event.detail } : s))
      break
    case 'step.completed':
      next.steps = next.steps.map((s) => (s.id === event.stepId ? { ...s, status: 'done', durationMs: event.durationMs, summary: event.summary } : s))
      break
    case 'run.progress':
      next.pct = event.pct
      next.elapsedMs = event.elapsedMs
      break
    case 'run.stopped':
      next.status = 'stopped'
      break
    case 'run.failed':
      next.status = 'failed'
      next.error = event.error
      break
    case 'run.completed': {
      if (run.status === 'completed') return state
      next.status = 'completed'
      next.pct = 100
      next.completedAt = Date.now()
      next.foreground = false
      let s: State = { ...state, runs: { ...state.runs, [run.id]: next } }
      const blocks = completionReply(next)
      if (next.everBackgrounded) {
        // The user moved on: hand off in a new turn (screen 3c).
        const c = s.conversations[run.conversationId]
        if (c) {
          s = {
            ...s,
            conversations: {
              ...s.conversations,
              [c.id]: { ...c, messages: [...c.messages, { id: uid('m_'), role: 'assistant', blocks }] },
            },
          }
        }
      } else {
        // Run stayed in the foreground: the progress turn becomes the result (screen 4).
        s = patchMessage(s, run.conversationId, run.startMessageId, { blocks })
      }
      const notification: Notification = {
        id: uid('n_'),
        title: `${run.app} analysis complete`,
        body: `${REPORT.title} · 1% coverage across ${REPORT.requirements} requirements`,
        conversationId: run.conversationId,
        runId: run.id,
        read: false,
        toast: true,
        createdAt: Date.now(),
      }
      return { ...s, notifications: [notification, ...s.notifications] }
    }
  }
  return { ...state, runs: { ...state.runs, [run.id]: next } }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'convo.create':
      return { ...state, conversations: { ...state.conversations, [action.convo.id]: action.convo } }
    case 'convo.setApp': {
      const c = state.conversations[action.id]
      return c ? { ...state, conversations: { ...state.conversations, [c.id]: { ...c, app: action.app } } } : state
    }
    case 'msg.add': {
      const c = state.conversations[action.convoId]
      if (!c) return state
      return { ...state, conversations: { ...state.conversations, [c.id]: { ...c, messages: [...c.messages, action.message], updatedAt: Date.now() } } }
    }
    case 'convo.delete': {
      const conversations = { ...state.conversations }
      delete conversations[action.id]
      const runs = Object.fromEntries(Object.entries(state.runs).filter(([, r]) => r.conversationId !== action.id))
      const pipelines = Object.fromEntries(Object.entries(state.pipelines).filter(([, p]) => p.conversationId !== action.id))
      const reviews = Object.fromEntries(Object.entries(state.reviews).filter(([, r]) => r.conversationId !== action.id))
      const batches = Object.fromEntries(Object.entries(state.batches).filter(([, b]) => b.conversationId !== action.id))
      const remediations = Object.fromEntries(Object.entries(state.remediations).filter(([, r]) => r.conversationId !== action.id))
      return { ...state, conversations, runs, pipelines, reviews, batches, remediations, notifications: state.notifications.filter((n) => n.conversationId !== action.id) }
    }
    case 'msg.set':
      return patchMessage(state, action.convoId, action.messageId, action.patch)
    case 'run.create':
      return { ...state, runs: { ...state.runs, [action.run.id]: action.run } }
    case 'run.patch': {
      const r = state.runs[action.id]
      return r ? { ...state, runs: { ...state.runs, [r.id]: { ...r, ...action.patch } } } : state
    }
    case 'run.event': {
      const r = state.runs[action.id]
      return r ? applyRunEvent(state, r, action.event) : state
    }
    case 'notif.patch':
      return { ...state, notifications: state.notifications.map((n) => (n.id === action.id ? { ...n, ...action.patch } : n)) }
    case 'notif.readAll':
      return { ...state, notifications: state.notifications.map((n) => ((n.to ?? 'sp') === state.viewer ? { ...n, read: true, toast: false } : n)) }
    case 'pipeline.create':
      return { ...state, pipelines: { ...state.pipelines, [action.pipeline.id]: action.pipeline } }
    case 'pipeline.failed': {
      const p = state.pipelines[action.id]
      return p ? { ...state, pipelines: { ...state.pipelines, [p.id]: { ...p, status: 'stopped', outcome: 'stopped', error: action.error } } } : state
    }
    case 'remediation.create':
      return { ...state, remediations: { ...state.remediations, [action.remediation.id]: action.remediation } }
    case 'remediation.failed': {
      const r = state.remediations[action.id]
      return r ? { ...state, remediations: { ...state.remediations, [r.id]: { ...r, status: 'stopped', outcome: 'stopped', error: action.error } } } : state
    }
    case 'remediation.state': {
      const prev = state.remediations[action.id]
      if (!prev) return state
      const next: RemediationRecord = { ...prev, ...action.remediation }
      let s: State = { ...state, remediations: { ...state.remediations, [next.id]: next } }
      for (const t of remTransitions(prev, next)) {
        const c = s.conversations[next.conversationId]
        if (!c) continue
        s = { ...s, conversations: { ...s.conversations, [c.id]: { ...c, updatedAt: Date.now(), messages: [...c.messages, { id: uid('m_'), role: 'assistant', blocks: t.blocks }] } } }
        if (t.notify) {
          const n = t.notify
          const fresh = (n.to ?? [undefined]).map((to) => ({ id: uid('n_'), title: n.title, body: n.body, action: n.action, to, conversationId: c.id, href: paths.remediation(c.id, next.id, n.view), read: false, toast: true, createdAt: Date.now() }))
          s = { ...s, notifications: [...fresh, ...s.notifications.map((x) => (x.conversationId === c.id ? { ...x, toast: false } : x))] }
        }
      }
      return s
    }
    case 'batch.create':
      return { ...state, batches: { ...state.batches, [action.batch.id]: action.batch } }
    case 'pipeline.state': {
      const prev = state.pipelines[action.id]
      if (!prev) return state
      const next: PipelineRecord = { ...prev, ...action.pipeline }
      let s: State = { ...state, pipelines: { ...state.pipelines, [next.id]: next } }
      // Batch members report as one batch instead of one chat thread per area.
      if (next.batchId) return batchProgress(s, next.batchId)
      for (const t of transitions(prev, next)) {
        const c = s.conversations[next.conversationId]
        if (!c) continue
        s = {
          ...s,
          conversations: { ...s.conversations, [c.id]: { ...c, updatedAt: Date.now(), messages: [...c.messages, { id: uid('m_'), role: 'assistant', blocks: t.blocks }] } },
        }
        if (t.notify) {
          s = {
            ...s,
            notifications: [
              { id: uid('n_'), title: t.notify.title, body: t.notify.body, action: t.notify.action, conversationId: c.id, href: paths.pipeline(c.id, next.id, t.notify.view), read: false, toast: true, createdAt: Date.now() },
              // A newer gate supersedes the older pop-up.
              ...s.notifications.map((n) => (n.conversationId === c.id ? { ...n, toast: false } : n)),
            ],
          }
        }
      }
      return s
    }
    case 'review.create': {
      const r = action.review
      const c = state.conversations[r.conversationId]
      const names = r.reviewers.map((x) => person(x.personId).name)
      const who = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      const what = r.items.length ? `${r.items.length} ${r.items.length === 1 ? 'item' : 'items'} in the ${targetLabel(r.target)}` : `the ${targetLabel(r.target)}`
      const href = reviewHref(r)
      const asker = person(r.requestedBy).name
      const forReviewers: Notification[] = r.reviewers.map((x) => ({
        id: uid('n_'),
        title: `${asker} asked you to review the ${targetLabel(r.target)}`,
        body: r.note ? `“${r.note}”` : r.items.length ? `${r.items.length} ${r.items.length === 1 ? 'item' : 'items'} pointed out` : 'Everything in this stage',
        action: 'Review',
        conversationId: r.conversationId,
        href,
        to: x.personId,
        read: false,
        toast: true,
        createdAt: r.requestedAt,
      }))
      let s: State = { ...state, reviews: { ...state.reviews, [r.id]: r }, notifications: [...forReviewers, ...state.notifications] }
      if (c) {
        const blocks: Block[] = [{ type: 'text', text: `Asked ${who} to review ${what}. They've been notified; their replies show up in the panel, and the gate decision stays with its owner.`, tone: 'secondary' }]
        s = { ...s, conversations: { ...s.conversations, [c.id]: { ...c, updatedAt: Date.now(), messages: [...c.messages, { id: uid('m_'), role: 'assistant', blocks }] } } }
      }
      return s
    }
    case 'review.resolve': {
      const r = state.reviews[action.id]
      return r ? { ...state, reviews: { ...state.reviews, [r.id]: { ...r, resolved: action.resolved } } } : state
    }
    case 'review.reply': {
      const r = state.reviews[action.id]
      if (!r) return state
      const now = Date.now()
      const reviewers = r.reviewers.map((x) => (x.personId === action.personId ? { ...x, status: action.status, comment: action.comment, respondedAt: now } : x))
      let next: TeamReview = { ...r, reviewers }
      const reply: Notification = {
        id: uid('n_'),
        title: `${person(action.personId).name} reviewed the ${targetLabel(r.target)}`,
        body: action.status === 'approved' ? 'Approved' : action.status === 'changes' ? 'Suggested changes' : 'Left a comment',
        action: 'Open',
        conversationId: r.conversationId,
        href: reviewHref(r),
        to: r.requestedBy,
        read: false,
        toast: true,
        createdAt: now,
      }
      let conversations = state.conversations
      if (!next.summarized && reviewers.every((x) => x.status !== 'waiting')) {
        next = { ...next, summarized: true }
        const n = (st: string) => reviewers.filter((x) => x.status === st).length
        const parts = [n('approved') && `${n('approved')} approved`, n('changes') && `${n('changes')} suggested changes`, n('commented') && `${n('commented')} commented`].filter(Boolean)
        const c = conversations[r.conversationId]
        if (c) {
          const blocks: Block[] = [
            { type: 'text', text: `Team review of the ${targetLabel(r.target)} is in: ${parts.join(', ')}.` },
            { type: 'chips', chips: [r.target.kind === 'stage' ? { label: 'Read the review', action: { kind: 'pipeline', id: r.target.pipelineId, view: r.target.stage } } : { label: 'Read the review', action: { kind: 'open', to: 'requirement', id: r.target.frId } }] },
          ]
          conversations = { ...conversations, [c.id]: { ...c, updatedAt: now, messages: [...c.messages, { id: uid('m_'), role: 'assistant', blocks }] } }
        }
      }
      return {
        ...state,
        conversations,
        reviews: { ...state.reviews, [r.id]: next },
        notifications: [reply, ...state.notifications.map((x) => ((x.to ?? 'sp') === reply.to ? { ...x, toast: false } : x))],
      }
    }
    case 'review.nudge': {
      const r = state.reviews[action.id]
      if (!r) return state
      const reminder: Notification = {
        id: uid('n_'),
        title: `Reminder from ${person(r.requestedBy).name}: review the ${targetLabel(r.target)}`,
        body: r.note ? `“${r.note}”` : 'Your review is still waiting',
        action: 'Review',
        conversationId: r.conversationId,
        href: reviewHref(r),
        to: action.personId,
        read: false,
        toast: true,
        createdAt: Date.now(),
      }
      return {
        ...state,
        reviews: { ...state.reviews, [r.id]: { ...r, reviewers: r.reviewers.map((x) => (x.personId === action.personId ? { ...x, nudgedAt: Date.now() } : x)) } },
        notifications: [reminder, ...state.notifications],
      }
    }
    case 'viewer.set':
      return { ...state, viewer: action.viewer }
    case 'feedback.set': {
      const prev = state.feedback[action.frId] ?? { notes: [] }
      return { ...state, feedback: { ...state.feedback, [action.frId]: { ...prev, ...action.patch } } }
    }
  }
}

export interface ScopeChoices {
  repoScope: RepoScope
  mode: ScanMode
  compare: boolean
}

function useStoreValue() {
  const [state, dispatch] = useReducer(reducer, undefined, load)
  const stateRef = useRef(state)
  stateRef.current = state
  const navigate = useNavigate()

  // Persist. Runs are durable on the (mock) backend; we only keep the IDs and
  // last-known state so a reload can reattach to the event stream.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* storage unavailable: prototype keeps working in memory */
    }
  }, [state])

  // One EventSource per active run.
  const sources = useRef(new Map<string, EventSource>())
  const runningIds = Object.values(state.runs).filter((r) => r.status === 'running').map((r) => r.id).join(',')
  useEffect(() => {
    const ids = new Set(runningIds ? runningIds.split(',') : [])
    for (const id of ids) {
      if (sources.current.has(id)) continue
      const es = new EventSource(`/api/runs/${id}/events`)
      es.onmessage = (e) => {
        const event = JSON.parse(e.data) as RunEvent
        dispatch({ type: 'run.event', id, event })
        if (event.type === 'run.completed' || event.type === 'run.stopped' || event.type === 'run.failed') {
          es.close()
          sources.current.delete(id)
        }
      }
      sources.current.set(id, es)
    }
    for (const [id, es] of sources.current) {
      if (!ids.has(id)) {
        es.close()
        sources.current.delete(id)
      }
    }
  }, [runningIds])
  useEffect(() => {
    const map = sources.current
    return () => {
      map.forEach((es) => es.close())
      map.clear()
    }
  }, [])

  // One shared EventSource for every active Matrix pipeline (a batch can run 8 at once,
  // and browsers only allow ~6 open connections per server over HTTP/1.1).
  const pipeSource = useRef<EventSource | null>(null)
  const activePipes = Object.values(state.pipelines)
    .filter((p) => p.status === 'running' || p.status === 'waiting')
    .map((p) => p.id)
    .sort()
    .join(',')
  const activeRems = Object.values(state.remediations)
    .filter((r) => r.status === 'running' || r.status === 'waiting')
    .map((r) => r.id)
    .sort()
    .join(',')
  useEffect(() => {
    pipeSource.current?.close()
    pipeSource.current = null
    if (!activePipes && !activeRems) return
    const es = new EventSource(`/api/matrix/events?pipelines=${activePipes}&remediations=${activeRems}`)
    es.onmessage = (e) => {
      const event = JSON.parse(e.data) as
        | { type: 'pipeline.state'; pipeline: PipelineState }
        | { type: 'pipeline.failed'; id: string; error: string }
        | { type: 'remediation.state'; remediation: RemediationState }
        | { type: 'remediation.failed'; id: string; error: string }
      if (event.type === 'pipeline.state') dispatch({ type: 'pipeline.state', id: event.pipeline.id, pipeline: event.pipeline })
      else if (event.type === 'pipeline.failed') dispatch({ type: 'pipeline.failed', id: event.id, error: event.error })
      else if (event.type === 'remediation.state') dispatch({ type: 'remediation.state', id: event.remediation.id, remediation: event.remediation })
      else dispatch({ type: 'remediation.failed', id: event.id, error: event.error })
    }
    // The server ends the stream when nothing is live; don't let the browser reconnect to it.
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED || es.readyState === EventSource.CONNECTING) es.close()
    }
    pipeSource.current = es
    return () => es.close()
  }, [activePipes, activeRems])

  const requestReview = useCallback((conversationId: string, target: ReviewTarget, personIds: string[], items: string[], note: string) => {
    const now = Date.now()
    const review: TeamReview = {
      id: uid('rv_'),
      conversationId,
      target,
      items,
      note,
      requestedBy: stateRef.current.viewer,
      requestedAt: now,
      reviewers: personIds.map((id, i) => {
        const plan = plannedResponse(id, target, items[0], i)
        return { personId: id, status: 'waiting', planned: { status: plan.status, comment: plan.comment } }
      }),
    }
    dispatch({ type: 'review.create', review })
    fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'team_review', target, reviewers: personIds, items, note }) }).catch(() => {})
  }, [])

  const resolveReview = useCallback((id: string, resolved: boolean) => dispatch({ type: 'review.resolve', id, resolved }), [])
  const replyReview = useCallback((id: string, status: 'approved' | 'commented' | 'changes', comment: string) => {
    dispatch({ type: 'review.reply', id, personId: stateRef.current.viewer, status, comment })
    fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'review_reply', reviewId: id, status }) }).catch(() => {})
  }, [])
  const nudgeReviewer = useCallback((id: string, personId: string) => dispatch({ type: 'review.nudge', id, personId }), [])
  const setViewer = useCallback((viewer: string) => dispatch({ type: 'viewer.set', viewer }), [])

  const latestRun = useCallback((convoId: string) => {
    const runs = Object.values(stateRef.current.runs).filter((r) => r.conversationId === convoId)
    return runs.find((r) => r.status === 'running') ?? [...runs].reverse().find((r) => r.status === 'completed') ?? runs[runs.length - 1]
  }, [])

  const openPanel = useCallback(
    (convoId: string, open: NonNullable<Reply['open']>) => {
      const run = Object.values(stateRef.current.runs).reverse().find((r) => r.conversationId === convoId && r.status === 'completed')
      if (!run) return
      if (open.to === 'report') navigate(paths.report(convoId, run.id))
      if (open.to === 'area' && open.id) navigate(paths.area(convoId, run.id, open.id))
      if (open.to === 'requirement' && open.id) navigate(paths.requirement(convoId, run.id, open.id))
    },
    [navigate],
  )

  const applyFixRef = useRef<((c: string, f: string, v: number) => void) | null>(null)

  /** Send a user message. Creates the conversation when called from the welcome screen. */
  const send = useCallback(
    /** `respondTo`: answer this request instead of `text` (used after picking a workspace). */
    (text: string, convoId?: string, app?: string | null, respondTo?: string) => {
      let id = convoId
      if (!id || !stateRef.current.conversations[id]) {
        id = uid('c_')
        dispatch({ type: 'convo.create', convo: { id, title: text.slice(0, 80), app: app ?? null, messages: [], owner: stateRef.current.viewer, createdAt: Date.now() } })
        navigate(paths.conversation(id))
      }
      const conversationId = id

      // A new message while a run is in the foreground sends the run to the background.
      const active = Object.values(stateRef.current.runs).find((r) => r.conversationId === conversationId && r.status === 'running')
      if (active) dispatch({ type: 'run.patch', id: active.id, patch: { foreground: false, everBackgrounded: true } })

      dispatch({ type: 'msg.add', convoId: conversationId, message: { id: uid('m_'), role: 'user', text } })
      const pendingId = uid('m_')
      dispatch({ type: 'msg.add', convoId: conversationId, message: { id: pendingId, role: 'assistant', pending: true } })

      window.setTimeout(() => {
        const convo = stateRef.current.conversations[conversationId]
        if (!convo) return
        const run = latestRun(conversationId)
        const r = reply(respondTo ?? text, convo, run)
        if (r.setApp && !convo.app) dispatch({ type: 'convo.setApp', id: conversationId, app: r.setApp })
        if (r.duringRun && run) dispatch({ type: 'run.patch', id: run.id, patch: { askedDuringRun: true } })
        dispatch({ type: 'msg.set', convoId: conversationId, messageId: pendingId, patch: { pending: false, blocks: r.blocks } })
        if (r.open) openPanel(conversationId, r.open)
        if (r.apply) applyFixRef.current?.(conversationId, r.apply.findingId, r.apply.variant)
      }, 1100)
    },
    [navigate, latestRun, openPanel],
  )

  /** Propose a Matrix hand-off for gaps the user picked (or the top ones in an area). */
  const handoffToPipeline = useCallback((convoId: string, areaSlug: string, frIds: string[]) => {
    const area = AREAS.find((a) => a.slug === areaSlug)
    const ids = frIds.length ? frIds : area ? requirementsFor(area).filter((r) => r.status === 'uncovered').slice(0, 5).map((r) => r.id) : []
    if (!area || ids.length === 0) return
    const listed = ids.length <= 6 ? ids.join(', ') : `${ids.slice(0, 5).join(', ')} and ${ids.length - 5} more`
    dispatch({ type: 'msg.add', convoId, message: { id: uid('m_'), role: 'user', text: `Close ${ids.length === 1 ? 'this' : 'these'} ${area.name.toLowerCase()} ${ids.length === 1 ? 'gap' : 'gaps'} with Matrix: ${listed}.` } })
    const pendingId = uid('m_')
    dispatch({ type: 'msg.add', convoId, message: { id: pendingId, role: 'assistant', pending: true } })
    window.setTimeout(() => {
      dispatch({
        type: 'msg.set',
        convoId,
        messageId: pendingId,
        patch: {
          pending: false,
          blocks: [
            { type: 'text', text: `Matrix can take ${ids.length === 1 ? 'this requirement' : `these **${ids.length} requirements**`} through its pipeline: it reads each linked Jira story, checks it's ready to test, designs test cases and commits the automation to a feature branch. Your Harness pipelines run it on HyperExecute post-commit on the branch, before Code review, and again post-merge on main. You approve at **Design review**, **Code review** and **Release sign-off** — nothing reaches Octane or Jira without them.` },
            { type: 'handoff', areaSlug, frIds: ids },
          ],
        },
      })
    }, 1100)
  }, [])

  const startPipeline = useCallback(
    async (convoId: string, messageId: string, areaSlug: string, frIds: string[], repo: string) => {
      const env = '' // decided by the Harness pipeline; the server reports it
      const app = stateRef.current.conversations[convoId]?.app ?? REPORT.app
      const res = await api('/api/matrix/pipelines', { method: 'POST', body: JSON.stringify({ app, areaSlug, frIds, repo, env }) })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; missing?: string[] }
        return { ok: false as const, error: err.error ?? 'Matrix could not start.', missing: err.missing ?? [] }
      }
      const { pipelineId } = (await res.json()) as { pipelineId: string }
      const now = Date.now()
      dispatch({
        type: 'pipeline.create',
        pipeline: {
          id: pipelineId,
          conversationId: convoId,
          messageId,
          app,
          areaSlug,
          frIds,
          repo,
          env,
          status: 'running',
          stages: [],
          gates: { readiness: { status: 'pending' }, design: { status: 'pending' }, code: { status: 'pending' }, release: { status: 'pending' } },
          readiness: {},
          revisions: { design: 1, automation: 1 },
          startedAt: now,
        },
      })
      dispatch({ type: 'msg.set', convoId, messageId, patch: { blocks: [{ type: 'pipeline', pipelineId }] } })
      return { ok: true as const }
    },
    [],
  )

  const decideGate = useCallback(async (pipelineId: string, gate: GateId, decision: 'approve' | 'changes' | 'reject', note?: string) => {
    await fetch(`/api/matrix/pipelines/${pipelineId}/gates/${gate}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, note, by: 'You' }),
    })
  }, [])

  const decideReadiness = useCallback(async (pipelineId: string, frId: string, decision: 'ready' | 'not_ready') => {
    await fetch(`/api/matrix/pipelines/${pipelineId}/readiness/${frId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, by: 'You' }),
    })
  }, [])

  const stopPipeline = useCallback(async (pipelineId: string) => {
    await fetch(`/api/matrix/pipelines/${pipelineId}/stop`, { method: 'POST' })
  }, [])

  /** Suggest closing every remaining gap: one pipeline per area. */
  const proposeBatch = useCallback((convoId: string) => {
    dispatch({ type: 'msg.add', convoId, message: { id: uid('m_'), role: 'user', text: 'Close all the coverage gaps with Matrix, in one go.' } })
    const pendingId = uid('m_')
    dispatch({ type: 'msg.add', convoId, message: { id: pendingId, role: 'assistant', pending: true } })
    window.setTimeout(() => {
      dispatch({
        type: 'msg.set',
        convoId,
        messageId: pendingId,
        patch: {
          pending: false,
          blocks: [
            { type: 'text', text: 'I can run one Matrix pipeline per functional area, side by side, covering every requirement that still has no full test evidence. The gates stay with you, but you can decide them **in bulk** from one batch view instead of area by area.' },
            { type: 'batchScope' },
          ],
        },
      })
    }, 1100)
  }, [])

  /** Requirements still open per area: not covered at the scan and not closed by a delivered pipeline. */
  const openGaps = useCallback(() => {
    const closed = new Set(Object.values(stateRef.current.pipelines).filter((p) => p.outcome === 'delivered').flatMap((p) => readyFrIds(p)))
    return AREAS.map((a) => ({ area: a, frIds: requirementsFor(a).filter((r) => r.status !== 'covered' && !closed.has(r.id)).map((r) => r.id) })).filter((x) => x.frIds.length)
  }, [])

  const startBatch = useCallback(async (convoId: string, messageId: string, repo: string) => {
    const env = '' // decided by the Harness pipeline; the server reports it
    const app = stateRef.current.conversations[convoId]?.app ?? REPORT.app
    const batchId = uid('bt_')
    const ids: string[] = []
    for (const { area, frIds } of openGaps()) {
      const res = await api('/api/matrix/pipelines', { method: 'POST', body: JSON.stringify({ app, areaSlug: area.slug, frIds, repo, env }) })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; missing?: string[] }
        if (!ids.length) return { ok: false as const, error: err.error ?? 'Matrix could not start.', missing: err.missing ?? [] }
        break
      }
      const { pipelineId } = (await res.json()) as { pipelineId: string }
      ids.push(pipelineId)
      dispatch({
        type: 'pipeline.create',
        pipeline: {
          id: pipelineId, conversationId: convoId, messageId, batchId, app, areaSlug: area.slug, frIds, repo, env, status: 'running', stages: [],
          gates: { readiness: { status: 'pending' }, design: { status: 'pending' }, code: { status: 'pending' }, release: { status: 'pending' } },
          readiness: {}, revisions: { design: 1, automation: 1 }, startedAt: Date.now(), owner: stateRef.current.viewer,
        },
      })
    }
    dispatch({ type: 'batch.create', batch: { id: batchId, conversationId: convoId, messageId, repo, env, pipelineIds: ids, createdAt: Date.now(), notified: [] } })
    dispatch({ type: 'msg.set', convoId, messageId, patch: { blocks: [{ type: 'batch', batchId }] } })
    return { ok: true as const }
  }, [openGaps])

  /** A person deciding many gates at once: one decision per waiting pipeline, same as doing it by hand. */
  const bulkDecide = useCallback(async (batchId: string, gate: Exclude<GateId, 'readiness'>, decision: 'approve' | 'reject', note?: string) => {
    const b = stateRef.current.batches[batchId]
    if (!b) return
    const waiting = b.pipelineIds.map((id) => stateRef.current.pipelines[id]).filter((p) => p && p.gates[gate].status === 'waiting')
    await Promise.all(
      waiting.map((p) =>
        fetch(`/api/matrix/pipelines/${p.id}/gates/${gate}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, note, by: 'You' }) }),
      ),
    )
  }, [])

  const bulkReadiness = useCallback(async (batchId: string, decision: 'ready' | 'not_ready') => {
    const b = stateRef.current.batches[batchId]
    if (!b) return
    await Promise.all(
      b.pipelineIds
        .map((id) => stateRef.current.pipelines[id])
        .filter((p) => p && p.gates.readiness.status === 'waiting')
        .map((p) => {
          const decisions = Object.fromEntries(p.frIds.filter((id) => p.readiness[id]?.answer === 'uncertain' && !p.readiness[id].decision).map((id) => [id, decision]))
          return fetch(`/api/matrix/pipelines/${p.id}/readiness`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decisions, by: 'You' }) })
        }),
    )
  }, [])

  const proposeRemediation = useCallback((convoId: string, imported: string[] = []) => {
    dispatch({ type: 'msg.add', convoId, message: { id: uid('m_'), role: 'user', text: imported.length ? `Remediate these: ${imported.join(', ')}.` : 'Find and fix vulnerabilities in the repositories.' } })
    const pendingId = uid('m_')
    dispatch({ type: 'msg.add', convoId, message: { id: pendingId, role: 'assistant', pending: true } })
    window.setTimeout(() => {
      dispatch({ type: 'msg.set', convoId, messageId: pendingId, patch: { pending: false, blocks: remediationIntro(imported) } })
    }, 1100)
  }, [])

  const startRemediation = useCallback(
    async (
      convoId: string,
      messageId: string,
      opts: { mode: 'scan' | 'import' | 'direct'; imported?: string[]; base: 'develop' | 'main'; fix?: string[]; variants?: Record<string, number> },
    ) => {
    const { mode, imported = [], base } = opts
    const env = '' // decided by the Harness pipeline; the server reports it
    const app = stateRef.current.conversations[convoId]?.app ?? REPORT.app
    const res = await api('/api/matrix/remediations', { method: 'POST', body: JSON.stringify({ app, mode, imported, env, base, fix: opts.fix, variants: opts.variants, by: 'You' }) })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string; missing?: string[] }
      return { ok: false as const, error: err.error ?? 'Matrix could not start.', missing: err.missing ?? [] }
    }
    const { remediationId } = (await res.json()) as { remediationId: string }
    dispatch({
      type: 'remediation.create',
      remediation: {
        id: remediationId, conversationId: convoId, messageId, app, mode, imported, env, base, branch: '', status: 'running', stages: [],
        gates: { triage: { status: 'pending' }, coverage: { status: 'pending' }, code: { status: 'pending' }, release: { status: 'pending' } },
        findings: opts.fix ?? [], unmatched: [], fix: opts.fix ?? [], dismissed: [], variants: opts.variants ?? {}, revision: 1, startedAt: Date.now(), owner: stateRef.current.viewer,
      },
    })
    dispatch({ type: 'msg.set', convoId, messageId, patch: { pending: false, blocks: [{ type: 'remediation', remediationId }] } })
    return { ok: true as const }
    },
    [],
  )

  /** A fix agreed in chat goes on its own feature branch with a PR into develop. */
  const applyFix = useCallback(
    async (convoId: string, findingId: string, variant: number) => {
      const messageId = uid('m_')
      dispatch({ type: 'msg.add', convoId, message: { id: messageId, role: 'assistant', pending: true } })
      const r = await startRemediation(convoId, messageId, { mode: 'direct', fix: [findingId], variants: { [findingId]: variant }, base: 'develop' })
      if (!r.ok) {
        dispatch({
          type: 'msg.set',
          convoId,
          messageId,
          patch: { pending: false, blocks: [{ type: 'text', text: r.missing?.length ? 'I need your GitHub connection to push a branch and open the PR. Connect it under your avatar → Connections, then ask me again.' : r.error }] },
        })
      }
    },
    [startRemediation],
  )

  const decideRemGate = useCallback(async (id: string, gate: RemGateId, body: Record<string, unknown>) => {
    const viewer = stateRef.current.viewer
    await api(`/api/matrix/remediations/${id}/gates/${gate}`, { method: 'POST', body: JSON.stringify({ ...body, by: viewer === 'sp' ? 'You' : person(viewer).name }) })
  }, [])

  const stopRemediation = useCallback(async (id: string) => {
    await api(`/api/matrix/remediations/${id}/stop`, { method: 'POST' })
  }, [])

  applyFixRef.current = applyFix

  const runChip = useCallback(
    (convoId: string, action: ChipAction) => {
      if (action.kind === 'say') return send(action.text, convoId)
      if (action.kind === 'pipeline' && action.id.startsWith('batch:')) return navigate(paths.batch(convoId, action.id.slice(6)))
      if (action.kind === 'pipeline') return navigate(paths.pipeline(convoId, action.id, action.view))
      if (action.kind === 'handoff') return handoffToPipeline(convoId, action.areaSlug, action.frIds)
      if (action.kind === 'batch') return proposeBatch(convoId)
      if (action.kind === 'workspace') {
        dispatch({ type: 'convo.setApp', id: convoId, app: action.app })
        return send(`Use the ${action.app} workspace.`, convoId, undefined, action.then)
      }
      if (action.kind === 'remediation') return navigate(paths.remediation(convoId, action.id, action.view))
      if (action.kind === 'remScope') return proposeRemediation(convoId, action.imported ?? [])
      if (action.kind === 'remApply') return applyFix(convoId, action.findingId, action.variant)
      openPanel(convoId, { to: action.to, id: action.id })
    },
    [send, openPanel, navigate], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const startRun = useCallback(async (convoId: string, messageId: string, app: string, choices: ScopeChoices) => {
    const repoCount = REPORT.components
    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app, repoCount, mode: choices.mode, compare: choices.compare }),
    })
    const { runId } = (await res.json()) as { runId: string }
    dispatch({
      type: 'run.create',
      run: {
        id: runId,
        conversationId: convoId,
        startMessageId: messageId,
        app,
        repoScope: choices.repoScope,
        repoCount,
        mode: choices.mode,
        compare: choices.compare,
        status: 'running',
        pct: 0,
        elapsedMs: 0,
        steps: [],
        foreground: true,
        everBackgrounded: false,
        askedDuringRun: false,
      },
    })
    dispatch({ type: 'msg.set', convoId, messageId, patch: { blocks: [{ type: 'runStart', runId }] } })
  }, [])

  const cancelScope = useCallback((convoId: string, messageId: string, app: string) => {
    const blocks: Block[] = [
      { type: 'text', text: `Okay — I haven't started anything. Ask again whenever you want to analyse ${app}.` },
      { type: 'chips', chips: [{ label: `Analyse ${app}`, action: { kind: 'say', text: `Analyse the functional coverage for ${app}.` } }] },
    ]
    dispatch({ type: 'msg.set', convoId, messageId, patch: { blocks } })
  }, [])

  const setBlocks = useCallback((convoId: string, messageId: string, blocks: Block[]) => dispatch({ type: 'msg.set', convoId, messageId, patch: { blocks } }), [])

  const stopRun = useCallback(async (runId: string) => {
    await fetch(`/api/runs/${runId}/stop`, { method: 'POST' })
  }, [])

  const setForeground = useCallback((runId: string, foreground: boolean) => {
    dispatch({ type: 'run.patch', id: runId, patch: { foreground } })
  }, [])

  const deleteConversation = useCallback(async (id: string) => {
    // Stop anything still running for it first; the run is a backend job.
    const running = Object.values(stateRef.current.runs).filter((r) => r.conversationId === id && r.status === 'running')
    await Promise.all(running.map((r) => fetch(`/api/runs/${r.id}/stop`, { method: 'POST' }).catch(() => {})))
    dispatch({ type: 'convo.delete', id })
  }, [])

  const setApp = useCallback((convoId: string, app: string) => dispatch({ type: 'convo.setApp', id: convoId, app }), [])

  const setNotification = useCallback((id: string, patch: Partial<Notification>) => dispatch({ type: 'notif.patch', id, patch }), [])
  const readAllNotifications = useCallback(() => dispatch({ type: 'notif.readAll' }), [])

  /** Feedback is data: it goes to the backend the matching pipeline reads from. */
  const giveFeedback = useCallback((frId: string, patch: Partial<Feedback>, payload: Record<string, unknown>) => {
    dispatch({ type: 'feedback.set', frId, patch })
    fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frId, ...payload }) }).catch(() => {})
  }, [])

  return {
    state,
    send,
    runChip,
    startRun,
    cancelScope,
    stopRun,
    setForeground,
    setApp,
    deleteConversation,
    handoffToPipeline,
    proposeBatch,
    proposeRemediation,
    applyFix,
    startRemediation,
    decideRemGate,
    stopRemediation,
    openGaps,
    startBatch,
    bulkDecide,
    bulkReadiness,
    requestReview,
    resolveReview,
    replyReview,
    nudgeReviewer,
    setViewer,
    setBlocks,
    startPipeline,
    decideGate,
    decideReadiness,
    stopPipeline,
    setNotification,
    readAllNotifications,
    giveFeedback,
    scopeLabel,
  }
}

type Store = ReturnType<typeof useStoreValue>
const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue()
  const memo = useMemo(() => value, [value.state]) // eslint-disable-line react-hooks/exhaustive-deps
  return <StoreContext.Provider value={memo}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}
