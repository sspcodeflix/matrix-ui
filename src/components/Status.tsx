import type { Coverage } from '../data/report'

const LABEL: Record<Coverage, string> = { covered: 'Covered', partial: 'Partial', uncovered: 'Uncovered' }

export function StatusMarker({ status, size }: { status: Coverage; size?: 'sm' }) {
  return <span className={`marker ${status} ${size ?? ''}`} aria-hidden="true" />
}

/** Marker + text. Status colours never appear without a label. */
export function StatusText({ status, label }: { status: Coverage; label?: string }) {
  return (
    <span className="status">
      <StatusMarker status={status} />
      {label ?? LABEL[status]}
    </span>
  )
}

export function StatusPill({ status }: { status: Coverage }) {
  return (
    <span className="pill">
      <StatusMarker status={status} size="sm" />
      {LABEL[status]}
    </span>
  )
}
