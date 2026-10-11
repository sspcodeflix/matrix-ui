/**
 * Canned agent for the prototype. Answers from the ABCD fixture so every screen
 * in the handoff is reachable from the conversation. Swap for the real chat
 * stream (useChat / assistant-ui) once the backend exists.
 */
import { AREAS, REPORT, componentBreakdown, findArea, findRequirement, uncoveredCount } from '../data/report'
import { CODE_COMPONENTS, TEST_REPO } from '../data/components'
import type { Block, Chip, Conversation, RunState } from './types'
import { FINDINGS, SEV_LABEL, approach, findingFromText, parseIds, type Finding } from '../remediation/data'
import { remediationIntro } from '../remediation/messages'
import { WORKSPACES, workspace, workspaceInText } from '../data/workspaces'

export interface Reply {
  blocks: Block[]
  /** Panel to open alongside the reply. */
  open?: { to: 'report' | 'area' | 'requirement'; id?: string }
  /** Marks this reply as answered while a run was in progress. */
  duringRun?: boolean
  /** Put a fix agreed in chat on a feature branch with a PR. */
  apply?: { findingId: string; variant: number }
  /** App workspace named in the message; becomes the conversation's workspace. */
  setApp?: string
}

const say = (label: string, text = label): Chip => ({ label, action: { kind: 'say', text } })
const ANALYSE_ABCD = say('Analyse ABCD', 'Analyse the functional coverage for ABCD.')

export function scopeLabel(run: Pick<RunState, 'repoScope' | 'repoCount' | 'mode'>) {
  const repos = `all ${run.repoCount} components`
  const mode = run.mode === 'fresh' ? 'fresh analysis' : 'accurate and cached mode'
  return `${repos}, ${mode}`
}

function componentGapLine() {
  return componentBreakdown()
    .map((c) => `${c.id} ${c.notCovered + c.partial}`)
    .join(', ')
}

export function completionReply(run: RunState): Block[] {
  const reconcile = run.askedDuringRun
  const text = reconcile
    ? `The analysis for ${run.app} is complete. Coverage is low: of **${REPORT.requirements} functional requirements**, ${REPORT.covered} have matching test evidence and ${REPORT.partial} have partial evidence. The picture held: ABCD-TestingScript carries all of the matched tests, and ABCD-service has the most requirements without any. The largest gap is **Payments processing**, with 182 of 184 requirements uncovered.`
    : `The analysis for ${run.app} is complete. Coverage is low: of **${REPORT.requirements} functional requirements**, ${REPORT.covered} have matching test evidence and ${REPORT.partial} have partial evidence — ${REPORT.notCovered} have none. The largest gaps are in **Payments processing** (182 of 184 requirements uncovered) and **Validation & exception handling** (118 of 121). The gaps run across all four code components: ${componentGapLine()}.`
  const chips: Chip[] = reconcile
    ? [say('Show me the biggest gaps', 'Show me the biggest gap in payments processing.'), { label: 'Close all gaps with Matrix', action: { kind: 'batch' } }, say('Split by component', 'Show the split by component.'), say(`Compare with ${REPORT.previousScan.replace(' 2026', '')} scan`)]
    : [say('Show me the biggest gaps', 'Show me the biggest gap in payments processing.'), { label: 'Close all gaps with Matrix', action: { kind: 'batch' } }, say('Split by component', 'Show the split by component.'), say('Explain how coverage is calculated')]
  return [
    { type: 'runDone', runId: run.id },
    { type: 'text', text },
    { type: 'artifact', runId: run.id },
    { type: 'chips', chips },
  ]
}

/** Requests that only make sense inside one application's workspace. */
const NEEDS_WORKSPACE = /analy[sz]e|\bscan|coverage|\bgaps?\b|vulnerab|\bcwe-|\bcve-|remediat|security|repositor|requirement|\bfr-?\d|\bvuln-|\bfix\b|test(s|ed|ing)?\b|untested/

export function reply(input: string, convo: Conversation, run: RunState | undefined): Reply {
  const r = replyInWorkspace(input, convo, run)
  const named = workspaceInText(input)
  return named && !convo.app ? { ...r, setApp: named } : r
}

function replyInWorkspace(input: string, convo: Conversation, run: RunState | undefined): Reply {
  const text = input.trim()
  const t = text.toLowerCase()
  const ws = convo.app ?? workspaceInText(text)

  if (NEEDS_WORKSPACE.test(t)) {
    // No workspace yet: ask, then carry on with this same request.
    if (!ws) {
      return {
        blocks: [
          { type: 'text', text: 'Which **app workspace** should I use? I work inside one application at a time: its repositories, Jira project, test management and pipelines.' },
          { type: 'chips', chips: WORKSPACES.map((w) => ({ label: `${w.id} · ${w.ready ? 'ready' : 'not set up'}`, action: { kind: 'workspace', app: w.id, then: text } })) },
        ],
      }
    }
    if (!workspace(ws)?.ready) {
      return {
        blocks: [
          { type: 'text', text: `The **${ws}** workspace isn't set up in this prototype, so I have no repositories, requirements or findings for it yet. Only ABCD has data. In the real product, setting it up would connect its repositories and run the first scan.` },
          { type: 'chips', chips: [{ label: 'Use the ABCD workspace instead', action: { kind: 'workspace', app: 'ABCD', then: text.replace(new RegExp(`\\b${ws}\\b`, 'gi'), 'ABCD') } }] },
        ],
      }
    }
  }
  const app = ws ?? REPORT.app
  const hasReport = run?.status === 'completed'
  const running = run?.status === 'running'

  // Interactive remediation: talk through one finding, then put it on a branch.
  const interactive = interactiveFix(text, convo)
  if (interactive) return interactive

  // Vulnerability remediation (scan, or pasted CWE / CVE IDs)
  if (/vulnerab|\bcwe-|\bcve-|security (fix|issue|finding)|remediat|sast|owasp|log4shell/.test(t)) {
    return { blocks: remediationIntro(parseIds(text)) }
  }

  // Start an analysis
  // "Find the coverage gaps" before there's a report means the same thing.
  const findGaps = !hasReport && /\b(find|measure|identify)\b/.test(t) && /(coverage|gaps?)/.test(t) && !/vulnerab|security|cwe|cve/.test(t)
  if ((findGaps || /\b(analy[sz]e|scan|run)\b/.test(t)) && /(coverage|abcd|application|app|gaps?)/.test(t) && !/split|repositor(y|ies) hold|by component/.test(t)) {
    if (running) {
      return { blocks: [{ type: 'text', text: `An analysis of ${run!.app} is already running (${run!.pct}%). I'll let you know when the report is ready — you can keep asking questions in the meantime.` }] }
    }
    return {
      blocks: [
        { type: 'text', text: `${app} has **${CODE_COMPONENTS.length} code components** (${CODE_COMPONENTS.map((c) => c.id).join(', ')}) and its automation repository, **${TEST_REPO}**. I'll map every functional requirement to the components that implement it, then look for tests in ${TEST_REPO} that exercise it. Two quick choices first:` },
        { type: 'scope', app },
      ],
    }
  }

  // Questions while the run is still going: answer from partial results.
  if (running) {
    const step = run!.steps.findIndex((s) => s.status === 'running') + 1 || run!.steps.filter((s) => s.status === 'done').length
    if (/repositor|component|tests?\b|evidence/.test(t)) {
      return {
        duringRun: true,
        blocks: [{ type: 'text', text: `So far, all of the matched test evidence sits in **${TEST_REPO}**, and none of it reaches ABCD-batch or ABCD-etl beyond smoke tests. Matching is still running (step ${step} of ${run!.steps.length}), so the counts will move. The report will carry the final split by component, and I'll flag it if that picture changes.` }],
      }
    }
    return {
      duringRun: true,
      blocks: [{ type: 'text', text: `I can only answer from partial results until the analysis finishes (step ${step} of ${run!.steps.length}, ${run!.pct}%). Ask me about components or test evidence found so far, or wait for the report and I'll have the full picture.` }],
    }
  }

  if (/similar requirements|similar to/.test(t)) {
    if (!hasReport) return needReport(app)
    return {
      blocks: [
        { type: 'text', text: 'Four requirements describe closely related settlement validation: **FR-226** (Validate beneficiary bank code), **FR-219** (Reject duplicate payment reference), **FR-220** (Apply cut-off time rules) and **FR-222** (Calculate settlement date). None of them has test evidence either, so a single settlement-validation test suite would likely close several gaps at once.' },
        { type: 'chips', chips: [say('Explain FR-226'), { label: 'Back to the payments gap', action: { kind: 'open', to: 'area', id: 'payments-processing' } }] },
      ],
    }
  }

  if (/related test|test cases related|search for test/.test(t)) {
    if (!hasReport) return needReport(app)
    return {
      blocks: [{ type: 'text', text: `I searched ${TEST_REPO} for tests that call the ABCD-service validation API or assert on its error messages, and for ABCD-ui tests of the settlement form. Nothing references it. The closest match is \`SettlementSmokeTest\` in ABCD-TestingScript, which submits a valid instruction end to end but never exercises the validation failures — so it doesn't count as evidence for FR-214.` }],
    }
  }

  // Requirement by ID
  const fr = text.match(/FR-?\s?(\d{2,4})/i)
  if (fr) {
    const id = `FR-${fr[1]}`
    if (!hasReport) return needReport(app)
    const req = findRequirement(id)
    if (!req) return { blocks: [{ type: 'text', text: `I couldn't find **${id}** in the ${app} report. Requirement IDs in this report run from FR-101 to FR-938.` }] }
    if (req.id === 'FR-214') {
      return {
        open: { to: 'requirement', id: req.id },
        blocks: [
          { type: 'text', text: `**FR-214 — Validate settlement instruction** is a high-priority requirement in Payments processing with no matching test evidence in ${TEST_REPO}. It runs through two components: the settlement form in ABCD-ui and the validation in ABCD-service (\`SettlementValidator.java\`, lines 120–210). No test exercises either. If the mapping looks wrong to you, flag it from the panel and it goes back to the matching pipeline for review.` },
          { type: 'chips', chips: [{ label: 'Close with Matrix', action: { kind: 'handoff', areaSlug: 'payments-processing', frIds: ['FR-214'] } }, say('Find similar requirements', 'Find requirements similar to FR-214.'), say('Search for related test cases', 'Search for test cases related to FR-214.'), { label: 'Back to the payments gap', action: { kind: 'open', to: 'area', id: 'payments-processing' } }] },
        ],
      }
    }
    const status = req.status === 'covered' ? `is covered by ${req.evidence}` : req.status === 'partial' ? `has partial test evidence (${req.evidence})` : 'has no matching test evidence'
    return {
      open: { to: 'requirement', id: req.id },
      blocks: [
        { type: 'text', text: `**${req.id} — ${req.title}** is a ${req.priority.toLowerCase()}-priority requirement in ${req.area}. It ${status}. It runs through ${req.components.join(' and ')}; the main logic is in \`${req.file.split('/').pop()}\` in ${req.repo}. I've opened it in the panel.` },
        { type: 'chips', chips: [{ label: `Back to ${req.area}`, action: { kind: 'open', to: 'area', id: req.areaSlug } }] },
      ],
    }
  }

  if (/close (all|every)|all (the )?(coverage )?gaps|in one go/.test(t)) {
    if (!hasReport) return needReport(app)
    return {
      blocks: [
        { type: 'text', text: 'I can run one Matrix pipeline per functional area, side by side, covering every requirement that still has no full test evidence. The gates stay with you, but you can decide them **in bulk** from one batch view instead of area by area.' },
        { type: 'batchScope' },
      ],
    }
  }

  // Hand gaps to Matrix (the store builds the hand-off turn from the chip action)
  if (/matrix|close (the |these )?gaps|automate|write tests|generate tests/.test(t)) {
    if (!hasReport) return needReport(app)
    return {
      blocks: [
        { type: 'text', text: 'Matrix picks up where the gap analysis stops: readiness, test design, automation and execution, with your approval at each gate. Which gaps should it take?' },
        {
          type: 'chips',
          chips: [
            { label: 'All gaps, in one go', action: { kind: 'batch' } },
            { label: 'Top 5 in Payments processing', action: { kind: 'handoff', areaSlug: 'payments-processing', frIds: [] } },
            { label: 'Top 5 in Validation & exception handling', action: { kind: 'handoff', areaSlug: 'validation-exception-handling', frIds: [] } },
            { label: 'Pick them from the list', action: { kind: 'open', to: 'area', id: 'payments-processing' } },
          ],
        },
      ],
    }
  }

  // Gaps
  if (/gap|payments|uncovered|untested|not covered/.test(t)) {
    if (!hasReport) return needReport(app)
    if (/untested|areas/.test(t) && !/payments/.test(t)) {
      const top = [...AREAS].sort((a, b) => uncoveredCount(b) - uncoveredCount(a)).slice(0, 3)
      return {
        open: { to: 'report' },
        blocks: [
          { type: 'text', text: `Every functional area has gaps, but three stand out: ${top.map((a) => `**${a.name}** (${uncoveredCount(a)} of ${a.total} uncovered)`).join(', ')}. The full list is in the report panel, most uncovered first.` },
          { type: 'chips', chips: [say('Show me the biggest gaps', 'Show me the biggest gap in payments processing.')] },
        ],
      }
    }
    return {
      open: { to: 'area', id: 'payments-processing' },
      blocks: [
        { type: 'text', text: '**Payments processing** is the largest gap: 184 requirements, 182 of them without any matching test evidence. I\'ve opened the list in the panel with uncovered requirements first — FR-214 to FR-218 all sit in the settlement flow.' },
        { type: 'chips', chips: [{ label: 'Close these gaps with Matrix', action: { kind: 'handoff', areaSlug: 'payments-processing', frIds: [] } }, say('Explain FR-214 in detail', 'Explain FR-214 in detail and show the source evidence.'), say('Which areas should we look at first?')] },
      ],
    }
  }

  if (/look at first|prioriti|where should/.test(t)) {
    if (!hasReport) return needReport(app)
    return {
      blocks: [{ type: 'text', text: 'I\'d start with **Payments processing**: it\'s the largest area, it holds most of the high-priority requirements, and 182 of 184 have no evidence at all. **Validation & exception handling** comes next — 20 of its requirements already have partial evidence, so some of those gaps may be quicker to close. I report the gaps; deciding what to test first is your call.' }],
    }
  }

  if (/covered requirements/.test(t)) {
    if (!hasReport) return needReport(app)
    return {
      open: { to: 'report' },
      blocks: [{ type: 'text', text: `${REPORT.covered} requirements have matching test evidence, spread across all eight functional areas — no area has more than 3. Almost all of that evidence comes from ABCD-TestingScript. Open an area in the panel and switch the filter to **Covered** to see them.` }],
    }
  }

  if (/how.*(coverage|calculat)|calculated/.test(t)) {
    return {
      blocks: [{ type: 'text', text: `Coverage is the share of functional requirements that have matching test evidence: ${REPORT.covered} of ${REPORT.requirements} (1.98%), shown as 1% because coverage is rounded down so it's never overstated. A requirement with **partial** evidence (${REPORT.partial} of them) isn't counted as covered. This is a requirement-to-evidence measure from Testmind's FR-to-test map — it isn't line or branch coverage, and it doesn't come from running any tests.` }],
    }
  }

  if (/split|per.repositor|by component|components? split/.test(t)) {
    if (!hasReport) return needReport(app)
    const rows = componentBreakdown()
    return {
      blocks: [
        {
          type: 'text',
          text: `Split by the component that mainly implements each requirement:\n\n${rows.map((c) => `- **${c.id}** (${c.role}): ${c.total} requirements, ${c.covered} covered, ${c.partial} partial, **${c.notCovered} with no tests**`).join('\n')}\n\nAll of the evidence is in ${TEST_REPO}. Most of it is API-level; ABCD-batch and ABCD-etl have almost nothing beyond smoke tests.`,
        },
        { type: 'chips', chips: [{ label: 'Close all gaps with Matrix', action: { kind: 'batch' } }] },
      ],
    }
  }

  if (/compare|previous scan/.test(t)) {
    return {
      blocks: [{ type: 'text', text: `Comparing with the ${REPORT.previousScan} scan isn't available in this prototype yet — the comparison view hasn't been designed. Once it is, it'll show what changed in coverage and gaps between the two scans.` }],
    }
  }

  if (/list|source repositor|which repositor|components/.test(t)) {
    return {
      blocks: [
        { type: 'text', text: `${app} has **${REPORT.components} components**:\n\n${CODE_COMPONENTS.map((c) => `- **${c.id}**: ${c.role}`).join('\n')}\n- **${TEST_REPO}**: the automation suite that tests all of them` },
        { type: 'chips', chips: hasReport ? [] : [ANALYSE_ABCD] },
      ],
    }
  }

  if (/explain a requirement|requirement/.test(t)) {
    return {
      blocks: [
        { type: 'text', text: 'Which requirement? Give me its ID — for example FR-214 — and I\'ll show what it says, where it lives in the code and what test evidence I found.' },
        { type: 'chips', chips: [say('Explain FR-214 in detail', 'Explain FR-214 in detail and show the source evidence.')] },
      ],
    }
  }

  const area = AREAS.find((a) => t.includes(a.name.toLowerCase().split(' ')[0]))
  if (area && hasReport) {
    return {
      open: { to: 'area', id: area.slug },
      blocks: [{ type: 'text', text: `**${area.name}** has ${area.total} requirements: ${area.covered} covered, ${area.partial} partial and ${area.notCovered} with no evidence. I've opened the list in the panel.` }],
    }
  }

  if (hasReport) {
    return {
      blocks: [
        { type: 'text', text: `In this prototype I answer from the ${app} report. Try asking about the biggest gaps, a requirement by ID (FR-214), the split by component, or how coverage is calculated.` },
        { type: 'chips', chips: [say('Show me the biggest gaps', 'Show me the biggest gap in payments processing.'), say('Explain FR-214 in detail', 'Explain FR-214 in detail and show the source evidence.')] },
      ],
    }
  }
  return {
    blocks: [
      { type: 'text', text: 'I analyse an application\'s functional coverage: I map its functional requirements to the components that implement them and to the test evidence in its automation repository, and report what\'s covered and where the gaps are. Start with an analysis.' },
      { type: 'chips', chips: [ANALYSE_ABCD] },
    ],
  }
}

function needReport(app: string): Reply {
  return {
    blocks: [
      { type: 'text', text: `I don't have a completed analysis for ${app} in this conversation yet. Want me to run one? It takes about 40 minutes, and you can keep asking questions while it runs.` },
      { type: 'chips', chips: [say(`Analyse ${app}`, `Analyse the functional coverage for ${app}.`)] },
    ],
  }
}

export { findArea }

/* ---------------- Interactive remediation in chat ---------------- */

/** The fix currently being discussed: the latest proposal in the conversation. */
function lastProposal(convo: Conversation): { f: Finding; variant: number } | undefined {
  for (let i = convo.messages.length - 1; i >= 0; i--) {
    const b = convo.messages[i].blocks?.find((x) => x.type === 'fixProposal')
    if (b && b.type === 'fixProposal') {
      const f = FINDINGS.find((x) => x.id === b.findingId)
      if (f) return { f, variant: b.variant }
    }
  }
  return undefined
}

const fixChips = (f: Finding, variant: number): Block => ({
  type: 'chips',
  chips: [
    { label: 'Apply on a feature branch', action: { kind: 'remApply', findingId: f.id, variant } },
    ...(f.alternatives.length ? [say('Try another approach')] : []),
    say('Explain the risk'),
    say('Show the security tests'),
  ],
})

function proposal(f: Finding, variant: number, lead?: string): Reply {
  const a = approach(f, variant)
  const where = `\`${f.file.split('/').pop()}:${f.line}\` in ${f.repo}`
  const fp = f.triage.verdict === 'false_positive'
  const intro =
    lead ??
    (fp
      ? `**${f.title}** (${f.cwe}, ${SEV_LABEL[f.severity].toLowerCase()}) at ${where} is most likely a false positive: ${f.triage.reason} If your policy still wants it changed, here's the minimal change.`
      : `**${f.title}** (${f.cve ? `${f.cve}, ` : ''}${f.cwe}, ${SEV_LABEL[f.severity].toLowerCase()}) at ${where}. ${f.triage.exploitability} Here's the ${variant ? `alternative: **${a.label.toLowerCase()}**` : 'fix I recommend'}: ${a.summary}`)
  return { blocks: [{ type: 'text', text: intro }, { type: 'fixProposal', findingId: f.id, variant }, fixChips(f, variant)] }
}

export function interactiveFix(text: string, convo: Conversation): Reply | undefined {
  const t = text.toLowerCase()
  const current = lastProposal(convo)
  const named = findingFromText(text)

  if (current && /(another|different|alternative|other) (approach|way|fix|option)|instead/.test(t)) {
    const n = current.f.alternatives.length
    if (!n) return { blocks: [{ type: 'text', text: `I only have the one sensible fix for ${current.f.title.toLowerCase()}.` }, fixChips(current.f, current.variant)] }
    const next = (current.variant + 1) % (n + 1)
    return proposal(current.f, next, next === 0 ? `Back to the recommended fix for **${current.f.title.toLowerCase()}**: ${current.f.fix.summary}` : undefined)
  }
  if (current && /\brisk\b|how bad|impact|why (does|is) (it|this)/.test(t)) {
    return { blocks: [{ type: 'text', text: current.f.risk }, fixChips(current.f, current.variant)] }
  }
  if (current && /(security )?tests?\b|how (will|do|would) (you|we) (test|verify)/.test(t) && !/apply/.test(t)) {
    const list = current.f.tests.map((x) => `\`${x.id}\` ${x.title} (${x.kind})`).join('; ')
    return {
      blocks: [
        { type: 'text', text: `I'd add ${current.f.tests.length} tests with the fix: ${list}. They run post-commit on the feature branch, so the reviewer sees them in the PR, and again post-merge on develop.` },
        fixChips(current.f, current.variant),
      ],
    }
  }
  if (current && /\b(apply|go ahead|do it|ship it|commit it)\b|open (a |the )?pr|raise (a |the )?pr|create (a |the )?(branch|pr)/.test(t)) {
    const a = approach(current.f, current.variant)
    return {
      blocks: [{ type: 'text', text: `Putting the ${current.variant ? a.label.toLowerCase() : 'recommended'} fix for **${current.f.title.toLowerCase()}** on a feature branch with a PR into develop. Code review and release sign-off stay with you.` }],
      apply: { findingId: current.f.id, variant: current.variant },
    }
  }

  const wantsChat = /with me|interactive|walk me|one (at a time|by one)|how (would|do|should|can) (you|i|we) fix|show (me )?(the |a )?fix|propose a fix|suggest a fix|let'?s fix|^fix vuln-/.test(t)
  if (named && (wantsChat || /^(fix|explain|tell me about|what is)\b/.test(t))) return proposal(named, 0)
  if (wantsChat && /vulnerab|finding|security/.test(t)) {
    return {
      blocks: [
        { type: 'text', text: 'Sure. Pick one and I’ll explain it and propose a fix; you can change the approach before anything is committed.' },
        { type: 'chips', chips: FINDINGS.map((f) => say(`${SEV_LABEL[f.severity]} · ${f.title}`, `Fix ${f.id} (${f.title.toLowerCase()}) with me.`)) },
      ],
    }
  }
  return undefined
}
