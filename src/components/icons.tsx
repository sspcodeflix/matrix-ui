export function Spark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M12 2C12.7 8.2 15.8 11.3 22 12C15.8 12.7 12.7 15.8 12 22C11.3 15.8 8.2 12.7 2 12C8.2 11.3 11.3 8.2 12 2Z" fill="var(--mx-accent)" />
    </svg>
  )
}

/** Running state: track ring + brand-green arc. The accent's only motion use. */
export function Spinner({ size = 22 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--mx-track)" strokeWidth="2" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="var(--mx-accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** Filled square used for Stop. */
export function StopGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

export const stroke = { strokeWidth: 1.75, 'aria-hidden': true } as const
