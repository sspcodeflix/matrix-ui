/**
 * Mock vulnerability-remediation backend.
 *
 * Fixes go on a feature branch in each component they touch. Before any PR is
 * raised, a coverage check asks whether tests exist for the behaviour the fixes
 * change: if every impacted requirement is covered it passes on its own;
 * otherwise it waits at the Coverage gaps gate until the gaps are closed (Matrix
 * writes the tests, or a developer adds them) or someone accepts the risk.
 * Then tests run in CI twice: post-commit on the branches (the PR checks, seen
 * at Code review) and post-merge on the base branch, where the full automation
 * suite runs (seen at Release sign-off). Each run is a Harness pipeline → tests
 * on HyperExecute → re-scan. Only GitHub access is needed: Harness, HyperExecute
 * and the scanner are read with the bot identity.
 *
 *   POST /api/matrix/remediations   { app, mode: 'scan'|'import'|'direct', imported?, fix?, variants?, base, env }
 *   POST /api/matrix/remediations/:id/gates/triage    { fix: string[] }
 *   POST /api/matrix/remediations/:id/gates/coverage  { decision: 'generate' | 'added' | 'request' | 'accept', to?: string[], note? }
 *   POST /api/matrix/remediations/:id/gates/code      { decision: 'approve' | 'changes', note? }
 *   POST /api/matrix/remediations/:id/gates/release   { decision: 'approve' | 'reject', note? }
 *   POST /api/matrix/remediations/:id/stop
 *   Events: GET /api/matrix/events?remediations=a,b   (shared stream)
 */
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { FINDINGS, branchFor, findingById, fullSuiteCount, impactedFrs, matchImported, prCheckCount, untestedFrs } from '../src/remediation/data.ts'
import { REM_STAGES, remStageIndex as at, type CheckRun, type RemGateId, type RemStageId, type RemediationState } from '../src/remediation/types.ts'
import { currentUser, missingConnections, useSecret, type Tool } from './secretsServer.ts'

/** Environment the Harness pipelines are configured to test against (the user doesn't choose it). */
const PIPELINE_ENV = process.env.MATRIX_PIPELINE_ENV ?? 'SIT'
const SCALE = Number(process.env.MATRIX_STAGE_SCALE ?? 1)
const DURATION_S: Record<RemStageId, number> = { discover: 4, triage: 3, fix: 6, coverage: 4, pr_checks: 8, post_merge: 9, deliver: 3 }
/** Writing the gap tests takes longer than just checking. */
const WRITING_TESTS_S = 7
/** Remediation only works in the code: the user's GitHub access is all it needs. */
export const REMEDIATION_TOOLS: Tool[] = ['github']
const STAGE_TOOLS: Partial<Record<RemStageId, Tool[]>> = { discover: ['github'], fix: ['github'] }
export const remediations = new Map<string, RemediationState>()

/** Gaps the check found that are still open. */
const remaining = (r: RemediationState) => (r.coverage ? r.coverage.gaps.filter((id) => !r.coverage!.closed.includes(id)) : [])

function durationS(r: RemediationState, id: RemStageId) {
  return id === 'coverage' && r.coverage?.closedBy === 'matrix' && !r.prChecks ? WRITING_TESTS_S : DURATION_S[id]
}

function startStage(r: RemediationState, i: number, now: number) {
  r.stages[i] = { ...r.stages[i], status: 'running', startedAt: now, endedAt: undefined }
  r.status = 'running'
  if (r.stages[i].id === 'coverage' && !r.coverage) {
    const impacted = impactedFrs(r)
    r.coverage = { impacted, gaps: untestedFrs(impacted), closed: [] }
  }
  if (r.owner) {
    for (const tool of STAGE_TOOLS[r.stages[i].id] ?? []) {
      try {
        void useSecret(r.owner, tool, `remediation ${r.id} · ${r.stages[i].id}`)
      } catch {
        /* audited */
      }
    }
  }
}

function finish(r: RemediationState, outcome: RemediationState['outcome'], now: number) {
  r.stages = r.stages.map((s) => (s.status === 'pending' ? { ...s, status: 'skipped' } : s))
  r.status = 'completed'
  r.outcome = outcome
  r.completedAt = now
}

/** Progress of one CI run, derived from how far into the stage we are. `lead` = share spent before CI starts (waiting for the merge). */
function updateRun(run: CheckRun | undefined, r: RemediationState, stage: RemStageId, startedAt: number, now: number, lead: number, total: number): CheckRun {
  const f = Math.min(1, (now - startedAt) / (DURATION_S[stage] * 1000 * SCALE))
  const seed = createHash('sha1').update(`${r.id}:${stage}:${r.revision}`).digest('hex')
  const c: CheckRun = run ?? { phase: 'waiting', done: 0, total }
  const span = 1 - lead
  const at = (x: number) => lead + span * x
  c.phase = f < lead ? 'waiting' : f < at(0.15) ? 'harness' : f < at(0.7) ? 'hyperexecute' : 'rescan'
  if (f >= lead) {
    c.commit ??= seed.slice(0, 7)
    c.harnessExecutionId ??= 4900 + parseInt(seed.slice(0, 2), 16)
  }
  if (f >= at(0.15)) {
    c.jobId ??= `he-${seed.slice(7, 15)}`
    c.done = Math.min(total, Math.floor(((f - at(0.15)) / (span * 0.55)) * total))
  }
  if (f >= at(0.7)) c.done = total
  return c
}

/** Moves a remediation forward based on the clock. Safe to call any number of times. */
export function advanceRemediation(r: RemediationState, now = Date.now()) {
  if (r.status !== 'running') return
  const i = r.stages.findIndex((s) => s.status === 'running')
  if (i < 0) return
  const stage = r.stages[i]
  if (stage.id === 'pr_checks') r.prChecks = updateRun(r.prChecks, r, 'pr_checks', stage.startedAt!, now, 0, prCheckCount(r))
  if (stage.id === 'post_merge') {
    r.postMerge = updateRun(r.postMerge, r, 'post_merge', stage.startedAt!, now, 0.2, fullSuiteCount(r))
    if (r.postMerge.commit) r.mergeCommit = r.postMerge.commit
  }
  if (now - stage.startedAt! < durationS(r, stage.id) * 1000 * SCALE) return
  r.stages[i] = { ...stage, status: 'done', endedAt: now }

  if (stage.id === 'discover') {
    if (r.mode === 'import') {
      const { matched, unmatched } = matchImported(r.imported)
      r.findings = matched
      r.unmatched = unmatched
    } else {
      r.findings = FINDINGS.map((f) => f.id)
    }
    if (!r.findings.length) return finish(r, 'nothing_found', now)
  }
  if (stage.id === 'coverage') {
    // Gaps still open: wait for someone to close them or accept the risk.
    if (remaining(r).length && r.gates.coverage.status !== 'passed') {
      r.gates.coverage = { status: 'waiting' }
      r.status = 'waiting'
      return
    }
    if (r.gates.coverage.status === 'pending') r.gates.coverage = { status: 'passed', auto: true, by: 'Matrix', at: now, note: 'Existing tests cover every requirement the fixes touch' }
    return startStage(r, at('pr_checks'), now)
  }
  if (stage.id === 'pr_checks' && r.prChecks) Object.assign(r.prChecks, { phase: 'done', rescanClean: true })
  if (stage.id === 'post_merge' && r.postMerge) Object.assign(r.postMerge, { phase: 'done', rescanClean: true })

  const gate = REM_STAGES[i].gate
  if (gate) {
    r.gates[gate] = { status: 'waiting' }
    r.status = 'waiting'
    return
  }
  if (i + 1 >= r.stages.length) return finish(r, 'resolved', now)
  startStage(r, i + 1, now)
}

async function readJson(req: IncomingMessage): Promise<any> {
  let body = ''
  for await (const chunk of req) body += chunk
  try {
    return body ? JSON.parse(body) : {}
  } catch {
    return {}
  }
}

function json(res: ServerResponse, status: number, data?: unknown) {
  res.statusCode = status
  if (data === undefined) return res.end()
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

export async function handleRemediations(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname
  if (!path.startsWith('/api/matrix/remediations')) return false

  if (req.method === 'POST' && path === '/api/matrix/remediations') {
    const owner = currentUser(req)
    if (!owner) {
      json(res, 401, { error: 'Not signed in.' })
      return true
    }
    const missing = missingConnections(owner, REMEDIATION_TOOLS)
    if (missing.length) {
      json(res, 412, { error: 'Connect GitHub first.', missing })
      return true
    }
    const body = await readJson(req)
    const now = Date.now()
    const id = `rm_${Math.random().toString(36).slice(2, 10)}`
    const mode: RemediationState['mode'] = body.mode === 'import' ? 'import' : body.mode === 'direct' ? 'direct' : 'scan'
    const app = body.app ?? 'ABCD'
    const r: RemediationState = {
      id,
      app,
      mode,
      imported: Array.isArray(body.imported) ? body.imported.slice(0, 200) : [],
      base: body.base === 'main' ? 'main' : 'develop',
      branch: '',
      env: PIPELINE_ENV, // the Harness pipeline's own configuration decides where tests run
      status: 'running',
      stages: REM_STAGES.map((s) => ({ id: s.id, status: 'pending' })),
      gates: { triage: { status: 'pending' }, coverage: { status: 'pending' }, code: { status: 'pending' }, release: { status: 'pending' } },
      findings: [],
      unmatched: [],
      fix: [],
      dismissed: [],
      variants: typeof body.variants === 'object' && body.variants ? body.variants : {},
      revision: 1,
      startedAt: now,
      owner,
    }
    if (mode === 'direct') {
      // Agreed interactively in chat: discovery and triage already happened in the conversation.
      const fix = (Array.isArray(body.fix) ? body.fix : []).filter((f: string) => findingById(f))
      r.findings = fix
      r.fix = fix
      r.branch = branchFor(app, fix)
      r.stages[0] = { ...r.stages[0], status: 'done', startedAt: now, endedAt: now }
      r.stages[1] = { ...r.stages[1], status: 'done', startedAt: now, endedAt: now }
      r.gates.triage = { status: 'passed', by: body.by ?? 'You', at: now, note: 'Agreed in chat' }
      startStage(r, at('fix'), now)
    } else {
      startStage(r, 0, now)
    }
    remediations.set(id, r)
    json(res, 201, { remediationId: id })
    return true
  }

  const m = path.match(/^\/api\/matrix\/remediations\/([\w-]+)(\/.*)?$/)
  const r = m ? remediations.get(m[1]) : undefined
  if (!r) {
    json(res, 404, { error: 'not found' })
    return true
  }
  const rest = m?.[2] ?? ''
  const gate = rest.match(/^\/gates\/(triage|coverage|code|release)$/)?.[1] as RemGateId | undefined

  if (req.method === 'POST' && gate) {
    const body = await readJson(req)
    const now = Date.now()
    if (r.gates[gate].status !== 'waiting') {
      json(res, 409, { error: 'gate is not waiting' })
      return true
    }
    const by = body.by ?? 'unknown'
    if (gate === 'triage') {
      const fix: string[] = (body.fix ?? []).filter((id: string) => r.findings.includes(id))
      r.fix = fix
      r.dismissed = r.findings.filter((id) => !fix.includes(id))
      r.branch = branchFor(r.app, fix)
      r.gates.triage = { status: 'passed', by, at: now, note: body.note }
      if (!fix.length) finish(r, 'resolved', now)
      else startStage(r, at('fix'), now)
    } else if (gate === 'coverage') {
      const cov = r.coverage!
      const open = remaining(r)
      if (body.decision === 'request') {
        // Ask teammates to add the tests; the gate keeps waiting for them.
        const to: string[] = Array.isArray(body.to) ? body.to.slice(0, 10) : []
        cov.requested = { to, by, at: now, note: body.note }
        json(res, 202, { ok: true })
        return true
      }
      if (body.decision === 'generate' || body.decision === 'added') {
        // Tests go on the branch in ABCD-TestingScript, then the check runs again.
        cov.closed = [...cov.closed, ...open]
        cov.closedBy = body.decision === 'generate' ? 'matrix' : 'developer'
        r.gates.coverage = { status: 'passed', by, at: now, note: body.decision === 'generate' ? `Matrix writes tests for ${open.length} ${open.length === 1 ? 'requirement' : 'requirements'}` : 'Developer added the tests' }
        startStage(r, at('coverage'), now)
      } else {
        r.gates.coverage = { status: 'passed', by, at: now, note: body.note ?? 'Proceeding without tests for the gaps' }
        startStage(r, at('pr_checks'), now)
      }
    } else if (body.decision === 'approve') {
      r.gates[gate] = { status: 'passed', by, at: now, note: body.note }
      startStage(r, at(gate === 'code' ? 'post_merge' : 'deliver'), now)
    } else if (body.decision === 'changes' && gate === 'code') {
      // A new commit on the same branches: fix again, re-check coverage, then the PR checks run again.
      r.gates.code = { status: 'changes', by, at: now, note: body.note }
      r.revision += 1
      r.prChecks = undefined
      for (const id of ['coverage', 'pr_checks'] as const) r.stages[at(id)] = { ...r.stages[at(id)], status: 'pending' }
      startStage(r, at('fix'), now)
    } else {
      r.gates[gate] = { status: 'rejected', by, at: now, note: body.note }
      finish(r, 'rejected', now)
    }
    json(res, 202, { ok: true })
    return true
  }

  if (req.method === 'POST' && rest === '/stop') {
    if (r.status === 'running' || r.status === 'waiting') {
      r.status = 'stopped'
      r.outcome = 'stopped'
      r.completedAt = Date.now()
      r.stages = r.stages.map((s) => (s.status === 'running' ? { ...s, status: 'pending' } : s))
    }
    json(res, 202, { ok: true })
    return true
  }

  json(res, 404, { error: 'not found' })
  return true
}
