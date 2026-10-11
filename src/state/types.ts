export type ChipAction =
  | { kind: 'say'; text: string } // sent as a user message
  | { kind: 'open'; to: 'report' | 'area' | 'requirement'; id?: string } // panel navigation only
  | { kind: 'pipeline'; id: string; view?: string } // open a Matrix pipeline in the panel
  | { kind: 'handoff'; areaSlug: string; frIds: string[] } // hand gaps to Matrix
  | { kind: 'batch' } // close every gap in one go
  | { kind: 'workspace'; app: string; then: string } // pick the app workspace, then answer `then`
  | { kind: 'remediation'; id: string; view?: string } // open a remediation in the panel
  | { kind: 'remScope'; imported?: string[] } // propose vulnerability remediation
  | { kind: 'remApply'; findingId: string; variant: number } // put a fix agreed in chat on a feature branch

export interface Chip {
  label: string
  action: ChipAction
}

export type Block =
  | { type: 'text'; text: string; tone?: 'secondary' }
  | { type: 'scope'; app: string }
  | { type: 'runStart'; runId: string }
  | { type: 'runDone'; runId: string }
  | { type: 'artifact'; runId: string }
  | { type: 'chips'; chips: Chip[] }
  | { type: 'handoff'; areaSlug: string; frIds: string[] }
  | { type: 'pipeline'; pipelineId: string }
  | { type: 'batchScope' }
  | { type: 'remScope'; imported: string[] }
  | { type: 'remediation'; remediationId: string }
  | { type: 'fixProposal'; findingId: string; variant: number }
  | { type: 'batch'; batchId: string }

export interface Message {
  id: string
  role: 'user' | 'assistant'
  text?: string
  blocks?: Block[]
  pending?: boolean
}

export interface Conversation {
  id: string
  title: string
  app: string | null
  messages: Message[]
  /** Person id of whoever started it. Missing = "sp". */
  owner?: string
  createdAt: number
  /** Last message time. Optional for conversations saved before it existed. */
  updatedAt?: number
}

export type StepStatus = 'pending' | 'running' | 'done'

export interface RunStep {
  id: string
  title: string
  description: string
  status: StepStatus
  durationMs?: number
  summary?: string
}

export type RepoScope = 'all' | 'automation' | 'custom'
export type ScanMode = 'cached' | 'fresh'

export interface RunState {
  id: string
  conversationId: string
  startMessageId: string
  app: string
  repoScope: RepoScope
  repoCount: number
  mode: ScanMode
  compare: boolean
  status: 'running' | 'completed' | 'stopped' | 'failed'
  pct: number
  elapsedMs: number
  steps: RunStep[]
  foreground: boolean
  everBackgrounded: boolean
  askedDuringRun: boolean
  completedAt?: number
  error?: string
}

export interface Notification {
  id: string
  title: string
  body: string
  conversationId: string
  runId?: string
  /** Where "Open" goes. Falls back to the run's report. */
  href?: string
  /** Recipient's person id. Missing = the conversation owner ("sp"). */
  to?: string
  action?: string
  read: boolean
  toast: boolean
  createdAt: number
}

export interface Feedback {
  reviewed?: boolean
  notes: { text: string; at: number }[]
  flag?: { reason: string; comment: string; at: number }
}

/** Events streamed by a coverage analysis run (see mock/runServer.ts). */
export type RunEvent =
  | { type: 'run.started'; steps: { id: string; title: string; description: string }[] }
  | { type: 'step.started'; stepId: string }
  | { type: 'step.progress'; stepId: string; pct: number; detail: string }
  | { type: 'step.completed'; stepId: string; durationMs: number; summary: string }
  | { type: 'run.progress'; pct: number; elapsedMs: number }
  | { type: 'run.needs_input'; question: string; options: string[] }
  | { type: 'run.completed'; reportId: string; completedAt: number }
  | { type: 'run.failed'; error: string }
  | { type: 'run.stopped' }

export type PipelineRecord = import('../pipeline/types').PipelineState & {
  conversationId: string
  messageId: string
  /** Set when the pipeline is one area of a "close all gaps" batch. */
  batchId?: string
  error?: string
}

/* ---------- Team review ---------- */

export type ReviewTarget =
  | { kind: 'stage'; pipelineId: string; stage: 'readiness' | 'design' | 'automation' | 'execution' | 'delivery' }
  | { kind: 'requirement'; frId: string; runId: string }

export type ReviewerStatus = 'waiting' | 'approved' | 'commented' | 'changes'

export interface ReviewerState {
  personId: string
  status: ReviewerStatus
  comment?: string
  respondedAt?: number
  /** Suggested reply, prefilled for the reviewer (prototype content). */
  planned: { status: Exclude<ReviewerStatus, 'waiting'>; comment: string }
  nudgedAt?: number
}

export interface TeamReview {
  id: string
  conversationId: string
  target: ReviewTarget
  /** Specific things to look at, e.g. test case IDs. Empty = the whole thing. */
  items: string[]
  note: string
  requestedBy: string
  requestedAt: number
  reviewers: ReviewerState[]
  resolved?: boolean
  /** Set once the "everyone replied" turn has been posted. */
  summarized?: boolean
}

/** "Close every gap in one go": one pipeline per functional area, decided in bulk. */
export interface Batch {
  id: string
  conversationId: string
  messageId: string
  repo: string
  env: string
  pipelineIds: string[]
  createdAt: number
  /** Gates we've already told the owner about (one heads-up per gate type). */
  notified: string[]
  done?: boolean
  completedAt?: number
}

export type RemediationRecord = import('../remediation/types').RemediationState & {
  conversationId: string
  messageId: string
  error?: string
}
