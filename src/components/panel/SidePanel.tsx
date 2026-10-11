import { useEffect, useRef, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, MoreHorizontal, X } from 'lucide-react'
import { stroke } from '../icons'

export interface Crumb {
  label: string
  to?: string
}

export function SidePanel({
  label,
  title,
  meta,
  crumbs,
  actions,
  closeTo,
  children,
}: {
  label: string
  title?: ReactNode
  meta?: ReactNode
  crumbs?: Crumb[]
  actions?: ReactNode
  closeTo: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  const ref = useRef<HTMLElement>(null)
  // New panel view: start at the top.
  useEffect(() => {
    ref.current?.scrollTo?.({ top: 0 })
    // Narrow screens: the panel isn't beside the chat, so bring it into view.
    // (Phone shows it full screen; tablet stacks it under the chat.)
    if (window.matchMedia('(max-width: 1239px)').matches) {
      requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'start' }))
    }
  }, [label])

  return (
    <aside className="panel" aria-label={label} ref={ref}>
      <div className="panel-head">
        <button type="button" className="ghost panel-back" onClick={() => navigate(closeTo)}>
          <ArrowLeft size={16} strokeWidth={2} aria-hidden />
          Chat
        </button>
        <div className="panel-title">
          {crumbs && (
            <nav aria-label="Breadcrumb" className="breadcrumb">
              {crumbs.map((c, i) => (
                <span key={c.label} style={{ display: 'contents' }}>
                  {i > 0 && <ChevronRight size={12} strokeWidth={2} aria-hidden />}
                  {c.to ? (
                    <Link to={c.to}>{c.label}</Link>
                  ) : (
                    <span className={i === crumbs.length - 1 && !title ? 'current' : ''} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
                      {c.label}
                    </span>
                  )}
                </span>
              ))}
            </nav>
          )}
          {title && <span style={{ fontSize: 15, fontWeight: 500 }}>{title}</span>}
          {meta && <span className="panel-meta">{meta}</span>}
        </div>
        <div className="panel-actions">
          {actions}
          <button type="button" className="ghost icon-btn sm" aria-label="More actions">
            <MoreHorizontal size={16} {...stroke} />
          </button>
          <button type="button" className="ghost icon-btn sm" aria-label="Close panel" onClick={() => navigate(closeTo)}>
            <X size={16} {...stroke} />
          </button>
        </div>
      </div>
      {children}
    </aside>
  )
}
