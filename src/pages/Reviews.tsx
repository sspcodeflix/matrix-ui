import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Inbox } from 'lucide-react'
import { stroke } from '../components/icons'
import { Avatar } from '../components/team/PeoplePicker'
import { AREAS } from '../data/report'
import { formatDateTime, paths } from '../lib/format'
import { person, targetLabel } from '../team/roster'
import { useStore } from '../state/store'
import type { TeamReview } from '../state/types'

type Filter = 'waiting' | 'done' | 'sent'

function href(r: TeamReview) {
  const base = r.target.kind === 'stage' ? paths.pipeline(r.conversationId, r.target.pipelineId, r.target.stage) : paths.requirement(r.conversationId, r.target.runId, r.target.frId)
  return `${base}?review=${r.id}`
}

/** Review requests addressed to the current viewer, plus the ones they sent. */
export function Reviews() {
  const { state } = useStore()
  const viewer = state.viewer
  const me = person(viewer)
  const all = Object.values(state.reviews).sort((a, b) => b.requestedAt - a.requestedAt)
  const forMe = all.filter((r) => r.reviewers.some((x) => x.personId === viewer))
  const mine = (r: TeamReview) => r.reviewers.find((x) => x.personId === viewer)!
  const waiting = forMe.filter((r) => !r.resolved && mine(r).status === 'waiting')
  const done = forMe.filter((r) => r.resolved || mine(r).status !== 'waiting')
  const sent = all.filter((r) => (r.requestedBy === 'You' ? 'sp' : r.requestedBy) === viewer)
  // Requests to add tests before a security fix's PR can be raised.
  const asks = Object.values(state.remediations).filter((r) => r.gates.coverage?.status === 'waiting' && r.coverage?.requested?.to.includes(viewer))
  const [filter, setFilter] = useState<Filter>(waiting.length || asks.length || !sent.length ? 'waiting' : 'sent')
  const list = filter === 'waiting' ? waiting : filter === 'done' ? done : sent
  const shownAsks = filter === 'waiting' ? asks : []

  return (
    <main className="history">
      <div className="history-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1>Reviews</h1>
          <p className="secondary" style={{ margin: 0, fontSize: 15 }}>
            {viewer === 'sp' ? 'Reviews you were asked for, and the ones you sent.' : `What ${me.name} has been asked to review.`}
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div role="group" aria-label="Filter reviews" className="segmented">
          {(
            [
              ['waiting', 'Waiting for you', waiting.length + asks.length],
              ['done', 'Replied', done.length],
              ['sent', 'Sent by you', sent.length],
            ] as const
          ).map(([key, label, n]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label} <span className="count">{n}</span>
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 && shownAsks.length === 0 ? (
        <div className="history-empty">
          <span className="icon-tile">
            <Inbox size={18} {...stroke} />
          </span>
          <p className="prose">{filter === 'waiting' ? 'Nothing waiting for you.' : filter === 'done' ? 'No replies yet.' : 'You haven’t asked anyone for a review.'}</p>
          {filter === 'sent' && (
            <p className="secondary" style={{ margin: 0, fontSize: 14 }}>
              Use “Ask your team” on any pipeline stage or requirement.
            </p>
          )}
        </div>
      ) : (
        <ul className="history-list">
          {shownAsks.map((r) => {
            const asker = person(r.owner ?? 'sp')
            const open = r.coverage!.gaps.filter((id) => !r.coverage!.closed.includes(id))
            const to = paths.remediation(r.conversationId, r.id, 'coverage')
            return (
              <li key={r.id} className="history-row">
                <Avatar p={asker} size={32} />
                <div className="history-main">
                  <Link to={to} className="history-title">
                    {asker.name} asked you to add tests before a security fix PR
                  </Link>
                  {r.coverage!.requested!.note && <span className="history-preview">“{r.coverage!.requested!.note}”</span>}
                  <span className="history-meta">
                    <span>{r.app}</span>
                    <span className="mono">{open.slice(0, 3).join(', ')}{open.length > 3 ? ` +${open.length - 3}` : ''}</span>
                    <span>{formatDateTime(r.coverage!.requested!.at)}</span>
                  </span>
                </div>
                <div className="history-side">
                  <span className="history-status">{open.length} untested</span>
                  <Link to={to} className="btn btn-primary" style={{ height: 34, fontSize: 13 }}>
                    Open
                  </Link>
                </div>
              </li>
            )
          })}
          {list.map((r) => {
            const asker = person(r.requestedBy === 'You' ? 'sp' : r.requestedBy)
            const t = r.target
            const area = t.kind === 'stage' ? AREAS.find((a) => a.slug === state.pipelines[t.pipelineId]?.areaSlug)?.name : t.frId
            const replied = r.reviewers.filter((x) => x.status !== 'waiting').length
            const myState = r.reviewers.find((x) => x.personId === viewer)
            return (
              <li key={r.id} className="history-row">
                <Avatar p={filter === 'sent' ? person(r.reviewers[0].personId) : asker} size={32} />
                <div className="history-main">
                  <Link to={href(r)} className="history-title">
                    {filter === 'sent' ? `You asked ${r.reviewers.map((x) => person(x.personId).name).join(', ')}` : `${asker.name} asked you`} to review the {targetLabel(r.target)}
                  </Link>
                  {r.note && <span className="history-preview">“{r.note}”</span>}
                  <span className="history-meta">
                    {area && <span>{area}</span>}
                    {r.items.length > 0 && <span className="mono">{r.items.slice(0, 3).join(', ')}{r.items.length > 3 ? ` +${r.items.length - 3}` : ''}</span>}
                    <span>{formatDateTime(r.requestedAt)}</span>
                  </span>
                </div>
                <div className="history-side">
                  <span className="history-status">
                    {filter === 'sent'
                      ? `${replied} of ${r.reviewers.length} replied${r.resolved ? ' · resolved' : ''}`
                      : myState?.status === 'waiting'
                        ? 'Waiting for you'
                        : myState?.status === 'approved'
                          ? 'You approved'
                          : myState?.status === 'changes'
                            ? 'You suggested changes'
                            : 'You commented'}
                  </span>
                  <Link to={href(r)} className={`btn ${filter === 'waiting' ? 'btn-primary' : 'btn-outline'}`} style={{ height: 34, fontSize: 13 }}>
                    {filter === 'waiting' ? 'Review' : 'Open'}
                  </Link>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
