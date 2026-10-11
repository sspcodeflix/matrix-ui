import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Check, ExternalLink, FileText, Flag, Pencil, Sparkles } from 'lucide-react'
import { stroke } from '../icons'
import { StatusMarker, StatusPill, StatusText } from '../Status'
import { SidePanel } from './SidePanel'
import { AREAS, FR214_DETAIL, REPORT, findRequirement, requirementsFor, type Requirement } from '../../data/report'
import { TEST_REPO } from '../../data/components'
import { formatDateTime, paths } from '../../lib/format'
import { measuredReq, useMeasurement } from '../../lib/measure'
import { useStore } from '../../state/store'
import { TeamReviewSection } from '../team/TeamReview'

type Tab = 'overview' | 'evidence' | 'related' | 'similar'

const FLAG_REASONS = [
  'A test does cover this requirement',
  'The requirement is mapped to the wrong source code',
  "This isn't a real functional requirement",
  'Something else',
]

export function RequirementView() {
  const { conversationId = '', runId = '', frId } = useParams()
  const [params, setParams] = useSearchParams()
  const m = useMeasurement(conversationId)
  const baseReq = findRequirement(frId)
  const req = baseReq ? measuredReq(baseReq, m) : undefined
  const { state, giveFeedback, runChip, handoffToPipeline } = useStore()
  const [tab, setTab] = useState<Tab>('overview')
  const [form, setForm] = useState<'note' | 'flag' | null>(params.get('flag') ? 'flag' : null)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState(FLAG_REASONS[0])
  const [comment, setComment] = useState('')

  useEffect(() => {
    setTab('overview')
    setForm(params.get('flag') ? 'flag' : null)
  }, [frId]) // eslint-disable-line react-hooks/exhaustive-deps

  const reportPath = paths.report(conversationId, runId)
  if (!req) {
    return (
      <SidePanel label="Requirement not found" closeTo={paths.conversation(conversationId)} crumbs={[{ label: REPORT.title, to: reportPath }, { label: frId ?? '' }]}>
        <div className="panel-body">
          <p className="prose secondary">{frId} isn't in this report.</p>
        </div>
      </SidePanel>
    )
  }

  const run = state.runs[runId]
  const fb = state.feedback[req.id] ?? { notes: [] }
  const area = AREAS.find((a) => a.slug === req.areaSlug)!
  const isFr214 = req.id === 'FR-214'
  const detail = isFr214
    ? FR214_DETAIL
    : {
        description: `The system must ${req.title.charAt(0).toLowerCase()}${req.title.slice(1)} in line with the ${req.area.toLowerCase()} business rules.`,
        file: req.file,
        fileName: req.file.split('/').pop()!,
        lines: req.lines,
        code: null,
        sourceEvidence: [{ file: req.file.split('/').pop()!, lines: req.lines }],
      }
  const siblings = requirementsFor(area)
  const idx = siblings.findIndex((r) => r.id === req.id)
  const related = siblings.filter((_, i) => i !== idx && Math.abs(i - idx) <= 3).slice(0, 6)
  const similar = siblings.filter((r) => r.id !== req.id && r.title.split(' ')[0] === req.title.split(' ')[0]).slice(0, 4)
  const identified = run?.completedAt ? formatDateTime(run.completedAt) : '—'
  const closeForm = () => {
    setForm(null)
    if (params.get('flag')) setParams({}, { replace: true })
  }

  const tabs: { key: Tab; label: string; n?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'evidence', label: 'Source evidence', n: detail.sourceEvidence.length },
    { key: 'related', label: 'Related requirements', n: related.length },
    { key: 'similar', label: 'Similar requirements', n: similar.length },
  ]

  return (
    <SidePanel
      label={`Requirement ${req.id}`}
      crumbs={[{ label: REPORT.title, to: reportPath }, { label: req.area, to: paths.area(conversationId, runId, req.areaSlug) }, { label: req.id }]}
      closeTo={paths.conversation(conversationId)}
    >
      <div className="panel-body" style={{ paddingTop: 24, gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <span className="id-chip">{req.id}</span>
            <StatusPill status={req.status} />
            <span style={{ fontSize: 12.5, color: 'var(--mx-text-secondary)' }}>
              {req.priority} priority · {req.area}
            </span>
          </div>
          <h2 className="req-title">{req.title}</h2>
        </div>

        <div role="tablist" aria-label="Requirement sections" className="tabs">
          {tabs.map((t) => (
            <button key={t.key} role="tab" id={`tab-${t.key}`} aria-controls={`tabpanel-${t.key}`} aria-selected={tab === t.key} type="button" onClick={() => setTab(t.key)}>
              {t.label} {t.n !== undefined && <span className="count">{t.n}</span>}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {tab === 'overview' && (
            <>
              <div className="two-col">
                <section aria-label="Requirement" style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
                  <p className="prose" style={{ fontSize: 15 }}>
                    {detail.description}
                  </p>
                  <dl className="dl">
                    <dt>Functional area</dt>
                    <dd>{req.area}</dd>
                    <dt>Priority</dt>
                    <dd style={{ fontWeight: 500 }}>{req.priority}</dd>
                    <dt>{req.components.length > 1 ? 'Components' : 'Component'}</dt>
                    <dd className="mono" style={{ fontSize: 13 }}>
                      {req.components.join(' → ')}
                    </dd>
                    <dt>Source file</dt>
                    <dd className="mono" style={{ fontSize: 13 }}>
                      {detail.file}
                    </dd>
                    <dt>Line references</dt>
                    <dd className="num">{detail.lines}</dd>
                    <dt>Identified</dt>
                    <dd>{identified}</dd>
                    <dt>Test evidence</dt>
                    <dd className={req.evidence ? '' : 'secondary'}>{req.evidence ?? 'None found'}</dd>
                  </dl>
                </section>
                <SourceExcerpt req={req} detail={detail} />
              </div>
              <WhyCallout req={req} />
            </>
          )}

          {tab === 'evidence' && (
            <ul className="link-list">
              {detail.sourceEvidence.map((e) => (
                <li key={e.file}>
                  <FileText size={15} color="var(--mx-text-secondary)" {...stroke} />
                  <span className="mono" style={{ fontSize: 13, flex: 1 }}>
                    {e.file}
                  </span>
                  <span className="secondary num" style={{ fontSize: 13 }}>
                    {e.lines}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {(tab === 'related' || tab === 'similar') && (
            <ul className="link-list">
              {(tab === 'related' ? related : similar).map((r) => (
                <li key={r.id}>
                  <span className="mono secondary" style={{ fontSize: 13, width: 70 }}>
                    {r.id}
                  </span>
                  <Link to={paths.requirement(conversationId, runId, r.id)} style={{ flex: 1 }}>
                    {r.title}
                  </Link>
                  <span className="secondary" style={{ fontSize: 13 }}>
                    <StatusText status={r.status} />
                  </span>
                </li>
              ))}
              {(tab === 'related' ? related : similar).length === 0 && <li className="secondary">None found.</li>}
            </ul>
          )}
        </div>

        {(fb.notes.length > 0 || fb.flag) && (
          <section aria-label="Your feedback" className="feedback-log">
            {fb.flag && (
              <div className="feedback-item">
                <Flag size={15} {...stroke} style={{ marginTop: 2, flex: 'none' }} />
                <span>
                  <strong style={{ fontWeight: 500 }}>Mapping flagged:</strong> {fb.flag.reason}
                  {fb.flag.comment && <> — {fb.flag.comment}</>}
                  <span className="panel-meta"> · {formatDateTime(fb.flag.at)}. Sent to the matching pipeline for review.</span>
                </span>
              </div>
            )}
            {fb.notes.map((n) => (
              <div key={n.at} className="feedback-item">
                <Pencil size={15} {...stroke} style={{ marginTop: 2, flex: 'none' }} />
                <span>
                  {n.text}
                  <span className="panel-meta"> · {formatDateTime(n.at)}</span>
                </span>
              </div>
            ))}
          </section>
        )}

        {form === 'note' && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (!note.trim()) return
              giveFeedback(req.id, { notes: [...fb.notes, { text: note.trim(), at: Date.now() }] }, { kind: 'note', text: note.trim() })
              setNote('')
              closeForm()
            }}
          >
            <label htmlFor="note" style={{ fontSize: 14, fontWeight: 600 }}>
              Add a note
            </label>
            <textarea id="note" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Context for your team, e.g. covered by manual regression pack R-12" />
            <div className="card-actions" style={{ marginTop: 0 }}>
              <button type="button" className="btn ghost" onClick={closeForm}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={!note.trim()}>
                Save note
              </button>
            </div>
          </form>
        )}

        {form === 'flag' && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              giveFeedback(req.id, { flag: { reason, comment: comment.trim(), at: Date.now() } }, { kind: 'flag', reason, comment: comment.trim() })
              setComment('')
              closeForm()
            }}
          >
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ padding: 0, margin: '0 0 10px', fontSize: 14, fontWeight: 600 }}>What's wrong with this mapping?</legend>
              <div className="opts">
                {FLAG_REASONS.map((r) => (
                  <label key={r} className="opt" style={{ minHeight: 40, padding: '9px 12px' }}>
                    <input type="radio" name="flag-reason" checked={reason === r} onChange={() => setReason(r)} />
                    <span className="opt-text">{r}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor="flag-comment" className="sr-only">
              Details
            </label>
            <textarea id="flag-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Details (optional): which test, file or requirement should it map to?" />
            <span className="panel-meta">Flags go back to the matching pipeline, which re-checks the mapping on the next scan.</span>
            <div className="card-actions" style={{ marginTop: 0 }}>
              <button type="button" className="btn ghost" onClick={closeForm}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Submit flag
              </button>
            </div>
          </form>
        )}

        <div className="actions-row">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn btn-primary" style={{ padding: '0 14px' }} aria-pressed={!!fb.reviewed} onClick={() => giveFeedback(req.id, { reviewed: !fb.reviewed }, { kind: fb.reviewed ? 'unreviewed' : 'reviewed' })}>
              <Check size={15} strokeWidth={2} aria-hidden />
              <span>{fb.reviewed ? 'Reviewed' : 'Mark as reviewed'}</span>
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setForm(form === 'note' ? null : 'note')}>
              <Pencil size={15} {...stroke} />
              <span>Add a note</span>
            </button>
            {req.status !== 'covered' && (
              <button type="button" className="btn btn-outline" onClick={() => handoffToPipeline(conversationId, req.areaSlug, [req.id])}>
                <Sparkles size={15} {...stroke} />
                <span>Close with Matrix</span>
              </button>
            )}
          </div>
          <button type="button" className="btn ghost" style={{ color: 'var(--mx-text-secondary)', padding: '0 12px' }} onClick={() => setForm(form === 'flag' ? null : 'flag')} disabled={!!fb.flag}>
            <Flag size={15} {...stroke} />
            <span>{fb.flag ? 'Mapping flagged' : 'Flag incorrect mapping'}</span>
          </button>
        </div>

        <TeamReviewSection conversationId={conversationId} target={{ kind: 'requirement', frId: req.id, runId }} />

        {!isFr214 && (
          <button type="button" className="chip chip-follow" style={{ alignSelf: 'flex-start' }} onClick={() => runChip(conversationId, { kind: 'say', text: `Explain ${req.id} in detail.` })}>
            Ask Matrix about {req.id}
          </button>
        )}
      </div>
    </SidePanel>
  )
}

function SourceExcerpt({ req, detail }: { req: Requirement; detail: { fileName: string; lines: string; code: typeof FR214_DETAIL.code | null } }) {
  return (
    <section aria-label="Source evidence" style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 13, fontWeight: 500 }}>
          <FileText size={15} color="var(--mx-text-secondary)" {...stroke} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail.fileName}</span>
        </span>
        <a href="#" onClick={(e) => e.preventDefault()} className="ghost row-btn" style={{ gap: 6, padding: '0 8px', whiteSpace: 'nowrap' }}>
          View in GitHub <ExternalLink size={14} {...stroke} />
        </a>
      </div>
      {detail.code ? (
        <div className="code">
          <div className="code-grid">
            {detail.code.map((l, i) => (
              <span key={i} style={{ display: 'contents' }}>
                <span className={`ln ${'hl' in l && l.hl ? 'hl' : ''}`}>{l.n}</span>
                <span className={'hl' in l && l.hl ? 'hl' : 'collapsed' in l || 'muted' in l ? 'muted' : ''}>{l.text}</span>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="code secondary" style={{ fontSize: 13 }}>
          Excerpt not loaded in this prototype.
        </div>
      )}
      <span style={{ fontSize: 12.5, color: 'var(--mx-text-secondary)' }}>
        {req.status === 'uncovered'
          ? `Lines ${detail.lines} are the identified logic. No test in ${TEST_REPO} references them.`
          : `Lines ${detail.lines} are the identified logic, referenced by ${req.evidence}.`}
      </span>
    </section>
  )
}

function WhyCallout({ req }: { req: Requirement }) {
  if (req.status === 'covered') {
    return (
      <section aria-label="Test evidence" className="callout">
        <h3>Test evidence</h3>
        <ul>
          <li>
            <StatusMarker status="covered" size="sm" />
            <span>
              {req.evidence} exercises this requirement directly. If that test doesn't actually cover it, flag the mapping below.
            </span>
          </li>
        </ul>
      </section>
    )
  }
  const items =
    req.status === 'partial'
      ? [`${req.evidence} touches this logic but doesn't assert the requirement's outcome.`, 'Error and edge-case paths have no matching test.', 'Flag it below if the mapping looks wrong.']
      : [
          `No test in ${TEST_REPO} exercises it through ${req.components.join(' or ')}.`,
          'No unit or integration test references this validation logic.',
          'This likely indicates a coverage gap — or a mapping Matrix could not make. Flag it below if the mapping looks wrong.',
        ]
  return (
    <section aria-label={req.status === 'partial' ? 'Why the evidence is partial' : 'Why there is no test evidence'} className="callout">
      <h3>{req.status === 'partial' ? 'Why the evidence is partial' : "Why there's no test evidence"}</h3>
      <ul>
        {items.map((t) => (
          <li key={t}>
            <StatusMarker status="uncovered" size="sm" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
