/** Matrix test intelligence pipeline (architecture board, plane 4). Shared by the UI and the mock server. */

export type StageId = 'intake' | 'readiness' | 'design' | 'automation' | 'execute' | 'deliver'
export type GateId = 'readiness' | 'design' | 'code' | 'release'
export type ReadinessAnswer = 'ready' | 'needs_clarification' | 'not_testable' | 'uncertain'

export interface StageState {
  id: StageId
  status: 'pending' | 'running' | 'done' | 'skipped'
  startedAt?: number
  endedAt?: number
}

export interface GateState {
  status: 'pending' | 'waiting' | 'passed' | 'changes' | 'rejected'
  auto?: boolean
  by?: string
  at?: number
  note?: string
}

export interface ReadinessResult {
  answer: ReadinessAnswer
  confidence: number
  judge: 'model' | 'llm'
  reason: string
  /** For "uncertain": what QA decided. */
  decision?: 'ready' | 'not_ready'
  decidedBy?: string
}

/** Stage 05 runs outside Matrix: merge → post-commit Harness pipeline → HyperExecute. */
export type ExecPhase = 'awaiting_merge' | 'harness_triggered' | 'hyperexecute_running' | 'collecting' | 'done'

export interface ExecutionInfo {
  phase: ExecPhase
  pr: number
  commit?: string
  branch: string
  mergedAt?: number
  harness: { pipeline: string; executionId?: number; triggeredAt?: number }
  hyperexecute: { jobId?: string; concurrency: number; done: number; total: number; startedAt?: number; finishedAt?: number }
}

/** Post-commit CI on the feature branch, run as part of stage 04 before Code review. */
export interface PrChecks {
  phase: 'writing' | 'harness' | 'hyperexecute' | 'done'
  branch: string
  pr: number
  commit?: string
  pipeline: string
  harnessExecutionId?: number
  jobId?: string
  done: number
  total: number
}

export interface PipelineState {
  id: string
  app: string
  areaSlug: string
  frIds: string[]
  repo: string
  env: string
  status: 'running' | 'waiting' | 'completed' | 'stopped'
  outcome?: 'delivered' | 'nothing_ready' | 'rejected' | 'stopped'
  stages: StageState[]
  gates: Record<GateId, GateState>
  readiness: Record<string, ReadinessResult>
  revisions: { design: number; automation: number }
  startedAt: number
  completedAt?: number
  /** User whose connections (PATs) the pipeline acts with. */
  owner?: string
  execution?: ExecutionInfo
  prChecks?: PrChecks
}

export const STAGES: { id: StageId; n: string; title: string; doing: string; gate?: GateId }[] = [
  { id: 'intake', n: '01', title: 'Story intake', doing: 'Reading the stories, criteria and linked pages' },
  { id: 'readiness', n: '02', title: 'Readiness check', doing: 'Checking each story is ready to test', gate: 'readiness' },
  { id: 'design', n: '03', title: 'Test design', doing: 'Writing test cases for each criterion', gate: 'design' },
  { id: 'automation', n: '04', title: 'Automation & PR checks', doing: 'Committing scripts to a feature branch; post-commit checks on the PR', gate: 'code' },
  { id: 'execute', n: '05', title: 'Post-merge run', doing: 'Harness post-merge pipeline on main, tests on HyperExecute', gate: 'release' },
  { id: 'deliver', n: '06', title: 'Deliver', doing: 'Sending results to Octane and updating Jira' },
]

export const GATES: Record<GateId, { title: string; short: string; who: string; auto?: boolean }> = {
  readiness: { title: 'Readiness gate', short: 'Readiness', who: 'Automatic above the confidence floor; QA decides when uncertain', auto: true },
  design: { title: 'Design review', short: 'Design review', who: 'QA engineer' },
  code: { title: 'Code review', short: 'Code review', who: 'Developer' },
  release: { title: 'Release sign-off', short: 'Sign-off', who: 'Release owner' },
}

export const CONFIDENCE_FLOOR = 0.8
