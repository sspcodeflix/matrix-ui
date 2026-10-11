import { useCallback, useEffect, useState } from 'react'

/**
 * Prototype identity. In production the backend takes the user from the SSO
 * session cookie; the browser never asserts who it is.
 */
export const CURRENT_USER = 'sp'

export function api(path: string, init: RequestInit = {}) {
  return fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Matrix-User': CURRENT_USER, ...(init.headers ?? {}) },
    credentials: 'same-origin',
    cache: 'no-store',
  })
}

export type ToolId = 'jira' | 'confluence' | 'github' | 'octane'

export type Connection =
  | { tool: ToolId; name: string; connected: false }
  | {
      tool: ToolId
      name: string
      connected: true
      baseUrl: string
      last4: string
      createdAt: number
      expiresAt?: number
      verifiedAt?: number
      verifiedAs?: string
      lastUsedAt?: number
      lastUsedFor?: string
    }

export const REQUIRED_FOR_PIPELINE: ToolId[] = ['jira', 'github', 'octane']

export const isExpired = (c: Connection) => c.connected && c.expiresAt !== undefined && c.expiresAt < Date.now()
export const expiresSoon = (c: Connection) => c.connected && c.expiresAt !== undefined && !isExpired(c) && c.expiresAt - Date.now() < 14 * 86_400_000

/** The current user's connections (metadata only; tokens never come back). */
export function useConnections() {
  const [connections, setConnections] = useState<Connection[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      const res = await api('/api/connections')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load connections.')
      setConnections(((await res.json()) as { connections: Connection[] }).connections)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load connections.')
    }
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])
  return { connections, error, refresh }
}
