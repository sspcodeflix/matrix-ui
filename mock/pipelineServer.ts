/**
 * Mock Matrix pipeline backend (plane 4). A durable job that runs stages
 * left to right and pauses at each human gate until a decision is posted.
 * The Readiness gate is automatic above the confidence floor; "uncertain"
 * stories wait for QA.
 *
 *   POST /api/matrix/pipelines                       { app, areaSlug, frIds, repo, env } -> { pipelineId }
 *   GET  /api/matrix/pipelines/:id/events            text/event-stream of { type: 'pipeline.state', pipeline }
 *   POST /api/matrix/pipelines/:id/gates/:gate       { decision: 'approve' | 'changes' | 'reject', note?, by }
 *   POST /api/matrix/pipelines/:id/readiness/:frId   { decision: 'ready' | 'not_ready', by }
 *   POST /api/matrix/pipelines/:id/readiness         { decisions: { [frId]: 'ready' | 'not_ready' }, by }  (bulk)
 *   POST /api/matrix/pipelines/:id/stop
 *
 * Stage timings scale with MATRIX_STAGE_SCALE (default 1 = ~30 s of work in total).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { allTestCases, automationFor, judgeReadiness, readyFrIds } from '../src/pipeline/data.ts'
import { STAGES, type GateId, type PipelineState, type StageId } from '../src/pipeline/types.ts'
import { currentUser, missingConnections, useSecret, type Tool } from './secretsServer.ts'
import { advanceRemediation, remediations } from './remediationServer.ts'

/** Tools each stage calls as the user. The token is fetched at call time and never kept. */
const STAGE_TOOLS: Partial<Record<StageId, Tool[]>> = { intake: ['jira', 'confluence'], automation: ['github'], deliver: ['octane', 'jira'] }
export const REQUIRED_TOOLS: Tool[] = ['jira', 'github', 'octane']

/** Environment the Harness pipelines are configured to test against (the user doesn't choose it). */
const PIPELINE_ENV = process.env.MATRIX_PIPELINE_ENV ?? 'SIT'
const SCALE = Number(process.env.MATRIX_STAGE_SCALE ?? 1)
const DURATION_S: Record<StageId, number> = { intake: 3, readiness: 4, design: 6, automation: 11, execute: 12, deliver: 3 }

/**
 * Stage 05 isn't run by Matrix. Approval at Code review → the PR merges in
 * GitHub → the merge commit fires the Harness post-commit pipeline → Harness
 * runs the suite on HyperExecute. Matrix follows along (in production via
 * GitHub and Harness webhooks, read with the Matrix bot identity) and pulls
 * the results and artifacts when the job finishes. Phases are fractions of the stage.
 */
const EXEC_PHASES = [
  { phase: 'awaiting_merge', until: 0.2 },
  { phase: 'harness_triggered', until: 0.3 },
  { phase: 'hyperexecute_running', until: 0.85 },
  { phase: 'collecting', until: 1 },
] as const

/**
 * Stage 04: Matrix commits the scripts to the feature branch (first 40%), then the
 * branch's post-commit Harness pipeline runs them on HyperExecute, so the code
 * reviewer sees real results in the PR before approving.
 */
function updatePrChecks(p: PipelineState, startedAt: number, now: number) {
  const f = Math.min(1, (now - startedAt) / (DURATION_S.automation * 1000 * SCALE))
  const a = automationFor(p)
  const seed = createHash('sha1').update(`${p.id}:pr:${p.revisions.automation}`).digest('hex')
  const total = allTestCases(p).length
  const c = (p.prChecks = p.prChecks?.pr === a.pr ? p.prChecks : { phase: 'writing', branch: a.branch, pr: a.pr, pipeline: `${p.app.toLowerCase()}-regression-postcommit`, done: 0, total })
  c.phase = f < 0.4 ? 'writing' : f < 0.5 ? 'harness' : 'hyperexecute'
  if (f >= 0.4) {
    c.commit ??= seed.slice(0, 7)
    c.harnessExecutionId ??= 4700 + p.revisions.automation
  }
  if (f >= 0.5) {
    c.jobId ??= `he-${seed.slice(7, 15)}`
    c.done = Math.min(total, Math.floor(((f - 0.5) / 0.45) * total))
  }
}

function updateExecution(p: PipelineState, startedAt: number, now: number) {
  const f = Math.min(1, (now - startedAt) / (DURATION_S.execute * 1000 * SCALE))
  const at = (frac: number) => startedAt + frac * DURATION_S.execute * 1000 * SCALE
  const seed = createHash('sha1').update(`${p.id}:${p.revisions.automation}`).digest('hex')
  const total = allTestCases(p).length
  const pr = automationFor(p).pr
  const phase = EXEC_PHASES.find((x) => f < x.until)?.phase ?? 'collecting'
  const e = (p.execution = p.execution?.pr === pr ? p.execution : { phase, pr, branch: 'main', harness: { pipeline: `${p.app.toLowerCase()}-regression-postmerge` }, hyperexecute: { concurrency: Math.min(8, total), done: 0, total } })
  e.phase = phase
  if (f >= 0.2) {
    e.commit ??= seed.slice(0, 7)
    e.mergedAt ??= at(0.2)
    e.harness.executionId ??= 4821 + p.revisions.automation
    e.harness.triggeredAt ??= at(0.2)
  }
  if (f >= 0.3) {
    e.hyperexecute.jobId ??= `he-${seed.slice(7, 15)}`
    e.hyperexecute.startedAt ??= at(0.3)
    e.hyperexecute.done = Math.min(total, Math.floor(((f - 0.3) / 0.55) * total))
  }
  if (f >= 0.85) {
    e.hyperexecute.done = total
    e.hyperexecute.finishedAt ??= at(0.85)
  }
}
const pipelines = new Map<string, PipelineState>()

function startStage(p: PipelineState, i: number, now: number) {
  p.stages[i] = { ...p.stages[i], status: 'running', startedAt: now, endedAt: undefined }
  p.status = 'running'
  if (p.owner) {
    for (const tool of STAGE_TOOLS[p.stages[i].id] ?? []) {
      // A real invocation router would make the call here with the token, then drop it.
      try {
        void useSecret(p.owner, tool, `pipeline ${p.id} · ${p.stages[i].id}`)
      } catch {
        /* Unreadable secret: audited; a real router would fail this stage and ask the user to reconnect. */
      }
    }
  }
}

/** Moves a pipeline forward based on the clock. Safe to call any number of times. */
function advance(p: PipelineState, now = Date.now()) {
  if (p.status !== 'running') return
  const i = p.stages.findIndex((s) => s.status === 'running')
  if (i < 0) return
  const stage = p.stages[i]
  if (stage.id === 'execute') updateExecution(p, stage.startedAt!, now)
  if (stage.id === 'automation') updatePrChecks(p, stage.startedAt!, now)
  if (now - stage.startedAt! < DURATION_S[stage.id] * 1000 * SCALE) return
  if (stage.id === 'execute' && p.execution) p.execution.phase = 'done'
  if (stage.id === 'automation' && p.prChecks) Object.assign(p.prChecks, { phase: 'done', done: p.prChecks.total })

  p.stages[i] = { ...stage, status: 'done', endedAt: now }
  if (stage.id === 'readiness') p.readiness = judgeReadiness(p.frIds)

  const gateId = STAGES[i].gate
  if (gateId === 'readiness') return passReadinessIfDecided(p, now)
  if (gateId) {
    p.gates[gateId] = { status: 'waiting' }
    p.status = 'waiting'
    return
  }
  next(p, i, now)
}

function next(p: PipelineState, doneIndex: number, now: number) {
  if (doneIndex + 1 >= p.stages.length) {
    p.status = 'completed'
    p.outcome = 'delivered'
    p.completedAt = now
    return
  }
  startStage(p, doneIndex + 1, now)
}

function passReadinessIfDecided(p: PipelineState, now: number) {
  const undecided = p.frIds.some((id) => p.readiness[id]?.answer === 'uncertain' && !p.readiness[id].decision)
  if (undecided) {
    p.gates.readiness = { status: 'waiting', auto: true }
    p.status = 'waiting'
    return
  }
  const humanDecided = p.frIds.some((id) => p.readiness[id]?.decision)
  p.gates.readiness = { status: 'passed', auto: !humanDecided, at: now, by: humanDecided ? p.gates.readiness.by : 'Readiness gate' }
  if (readyFrIds(p).length === 0) {
    p.stages = p.stages.map((s) => (s.status === 'pending' ? { ...s, status: 'skipped' } : s))
    p.status = 'completed'
    p.outcome = 'nothing_ready'
    p.completedAt = now
    return
  }
  next(p, 1, now)
}

const GATE_STAGE: Record<Exclude<GateId, 'readiness'>, number> = { design: 2, code: 3, release: 4 }

function decideGate(p: PipelineState, gate: GateId, decision: string, by: string, note: string | undefined) {
  const now = Date.now()
  if (gate === 'readiness' || p.gates[gate].status !== 'waiting') return false
  const stageIndex = GATE_STAGE[gate]
  if (decision === 'approve') {
    p.gates[gate] = { status: 'passed', by, at: now, note }
    next(p, stageIndex, now)
  } else if (decision === 'changes' && gate !== 'release') {
    // Rework: the stage runs again with the reviewer's note, then waits for the same gate.
    p.gates[gate] = { status: 'changes', by, at: now, note }
    if (gate === 'design') p.revisions.design += 1
    else {
      p.revisions.automation += 1
      p.prChecks = undefined // a new commit on the branch: the PR checks run again
    }
    startStage(p, stageIndex, now)
  } else {
    p.gates[gate] = { status: 'rejected', by, at: now, note }
    p.stages = p.stages.map((s) => (s.status === 'pending' ? { ...s, status: 'skipped' } : s))
    p.status = 'completed'
    p.outcome = 'rejected'
    p.completedAt = now
  }
  return true
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

function stream(id: string, req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const p = pipelines.get(id)
  if (!p) {
    res.write(`data: ${JSON.stringify({ type: 'pipeline.failed', error: 'This pipeline is no longer available. The mock server may have restarted.' })}\n\n`)
    return res.end()
  }
  let last = ''
  const tick = () => {
    advance(p)
    const snapshot = JSON.stringify({ type: 'pipeline.state', pipeline: p })
    if (snapshot !== last) {
      res.write(`data: ${snapshot}\n\n`)
      last = snapshot
    }
    if (p.status === 'completed' || p.status === 'stopped') {
      clearInterval(timer)
      res.end()
    }
  }
  const timer = setInterval(tick, 400)
  tick()
  req.on('close', () => clearInterval(timer))
}

/**
 * One stream for many pipelines: GET /api/matrix/events?pipelines=a,b,c
 * Browsers allow ~6 open HTTP/1.1 connections per origin, so a batch of 8
 * pipelines can't each hold its own SSE connection.
 */
function streamMany(ids: string[], remIds: string[], req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const last = new Map<string, string>()
  const tick = () => {
    let live = 0
    for (const id of ids) {
      const p = pipelines.get(id)
      if (!p) {
        if (!last.has(id)) {
          res.write(`data: ${JSON.stringify({ type: 'pipeline.failed', id, error: 'This pipeline is no longer available. The mock server may have restarted.' })}\n\n`)
          last.set(id, 'failed')
        }
        continue
      }
      advance(p)
      const snapshot = JSON.stringify({ type: 'pipeline.state', pipeline: p })
      if (snapshot !== last.get(id)) {
        res.write(`data: ${snapshot}\n\n`)
        last.set(id, snapshot)
      }
      if (p.status !== 'completed' && p.status !== 'stopped') live++
    }
    for (const id of remIds) {
      const r = remediations.get(id)
      const key = `rm:${id}`
      if (!r) {
        if (!last.has(key)) {
          res.write(`data: ${JSON.stringify({ type: 'remediation.failed', id, error: 'This remediation is no longer available. The mock server may have restarted.' })}\n\n`)
          last.set(key, 'failed')
        }
        continue
      }
      advanceRemediation(r)
      const snapshot = JSON.stringify({ type: 'remediation.state', remediation: r })
      if (snapshot !== last.get(key)) {
        res.write(`data: ${snapshot}\n\n`)
        last.set(key, snapshot)
      }
      if (r.status !== 'completed' && r.status !== 'stopped') live++
    }
    if (!live) {
      clearInterval(timer)
      res.end()
    }
  }
  const timer = setInterval(tick, 400)
  tick()
  req.on('close', () => clearInterval(timer))
}

/** Returns true when the request was handled. */
export async function handleMatrixPipelines(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname
  if (!path.startsWith('/api/matrix/')) return false

  if (req.method === 'GET' && path === '/api/matrix/events') {
    const ids = (url.searchParams.get('pipelines') ?? '').split(',').filter(Boolean)
    const remIds = (url.searchParams.get('remediations') ?? '').split(',').filter(Boolean)
    streamMany(ids, remIds, req, res)
    return true
  }

  if (req.method === 'POST' && path === '/api/matrix/pipelines') {
    const owner = currentUser(req)
    if (!owner) {
      json(res, 401, { error: 'Not signed in.' })
      return true
    }
    const missing = missingConnections(owner, REQUIRED_TOOLS)
    if (missing.length) {
      json(res, 412, { error: 'Connect your accounts first.', missing })
      return true
    }
    const body = await readJson(req)
    const now = Date.now()
    const id = `mx_${Math.random().toString(36).slice(2, 10)}`
    const p: PipelineState = {
      id,
      app: body.app ?? 'ABCD',
      areaSlug: body.areaSlug,
      frIds: body.frIds ?? [],
      repo: body.repo ?? 'ABCD-TestingScript',
      env: PIPELINE_ENV, // the Harness pipeline's own configuration decides where tests run
      status: 'running',
      stages: STAGES.map((s) => ({ id: s.id, status: 'pending' })),
      gates: { readiness: { status: 'pending' }, design: { status: 'pending' }, code: { status: 'pending' }, release: { status: 'pending' } },
      readiness: {},
      revisions: { design: 1, automation: 1 },
      startedAt: now,
      owner,
    }
    startStage(p, 0, now)
    pipelines.set(id, p)
    json(res, 201, { pipelineId: id })
    return true
  }

  const m = path.match(/^\/api\/matrix\/pipelines\/([\w-]+)(\/.*)?$/)
  const p = m ? pipelines.get(m[1]) : undefined
  const rest = m?.[2] ?? ''

  if (req.method === 'GET' && m && rest === '/events') {
    stream(m[1], req, res)
    return true
  }
  if (!p) {
    json(res, 404, { error: 'not found' })
    return true
  }

  const gate = rest.match(/^\/gates\/(readiness|design|code|release)$/)
  if (req.method === 'POST' && gate) {
    const body = await readJson(req)
    const ok = decideGate(p, gate[1] as GateId, body.decision, body.by ?? 'unknown', body.note)
    json(res, ok ? 202 : 409, ok ? { ok: true } : { error: 'gate is not waiting' })
    return true
  }

  // Bulk QA decisions for uncertain stories: { decisions: { "FR-217": "ready", ... }, by }
  if (req.method === 'POST' && rest === '/readiness') {
    const body = await readJson(req)
    const decisions: Record<string, string> = body.decisions ?? {}
    for (const [frId, d] of Object.entries(decisions)) {
      const r = p.readiness[frId]
      if (r?.answer === 'uncertain' && !r.decision) {
        r.decision = d === 'ready' ? 'ready' : 'not_ready'
        r.decidedBy = body.by
      }
    }
    p.gates.readiness.by = body.by
    if (p.gates.readiness.status === 'waiting') passReadinessIfDecided(p, Date.now())
    json(res, 202, { ok: true })
    return true
  }

  const ready = rest.match(/^\/readiness\/(FR-\d+)$/)
  if (req.method === 'POST' && ready) {
    const body = await readJson(req)
    const r = p.readiness[ready[1]]
    if (!r || r.answer !== 'uncertain') {
      json(res, 409, { error: 'only uncertain stories take a QA decision' })
      return true
    }
    r.decision = body.decision === 'ready' ? 'ready' : 'not_ready'
    r.decidedBy = body.by
    p.gates.readiness.by = body.by
    if (p.gates.readiness.status === 'waiting') passReadinessIfDecided(p, Date.now())
    json(res, 202, { ok: true })
    return true
  }

  if (req.method === 'POST' && rest === '/stop') {
    if (p.status === 'running' || p.status === 'waiting') {
      p.status = 'stopped'
      p.outcome = 'stopped'
      p.completedAt = Date.now()
      p.stages = p.stages.map((s) => (s.status === 'running' ? { ...s, status: 'pending' } : s))
    }
    json(res, 202, { ok: true })
    return true
  }

  json(res, 404, { error: 'not found' })
  return true
}
