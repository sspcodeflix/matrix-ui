import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Bell, Check, Clock, Inbox, KeyRound, Menu, Monitor, Moon, Sun, X } from 'lucide-react'
import { Spark, stroke } from './icons'
import { Popover } from './Popover'
import { useStore } from '../state/store'
import { formatDateTime, paths } from '../lib/format'
import { useTheme, type ThemePref } from '../lib/theme'
import { EVERYONE, person } from '../team/roster'
import { Avatar } from './team/PeoplePicker'

const THEMES: { key: ThemePref; label: string; Icon: typeof Sun }[] = [
  { key: 'light', label: 'Light', Icon: Sun },
  { key: 'dark', label: 'Dark', Icon: Moon },
  { key: 'system', label: 'Match system', Icon: Monitor },
]

export function AppHeader({ menuOpen, onToggleMenu }: { menuOpen: boolean; onToggleMenu: () => void }) {
  const { state, readAllNotifications, setNotification, setViewer } = useStore()
  const navigate = useNavigate()
  const [open, setOpen] = useState<'bell' | 'account' | null>(null)
  const [theme, setTheme] = useTheme()
  const close = () => setOpen(null)
  // Notifications are addressed to a person; show only the viewer's.
  const mine = state.notifications.filter((n) => (n.to ?? 'sp') === state.viewer)
  const unread = mine.some((n) => !n.read)
  const toast = mine.find((n) => n.toast)
  const me = person(state.viewer)
  // Anything still running for this person: the logo breathes while Matrix works in the background.
  const mineConvos = new Set(Object.values(state.conversations).filter((c) => (c.owner ?? 'sp') === state.viewer).map((c) => c.id))
  const busy =
    Object.values(state.runs).filter((r) => r.status === 'running' && mineConvos.has(r.conversationId)).length +
    Object.values(state.pipelines).filter((p) => p.status === 'running' && mineConvos.has(p.conversationId)).length +
    Object.values(state.remediations).filter((r) => r.status === 'running' && mineConvos.has(r.conversationId)).length
  const reviewsWaiting = Object.values(state.reviews).filter((r) => !r.resolved && r.reviewers.some((x) => x.personId === state.viewer && x.status === 'waiting')).length
    + Object.values(state.remediations).filter((r) => r.gates.coverage?.status === 'waiting' && r.coverage?.requested?.to.includes(state.viewer)).length
  const location = useLocation()

  // Don't pop up about a pipeline you're already looking at; count it as read.
  useEffect(() => {
    if (!toast?.href) return
    // A review pop-up clears once you open that review.
    const reviewId = new URLSearchParams(location.search).get('review')
    if (toast.href.includes('?review=')) {
      if (reviewId && toast.href.endsWith(`review=${reviewId}`)) setNotification(toast.id, { toast: false, read: true })
      return // otherwise person-to-person messages always pop up
    }
    const base = toast.href.split('/').slice(0, 5).join('/')
    if (location.pathname.startsWith(base)) setNotification(toast.id, { toast: false, read: true })
  }, [toast, location.pathname, location.search, setNotification])

  const openReport = (id: string) => {
    const n = state.notifications.find((x) => x.id === id)
    if (!n) return
    setNotification(id, { read: true, toast: false })
    navigate(n.href ?? paths.report(n.conversationId, n.runId ?? ''))
    close()
  }

  return (
    <>
      <header className="app-header">
        <div className="header-left">
        <button
          type="button"
          className="ghost icon-btn"
          aria-label={menuOpen ? 'Close menu' : 'Open menu: new chat and history'}
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
          onClick={onToggleMenu}
        >
          <Menu size={20} {...stroke} />
        </button>
        <Link to="/" className={`brand ${busy ? 'busy' : ''}`} aria-label={busy ? `Matrix home, working on ${busy} ${busy === 1 ? 'task' : 'tasks'}` : 'Matrix home'} title={busy ? `Matrix is working on ${busy} ${busy === 1 ? 'task' : 'tasks'}` : undefined}>
          <Spark size={26} />
          <span className="brand-name">Matrix</span>
          <span className="brand-tagline">Measure twice, ship once.</span>
        </Link>
        </div>
        <div className="header-actions">
          <NavLink to="/reviews" className="ghost header-btn" style={{ textDecoration: 'none', color: 'var(--mx-text)' }}>
            <Inbox size={16} {...stroke} />
            <span>Reviews</span>
            {reviewsWaiting > 0 && (
              <span className="count-badge" aria-label={`${reviewsWaiting} waiting for you`}>
                {reviewsWaiting}
              </span>
            )}
          </NavLink>
          <NavLink to="/history" className="ghost header-btn" style={{ textDecoration: 'none', color: 'var(--mx-text)' }}>
            <Clock size={16} {...stroke} />
            <span>History</span>
          </NavLink>

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="ghost icon-btn bell"
              aria-label={unread ? 'Notifications, unread' : 'Notifications'}
              aria-expanded={open === 'bell'}
              onClick={() => {
                setOpen(open === 'bell' ? null : 'bell')
                readAllNotifications()
              }}
            >
              <Bell size={18} {...stroke} />
              {unread && <span className="unread-dot" aria-hidden="true" />}
            </button>
            <Popover open={open === 'bell'} onClose={close} label="Notifications" className="menu" style={{ right: 0, top: 44, width: 340 }}>
              <div className="menu-label">Notifications</div>
              {mine.length === 0 && <div className="menu-empty">Nothing yet. I'll let you know when an analysis finishes.</div>}
              {mine.map((n) => (
                <button key={n.id} type="button" className="menu-item" onClick={() => openReport(n.id)} style={{ alignItems: 'flex-start' }}>
                  <span className="check-badge" style={{ width: 20, height: 20 }}>
                    <Check size={11} strokeWidth={3} aria-hidden />
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontWeight: 500 }}>{n.title}</span>
                    <span className="panel-meta">{n.body}</span>
                    <span className="panel-meta">{formatDateTime(n.createdAt)}</span>
                  </span>
                </button>
              ))}
            </Popover>
          </div>

          <div style={{ position: 'relative' }}>
            <button type="button" className="avatar" aria-label={`Account menu, viewing as ${me.name}`} aria-expanded={open === 'account'} onClick={() => setOpen(open === 'account' ? null : 'account')}>
              {me.initials}
            </button>
            <Popover open={open === 'account'} onClose={close} label="Account" className="menu" style={{ right: 0, top: 42, width: 230 }}>
              <div className="menu-label" id="viewas-label">
                View as <span style={{ fontWeight: 400 }}>· prototype</span>
              </div>
              <div role="group" aria-labelledby="viewas-label" style={{ maxHeight: 260, overflowY: 'auto' }}>
                {EVERYONE.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={state.viewer === p.id}
                    className="menu-item"
                    style={{ width: '100%' }}
                    onClick={() => {
                      setViewer(p.id)
                      close()
                      // A teammate "opening the app" lands on their review inbox, not on SP's screen.
                      if (p.id !== 'sp') navigate('/reviews')
                    }}
                  >
                    <Avatar p={p} size={22} />
                    <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <span>{p.id === 'sp' ? 'SP (you)' : p.name}</span>
                      <span className="panel-meta">{p.role}</span>
                    </span>
                    {state.viewer === p.id && <Check size={15} {...stroke} />}
                  </button>
                ))}
              </div>
              <div className="menu-label" id="theme-label" style={{ borderTop: '1px solid var(--mx-divider)', marginTop: 6, paddingTop: 10 }}>
                Appearance
              </div>
              <div role="group" aria-labelledby="theme-label">
                {THEMES.map(({ key, label, Icon }) => (
                  <button key={key} type="button" role="menuitemradio" aria-checked={theme === key} className="menu-item" style={{ width: '100%' }} onClick={() => setTheme(key)}>
                    <Icon size={16} {...stroke} />
                    <span style={{ flex: 1 }}>{label}</span>
                    {theme === key && <Check size={15} {...stroke} />}
                  </button>
                ))}
              </div>
              <div className="menu-label" style={{ borderTop: '1px solid var(--mx-divider)', marginTop: 6, paddingTop: 10 }}>
                Account
              </div>
              <Link to="/settings/connections" className="menu-item" onClick={close}>
                <KeyRound size={16} {...stroke} />
                Connections
              </Link>
              <div className="menu-label" style={{ borderTop: '1px solid var(--mx-divider)', marginTop: 6, paddingTop: 10 }}>
                Prototype
              </div>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  try {
                    localStorage.clear()
                  } catch {
                    /* ignore */
                  }
                  window.location.assign('/')
                }}
              >
                Reset prototype data
              </button>
            </Popover>
          </div>
        </div>
      </header>

      {state.viewer !== 'sp' && (
        <div className="viewas-banner" role="status">
          <Avatar p={me} size={22} />
          <span>
            Viewing as <strong>{me.name}</strong> <span className="secondary">· {me.role}</span>
          </span>
          <button type="button" className="btn btn-outline" style={{ height: 30, fontSize: 13, padding: '0 10px', marginLeft: 'auto' }} onClick={() => setViewer('sp')}>
            Switch back to SP
          </button>
        </div>
      )}

      {toast && (
        <div className={`popover toast ${state.viewer !== 'sp' ? 'below-banner' : ''}`} role="status" aria-live="polite">
          <span className="check-badge">
            <Check size={13} strokeWidth={3} aria-hidden />
          </span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{toast.title}</span>
              <span style={{ fontSize: 13, color: 'var(--mx-text-secondary)', lineHeight: 1.45 }}>{toast.body}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-primary" style={{ height: 32, padding: '0 12px', borderRadius: 8, fontSize: 13 }} onClick={() => openReport(toast.id)}>
                {toast.action ?? 'Open report'}
              </button>
              <button type="button" className="btn ghost" style={{ height: 32, padding: '0 10px', borderRadius: 8, fontSize: 13 }} onClick={() => setNotification(toast.id, { toast: false })}>
                Later
              </button>
            </div>
          </div>
          <button type="button" className="ghost icon-btn" aria-label="Dismiss notification" style={{ width: 28, height: 28, borderRadius: 8, color: 'var(--mx-text-secondary)' }} onClick={() => setNotification(toast.id, { toast: false })}>
            <X size={14} strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}
    </>
  )
}
