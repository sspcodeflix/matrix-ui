import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeftRight, ChevronRight, Download } from 'lucide-react'
import { stroke } from '../icons'
import { SidePanel } from './SidePanel'
import { AREAS, REPORT, componentBreakdown, coveragePct, uncoveredCount } from '../../data/report'
import { TEST_REPO } from '../../data/components'
import { formatDateTime, paths } from '../../lib/format'
import { measuredAreas, useMeasurement } from '../../lib/measure'
import { useStore } from '../../state/store'

export function Kpi({ value, label, swatch }: { value: string | number; label: string; swatch?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-num">{value}</span>
      <span className="kpi-label">
        {swatch && <span className="swatch sm" style={{ background: swatch }} aria-hidden="true" />}
        {label}
      </span>
    </div>
  )
}

/** Segments proportional to counts, 2px gaps, min 6px so tiny segments stay visible. */
export function CoverageBar({ covered, partial, notCovered }: { covered: number; partial: number; notCovered: number }) {
  const segs = [
    { n: covered, color: 'var(--mx-covered)' },
    { n: partial, color: 'var(--mx-partial)' },
    { n: notCovered, color: 'var(--mx-uncovered)' },
  ].filter((s) => s.n > 0)
  return (
    <div className="coverage-bar" role="img" aria-label={`Covered ${covered} requirements, partial ${partial}, not covered ${notCovered}`}>
      {segs.map((s, i) => (
        <div key={i} style={{ flex: `${s.n} 0 0`, minWidth: 6, background: s.color }} />
      ))}
    </div>
  )
}

export function ReportView() {
  const { conversationId = '', runId = '' } = useParams()
  const { state, runChip } = useStore()
  const run = state.runs[runId]
  const [showAll, setShowAll] = useState(false)
  const total = REPORT.requirements
  const pct = (n: number) => `${coveragePct(n, total)}%`
  const m = useMeasurement(conversationId)
  const areas = measuredAreas(m).sort((a, b) => uncoveredCount(b) - uncoveredCount(a))
  const visible = showAll ? areas : areas.slice(0, 5)

  return (
    <SidePanel
      label="Functional coverage report"
      title={REPORT.title}
      meta={`${run?.app ?? REPORT.app} · ${run?.repoCount ?? REPORT.components} components · completed ${run?.completedAt ? formatDateTime(run.completedAt) : '—'}`}
      closeTo={paths.conversation(conversationId)}
      actions={
        <>
          <button type="button" className="ghost panel-btn" onClick={() => runChip(conversationId, { kind: 'say', text: `Compare with the ${REPORT.previousScan} scan.` })}>
            <ArrowLeftRight size={15} {...stroke} />
            <span className="label">Compare</span>
          </button>
          <button type="button" className="ghost panel-btn" onClick={() => exportAreasCsv()}>
            <Download size={15} {...stroke} />
            <span className="label">Export</span>
          </button>
        </>
      }
    >
      <div className="panel-body">
        {m.remeasured && (
          <div className="remeasure-note" role="status">
            <strong style={{ fontWeight: 600 }}>Re-measured {m.at ? formatDateTime(m.at) : ''}</strong>
            <span className="secondary">
              {' '}
              · Matrix closed {m.closed.size} {m.closed.size === 1 ? 'gap' : 'gaps'} · was {pct(REPORT.covered)} with {REPORT.covered} covered at the scan
            </span>
          </div>
        )}
        <section aria-label="Overall coverage" className="hero-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="hero-num">{pct(m.covered)}</span>
            <span className="hero-text">
              Overall functional coverage — {m.covered} of {total} requirements have matching test evidence.
            </span>
          </div>
          <div className="kpis" style={{ paddingBottom: 6 }}>
            <Kpi value={total} label="Functional requirements" />
            <Kpi value={m.existingTests} label="Existing test cases" />
            <Kpi value={REPORT.components} label="Components" />
          </div>
        </section>

        <section aria-label="Coverage breakdown" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="section-head">
            <h3>Coverage breakdown</h3>
            <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>{total} requirements</span>
          </div>
          <CoverageBar covered={m.covered} partial={m.partial} notCovered={m.notCovered} />
          <div className="legend">
            <LegendItem color="var(--mx-covered)" label="Covered" n={m.covered} pct={pct(m.covered)} />
            <LegendItem color="var(--mx-partial)" label="Partial" n={m.partial} pct={pct(m.partial)} />
            <LegendItem color="var(--mx-uncovered)" label="Not covered" n={m.notCovered} pct={`${100 - coveragePct(m.covered, total) - coveragePct(m.partial, total)}%`} />
          </div>
        </section>

        <section aria-label="Functional areas" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="section-head">
            <h3>Where the gaps are</h3>
            <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>Functional areas, most uncovered first</span>
          </div>
          <div className="table-wrap">
            <table className="data-table" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th scope="col">Functional area</th>
                  <th scope="col" className="r">
                    Requirements
                  </th>
                  <th scope="col" className="r" title="Requirements without full test evidence (partial + none)">
                    Uncovered
                  </th>
                  <th scope="col" className="r">
                    Coverage
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.slug}>
                    <td>
                      <Link to={paths.area(conversationId, runId, a.slug)}>{a.name}</Link>
                    </td>
                    <td className="r secondary">{a.total}</td>
                    <td className="r" style={{ fontWeight: 500 }}>
                      {uncoveredCount(a)}
                    </td>
                    <td className="r secondary">
                      {a.gained > 0 && <span className="delta-tag">+{a.gained}</span>}
                      {coveragePct(a.covered, a.total)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {areas.length > 5 && (
            <button type="button" className="chip chip-follow" style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show top 5 areas' : `Show all ${areas.length} areas`}
            </button>
          )}
        </section>

        <section aria-label="Components" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="section-head">
            <h3>By component</h3>
            <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }}>Where each requirement is mainly implemented · tests in {TEST_REPO}</span>
          </div>
          <div className="table-wrap">
            <table className="data-table" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th scope="col">Component</th>
                  <th scope="col" className="r">
                    Requirements
                  </th>
                  <th scope="col" className="r" title="Requirements without full test evidence (partial + none)">
                    Uncovered
                  </th>
                  <th scope="col" className="r">
                    Coverage
                  </th>
                </tr>
              </thead>
              <tbody>
                {componentBreakdown(new Set(m.closed.keys())).map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="mono" style={{ fontSize: 13.5 }}>
                        {c.id}
                      </div>
                      <div className="panel-meta">{c.role}</div>
                    </td>
                    <td className="r secondary">{c.total}</td>
                    <td className="r" style={{ fontWeight: 500 }}>
                      {c.partial + c.notCovered}
                    </td>
                    <td className="r secondary">{coveragePct(c.covered, c.total)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="footer-links">
          <button type="button" onClick={() => runChip(conversationId, { kind: 'say', text: 'Explain how coverage is calculated' })}>
            How is coverage calculated? <ChevronRight size={14} {...stroke} />
          </button>
          <Link to={paths.area(conversationId, runId, areas[0].slug)}>
            Largest gap: {areas[0].name} <ChevronRight size={14} {...stroke} />
          </Link>
        </div>
      </div>
    </SidePanel>
  )
}

function LegendItem({ color, label, n, pct }: { color: string; label: string; n: number; pct: string }) {
  return (
    <span>
      <span className="swatch" style={{ background: color }} aria-hidden="true" />
      <span>{label}</span>
      <strong className="num">{n}</strong>
      <span className="secondary">{pct}</span>
    </span>
  )
}

export function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function exportAreasCsv() {
  downloadCsv(`${REPORT.app}-coverage-by-area.csv`, [
    ['Functional area', 'Requirements', 'Covered', 'Partial', 'Not covered', 'Coverage %'],
    ...AREAS.map((a) => [a.name, a.total, a.covered, a.partial, a.notCovered, coveragePct(a.covered, a.total)]),
  ])
}
