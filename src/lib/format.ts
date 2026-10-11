export function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${s}s`
  return `${s}s`
}

export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function formatDateTime(ts: number) {
  const d = new Date(ts)
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${date}, ${formatTime(ts)}`
}

export function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export const paths = {
  conversation: (c: string) => `/c/${c}`,
  report: (c: string, r: string) => `/c/${c}/runs/${r}/report`,
  area: (c: string, r: string, slug: string) => `/c/${c}/runs/${r}/report/areas/${slug}`,
  requirement: (c: string, r: string, fr: string) => `/c/${c}/runs/${r}/report/requirements/${fr}`,
  batch: (c: string, b: string) => `/c/${c}/batches/${b}`,
  remediation: (c: string, r: string, view?: string) => `/c/${c}/remediation/${r}${view ? `/${view}` : ''}`,
  pipeline: (c: string, p: string, view?: string) => `/c/${c}/pipelines/${p}${view ? `/${view}` : ''}`,
}
