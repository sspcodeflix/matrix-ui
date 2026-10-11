import { useEffect, useState } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'

const KEY = 'matrix.theme'
export const DEFAULT_THEME: ThemePref = 'dark'

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

const media = () => window.matchMedia('(prefers-color-scheme: dark)')

export function applyTheme(pref: ThemePref) {
  const resolved = pref === 'system' ? (media().matches ? 'dark' : 'light') : pref
  document.documentElement.dataset.theme = resolved
}

/** Theme preference, persisted per browser. "system" follows the OS live. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readThemePref)

  useEffect(() => {
    applyTheme(pref)
    try {
      localStorage.setItem(KEY, pref)
    } catch {
      /* storage unavailable: theme still applies for this session */
    }
    if (pref !== 'system') return
    const mq = media()
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  return [pref, setPref] as const
}
