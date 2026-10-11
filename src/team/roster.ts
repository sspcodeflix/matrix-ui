/**
 * Prototype team for ABCD and the canned responses that simulate their reviews.
 * Real reviews would come from Huddle (shared app context; team reviews and corrections).
 */
import type { ReviewTarget, ReviewerStatus } from '../state/types'

export interface Person {
  id: string
  name: string
  role: string
  initials: string
}

export const TEAM: Person[] = [
  { id: 'priya', name: 'Priya Raman', role: 'QA lead', initials: 'PR' },
  { id: 'marcus', name: 'Marcus Chen', role: 'QA engineer', initials: 'MC' },
  { id: 'aisha', name: 'Aisha Bello', role: 'Developer · payments', initials: 'AB' },
  { id: 'daniel', name: 'Daniel Ortiz', role: 'Developer · platform', initials: 'DO' },
  { id: 'tom', name: 'Tom Gallagher', role: 'Product owner', initials: 'TG' },
  { id: 'mei', name: 'Mei Tanaka', role: 'Business analyst', initials: 'MT' },
  { id: 'lena', name: 'Lena Kovač', role: 'Release owner', initials: 'LK' },
]

/** The prototype's signed-in author. */
export const ME: Person = { id: 'sp', name: 'SP', role: 'Test author', initials: 'SP' }
export const EVERYONE: Person[] = [ME, ...TEAM]

export const person = (id: string): Person => EVERYONE.find((p) => p.id === id) ?? { id, name: id, role: '', initials: id.slice(0, 2).toUpperCase() }

export function targetLabel(t: ReviewTarget) {
  if (t.kind === 'requirement') return `${t.frId} mapping`
  return { readiness: 'readiness answers', design: 'test design', automation: 'automation PR', execution: 'run results', delivery: 'delivery' }[t.stage]
}

export function suggestedFor(t: ReviewTarget): string[] {
  if (t.kind === 'requirement') return ['tom', 'mei', 'priya']
  return { readiness: ['tom', 'mei'], design: ['priya', 'marcus'], automation: ['aisha', 'daniel'], execution: ['priya', 'lena'], delivery: ['lena'] }[t.stage]
}

interface Planned {
  status: Exclude<ReviewerStatus, 'waiting'>
  comment: string
  afterMs: number
}

/** What each person says, by what they're reviewing. `item` is the first tagged item, if any. */
export function plannedResponse(personId: string, t: ReviewTarget, item: string | undefined, order: number): Planned {
  const afterMs = 4000 + order * 3500
  const tc = item ?? 'TC-1421-03'
  const stage = t.kind === 'stage' ? t.stage : 'requirement'
  const by: Record<string, Partial<Record<string, Omit<Planned, 'afterMs'>>>> = {
    priya: {
      design: { status: 'changes', comment: `${tc}: also assert the rejection is logged with the correlation ID; audit needs it for settlement failures.` },
      execution: { status: 'commented', comment: 'The TC-1421-03 failure looks like a real wording mismatch. I’ve asked Tom which text is right before we sign off.' },
      requirement: { status: 'approved', comment: 'Mapping is right: SettlementValidator is the only place this rule lives.' },
      readiness: { status: 'approved', comment: 'Agree with the readiness calls.' },
    },
    marcus: {
      design: { status: 'approved', comment: 'Steps are clear and every case maps 1:1 to a criterion. Good to go from me.' },
      execution: { status: 'approved', comment: 'Evidence is complete; the flaky case is the SIT stub again.' },
    },
    aisha: {
      automation: { status: 'changes', comment: 'Use the existing SettlementFixture builder instead of validInstruction(); it keeps the test data in one place.' },
      design: { status: 'commented', comment: `${tc} will need a stubbed downstream; I can pair on that.` },
      requirement: { status: 'commented', comment: 'Part of this logic is also in SettlementInstruction.java (L14–62). Worth checking the mapping covers both.' },
    },
    daniel: {
      automation: { status: 'approved', comment: 'Conventions match ABCD-TestingScript. Build time impact is negligible.' },
    },
    tom: {
      readiness: { status: 'commented', comment: 'ABCD-1423 is missing the cut-off rule. I’ll update the story today.' },
      requirement: { status: 'approved', comment: 'Yes, this is the requirement behind ABCD-1421.' },
      execution: { status: 'commented', comment: '“Account number is mandatory” is the agreed wording. The code is wrong; I’ll raise a defect.' },
      design: { status: 'approved', comment: 'Covers what the story asks for.' },
    },
    mei: {
      readiness: { status: 'approved', comment: 'Criteria for the ready stories are complete.' },
      requirement: { status: 'approved', comment: 'Matches the Confluence spec, section 3.2.' },
      design: { status: 'commented', comment: 'Consider a case for a held instruction being released after review.' },
    },
    lena: {
      execution: { status: 'approved', comment: 'Fine to sign off once the TC-1421-03 defect is raised in Jira.' },
      delivery: { status: 'approved', comment: 'Octane and Jira updates look right.' },
    },
  }
  const r = by[personId]?.[stage] ?? { status: 'approved' as const, comment: 'Looks good to me.' }
  return { ...r, afterMs }
}
