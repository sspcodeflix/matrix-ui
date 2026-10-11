/** What Matrix says in the conversation as a remediation moves, and when to notify. */
import type { Block } from '../state/types'
import { findRequirement } from '../data/report'
import { TEST_REPO } from '../data/components'
import { person } from '../team/roster'
import { SEVERITY_ORDER, SEV_LABEL, findingById, gapTests, prLabel, remPrs, remTests } from './data'
import { remStageIndex, type RemediationState } from './types'

export interface RemTransition {
  blocks: Block[]
  /** `to` = teammates to notify instead of the owner. */
  notify?: { title: string; body: string; view: string; action: string; to?: string[] }
}

const frList = (ids: string[]) => ids.map((id) => `${id} (${findRequirement(id)?.title ?? 'requirement'})`).join('; ')
const names = (ids: string[]) => ids.map((id) => person(id).name).join(', ')

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function severitySummary(ids: string[]) {
  const counts = SEVERITY_ORDER.map((s) => [s, ids.filter((id) => findingById(id)?.severity === s).length] as const).filter(([, n]) => n)
  return counts.map(([s, n]) => `${n} ${SEV_LABEL[s].toLowerCase()}`).join(', ')
}

export function remTransitions(prev: RemediationState | undefined, next: RemediationState): RemTransition[] {
  const out: RemTransition[] = []
  const id = next.id
  const chip = (label: string, view: string): Block => ({ type: 'chips', chips: [{ label, action: { kind: 'remediation', id, view } }] })
  const was = (g: keyof RemediationState['gates']) => prev?.gates[g].status

  const discovered = next.stages[0]?.status === 'done' && prev?.stages[0]?.status !== 'done'
  if (discovered && next.findings.length) {
    out.push({
      blocks: [
        {
          type: 'text',
          text:
            next.mode === 'import'
              ? `Matched **${plural(next.findings.length, 'finding')}** in ${next.app}'s components to the IDs you gave me (${severitySummary(next.findings)}).${next.unmatched.length ? ` ${next.unmatched.join(', ')} matched nothing in the code, so there's nothing to fix for ${next.unmatched.length === 1 ? 'it' : 'them'}.` : ''}`
              : `The scan found **${plural(next.findings.length, 'vulnerability', 'vulnerabilities')}** across ${new Set(next.findings.map((f) => findingById(f)?.repo)).size} of ${next.app}'s components (${severitySummary(next.findings)}) in code, dependencies and secrets. Triaging them now.`,
        },
      ],
    })
  }
  if (next.status === 'completed' && next.outcome === 'nothing_found' && prev?.status !== 'completed') {
    out.push({ blocks: [{ type: 'text', text: `None of those IDs (${next.imported.join(', ')}) match anything in ${next.app}'s components, so there's nothing to remediate. If you expected a match, the scanner may need a rule for it.` }] })
  }

  if (next.gates.triage.status === 'waiting' && was('triage') !== 'waiting') {
    const fp = next.findings.filter((f) => findingById(f)?.triage.verdict === 'false_positive')
    out.push({
      blocks: [
        {
          type: 'text',
          text: `Triage is ready. I recommend fixing **${plural(next.findings.length - fp.length, 'finding')}**${fp.length ? ` and dismissing ${plural(fp.length, 'false positive')} (${fp.map((f) => findingById(f)?.title).join('; ')})` : ''}. Confirm what to fix: nothing is changed until you do.`,
        },
        chip('Review triage', 'findings'),
      ],
      notify: { title: 'Triage review needs you', body: `${next.app} · ${plural(next.findings.length, 'finding')}`, view: 'findings', action: 'Review' },
    })
  }

  const cov = next.coverage
  if (cov && next.gates.coverage.status === 'waiting' && was('coverage') !== 'waiting') {
    const open = cov.gaps.filter((id) => !cov.closed.includes(id))
    out.push({
      blocks: [
        {
          type: 'text',
          text: `The fixes are on \`${next.branch}\`, but I haven't raised ${remPrs(next).length === 1 ? 'the PR' : 'the PRs'} yet. These fixes change behaviour behind **${plural(cov.impacted.length, 'requirement')}**, and **${open.length} of them ${open.length === 1 ? 'has' : 'have'} no full test** in ${TEST_REPO}: ${frList(open)}. Without those tests the PR checks would pass even if a fix broke that behaviour. I can write the missing tests, or you can ask a developer to.`,
        },
        chip('Review coverage gaps', 'coverage'),
      ],
      notify: { title: 'Coverage gaps need you', body: `${plural(open.length, 'requirement')} untested before the PR`, view: 'coverage', action: 'Review' },
    })
  }
  if (cov?.requested && cov.requested.at !== prev?.coverage?.requested?.at) {
    out.push({
      blocks: [{ type: 'text', text: `Asked ${names(cov.requested.to)} to add tests for the coverage gaps. The PR waits until the tests are on the branch, or until someone accepts going ahead without them.`, tone: 'secondary' }],
      notify: { title: `${person(next.owner ?? 'sp').name} asked you to add tests`, body: `${next.app} · ${plural(cov.gaps.length, 'requirement')} untested before a security fix PR`, view: 'coverage', action: 'Open', to: cov.requested.to },
    })
  }
  const coverageDone = next.stages[remStageIndex('coverage')]?.status === 'done' && prev?.stages[remStageIndex('coverage')]?.status !== 'done'
  const open = cov ? cov.gaps.filter((id) => !cov.closed.includes(id)) : []
  const accepted = was('coverage') === 'waiting' && next.gates.coverage.status === 'passed' && open.length > 0
  if (cov && next.gates.coverage.status === 'passed' && ((coverageDone && !open.length) || accepted)) {
    const raising = remPrs(next).length === 1 ? `Raising ${prLabel(next)}` : `Raising ${remPrs(next).length} PRs, one per repository`
    const text = next.gates.coverage.auto
      ? `Coverage check passed: existing tests in ${TEST_REPO} cover ${cov.impacted.length === 1 ? 'the requirement' : cov.impacted.length === 2 ? 'both requirements' : `all ${cov.impacted.length} requirements`} ${next.fix.length === 1 ? 'this fix touches' : 'these fixes touch'} (${cov.impacted.join(', ')}). ${raising} and starting the post-commit checks.`
      : open.length
        ? `Going ahead without tests for ${plural(open.length, 'requirement')} (${open.join(', ')}), as ${next.gates.coverage.by === 'You' ? 'you' : next.gates.coverage.by} decided. The reason is on record${next.gates.coverage.note ? ` (“${next.gates.coverage.note}”)` : ''}. ${raising}.`
        : cov.closedBy === 'matrix'
          ? `Wrote **${plural(gapTests(next).length, 'test')}** for ${plural(cov.closed.length, 'requirement')} in ${TEST_REPO} on \`${next.branch}\`, in the style of each component's existing tests. The coverage check passes now. ${raising}.`
          : `${next.gates.coverage.by} added tests for ${plural(cov.closed.length, 'requirement')}. The coverage check passes now. ${raising}.`
    out.push({ blocks: [{ type: 'text', text }] })
  }

  if (next.gates.code.status === 'waiting' && was('code') !== 'waiting') {
    const tests = remTests(next)
    const prs = remPrs(next)
    const extra = gapTests(next).length
    out.push({
      blocks: [
        {
          type: 'text',
          text: `${prs.length === 1 ? `**${prLabel(next)}** is` : `**${prs.length} PRs** are`} open from \`${next.branch}\` into \`${next.base}\` (${prs.map((p) => `${p.repo} #${p.number}`).join(', ')}): ${plural(next.fix.length, 'patch', 'patches')}, ${plural(tests.length, 'security test')}${extra ? ` and ${plural(extra, 'functional test')} for the coverage gaps` : ''}. The post-commit pipeline passed: Harness #${next.prChecks?.harnessExecutionId} ran ${next.prChecks?.total}/${next.prChecks?.total} tests on HyperExecute, including the existing tests for the requirements the fixes touch, and the branch re-scan is clean. It needs a developer's code review.`,
        },
        chip('Review the PRs', 'fixes'),
      ],
      notify: { title: 'Code review needs you', body: `${prLabel(next)} into ${next.base} · checks passed`, view: 'fixes', action: 'Review' },
    })
  }

  if (next.gates.release.status === 'waiting' && was('release') !== 'waiting') {
    const v = next.postMerge
    out.push({
      blocks: [
        {
          type: 'text',
          text: `${prLabel(next)} ${remPrs(next).length === 1 ? 'is' : 'are'} merged into \`${next.base}\` (head \`${next.mergeCommit}\`). The post-merge pipeline (Harness #${v?.harnessExecutionId}) ran the **full automation suite**, ${plural(v?.total ?? 0, 'test')}, on HyperExecute (job \`${v?.jobId}\`): all passed, and a re-scan of ${next.base} confirms **${next.fix.length} of ${next.fix.length}** findings are gone.`,
        },
        chip('Review for sign-off', 'merge'),
      ],
      notify: { title: 'Release sign-off needs you', body: `Merged into ${next.base} · full suite passed`, view: 'merge', action: 'Review' },
    })
  }

  const finished = next.status === 'completed' && prev?.status !== 'completed'
  if (finished && next.outcome === 'resolved') {
    out.push({
      blocks: next.fix.length
        ? [
            { type: 'text', text: `Remediated **${plural(next.fix.length, 'vulnerability', 'vulnerabilities')}** on \`${next.base}\`. The findings are closed in the scanner, with an attestation linking each fix to its PR, tests and both re-scans.${gapTests(next).length ? ` The ${plural(gapTests(next).length, 'functional test')} written for the coverage gaps stay in ${TEST_REPO}, so those requirements now count as covered.` : ''}${next.dismissed.length ? ` ${plural(next.dismissed.length, 'finding')} dismissed at triage stay on record.` : ''}` },
            chip('Open the summary', 'delivery'),
          ]
        : [{ type: 'text', text: 'Every finding was dismissed at triage, so nothing was changed. The dismissals are on record with your reasons.' }],
      notify: next.fix.length ? { title: 'Vulnerabilities remediated', body: `${next.app} · ${plural(next.fix.length, 'fix', 'fixes')} delivered`, view: 'delivery', action: 'Open' } : undefined,
    })
  }
  if (finished && next.outcome === 'rejected') {
    out.push({ blocks: [{ type: 'text', text: `Release sign-off was rejected. The fix is merged into ${next.base}, but nothing was marked resolved in the scanner. Revert the PRs in GitHub if they shouldn't stay.` }] })
  }
  return out
}

/** The assistant turn that offers remediation (also used by the chat agent). */
export function remediationIntro(imported: string[]): Block[] {
  return [
    {
      type: 'text',
      text: imported.length
        ? `I'll match ${imported.join(', ')} against ABCD's components, propose a fix for each match and write security tests that try the attack. Before raising a PR I check that tests cover what each fix changes, and help close any gaps. You approve at **Triage review**, **Code review** and **Release sign-off**.`
        : "I'll scan ABCD's four components for vulnerabilities in code, dependencies and secrets, triage them, propose a fix for each and write security tests that try the attack. Before raising a PR I check that tests cover what each fix changes, and help close any gaps. After merge, the full automation suite runs. You approve at **Triage review**, **Code review** and **Release sign-off**.",
    },
    { type: 'remScope', imported },
  ]
}

