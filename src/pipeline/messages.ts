/**
 * What Matrix says in the conversation as a pipeline moves. Each function
 * compares the previous and next pipeline state and returns the turn to post
 * (and the notification to raise), or nothing.
 */
import { AREAS, coveragePct } from '../data/report'
import type { Block } from '../state/types'
import { allTestCases, automationFor, coverageDelta, deliveryFor, executionFor, readyFrIds, storyFor } from './data'
import type { PipelineState, ReadinessAnswer } from './types'

export interface Transition {
  blocks: Block[]
  notify?: { title: string; body: string; view: string; action: string }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "from 1% to 2%", or the count when rounding down hides the change. */
function coverageChange(d: ReturnType<typeof coverageDelta>) {
  const a = coveragePct(d.before.covered, d.before.total)
  const b = coveragePct(d.after.covered, d.after.total)
  const counts = `${d.before.covered} → ${d.after.covered} requirements with evidence`
  return a === b ? `${counts}; still ${b}% after rounding down` : `coverage goes from ${a}% to **${b}%** (${counts})`
}
const areaName = (p: PipelineState) => AREAS.find((a) => a.slug === p.areaSlug)?.name ?? p.areaSlug

function count(p: PipelineState, a: ReadinessAnswer) {
  return p.frIds.filter((id) => p.readiness[id]?.answer === a).length
}

function readinessSummary(p: PipelineState) {
  const parts: string[] = []
  const ready = count(p, 'ready')
  const clar = count(p, 'needs_clarification')
  const untestable = count(p, 'not_testable')
  const unsure = count(p, 'uncertain')
  if (ready) parts.push(`**${ready} ready**`)
  if (clar) parts.push(`${clar} needs clarification — feedback went to the author in Jira`)
  if (untestable) parts.push(`${untestable} not testable — sent back to the product owner`)
  if (unsure) parts.push(`${unsure} uncertain`)
  return parts.join('; ')
}

export function transitions(prev: PipelineState | undefined, next: PipelineState): Transition[] {
  const out: Transition[] = []
  const pid = next.id
  const chip = (label: string, view: string): Block => ({ type: 'chips', chips: [{ label, action: { kind: 'pipeline', id: pid, view } }] })
  const was = (g: keyof PipelineState['gates']) => prev?.gates[g].status
  const readinessDone = next.stages[1].status === 'done' && prev?.stages[1].status !== 'done'

  if (readinessDone) {
    const waiting = next.gates.readiness.status === 'waiting'
    const unsure = next.frIds.filter((id) => next.readiness[id]?.answer === 'uncertain').map((id) => storyFor(id).key)
    out.push({
      blocks: [
        { type: 'text', text: `Readiness check on ${plural(next.frIds.length, 'story', 'stories')}: ${readinessSummary(next)}.` },
        ...(waiting
          ? [
              { type: 'text' as const, text: `The readiness model wasn't confident about ${unsure.join(', ')}, so it's a QA call. Decide whether it's ready to test and I'll carry on.` },
              chip('Decide readiness', 'readiness'),
            ]
          : []),
      ],
      notify: waiting ? { title: 'Readiness needs a QA decision', body: `${next.app} · ${areaName(next)} · ${plural(unsure.length, 'story', 'stories')} uncertain`, view: 'readiness', action: 'Decide' } : undefined,
    })
  }

  if (next.gates.design.status === 'waiting' && was('design') !== 'waiting') {
    const cases = allTestCases(next)
    const stories = readyFrIds(next).length
    const revised = next.revisions.design > 1
    out.push({
      blocks: [
        {
          type: 'text',
          text: revised
            ? `Revised test design is ready: **${plural(cases.length, 'test case')}** now, including the cases added for your note.`
            : `Test design is ready for review: **${plural(cases.length, 'test case')}** across ${plural(stories, 'story', 'stories')}. Each one names the acceptance criterion it came from and the sources it used.`,
        },
        chip('Review test design', 'design'),
      ],
      notify: { title: 'Design review needs you', body: `${next.app} · ${areaName(next)} · ${plural(cases.length, 'test case')}`, view: 'design', action: 'Review' },
    })
  }

  if (next.gates.code.status === 'waiting' && was('code') !== 'waiting') {
    const a = automationFor(next)
    const ex = executionFor(next)
    const failed = ex.results.filter((r) => r.result === 'failed').length
    const flaky = ex.results.filter((r) => r.result === 'flaky').length
    const passed = ex.results.length - failed - flaky
    out.push({
      blocks: [
        {
          type: 'text',
          text: `I opened **${a.repo} PR #${a.pr}** from \`${a.branch}\` into main with ${plural(a.files.length, 'test file')} written in the repo's style. The post-commit pipeline on the branch (Harness #${next.prChecks?.harnessExecutionId}) ran them on HyperExecute: **${passed} passed**${failed ? `, ${failed} failed` : ''}${flaky ? `, ${flaky} flaky` : ''}.${failed ? ' Triage reads the failure as a likely product defect, not a broken test, so the script itself looks right.' : ''} It needs a developer's code review.`,
        },
        chip('Review the code', 'automation'),
      ],
      notify: { title: 'Code review needs you', body: `${a.repo} PR #${a.pr} · checks: ${passed}/${ex.results.length} passed`, view: 'automation', action: 'Review' },
    })
  }

  if (next.gates.release.status === 'waiting' && was('release') !== 'waiting') {
    const ex = executionFor(next)
    const passed = ex.results.filter((r) => r.result === 'passed').length
    const failed = ex.results.filter((r) => r.result === 'failed').length
    const flaky = ex.results.filter((r) => r.result === 'flaky').length
    const d = coverageDelta(next)
    const tail = [failed && `${failed} failed`, flaky && `${flaky} flaky`].filter(Boolean).join(', ')
    out.push({
      blocks: [
        {
          type: 'text',
          text: `PR #${automationFor(next).pr} is merged into main as \`${ex.commit}\`. The post-merge pipeline **${ex.harness?.pipeline} #${ex.harness?.executionId}** ran the suite on HyperExecute again (job \`${ex.runId}\`, ${ex.hyperexecute?.concurrency} in parallel, against ${ex.env}): **${passed} passed**${tail ? `, ${tail}` : ''}. ${failed ? 'Triage reads the failure as a likely product defect, not a test problem. ' : ''}Testmind re-measured ${d.area.name}: ${coverageChange(d)}.`,
        },
        chip('Review for sign-off', 'execution'),
      ],
      notify: { title: 'Release sign-off needs you', body: `${next.app} · ${passed}/${ex.results.length} passed${failed ? ` · ${failed} failed` : ''}`, view: 'execution', action: 'Review' },
    })
  }

  const finished = next.status === 'completed' && prev?.status !== 'completed'
  if (finished && next.outcome === 'delivered') {
    const dv = deliveryFor(next)
    out.push({
      blocks: [
        {
          type: 'text',
          text: `Delivered. Results are in Octane test set **${dv.octane.testSet}**, and ${dv.jira.map((j) => j.key).join(', ')} ${dv.jira.length === 1 ? 'is' : 'are'} marked Tested in Jira. Coverage is re-measured for ${coverageDelta(next).area.name} (${coverageChange(coverageDelta(next)).replace(/\*\*/g, '')}), and the report now shows it. Every result traces back to its story, criteria and gate decisions.`,
        },
        {
          type: 'chips',
          chips: [
            { label: 'Open the re-measured report', action: { kind: 'open', to: 'report' } },
            { label: 'Delivery and traceability', action: { kind: 'pipeline', id: pid, view: 'delivery' } },
          ],
        },
      ],
      notify: { title: 'Matrix delivered', body: `${next.app} · ${areaName(next)} · Octane ${dv.octane.testSet}`, view: 'delivery', action: 'Open' },
    })
  }
  if (finished && next.outcome === 'nothing_ready') {
    out.push({
      blocks: [{ type: 'text', text: 'No story passed the readiness gate, so the pipeline stopped after the readiness check. Nothing was designed or run. Once the authors update the stories, start it again.' }],
    })
  }
  if (finished && next.outcome === 'rejected') {
    const g = Object.entries(next.gates).find(([, v]) => v.status === 'rejected')
    out.push({ blocks: [{ type: 'text', text: `Release sign-off was rejected${g?.[1].note ? ` (“${g[1].note}”)` : ''}. Nothing was delivered to Octane or Jira; the PR and evidence stay as they are for reference.` }] })
  }
  return out
}
