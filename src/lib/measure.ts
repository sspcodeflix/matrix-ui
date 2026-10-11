/**
 * Re-measurement: the scan's numbers plus whatever Matrix has delivered in
 * this conversation. A requirement becomes covered once its delivered tests
 * give it test evidence.
 */
import { useMemo } from 'react'
import { AREAS, REPORT, findRequirement, type Area, type Requirement } from '../data/report'
import { allTestCases, readyFrIds, storyFor } from '../pipeline/data'
import { gapTests } from '../remediation/data'
import { TEST_REPO } from '../data/components'
import { useStore } from '../state/store'

export interface Measurement {
  /** FR id -> evidence label, for requirements closed by Matrix. */
  closed: Map<string, string>
  covered: number
  partial: number
  notCovered: number
  existingTests: number
  /** Time of the latest delivery that changed the numbers. */
  at?: number
  remeasured: boolean
}

export function useMeasurement(conversationId: string): Measurement {
  const { state } = useStore()
  return useMemo(() => {
    const closed = new Map<string, string>()
    let tests = 0
    let at: number | undefined
    for (const p of Object.values(state.pipelines)) {
      if (p.conversationId !== conversationId || p.outcome !== 'delivered') continue
      tests += allTestCases(p).length
      at = Math.max(at ?? 0, p.completedAt ?? 0)
      for (const id of readyFrIds(p)) {
        const req = findRequirement(id)
        if (req && req.status !== 'covered') closed.set(id, `${p.repo} · ${storyFor(id).key} tests · Matrix`)
      }
    }
    // Tests written for coverage gaps during a remediation count once it is delivered.
    for (const r of Object.values(state.remediations)) {
      if (r.conversationId !== conversationId || r.outcome !== 'resolved' || !r.coverage?.closed.length) continue
      tests += gapTests(r).length
      at = Math.max(at ?? 0, r.completedAt ?? 0)
      for (const id of r.coverage.closed) {
        const req = findRequirement(id)
        if (req && req.status !== 'covered' && !closed.has(id)) closed.set(id, `${TEST_REPO} · ${storyFor(id).key} tests · Matrix (security fix)`)
      }
    }
    let partial = REPORT.partial
    let notCovered = REPORT.notCovered
    for (const id of closed.keys()) {
      if (findRequirement(id)?.status === 'partial') partial--
      else notCovered--
    }
    return {
      closed,
      covered: REPORT.covered + closed.size,
      partial,
      notCovered,
      existingTests: REPORT.existingTests + tests,
      at,
      remeasured: closed.size > 0,
    }
  }, [state.pipelines, state.remediations, conversationId])
}

export function measuredArea(area: Area, m: Measurement): Area & { gained: number } {
  let gained = 0
  let partial = area.partial
  let notCovered = area.notCovered
  for (const id of m.closed.keys()) {
    const r = findRequirement(id)
    if (r?.areaSlug !== area.slug) continue
    gained++
    if (r.status === 'partial') partial--
    else notCovered--
  }
  return { ...area, covered: area.covered + gained, partial, notCovered, gained }
}

export function measuredReq(r: Requirement, m: Measurement): Requirement & { closedBy?: string } {
  const by = m.closed.get(r.id)
  return by ? { ...r, status: 'covered', evidence: by, closedBy: 'Matrix' } : r
}

export const measuredAreas = (m: Measurement) => AREAS.map((a) => measuredArea(a, m))
