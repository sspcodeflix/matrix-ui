/**
 * Fixture for the ABCD Functional Coverage Report (screens 4–6).
 *
 * ABCD has four code components and one automation repository (see
 * components.ts). Each requirement is implemented in one or two components.
 *
 * Area figures reconcile with the headline:
 *   657 requirements = 13 covered + 79 partial + 565 not covered.
 * "Uncovered" in the areas table means "not fully covered" (partial + none),
 * so the gaps total is 644.
 */

import { CODE_COMPONENTS, COMPONENTS, TEST_REPO, componentsFor, sourceFileFor } from './components'

export type Coverage = 'covered' | 'partial' | 'uncovered'

export interface Area {
  slug: string
  name: string
  total: number
  covered: number
  partial: number
  notCovered: number
  prefix: string // FR number range start
}

export interface Requirement {
  id: string
  title: string
  area: string
  areaSlug: string
  status: Coverage
  priority: 'High' | 'Medium' | 'Low'
  evidence: string | null
  /** Components the requirement runs through, the main one first. */
  components: string[]
  /** The main component, where `file` lives. */
  repo: string
  file: string
  lines: string
}

export const REPORT = {
  app: 'ABCD',
  title: 'Functional Coverage Report',
  /** Code components plus the automation repository. */
  components: COMPONENTS.length,
  requirements: 657,
  covered: 13,
  partial: 79,
  notCovered: 565,
  existingTests: 13,
  previousScan: '2 Oct 2026',
}

export const AREAS: Area[] = [
  { slug: 'payments-processing', name: 'Payments processing', total: 184, covered: 2, partial: 0, notCovered: 182, prefix: 'FR-214' },
  { slug: 'validation-exception-handling', name: 'Validation & exception handling', total: 121, covered: 3, partial: 20, notCovered: 98, prefix: 'FR-401' },
  { slug: 'customer-account-workflows', name: 'Customer account workflows', total: 96, covered: 2, partial: 18, notCovered: 76, prefix: 'FR-101' },
  { slug: 'reporting-and-audit', name: 'Reporting and audit', total: 73, covered: 2, partial: 15, notCovered: 56, prefix: 'FR-601' },
  { slug: 'reference-data-management', name: 'Reference data management', total: 56, covered: 1, partial: 10, notCovered: 45, prefix: 'FR-701' },
  { slug: 'user-access-permissions', name: 'User access & permissions', total: 48, covered: 1, partial: 6, notCovered: 41, prefix: 'FR-801' },
  { slug: 'notifications-alerts', name: 'Notifications & alerts', total: 41, covered: 1, partial: 6, notCovered: 34, prefix: 'FR-851' },
  { slug: 'batch-scheduling', name: 'Batch scheduling', total: 38, covered: 1, partial: 4, notCovered: 33, prefix: 'FR-901' },
]

export const uncoveredCount = (a: Area) => a.partial + a.notCovered
/** Coverage rounds down so it is never overstated: 13/657 = 1.98% shows as 1%. */
export const coveragePct = (covered: number, total: number) => Math.floor((covered / total) * 100)

export function findArea(slug: string | undefined) {
  return AREAS.find((a) => a.slug === slug)
}

// Requirement titles per area. The first five payments titles come straight
// from the design; the rest are plausible fillers for the prototype.
const TITLES: Record<string, string[]> = {
  'payments-processing': [
    'Validate settlement instruction', 'Handle invalid account number', 'Process payment cancellation', 'Generate settlement confirmation', 'Retry on network failure',
    'Reject duplicate payment reference', 'Apply cut-off time rules', 'Route high-value payments for approval', 'Calculate settlement date', 'Reconcile partial settlements',
    'Hold payments on sanctions match', 'Release held payment after review', 'Validate beneficiary bank code', 'Convert currency at booked rate', 'Split payment across value dates',
    'Reverse failed settlement', 'Record payment audit trail', 'Notify counterparty of amendment', 'Enforce daily payment limits', 'Queue payments during outage',
  ],
  'validation-exception-handling': [
    'Reject malformed input payloads', 'Map validation errors to user messages', 'Escalate unhandled exceptions', 'Validate mandatory reference fields', 'Handle timeout from downstream service',
    'Log correlation ID on failure', 'Validate date ranges', 'Reject unsupported currencies', 'Handle concurrent update conflict', 'Validate file upload format',
  ],
  'customer-account-workflows': [
    'Open customer account', 'Close dormant account', 'Update registered address', 'Link secondary account holder', 'Freeze account on fraud alert',
    'Change account tier', 'Verify customer identity documents', 'Merge duplicate customer records', 'Set account statement preferences', 'Reactivate closed account',
  ],
  'reporting-and-audit': [
    'Generate daily settlement report', 'Export audit log', 'Record user access to reports', 'Schedule regulatory return', 'Archive reports after retention period',
    'Produce exception summary', 'Trace change history for record', 'Sign off monthly report',
  ],
  'reference-data-management': [
    'Load holiday calendar', 'Update bank identifier directory', 'Version currency reference data', 'Approve reference data change', 'Validate country codes',
    'Synchronise branch list', 'Retire obsolete reference values',
  ],
  'user-access-permissions': [
    'Grant role to user', 'Revoke access on leave', 'Enforce four-eyes approval', 'Expire inactive sessions', 'Audit privileged actions', 'Restrict access by entity',
  ],
  'notifications-alerts': [
    'Send settlement failure alert', 'Email daily digest', 'Escalate unacknowledged alerts', 'Suppress duplicate notifications', 'Notify on threshold breach',
  ],
  'batch-scheduling': [
    'Run end-of-day batch', 'Restart failed batch step', 'Hold batch on upstream delay', 'Report batch completion', 'Skip batch on holidays',
  ],
}

const QUALIFIERS = ['', ' for bulk files', ' for cross-border flows', ' for scheduled instructions', ' via API', ' in manual entry', ' for urgent payments', ' for internal transfers', ' after amendment']

function frNumber(prefix: string) {
  return Number(prefix.replace('FR-', ''))
}

const cache = new Map<string, Requirement[]>()

export function requirementsFor(area: Area): Requirement[] {
  const hit = cache.get(area.slug)
  if (hit) return hit
  const titles = TITLES[area.slug] ?? ['Requirement']
  const start = frNumber(area.prefix)
  const out: Requirement[] = []
  // Order: not covered first, then partial, then covered; matches the design's
  // "most uncovered first" default.
  const statuses: Coverage[] = [
    ...Array<Coverage>(area.notCovered).fill('uncovered'),
    ...Array<Coverage>(area.partial).fill('partial'),
    ...Array<Coverage>(area.covered).fill('covered'),
  ]
  statuses.forEach((status, i) => {
    const base = titles[i % titles.length]
    const qualifier = QUALIFIERS[Math.floor(i / titles.length) % QUALIFIERS.length]
    const fileStem = base.split(' ').slice(0, 2).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
    const components = componentsFor(area.slug, i)
    out.push({
      id: `FR-${start + i}`,
      title: base + qualifier,
      area: area.name,
      areaSlug: area.slug,
      status,
      priority: i % 5 === 0 ? 'High' : i % 3 === 0 ? 'Low' : 'Medium',
      evidence: status === 'covered' ? `${TEST_REPO} · ${fileStem}Test` : status === 'partial' ? `${TEST_REPO} · ${fileStem}SmokeTest` : null,
      components,
      repo: components[0],
      file: sourceFileFor(components[0], fileStem),
      lines: `${40 + ((i * 37) % 300)}–${90 + ((i * 37) % 300)}`,
    })
  })
  cache.set(area.slug, out)
  return out
}

export function findRequirement(frId: string | undefined): Requirement | undefined {
  if (!frId) return undefined
  const id = frId.toUpperCase()
  for (const area of AREAS) {
    const hit = requirementsFor(area).find((r) => r.id === id)
    if (hit) return hit
  }
  return undefined
}

/** Detail that only FR-214 has in the design; other requirements get a generic version. */
export const FR214_DETAIL = {
  description:
    'The system must validate settlement instructions to ensure mandatory fields are present, account details are valid, and the instruction complies with business rules before submission to the settlement system.',
  file: 'src/main/java/…/SettlementValidator.java',
  fileName: 'SettlementValidator.java',
  lines: '120–210',
  code: [
    { n: '118', text: 'public ValidationResult validate(SettlementInstruction instr) {' },
    { n: '119', text: '    if (instr.getAccountNumber() == null) {' },
    { n: '120', text: '        return ValidationResult.error(', hl: true },
    { n: '121', text: '            "Account number is required");', hl: true },
    { n: '122', text: '    }' },
    { n: '⋯', text: '    // lines 123–125 collapsed', collapsed: true },
    { n: '126', text: '    // Additional validation logic', muted: true },
  ],
  sourceEvidence: [
    { file: 'SettlementValidator.java', lines: '120–210' },
    { file: 'SettlementInstruction.java', lines: '14–62' },
    { file: 'settlement-rules.md', lines: '§3.2' },
  ],
}

/** Repositories automation can go to. ABCD keeps all of its tests in one. */
export const AUTOMATION_REPOS = [TEST_REPO]

export interface ComponentCoverage {
  id: string
  role: string
  total: number
  covered: number
  partial: number
  notCovered: number
}

/** Requirements by the component that mainly implements them. `closed` = requirements Matrix has since covered. */
export function componentBreakdown(closed: ReadonlySet<string> = new Set()): ComponentCoverage[] {
  const rows = new Map(CODE_COMPONENTS.map((c) => [c.id, { id: c.id, role: c.role, total: 0, covered: 0, partial: 0, notCovered: 0 }]))
  for (const area of AREAS) {
    for (const r of requirementsFor(area)) {
      const row = rows.get(r.components[0])!
      row.total++
      const status = closed.has(r.id) ? 'covered' : r.status
      if (status === 'covered') row.covered++
      else if (status === 'partial') row.partial++
      else row.notCovered++
    }
  }
  return [...rows.values()]
}
