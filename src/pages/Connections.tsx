import { useState } from 'react'
import { Check, KeyRound, Lock, RefreshCw, Trash2 } from 'lucide-react'
import { stroke } from '../components/icons'
import { REQUIRED_FOR_PIPELINE, api, expiresSoon, isExpired, useConnections, type Connection } from '../lib/api'
import { formatDateTime } from '../lib/format'

const DEFAULT_URL: Record<string, string> = {
  jira: 'https://jira.abcd.example.com',
  confluence: 'https://confluence.abcd.example.com',
  github: 'https://github.abcd.example.com',
  octane: 'https://octane.abcd.example.com',
}

const HELP: Record<string, string> = {
  jira: 'Profile → Personal Access Tokens. Read access to ABCD projects, plus write for status updates.',
  confluence: 'Profile → Personal Access Tokens. Read access is enough.',
  github: 'Settings → Developer settings → fine-grained token with repo contents and pull requests.',
  octane: 'API access key for your workspace, with permission to create test sets.',
}

const USED_FOR: Record<string, string> = {
  jira: 'Reads stories and criteria; marks delivered stories Tested.',
  confluence: 'Reads linked specs during story intake. Optional.',
  github: 'Reads repos and opens the automation pull request.',
  octane: 'Records test sets and runs at delivery.',
}

export function Connections() {
  const { connections, error, refresh } = useConnections()
  const [shredding, setShredding] = useState(false)

  return (
    <main className="history">
      <div className="history-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1>Connections</h1>
          <p className="secondary" style={{ margin: 0, fontSize: 15, maxWidth: 560 }}>
            Matrix acts as you in these tools. Your tokens are encrypted with a key only you have, and they're never shown again after you save them.
          </p>
        </div>
      </div>

      <section className="vault-note" aria-label="How tokens are stored">
        <Lock size={16} {...stroke} />
        <span>
          Each token is encrypted with your own key, which is itself encrypted with a master key the browser never sees. Only the service that calls the tool can decrypt it, at the moment of the call, and every use is recorded in the audit log.
        </span>
      </section>

      {error && <p className="secondary">{error}</p>}
      {!connections && !error && <p className="secondary">Loading…</p>}

      <div className="conn-list">
        {connections?.map((c) => (
          <ConnectionCard key={c.tool} c={c} onChange={refresh} />
        ))}
      </div>

      {connections?.some((c) => c.connected) && (
        <section className="danger-zone" aria-label="Remove all">
          <div>
            <strong style={{ fontWeight: 600 }}>Disconnect everything</strong>
            <p className="secondary" style={{ margin: '2px 0 0', fontSize: 13.5 }}>
              Destroys your encryption key, so every token you've stored becomes unreadable. Running pipelines will stop at their next tool call.
            </p>
          </div>
          {shredding ? (
            <span style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn ghost" onClick={() => setShredding(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  await api('/api/connections', { method: 'DELETE' })
                  setShredding(false)
                  refresh()
                }}
              >
                Disconnect all
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn-outline" onClick={() => setShredding(true)}>
              Disconnect all…
            </button>
          )}
        </section>
      )}
    </main>
  )
}

function ConnectionCard({ c, onChange }: { c: Connection; onChange: () => void }) {
  const [editing, setEditing] = useState(!c.connected)
  const [token, setToken] = useState('')
  const [baseUrl, setBaseUrl] = useState(c.connected ? c.baseUrl : DEFAULT_URL[c.tool])
  const [expires, setExpires] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const required = REQUIRED_FOR_PIPELINE.includes(c.tool)

  const save = async () => {
    setBusy('save')
    setMessage(null)
    try {
      const res = await api(`/api/connections/${c.tool}`, {
        method: 'PUT',
        body: JSON.stringify({ token, baseUrl, expiresAt: expires ? new Date(`${expires}T23:59:59`).getTime() : undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setToken('') // Drop it from memory straight away.
      setEditing(false)
      setMessage({ kind: 'ok', text: `Saved and verified as ${data.verifiedAs}.` })
      onChange()
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Could not save.' })
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setBusy('test')
    setMessage(null)
    const res = await api(`/api/connections/${c.tool}/test`, { method: 'POST' })
    const data = await res.json()
    setMessage(res.ok ? { kind: 'ok', text: `Still works · verified as ${data.verifiedAs}.` } : { kind: 'error', text: data.error })
    setBusy(null)
    onChange()
  }

  const remove = async () => {
    setBusy('delete')
    await api(`/api/connections/${c.tool}`, { method: 'DELETE' })
    setBusy(null)
    setMessage(null)
    setEditing(true)
    onChange()
  }

  const status = !c.connected ? 'Not connected' : isExpired(c) ? 'Expired' : expiresSoon(c) ? 'Expires soon' : 'Connected'

  return (
    <article className="conn-card" aria-label={`${c.name} connection`}>
      <header className="conn-head">
        <span className="icon-tile">
          <KeyRound size={18} {...stroke} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontWeight: 600, fontSize: 15 }}>{c.name}</strong>
            <span className={`pill conn-${status.replace(' ', '-').toLowerCase()}`}>
              {status === 'Connected' && <Check size={12} strokeWidth={2.5} aria-hidden />}
              {status}
            </span>
            {required && <span className="panel-meta">Needed for Matrix</span>}
          </div>
          <span className="secondary" style={{ fontSize: 13 }}>
            {USED_FOR[c.tool]}
          </span>
        </div>
      </header>

      {c.connected && !editing && (
        <dl className="dl conn-meta">
          <dt>Server</dt>
          <dd className="mono" style={{ fontSize: 12.5 }}>
            {c.baseUrl}
          </dd>
          <dt>Token</dt>
          <dd className="mono" style={{ fontSize: 12.5 }}>
            ••••••••{c.last4}
          </dd>
          <dt>Verified as</dt>
          <dd>{c.verifiedAs ?? '—'}</dd>
          <dt>Expires</dt>
          <dd>{c.expiresAt ? formatDateTime(c.expiresAt) : 'No expiry set'}</dd>
          <dt>Last used</dt>
          <dd>{c.lastUsedAt ? `${formatDateTime(c.lastUsedAt)} · ${c.lastUsedFor}` : 'Not used yet'}</dd>
        </dl>
      )}

      {editing && (
        <form
          className="conn-form"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <label>
            <span>Server address</span>
            <input type="url" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </label>
          <label>
            <span>Personal access token</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={c.connected ? `Replaces the token ending ${c.last4}` : 'Paste your token'}
            />
            <span className="panel-meta">{HELP[c.tool]}</span>
          </label>
          <label>
            <span>
              Expires <span className="secondary" style={{ fontWeight: 400 }}>· optional; we'll remind you two weeks before</span>
            </span>
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} min={new Date().toISOString().slice(0, 10)} />
          </label>
          <div className="card-actions" style={{ marginTop: 0 }}>
            {c.connected && (
              <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
            <button type="submit" className="btn btn-go" disabled={!token || busy !== null}>
              <Lock size={14} strokeWidth={2} aria-hidden />
              {busy === 'save' ? 'Verifying…' : 'Verify and save'}
            </button>
          </div>
        </form>
      )}

      {message && (
        <p className={`conn-msg ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      {c.connected && !editing && (
        <div className="card-actions" style={{ marginTop: 0, justifyContent: 'flex-start' }}>
          <button type="button" className="btn btn-outline" style={{ height: 34, fontSize: 13 }} disabled={busy !== null} onClick={test}>
            <RefreshCw size={14} {...stroke} />
            {busy === 'test' ? 'Testing…' : 'Test'}
          </button>
          <button type="button" className="btn btn-outline" style={{ height: 34, fontSize: 13 }} onClick={() => setEditing(true)}>
            Replace token
          </button>
          <button type="button" className="btn ghost" style={{ height: 34, fontSize: 13, marginLeft: 'auto' }} disabled={busy !== null} onClick={remove}>
            <Trash2 size={14} {...stroke} />
            Disconnect
          </button>
        </div>
      )}
    </article>
  )
}
