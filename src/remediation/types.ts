/** Vulnerability remediation pipeline. Shared by the UI and the mock server. */
import type { GateState, StageState } from '../pipeline/types'

export type RemStageId = 'discover' | 'triage' | 'fix' | 'coverage' | 'pr_checks' | 'post_merge' | 'deliver'
export type RemGateId = 'triage' | 'coverage' | 'code' | 'release'
export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface RemStage extends Omit<StageState, 'id'> {
  id: RemStageId
}

/** One CI run: Harness pipeline → tests on HyperExecute → re-scan. */
export interface CheckRun {
  phase: 'waiting' | 'harness' | 'hyperexecute' | 'rescan' | 'done'
  commit?: string
  harnessExecutionId?: number
  jobId?: string
  done: number
  total: number
  rescanClean?: boolean
}

/**
 * Before the PR: do tests exist for the behaviour the fixes change? Each fixed
 * finding touches some functional requirements; any that lack full test
 * evidence in ABCD-TestingScript is a gap the PR checks would not catch.
 */
export interface CoverageCheck {
  /** Requirements the fixes touch. */
  impacted: string[]
  /** Impacted requirements with no or only partial tests, as found by the check. */
  gaps: string[]
  /** Gaps closed on the branch, and by whom. */
  closed: string[]
  closedBy?: 'matrix' | 'developer'
  /** Teammates asked to add the tests. */
  requested?: { to: string[]; by: string; at: number; note?: string }
}

export interface RemediationState {
  id: string
  app: string
  /** scan the repos · import CWE/CVE IDs · direct = a fix agreed interactively in chat */
  mode: 'scan' | 'import' | 'direct'
  /** CWE / CVE IDs the user pasted (import mode). */
  imported: string[]
  /** Branch the PR targets. */
  base: 'develop' | 'main'
  /** Feature branch the fixes are committed to. */
  branch: string
  env: string
  status: 'running' | 'waiting' | 'completed' | 'stopped'
  outcome?: 'resolved' | 'nothing_found' | 'rejected' | 'stopped'
  stages: RemStage[]
  gates: Record<RemGateId, GateState>
  findings: string[]
  unmatched: string[]
  fix: string[]
  dismissed: string[]
  /** Chosen fix approach per finding (0 = recommended). */
  variants: Record<string, number>
  revision: number
  coverage?: CoverageCheck
  /** Post-commit run on the feature branch (the PR's checks). */
  prChecks?: CheckRun
  /** Post-merge run on the base branch. */
  postMerge?: CheckRun
  mergeCommit?: string
  startedAt: number
  completedAt?: number
  owner?: string
}

export const REM_STAGES: { id: RemStageId; n: string; title: string; doing: string; gate?: RemGateId }[] = [
  { id: 'discover', n: '01', title: 'Discover', doing: 'Scanning code, dependencies and secrets' },
  { id: 'triage', n: '02', title: 'Triage', doing: 'Rating severity and exploitability; spotting false positives', gate: 'triage' },
  { id: 'fix', n: '03', title: 'Fix on a branch', doing: 'Committing patches and security tests to feature branches' },
  { id: 'coverage', n: '04', title: 'Coverage check', doing: 'Checking that existing tests cover what the fixes change', gate: 'coverage' },
  { id: 'pr_checks', n: '05', title: 'PR checks', doing: 'Post-commit pipeline on the feature branches', gate: 'code' },
  { id: 'post_merge', n: '06', title: 'Post-merge', doing: 'Full automation suite on the base branch', gate: 'release' },
  { id: 'deliver', n: '07', title: 'Deliver', doing: 'Closing the findings in the scanner' },
]

export const remStageIndex = (id: RemStageId) => REM_STAGES.findIndex((s) => s.id === id)

export const REM_GATES: Record<RemGateId, { title: string; short: string; who: string }> = {
  triage: { title: 'Triage review', short: 'Triage', who: 'Security champion' },
  coverage: { title: 'Coverage gaps', short: 'Coverage', who: 'Developer' },
  code: { title: 'Code review', short: 'Code review', who: 'Developer' },
  release: { title: 'Release sign-off', short: 'Sign-off', who: 'Release owner' },
}
