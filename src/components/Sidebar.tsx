import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Clock, Inbox, KeyRound, Menu, Plus, Search } from 'lucide-react'
import { Spark, Spinner, stroke } from './icons'
import { useStore } from '../state/store'
import { paths } from '../lib/format'

const DAY = 86_400_000

function group(ts: number) {
  const today = new Date().setHours(0, 0, 0, 0)
  if (ts >= today) return 'Today'
  if (ts >= today - 7 * DAY) return 'Previous 7 days'
  return 'Older'
}

/** Slide-out navigation: new chat, recent conversations, and the other places. */
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useStore()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const newChatRef = useRef<HTMLAnchorElement>(null)
  const viewer = state.viewer

  // Move focus in when the user opens it (not when it's restored open on load); Esc closes it.
  const wasOpen = useRef(open)
  useEffect(() => {
    const justOpened = open && !wasOpen.current
    wasOpen.current = open
    if (!open) return
    if (justOpened) newChatRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const items = useMemo(() => {
    const runs = Object.values(state.runs)
    const pipes = Object.values(state.pipelines)
    const rems = Object.values(state.remediations)
    const q = query.trim().toLowerCase()
    return Object.values(state.conversations)
      .filter((c) => (c.owner ?? 'sp') === viewer)
      .filter((c) => !q || c.title.toLowerCase().includes(q) || (c.app ?? '').toLowerCase().includes(q))
      .map((c) => {
        const running =
          runs.some((r) => r.conversationId === c.id && r.status === 'running') ||
          pipes.some((p) => p.conversationId === c.id && p.status === 'running') ||
          rems.some((r) => r.conversationId === c.id && r.status === 'running')
        const needsYou = pipes.some((p) => p.conversationId === c.id && p.status === 'waiting') || rems.some((r) => r.conversationId === c.id && r.status === 'waiting')
        return { c, running, needsYou, last: c.updatedAt ?? c.createdAt }
      })
      .sort((a, b) => b.last - a.last)
  }, [state.conversations, state.runs, state.pipelines, state.remediations, viewer, query])

  const groups = items.reduce<{ label: string; items: typeof items }[]>((acc, it) => {
    const label = group(it.last)
    const g = acc.find((x) => x.label === label)
    if (g) g.items.push(it)
    else acc.push({ label, items: [it] })
    return acc
  }, [])

  const currentId = location.pathname.match(/^\/c\/([^/]+)/)?.[1]
  const waitingReviews = Object.values(state.reviews).filter((r) => !r.resolved && r.reviewers.some((x) => x.personId === viewer && x.status === 'waiting')).length
    + Object.values(state.remediations).filter((r) => r.gates.coverage?.status === 'waiting' && r.coverage?.requested?.to.includes(viewer)).length

  return (
    <>
      <aside id="app-sidebar" className={`sidebar ${open ? 'open' : ''}`} aria-label="Conversations" aria-hidden={!open} inert={!open ? true : undefined}>
        <div className="sidebar-inner">
        <div className="sidebar-head">
          <button type="button" className="ghost icon-btn" aria-label="Close menu" onClick={onClose}>
            <Menu size={20} {...stroke} />
          </button>
          <Link to="/" className="brand" aria-label="Matrix home">
            <Spark size={22} />
            <span className="brand-name" style={{ fontSize: 19 }}>
              Matrix
            </span>
          </Link>
        </div>

        <Link ref={newChatRef} to="/" className="btn btn-primary sidebar-new">
          <Plus size={16} strokeWidth={2.25} aria-hidden />
          New chat
        </Link>

        <label className="search sidebar-search">
          <Search size={15} {...stroke} />
          <span className="sr-only">Search conversations</span>
          <input type="search" placeholder="Search conversations" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>

        <nav className="sidebar-list" aria-label="Recent conversations">
          {groups.length === 0 && <p className="sidebar-empty">{query ? 'No conversations match.' : 'No conversations yet. Start one with New chat.'}</p>}
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="sidebar-group">{g.label}</h2>
              <ul>
                {g.items.slice(0, 30).map(({ c, running, needsYou }) => (
                  <li key={c.id}>
                    <Link to={paths.conversation(c.id)} className="sidebar-item" aria-current={c.id === currentId ? 'page' : undefined}>
                      <span className="sidebar-title">{c.title}</span>
                      {running ? (
                        <span aria-label="Running">
                          <Spinner size={14} />
                        </span>
                      ) : needsYou ? (
                        <span className="gate-dot static" style={{ margin: 0 }} aria-label="Needs you" />
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>

        <div className="sidebar-foot">
          <NavLink to="/reviews" className="sidebar-link">
            <Inbox size={16} {...stroke} />
            <span style={{ flex: 1 }}>Reviews</span>
            {waitingReviews > 0 && <span className="count-badge">{waitingReviews}</span>}
          </NavLink>
          <NavLink to="/history" className="sidebar-link">
            <Clock size={16} {...stroke} />
            <span style={{ flex: 1 }}>All history</span>
          </NavLink>
          <NavLink to="/settings/connections" className="sidebar-link">
            <KeyRound size={16} {...stroke} />
            <span style={{ flex: 1 }}>Connections</span>
          </NavLink>
        </div>
        </div>
      </aside>
    </>
  )
}
