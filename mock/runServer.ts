/**
 * Mock run backend, mounted into the Vite dev server.
 *
 * Simulates a durable analysis job and streams its progress over SSE using the
 * RunEvent shape in src/state/types.ts. A ~38-minute analysis is compressed into
 * ~30 real seconds (override with TESTMIND_RUN_SECONDS). Run state is derived
 * from the start time, so a reconnect (e.g. after a page reload) resumes where
 * the run actually is rather than starting over.
 *
 *   POST /api/runs                 { app, repoCount, mode, compare } -> { runId }
 *   GET  /api/runs/:id/events      text/event-stream
 *   POST /api/runs/:id/stop
 *   POST /api/feedback             { kind, frId, ... } -> 204
 *   /api/matrix/...               Matrix pipeline, see pipelineServer.ts
 *   /api/matrix/remediations/...  vulnerability remediation, see remediationServer.ts
 *   /api/connections/...           per-user secret store, see secretsServer.ts
 */
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleMatrixPipelines } from './pipelineServer.ts'
import { handleSecrets } from './secretsServer.ts'
import { handleRemediations } from './remediationServer.ts'

interface StepDef {
  id: string
  title: string
  description: string
  durationS: number // simulated seconds
  summary: (run: Run) => string
}

const STEPS: StepDef[] = [
  { id: 'discovery', title: 'Component discovery', description: 'Locating the application\'s components', durationS: 138, summary: (r) => `${r.repoCount} components: 4 with code, 1 automation repository` },
  { id: 'indexing', title: 'Source evidence indexing', description: 'Scanning ABCD-service, ABCD-ui, ABCD-batch and ABCD-etl', durationS: 372, summary: () => 'Indexed code and documentation in 4 components' },
  { id: 'evidence', title: 'Identifying existing test evidence', description: 'Reading ABCD-TestingScript', durationS: 276, summary: () => 'Analysed the tests in ABCD-TestingScript' },
  { id: 'matching', title: 'Matching requirements to evidence', description: 'Mapping requirements to the tests that exercise them', durationS: 900, summary: () => '657 requirements mapped across 4 components' },
  { id: 'coverage', title: 'Coverage analysis', description: 'Calculating coverage and gaps', durationS: 420, summary: () => 'Coverage and gaps calculated' },
  { id: 'report', title: 'Report preparation', description: 'Generating the final report', durationS: 180, summary: () => 'Report ready' },
]
const TOTAL_S = STEPS.reduce((s, x) => s + x.durationS, 0)
const REAL_SECONDS = Number(process.env.TESTMIND_RUN_SECONDS ?? 30)
const SPEED = TOTAL_S / REAL_SECONDS

interface Run {
  id: string
  app: string
  repoCount: number
  mode: string
  startedAt: number
  stoppedAt?: number
}

const runs = new Map<string, Run>()

function simElapsedS(run: Run, now = Date.now()) {
  const end = run.stoppedAt ?? now
  return Math.min(TOTAL_S, ((end - run.startedAt) / 1000) * SPEED)
}

function snapshot(run: Run) {
  const t = simElapsedS(run)
  let acc = 0
  for (let i = 0; i < STEPS.length; i++) {
    if (t < acc + STEPS[i].durationS) {
      return { stepIndex: i, stepPct: (t - acc) / STEPS[i].durationS, elapsedS: t, done: false }
    }
    acc += STEPS[i].durationS
  }
  return { stepIndex: STEPS.length, stepPct: 0, elapsedS: TOTAL_S, done: true }
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

function streamEvents(run: Run | undefined, req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const send = (event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`)

  if (!run) {
    send({ type: 'run.failed', error: 'This run is no longer available. The mock server may have restarted.' })
    return res.end()
  }

  send({
    type: 'run.started',
    runId: run.id,
    app: run.app,
    repoCount: run.repoCount,
    mode: run.mode,
    steps: STEPS.map(({ id, title, description }) => ({ id, title, description })),
  })

  let sentThrough = -1 // index of the last step we sent step.completed for
  let started = -1
  const tick = () => {
    const snap = snapshot(run)
    for (let i = sentThrough + 1; i < Math.min(snap.stepIndex, STEPS.length); i++) {
      if (started < i) send({ type: 'step.started', stepId: STEPS[i].id })
      send({ type: 'step.completed', stepId: STEPS[i].id, durationMs: STEPS[i].durationS * 1000, summary: STEPS[i].summary(run) })
      sentThrough = i
      started = i
    }
    if (!snap.done && started < snap.stepIndex) {
      send({ type: 'step.started', stepId: STEPS[snap.stepIndex].id })
      started = snap.stepIndex
    }
    const pct = Math.round((snap.elapsedS / TOTAL_S) * 100)
    if (!snap.done) {
      send({ type: 'step.progress', stepId: STEPS[snap.stepIndex].id, pct: Math.round(snap.stepPct * 100), detail: STEPS[snap.stepIndex].description })
    }
    send({ type: 'run.progress', pct, elapsedMs: Math.round(snap.elapsedS * 1000) })

    if (run.stoppedAt) {
      send({ type: 'run.stopped' })
      return finish()
    }
    if (snap.done) {
      send({ type: 'run.completed', reportId: `report-${run.id}`, completedAt: run.startedAt + REAL_SECONDS * 1000 })
      return finish()
    }
  }
  const timer = setInterval(tick, 400)
  const finish = () => {
    clearInterval(timer)
    res.end()
  }
  tick()
  req.on('close', () => clearInterval(timer))
}

export function mockApi(): Plugin {
  return {
    name: 'matrix-mock-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()
        if (await handleSecrets(req, res, url)) return
        if (await handleRemediations(req, res, url)) return
        if (await handleMatrixPipelines(req, res, url)) return

        if (req.method === 'POST' && url.pathname === '/api/runs') {
          const body = await readJson(req)
          const id = `run_${Math.random().toString(36).slice(2, 10)}`
          runs.set(id, {
            id,
            app: body.app ?? 'ABCD',
            repoCount: body.repoCount ?? 5,
            mode: body.mode ?? 'cached',
            startedAt: Date.now(),
          })
          return json(res, 201, { runId: id })
        }

        const events = url.pathname.match(/^\/api\/runs\/([\w-]+)\/events$/)
        if (req.method === 'GET' && events) return streamEvents(runs.get(events[1]), req, res)

        const stop = url.pathname.match(/^\/api\/runs\/([\w-]+)\/stop$/)
        if (req.method === 'POST' && stop) {
          const run = runs.get(stop[1])
          if (!run) return json(res, 404, { error: 'not found' })
          run.stoppedAt ??= Date.now()
          return json(res, 202, { ok: true })
        }

        if (req.method === 'POST' && url.pathname === '/api/feedback') {
          const body = await readJson(req)
          server.config.logger.info(`[matrix feedback] ${JSON.stringify(body)}`)
          return json(res, 204)
        }

        json(res, 404, { error: 'not found' })
      })
    },
  }
}
