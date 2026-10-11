/**
 * Prototype fixtures for Matrix. Deterministic so the same selection always
 * produces the same stories, readiness answers, test cases and results.
 */
import { AREAS, REPORT, findRequirement, type Requirement } from '../data/report'
import { stepsThrough, testFileFor } from '../data/components'
import type { PipelineState, ReadinessResult } from './types'

export interface Story {
  key: string
  frId: string
  title: string
  req: Requirement
}

export function storyFor(frId: string): Story {
  const req = findRequirement(frId)!
  const n = Number(frId.replace('FR-', ''))
  return { key: `${REPORT.app}-${1207 + n}`, frId, title: req.title, req }
}

// Readiness answers cycle through the four outcomes by position in the batch,
// so a typical five-story batch shows every path through the readiness gate.
const READINESS: ReadinessResult[] = [
  { answer: 'ready', confidence: 0.94, judge: 'model', reason: 'Acceptance criteria are complete and each one is observable.' },
  { answer: 'ready', confidence: 0.91, judge: 'model', reason: 'Criteria are testable; linked Confluence page defines the error messages.' },
  { answer: 'needs_clarification', confidence: 0.88, judge: 'model', reason: 'No acceptance criterion says what happens after the cut-off time.' },
  { answer: 'uncertain', confidence: 0.62, judge: 'llm', reason: 'Criteria reference a template that isn’t linked. The readiness skill could not confirm the expected output.' },
  { answer: 'not_testable', confidence: 0.85, judge: 'model', reason: 'Describes an infrastructure retry policy with no functional outcome to assert.' },
]

export function judgeReadiness(frIds: string[]): Record<string, ReadinessResult> {
  return Object.fromEntries(frIds.map((id, i) => [id, { ...READINESS[i % READINESS.length] }]))
}

/** Stories that pass the readiness gate. */
export function readyFrIds(p: Pick<PipelineState, 'frIds' | 'readiness'>) {
  return p.frIds.filter((id) => {
    const r = p.readiness[id]
    return r && (r.answer === 'ready' || (r.answer === 'uncertain' && r.decision === 'ready'))
  })
}

export interface Criterion {
  id: string
  text: string
}

export function criteriaFor(story: Story): Criterion[] {
  if (story.frId === 'FR-214') {
    return [
      { id: 'AC1', text: 'An instruction missing a mandatory field is rejected before submission.' },
      { id: 'AC2', text: 'A missing account number returns “Account number is mandatory”.' },
      { id: 'AC3', text: 'A valid instruction that breaks a business rule is held, not submitted.' },
    ]
  }
  const t = story.title.charAt(0).toLowerCase() + story.title.slice(1)
  return [
    { id: 'AC1', text: `The system can ${t} for a valid request.` },
    { id: 'AC2', text: `An invalid request to ${t} is rejected with a clear error.` },
  ]
}

export interface TestCase {
  id: string
  storyKey: string
  criterion: string
  title: string
  steps: string[]
  expected: string
  sources: string[]
  addedInRevision?: number
}

export function testCasesFor(story: Story, revision: number): TestCase[] {
  const crit = criteriaFor(story)
  const num = story.key.split('-')[1]
  const src = story.req.file.split('/').pop()
  const out: TestCase[] = []
  crit.forEach((c) => {
    out.push({
      id: '',
      storyKey: story.key,
      criterion: c.id,
      title: c.text.replace(/\.$/, ''),
      steps: stepsThrough(story.req.components),
      expected: c.text,
      sources: [`${story.key} ${c.id}`, `${src} L${story.req.lines}`],
    })
  })
  if (story.frId === 'FR-214') {
    out.splice(1, 0, {
      id: '',
      storyKey: story.key,
      criterion: 'AC1',
      title: 'Each mandatory field is checked independently',
      steps: ['For each mandatory field, blank only that field', 'Submit the instruction', 'Check the rejection names that field'],
      expected: 'Every mandatory field produces its own rejection reason.',
      sources: [`${story.key} AC1`, 'settlement-rules.md §3.2'],
    })
  }
  if (revision > 1) {
    out.push({
      id: '',
      storyKey: story.key,
      criterion: crit[crit.length - 1].id,
      title: 'Boundary case added after design review',
      steps: ['Use the boundary value named in the review note', 'Submit the request', 'Check the outcome matches the criterion'],
      expected: crit[crit.length - 1].text,
      sources: [`${story.key} ${crit[crit.length - 1].id}`, 'Design review note'],
      addedInRevision: revision,
    })
  }
  return out.map((tc, i) => ({ ...tc, id: `TC-${num}-${String(i + 1).padStart(2, '0')}` }))
}

export function allTestCases(p: PipelineState) {
  return readyFrIds(p).flatMap((id) => testCasesFor(storyFor(id), p.revisions.design))
}

export function testStem(story: Story) {
  return story.req.file.split('/').pop()!.replace('Handler.java', '').replace('.java', '').replace('Validator', 'Validation')
}

export function automationFor(p: PipelineState) {
  const files = readyFrIds(p).map((id) => {
    const s = storyFor(id)
    const cases = testCasesFor(s, p.revisions.design).length
    return { path: testFileFor(s.req, testStem(s)), added: 38 + cases * 26, story: s.key, cases, components: s.req.components }
  })
  const area = AREAS.find((a) => a.slug === p.areaSlug)
  return {
    pr: 482 + (p.revisions.automation - 1),
    branch: `matrix/${p.app.toLowerCase()}-${p.areaSlug.split('-')[0]}-gaps`,
    title: `Add tests for ${files.length} ${area?.name.toLowerCase() ?? ''} ${files.length === 1 ? 'story' : 'stories'}`,
    repo: p.repo,
    files,
    checks: [
      { name: 'Build', ok: true },
      { name: 'Repo conventions (mined from ABCD-TestingScript)', ok: true },
      { name: 'Every test cites its criterion', ok: true },
    ],
  }
}

export const FR214_TEST_EXCERPT = [
  '@Test',
  '@Criterion("ABCD-1421 AC2")',
  'void missingAccountNumberIsRejected() {',
  '    var instr = validInstruction().withAccountNumber(null);',
  '    var result = validator.validate(instr);',
  '    assertThat(result.isError()).isTrue();',
  '    assertThat(result.message())',
  '        .isEqualTo("Account number is mandatory");',
  '}',
]

export type TestResult = 'passed' | 'failed' | 'flaky'

export function executionFor(p: PipelineState) {
  const cases = allTestCases(p)
  const results = cases.map((tc, i) => {
    let result: TestResult = 'passed'
    let triage: string | undefined
    if (tc.storyKey === `${p.app}-1421` && tc.criterion === 'AC2') {
      result = 'failed'
      triage = 'Likely product defect: the service returns “Account number is required”, the criterion says “Account number is mandatory”. Either the code or the story wording needs to change.'
    } else if (i === cases.length - 1 && cases.length > 4) {
      result = 'flaky'
      triage = 'Passed on retry. The first attempt timed out waiting for the SIT settlement stub, so this is environment noise rather than a product problem.'
    }
    return { tc, result, durationMs: 800 + ((i * 377) % 2400), triage }
  })
  const e = p.execution
  return {
    runId: e?.hyperexecute.jobId ?? 'HyperExecute job',
    env: p.env,
    commit: e?.commit,
    harness: e?.harness,
    hyperexecute: e?.hyperexecute,
    results,
    evidence: [
      { name: 'HyperExecute job logs', kind: 'log', hash: 'sha256:4be1…9a07' },
      { name: 'Screenshots and videos (12)', kind: 'zip', hash: 'sha256:c03d…11fe' },
      { name: 'JUnit XML report', kind: 'xml', hash: 'sha256:77a2…e4b3' },
      { name: 'Harness execution summary', kind: 'json', hash: 'sha256:e81f…20c6' },
    ],
  }
}

/** Testmind re-measures after the run: each delivered story's requirement now has evidence. */
export function coverageDelta(p: PipelineState) {
  const area = AREAS.find((a) => a.slug === p.areaSlug)!
  const gained = readyFrIds(p).length
  return {
    area,
    before: { covered: area.covered, total: area.total },
    after: { covered: area.covered + gained, total: area.total },
    overallBefore: REPORT.covered,
    overallAfter: REPORT.covered + gained,
    gained,
  }
}

export function deliveryFor(p: PipelineState) {
  return {
    octane: { testSet: `TS-${58210 + p.revisions.automation}`, name: `${p.app} ${AREAS.find((a) => a.slug === p.areaSlug)?.name} · Matrix` },
    jira: readyFrIds(p).map((id) => ({ key: storyFor(id).key, status: 'Tested' })),
    attestation: 'sha256:9f2c…41d8',
  }
}
