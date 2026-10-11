import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'

/** Minimal anchored popover: closes on outside click and Escape. */
export function Popover({
  open,
  onClose,
  children,
  style,
  className = '',
  label,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  style?: CSSProperties
  className?: string
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const anchor = ref.current?.parentElement
      if (anchor && !anchor.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div ref={ref} className={`popover ${className}`} role="dialog" aria-label={label} style={style}>
      {children}
    </div>
  )
}
