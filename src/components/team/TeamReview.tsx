import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BellRing, Check, MessageSquare, RotateCcw, Users } from 'lucide-react'
import { stroke } from '../icons'
import { Avatar, PeoplePicker } from './PeoplePicker'
import { person, suggestedFor, targetLabel } from '../../team/roster'
import { formatTime } from '../../lib/format'
import { useStore } from '../../state/store'
import type { ReviewTarget, ReviewerStatus, TeamReview } from '../../state/types'

const STATUS: Record<ReviewerStatus, { label: string; Icon: typeof Check }> = {
  waiting: { label: 'Waiting', Icon: Users },
  approved: { label: 'Approved', Icon: Check },
  commented: { label: 'Commented', Icon: MessageSquare },
  changes: { label: 'Suggested changes', Icon: RotateCcw },
}

interface Draft {
  open: boolean
  people: string[]
  picked: string[]
  note: string
}
const EMPTY: Draft = { open: false, people: [], picked: [], note: '' }

/**
 * A half-written review request survives the section re-mounting (switching
 * stage views, the panel re-rendering for a new route), keyed by its target.
 */
const drafts = new Map<string, Draft>()
const targetKey = (t: ReviewTarget) => (t.kind === 'stage' ? `${t.pipelineId}:${t.stage}` : `req:${t.frId}`)

function useDraft(t: ReviewTarget) {
  const key = targetKey(t)
  const [draft, setDraft] = useState<Draft>(() => drafts.get(key) ?? EMPTY)
  useEffect(() => {
    setDraft(drafts.get(key) ?? EMPTY)
  }, [key])
  const update = (patch: Partial<Draft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch }
      if (next.open) drafts.set(key, next)
      else drafts.delete(key)
      return next
    })
  return [draft, update] as const
}

/** Items the open deep link (?review=…) points at, for highlighting in the stage view. */
export function useFocusedReviewItems(): Set<string> {
  const [params] = useSearchParams()
  const { state } = useStore()
  const r = state.reviews[params.get('review') ?? '']
  return new Set(r?.items ?? [])
}

const who = (id: string) => (id === 'You' ? 'sp' : id) // reviews saved before people had ids

export function sameTarget(a: ReviewTarget, b: ReviewTarget) {
  if (a.kind === 'stage' && b.kind === 'stage') return a.pipelineId === b.pipelineId && a.stage === b.stage
  if (a.kind === 'requirement' && b.kind === 'requirement') return a.frId === b.frId
  return false
}

export function useReviews(target: ReviewTarget) {
  const { state } = useStore()
  return Object.values(state.reviews)
    .filter((r) => sameTarget(r.target, target))
    .sort((a, b) => b.requestedAt - a.requestedAt)
}

/** One-line status for gate bars: "Team review: 2 of 3 replied · 1 suggested changes". */
export function reviewSummary(reviews: TeamReview[]) {
  const open = reviews.filter((r) => !r.resolved)
  if (!open.length) return null
  const all = open.flatMap((r) => r.reviewers)
  const replied = all.filter((x) => x.status !== 'waiting').length
  const changes = all.filter((x) => x.status === 'changes').length
  return `Team review: ${replied} of ${all.length} replied${changes ? ` · ${changes} suggested changes` : ''}`
}

/**
 * Team review for anything in the panel. The author tags teammates; their
 * replies are advice for the gate owner, never the gate decision itself.
 */
export function TeamReviewSection({
  conversationId,
  target,
  items,
  onUseSuggestion,
}: {
  conversationId: string
  target: ReviewTarget
  /** Things the author can point reviewers at, e.g. test cases. */
  items?: { id: string; label: string }[]
  /** Offered on "Suggested changes" replies when the stage's gate is waiting. */
  onUseSuggestion?: (text: string) => void
}) {
  const { state, requestReview, resolveReview, nudgeReviewer } = useStore()
  const reviews = useReviews(target)
  const viewer = state.viewer
  const isOwner = (state.conversations[conversationId]?.owner ?? 'sp') === viewer
  const [params] = useSearchParams()
  const focusId = params.get('review')
  useEffect(() => {
    if (focusId) setTimeout(() => document.getElementById(`review-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120)
  }, [focusId])
  const [{ open, people, picked, note }, update] = useDraft(target)
  const setOpen = (v: boolean) => update({ open: v })
  const setPeople = (v: string[]) => update({ people: v })
  const setPicked = (v: string[]) => update({ picked: v })
  const setNote = (v: string) => update({ note: v })
  const what = targetLabel(target)

  const reset = () => update({ ...EMPTY })

  return (
    <section className="team-review" id="team-review" aria-label="Team review">
      <div className="section-head">
        <h3>Team review</h3>
        {!open && isOwner && (
          <button type="button" className="btn btn-outline" style={{ height: 36, fontSize: 13.5 }} onClick={() => setOpen(true)}>
            <Users size={15} {...stroke} />
            Ask your team
          </button>
        )}
      </div>

      {open && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!people.length) return
            requestReview(conversationId, target, people, picked, note.trim())
            reset()
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Who should review the {what}?</span>
            <PeoplePicker value={people} onChange={setPeople} suggested={suggestedFor(target)} />
          </div>
          {items && items.length > 0 && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ padding: 0, marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
                Point them at <span className="secondary" style={{ fontWeight: 400 }}>· optional, leave empty for everything</span>
              </legend>
              <div className="item-picks">
                {items.map((it) => (
                  <label key={it.id} className="row-check" style={{ fontSize: 13.5 }}>
                    <input type="checkbox" className="check" checked={picked.includes(it.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, it.id] : picked.filter((x) => x !== it.id))} />
                    <span className="mono secondary" style={{ fontSize: 12.5 }}>
                      {it.id}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label htmlFor="review-note" style={{ fontSize: 14, fontWeight: 600 }}>
            Note <span className="secondary" style={{ fontWeight: 400 }}>· optional</span>
          </label>
          <textarea id="review-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should they look at? e.g. are the boundary cases enough for the cut-off rule?" />
          <div className="card-actions" style={{ marginTop: 0 }}>
            <span className="secondary" style={{ fontSize: 13, marginRight: 'auto' }}>
              Replies are advice; the gate decision stays with its owner.
            </span>
            <button type="button" className="btn ghost" onClick={reset}>
              Cancel
            </button>
            <button type="submit" className="btn btn-go" disabled={!people.length}>
              Send for review{people.length > 1 ? ` (${people.length})` : ''}
            </button>
          </div>
        </form>
      )}

      {reviews.length === 0 && !open && (
        <p className="secondary" style={{ margin: 0, fontSize: 13.5 }}>
          {isOwner ? `Tag people in your team to look over the ${what} before you decide.` : `No review requests on the ${what}.`}
        </p>
      )}

      {reviews.map((r) => (
        <article key={r.id} id={`review-${r.id}`} className={`review ${r.resolved ? 'resolved' : ''} ${focusId === r.id ? 'focused' : ''}`} aria-label={`Review requested ${formatTime(r.requestedAt)}`}>
          <header className="review-head">
            <span>
              <strong style={{ fontWeight: 500 }}>{who(r.requestedBy) === viewer ? 'You' : person(who(r.requestedBy)).name}</strong> asked {r.reviewers.length} {r.reviewers.length === 1 ? 'person' : 'people'} · {formatTime(r.requestedAt)}
              {r.items.length > 0 && (
                <span className="secondary">
                  {' '}
                  · on{' '}
                  {r.items.map((id) => (
                    <span key={id} className="mono source" style={{ marginLeft: 4 }}>
                      {id}
                    </span>
                  ))}
                </span>
              )}
            </span>
            {who(r.requestedBy) === viewer && (
              <button type="button" className="btn ghost" style={{ height: 30, fontSize: 13, padding: '0 10px' }} onClick={() => resolveReview(r.id, !r.resolved)}>
                {r.resolved ? 'Reopen' : 'Mark resolved'}
              </button>
            )}
          </header>
          {r.note && <p className="review-note">“{r.note}”</p>}
          <ul className="reviewers">
            {r.reviewers.map((x) => {
              const p = person(x.personId)
              const st = STATUS[x.status]
              return (
                <li key={x.personId} className={`reviewer ${x.status}`}>
                  <Avatar p={p} size={28} />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong style={{ fontWeight: 500 }}>{p.name}</strong>
                      <span className="panel-meta">{p.role}</span>
                      <span className={`review-status ${x.status}`}>
                        <st.Icon size={13} strokeWidth={x.status === 'approved' ? 2.5 : 1.75} aria-hidden />
                        {st.label}
                        {x.respondedAt ? ` · ${formatTime(x.respondedAt)}` : ''}
                      </span>
                    </span>
                    {x.comment && <span style={{ fontSize: 14 }}>{x.comment}</span>}
                    {x.status === 'waiting' && x.personId === viewer && !r.resolved && <ReplyBox reviewId={r.id} planned={x.planned} />}
                    {x.status === 'waiting' && x.personId !== viewer && who(r.requestedBy) === viewer && !r.resolved && (
                      <button
                        type="button"
                        className="btn ghost"
                        style={{ alignSelf: 'flex-start', height: 30, fontSize: 13, padding: '0 8px', gap: 6 }}
                        disabled={!!x.nudgedAt && Date.now() - x.nudgedAt < 60_000}
                        onClick={() => nudgeReviewer(r.id, x.personId)}
                      >
                        <BellRing size={14} {...stroke} />
                        {x.nudgedAt ? `Nudged ${formatTime(x.nudgedAt)}` : 'Nudge'}
                      </button>
                    )}
                    {x.status === 'changes' && onUseSuggestion && isOwner && !r.resolved && (
                      <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start', height: 32, fontSize: 13, padding: '0 10px', marginTop: 4 }} onClick={() => onUseSuggestion(`${p.name}: ${x.comment}`)}>
                        Send to Matrix as a change request
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </article>
      ))}
    </section>
  )
}

const REPLY_OPTIONS: { status: 'approved' | 'commented' | 'changes'; label: string }[] = [
  { status: 'approved', label: 'Approve' },
  { status: 'commented', label: 'Comment' },
  { status: 'changes', label: 'Suggest changes' },
]

/** The tagged reviewer's reply. Prefilled with a suggestion (prototype content) they can edit. */
function ReplyBox({ reviewId, planned }: { reviewId: string; planned: { status: 'approved' | 'commented' | 'changes'; comment: string } }) {
  const { replyReview } = useStore()
  const [status, setStatus] = useState(planned.status)
  const [comment, setComment] = useState(planned.comment)
  return (
    <form
      className="reply-box"
      onSubmit={(e) => {
        e.preventDefault()
        if (status !== 'approved' && !comment.trim()) return
        replyReview(reviewId, status, comment.trim())
      }}
    >
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ padding: 0, marginBottom: 8, fontSize: 13.5, fontWeight: 600 }}>Your review</legend>
        <div role="radiogroup" className="segmented">
          {REPLY_OPTIONS.map((o) => (
            <button key={o.status} type="button" role="radio" aria-checked={status === o.status} aria-pressed={status === o.status} onClick={() => setStatus(o.status)}>
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>
      <label htmlFor={`reply-${reviewId}`} className="panel-meta">
        Suggested reply · edit before sending
      </label>
      <textarea id={`reply-${reviewId}`} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={status === 'approved' ? 'Optional comment' : 'What should change, and why?'} />
      <div className="card-actions" style={{ marginTop: 0, justifyContent: 'flex-start' }}>
        <button type="submit" className="btn btn-primary" disabled={status !== 'approved' && !comment.trim()}>
          Send review
        </button>
        <span className="panel-meta">Goes to the requester; the gate decision stays with its owner.</span>
      </div>
    </form>
  )
}
