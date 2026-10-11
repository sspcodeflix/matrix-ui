import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ChevronDown, Download, MoreHorizontal, Search, Sparkles } from 'lucide-react'
import { stroke } from '../icons'
import { Popover } from '../Popover'
import { StatusText } from '../Status'
import { SidePanel } from './SidePanel'
import { Kpi, downloadCsv } from './ReportView'
import { REPORT, coveragePct, findArea, requirementsFor, type Coverage, type Requirement } from '../../data/report'
import { paths } from '../../lib/format'
import { measuredArea, measuredReq, useMeasurement } from '../../lib/measure'
import { useStore } from '../../state/store'

type Filter = 'all' | Coverage
const PAGE = 5
const MORE = 25

export function AreaView() {
  const { conversationId = '', runId = '', areaSlug } = useParams()
  const [params, setParams] = useSearchParams()
  const m = useMeasurement(conversationId)
  const baseArea = findArea(areaSlug)
  const area = baseArea ? measuredArea(baseArea, m) : undefined
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [picked, setPicked] = useState<string[]>([])
  const { handoffToPipeline } = useStore()
  const filter = (params.get('filter') as Filter) ?? 'uncovered'

  const all = useMemo(() => (baseArea ? requirementsFor(baseArea).map((r) => measuredReq(r, m)) : []), [baseArea, m])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((r) => (filter === 'all' || r.status === filter) && (!q || r.title.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)))
  }, [all, filter, query])

  const reportPath = paths.report(conversationId, runId)
  if (!area) {
    return (
      <SidePanel label="Area not found" title="Area not found" closeTo={paths.conversation(conversationId)} crumbs={[{ label: REPORT.title, to: reportPath }]}>
        <div className="panel-body">
          <p className="prose secondary">This functional area isn't in the report.</p>
        </div>
      </SidePanel>
    )
  }

  const setFilter = (f: Filter) => {
    setParams(f === 'uncovered' ? {} : { filter: f }, { replace: true })
    setShown(PAGE)
  }
  const segments: { key: Filter; label: string; n: number }[] = [
    { key: 'all', label: 'All', n: area.total },
    { key: 'uncovered', label: 'Not covered', n: area.notCovered },
    ...(area.partial ? [{ key: 'partial' as Filter, label: 'Partial', n: area.partial }] : []),
    { key: 'covered', label: 'Covered', n: area.covered },
  ]
  const filterNoun = filter === 'all' ? 'requirements' : filter === 'uncovered' ? 'uncovered requirements' : `${filter} requirements`

  return (
    <SidePanel
      label={`${area.name} coverage details`}
      crumbs={[{ label: REPORT.title, to: reportPath }, { label: REPORT.app }]}
      title={area.name}
      closeTo={paths.conversation(conversationId)}
      actions={
        <>
        <button type="button" className="ghost panel-btn" onClick={() => handoffToPipeline(conversationId, area.slug, picked)} title="Send uncovered requirements to Matrix">
          <Sparkles size={15} {...stroke} />
          <span className="label">Close gaps with Matrix</span>
        </button>
        <button
          type="button"
          className="ghost panel-btn"
          onClick={() => downloadCsv(`${REPORT.app}-${area.slug}.csv`, [['ID', 'Requirement', 'Status', 'Test evidence'], ...rows.map((r) => [r.id, r.title, r.status, r.evidence ?? 'None found'])])}
        >
          <Download size={15} {...stroke} />
          <span className="label">Export list</span>
        </button>
        </>
      }
    >
      <div className="panel-body" style={{ gap: 26 }}>
        <section aria-label={`${area.name} summary`} className="kpis wide">
          <Kpi value={area.total} label="Requirements" />
          <Kpi value={area.covered} label="Covered" swatch="var(--mx-covered)" />
          {area.partial > 0 && <Kpi value={area.partial} label="Partial" swatch="var(--mx-partial)" />}
          <Kpi value={area.notCovered} label="Not covered" swatch="var(--mx-uncovered)" />
          <Kpi value={`${coveragePct(area.covered, area.total)}%`} label="Coverage" />
        </section>

        <section aria-label={`Requirements in ${area.name}`} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="toolbar">
            <div role="group" aria-label="Filter requirements" className="segmented">
              {segments.map((s) => (
                <button key={s.key} type="button" aria-pressed={filter === s.key} onClick={() => setFilter(s.key)}>
                  {s.label} <span className="count">{s.n}</span>
                </button>
              ))}
            </div>
            <label className="search">
              <Search size={15} {...stroke} />
              <span className="sr-only">Search requirements</span>
              <input
                type="search"
                placeholder="Search requirements"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setShown(PAGE)
                }}
              />
            </label>
          </div>

          {picked.length > 0 && (
            <div className="selection-bar" role="status">
              <span>
                <strong style={{ fontWeight: 600 }}>{picked.length}</strong> selected
              </span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn ghost" style={{ height: 34, fontSize: 13 }} onClick={() => setPicked([])}>
                  Clear
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ height: 34, fontSize: 13, padding: '0 12px' }}
                  onClick={() => {
                    handoffToPipeline(conversationId, area.slug, picked)
                    setPicked([])
                  }}
                >
                  <Sparkles size={14} {...stroke} />
                  Close with Matrix
                </button>
              </span>
            </div>
          )}

          <div className="table-wrap">
            <table className="data-table dense" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 112 }}>
                    <label className="row-check">
                      <input
                        type="checkbox"
                        className="check"
                        aria-label="Select all uncovered requirements shown"
                        checked={rows.slice(0, shown).some((r) => r.status !== 'covered') && rows.slice(0, shown).filter((r) => r.status !== 'covered').every((r) => picked.includes(r.id))}
                        onChange={(e) => {
                          const ids = rows.slice(0, shown).filter((r) => r.status !== 'covered').map((r) => r.id)
                          setPicked(e.target.checked ? [...new Set([...picked, ...ids])] : picked.filter((id) => !ids.includes(id)))
                        }}
                      />
                      ID
                    </label>
                  </th>
                  <th scope="col">Requirement</th>
                  <th scope="col" style={{ width: 190 }}>
                    Test evidence
                  </th>
                  <th scope="col" style={{ width: 120 }}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((r) => (
                  <Row key={r.id} r={r} convoId={conversationId} runId={runId} picked={picked.includes(r.id)} onPick={(on) => setPicked(on ? [...picked, r.id] : picked.filter((x) => x !== r.id))} />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="secondary" style={{ padding: '20px 0' }}>
                      No requirements match{query ? ` “${query}”` : ''}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="toolbar" style={{ paddingTop: 4 }}>
            <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)' }} aria-live="polite">
              Showing {Math.min(shown, rows.length)} of {rows.length} {filterNoun}
            </span>
            {shown < rows.length && (
              <button type="button" className="chip chip-follow" style={{ gap: 8 }} onClick={() => setShown(shown + MORE)}>
                <span>Show {Math.min(MORE, rows.length - shown)} more</span>
                <ChevronDown size={14} {...stroke} />
              </button>
            )}
          </div>
        </section>
      </div>
    </SidePanel>
  )
}

function Row({ r, convoId, runId, picked, onPick }: { r: Requirement; convoId: string; runId: string; picked: boolean; onPick: (on: boolean) => void }) {
  const { runChip, state, giveFeedback } = useStore()
  const [menu, setMenu] = useState(false)
  const fb = state.feedback[r.id]
  const to = paths.requirement(convoId, runId, r.id)
  return (
    <tr>
      <td className="mono secondary" style={{ fontSize: 13, fontWeight: 500 }}>
        <label className="row-check">
          {r.status !== 'covered' ? <input type="checkbox" className="check" aria-label={`Select ${r.id}`} checked={picked} onChange={(e) => onPick(e.target.checked)} /> : <span style={{ width: 16 }} />}
          {r.id}
        </label>
      </td>
      <td>
        <Link to={to}>{r.title}</Link>
        {fb?.reviewed && <span className="panel-meta"> · Reviewed</span>}
        {fb?.flag && <span className="panel-meta"> · Mapping flagged</span>}
      </td>
      <td className="secondary">{r.evidence ? <StatusText status={r.status} label={r.evidence} /> : <StatusText status="uncovered" label="None found" />}</td>
      <td className="actions">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, position: 'relative' }}>
          <button type="button" className="ghost row-btn" onClick={() => runChip(convoId, { kind: 'say', text: `Explain ${r.id} in detail.` })}>
            Explain
          </button>
          <button type="button" className="ghost icon-btn xs" aria-label={`More actions for ${r.id}`} aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={16} {...stroke} />
          </button>
          <Popover open={menu} onClose={() => setMenu(false)} label={`Actions for ${r.id}`} className="menu" style={{ right: 0, top: 36, textAlign: 'left' }}>
            <Link to={to} className="menu-item" onClick={() => setMenu(false)}>
              Open details
            </Link>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                giveFeedback(r.id, { reviewed: !fb?.reviewed }, { kind: fb?.reviewed ? 'unreviewed' : 'reviewed' })
                setMenu(false)
              }}
            >
              {fb?.reviewed ? 'Clear reviewed' : 'Mark as reviewed'}
            </button>
            <Link to={`${to}?flag=1`} className="menu-item" onClick={() => setMenu(false)}>
              Flag incorrect mapping
            </Link>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                navigator.clipboard?.writeText(window.location.origin + to).catch(() => {})
                setMenu(false)
              }}
            >
              Copy link
            </button>
          </Popover>
        </span>
      </td>
    </tr>
  )
}

