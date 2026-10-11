/**
 * Per-user secret store (prototype of the enterprise secret manager on the
 * architecture board). Envelope encryption:
 *
 *   master key (KEK) ──wraps──▶ per-user data key (DEK) ──encrypts──▶ each token
 *
 * - Tokens are AES-256-GCM encrypted with the user's DEK. The AAD binds each
 *   ciphertext to `${userId}:${tool}`, so a record can't be moved to another
 *   user or tool and still decrypt.
 * - No endpoint ever returns a token. Only `useSecret()` (called server-side
 *   by the invocation layer) decrypts, and every use is audited without the value.
 * - Deleting a connection deletes its ciphertext; "disconnect all" deletes the
 *   user's DEK (crypto-shredding).
 *
 * Prototype limits: the user comes from an `X-Matrix-User` header (production:
 * the SSO session), the master key comes from MATRIX_MASTER_KEY or a local
 * dev key file (production: a KMS/HSM), and verification is simulated
 * (production: call each tool's "who am I" endpoint with the token).
 *
 *   GET    /api/connections                 -> metadata for the current user
 *   PUT    /api/connections/:tool           { token, baseUrl, expiresAt? } -> metadata
 *   POST   /api/connections/:tool/test      -> metadata (re-verified)
 *   DELETE /api/connections/:tool
 *   DELETE /api/connections                 -> crypto-shred all of the user's secrets
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const TOOLS = {
  jira: { name: 'Jira', defaultUrl: 'https://jira.abcd.example.com' },
  confluence: { name: 'Confluence', defaultUrl: 'https://confluence.abcd.example.com' },
  github: { name: 'GitHub', defaultUrl: 'https://github.abcd.example.com' },
  octane: { name: 'Octane', defaultUrl: 'https://octane.abcd.example.com' },
} as const
export type Tool = keyof typeof TOOLS

interface Sealed {
  iv: string
  tag: string
  data: string
}

interface SecretRecord {
  sealed: Sealed
  baseUrl: string
  last4: string
  createdAt: number
  expiresAt?: number
  verifiedAt?: number
  verifiedAs?: string
  lastUsedAt?: number
  lastUsedFor?: string
}

interface UserVault {
  wrappedKey: Sealed // the user's DEK, encrypted with the master key
  secrets: Partial<Record<Tool, SecretRecord>>
}

const DIR = join(process.cwd(), 'mock', '.data')
const VAULT_FILE = join(DIR, 'vault.json')
const AUDIT_FILE = join(DIR, 'secret-audit.log')
const KEY_FILE = join(DIR, 'master.key')

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 })
}

function masterKey(): Buffer {
  const env = process.env.MATRIX_MASTER_KEY
  if (env) {
    const k = Buffer.from(env, 'base64')
    if (k.length !== 32) throw new Error('MATRIX_MASTER_KEY must be 32 bytes, base64-encoded')
    return k
  }
  ensureDir()
  if (!existsSync(KEY_FILE)) {
    writeFileSync(KEY_FILE, randomBytes(32).toString('base64'), { mode: 0o600 })
    console.warn('[secrets] Generated a local dev master key at mock/.data/master.key. Use a KMS in production.')
  }
  return Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'base64')
}

function seal(key: Buffer, plain: Buffer, aad: string): Sealed {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(Buffer.from(aad))
  const data = Buffer.concat([c.update(plain), c.final()])
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }
}

function open(key: Buffer, s: Sealed, aad: string): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64'))
  d.setAAD(Buffer.from(aad))
  d.setAuthTag(Buffer.from(s.tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(s.data, 'base64')), d.final()])
}

function load(): Record<string, UserVault> {
  try {
    return JSON.parse(readFileSync(VAULT_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function save(v: Record<string, UserVault>) {
  ensureDir()
  writeFileSync(VAULT_FILE, JSON.stringify(v, null, 2), { mode: 0o600 })
  try {
    chmodSync(VAULT_FILE, 0o600)
  } catch {
    /* best effort */
  }
}

function audit(entry: Record<string, unknown>) {
  ensureDir()
  appendFileSync(AUDIT_FILE, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 })
}

function userKey(vault: Record<string, UserVault>, userId: string, create: boolean): Buffer | null {
  const kek = masterKey()
  let u = vault[userId]
  if (!u) {
    if (!create) return null
    const dek = randomBytes(32)
    u = vault[userId] = { wrappedKey: seal(kek, dek, `dek:${userId}`), secrets: {} }
    return dek
  }
  return open(kek, u.wrappedKey, `dek:${userId}`)
}

/** Public view of a connection. Never includes the token. */
function meta(tool: Tool, r: SecretRecord | undefined) {
  if (!r) return { tool, name: TOOLS[tool].name, connected: false as const }
  return {
    tool,
    name: TOOLS[tool].name,
    connected: true as const,
    baseUrl: r.baseUrl,
    last4: r.last4,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    verifiedAt: r.verifiedAt,
    verifiedAs: r.verifiedAs,
    lastUsedAt: r.lastUsedAt,
    lastUsedFor: r.lastUsedFor,
  }
}

/**
 * Simulated "who am I" check. A real implementation calls e.g. Jira
 * /rest/api/2/myself with the token and confirms it belongs to `userId`.
 */
function verify(userId: string, tool: Tool, token: string): { ok: true; as: string } | { ok: false; error: string } {
  if (token.length < 20 || /\s/.test(token)) return { ok: false, error: `That doesn't look like a ${TOOLS[tool].name} token. Tokens are long and have no spaces.` }
  if (/invalid|expired/i.test(token)) return { ok: false, error: `${TOOLS[tool].name} rejected the token (401). Check it hasn't expired or been revoked.` }
  return { ok: true, as: `${userId}@abcd.example.com` }
}

/**
 * Server-side only: decrypt a user's token for one call. This is the
 * invocation layer's door; it records every use. Returns null if missing.
 */
export class UnreadableSecret extends Error {}

export function useSecret(userId: string, tool: Tool, purpose: string): string | null {
  const vault = load()
  const r = vault[userId]?.secrets[tool]
  if (!r) {
    audit({ event: 'secret.missing', userId, tool, purpose })
    return null
  }
  let token: string
  try {
    const key = userKey(vault, userId, false)!
    token = open(key, r.sealed, `${userId}:${tool}`).toString('utf8')
  } catch {
    // Wrong key, moved record or tampered ciphertext: GCM authentication fails.
    audit({ event: 'secret.decrypt_failed', userId, tool, purpose })
    throw new UnreadableSecret()
  }
  r.lastUsedAt = Date.now()
  r.lastUsedFor = purpose
  save(vault)
  audit({ event: 'secret.used', userId, tool, purpose })
  return token
}

export function missingConnections(userId: string, tools: Tool[]): Tool[] {
  const v = load()[userId]
  const now = Date.now()
  return tools.filter((t) => {
    const r = v?.secrets[t]
    return !r || (r.expiresAt !== undefined && r.expiresAt < now)
  })
}

async function readJson(req: IncomingMessage): Promise<any> {
  let body = ''
  for await (const chunk of req) body += chunk
  try {
    return body ? JSON.parse(body) : {}
  } catch {
    return {}
  }
}

function json(res: ServerResponse, status: number, data?: unknown) {
  res.statusCode = status
  res.setHeader('Cache-Control', 'no-store')
  if (data === undefined) return res.end()
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

export function currentUser(req: IncomingMessage) {
  const u = String(req.headers['x-matrix-user'] ?? '').toLowerCase()
  return /^[a-z0-9._-]{1,64}$/.test(u) ? u : null
}

export async function handleSecrets(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/connections')) return false
  const userId = currentUser(req)
  if (!userId) {
    json(res, 401, { error: 'Not signed in.' })
    return true
  }
  const m = url.pathname.match(/^\/api\/connections(?:\/(jira|confluence|github|octane))?(\/test)?$/)
  if (!m) {
    json(res, 404, { error: 'not found' })
    return true
  }
  const tool = m[1] as Tool | undefined
  const vault = load()

  if (req.method === 'GET' && !tool) {
    const secrets = vault[userId]?.secrets ?? {}
    json(res, 200, { connections: (Object.keys(TOOLS) as Tool[]).map((t) => meta(t, secrets[t])) })
    return true
  }

  if (req.method === 'DELETE' && !tool) {
    // Crypto-shred: without the DEK, every ciphertext for this user is unreadable.
    delete vault[userId]
    save(vault)
    audit({ event: 'vault.shredded', userId })
    json(res, 204)
    return true
  }

  if (!tool) {
    json(res, 405, { error: 'method not allowed' })
    return true
  }

  if (req.method === 'PUT' && !m[2]) {
    const body = await readJson(req)
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    const baseUrl = typeof body.baseUrl === 'string' && /^https:\/\/[^\s]+$/.test(body.baseUrl) ? body.baseUrl.replace(/\/+$/, '') : null
    if (!baseUrl) {
      json(res, 400, { error: 'Use the https:// address of your server.' })
      return true
    }
    const expiresAt = typeof body.expiresAt === 'number' ? body.expiresAt : undefined
    if (expiresAt !== undefined && expiresAt < Date.now()) {
      json(res, 400, { error: 'That expiry date is in the past.' })
      return true
    }
    const check = verify(userId, tool, token)
    if (!check.ok) {
      audit({ event: 'secret.rejected', userId, tool })
      json(res, 422, { error: check.error })
      return true
    }
    const dek = userKey(vault, userId, true)!
    vault[userId].secrets[tool] = {
      sealed: seal(dek, Buffer.from(token, 'utf8'), `${userId}:${tool}`),
      baseUrl,
      last4: token.slice(-4),
      createdAt: Date.now(),
      expiresAt,
      verifiedAt: Date.now(),
      verifiedAs: check.as,
    }
    save(vault)
    audit({ event: 'secret.stored', userId, tool })
    json(res, 200, meta(tool, vault[userId].secrets[tool]))
    return true
  }

  if (req.method === 'POST' && m[2]) {
    let token: string | null
    try {
      token = useSecret(userId, tool, 'connection test')
    } catch {
      json(res, 409, { error: 'This token can no longer be decrypted. Disconnect and add it again.' })
      return true
    }
    if (!token) {
      json(res, 404, { error: 'Not connected.' })
      return true
    }
    const check = verify(userId, tool, token)
    const fresh = load()
    const r = fresh[userId].secrets[tool]!
    if (check.ok) {
      r.verifiedAt = Date.now()
      r.verifiedAs = check.as
      save(fresh)
      json(res, 200, meta(tool, r))
    } else {
      json(res, 422, { error: check.error })
    }
    return true
  }

  if (req.method === 'DELETE') {
    if (vault[userId]?.secrets[tool]) {
      delete vault[userId].secrets[tool]
      save(vault)
      audit({ event: 'secret.deleted', userId, tool })
    }
    json(res, 204)
    return true
  }

  json(res, 405, { error: 'method not allowed' })
  return true
}
