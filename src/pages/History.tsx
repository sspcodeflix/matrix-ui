import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, MessageSquare, MoreHorizontal, Plus, Search } from 'lucide-react'
import { Spinner, stroke } from '../components/icons'
import { Popover } from '../components/Popover'
import { REPORT, coveragePct } from '../data/report'
import { formatDateTime, formatTime, paths } from '../lib/format'
import { useStore } from '../state/store'
import type { Conversation, PipelineRecord, RunState } from '../state/types'
import { pipelineStatus } from '../components/pipeline/chat'
import { currentView } from '../components/pipeline/parts'

type Filter = 'all' | 'reports' | 'running'

interface Item {
  convo: Conversation
  run?: RunState
  pipeline?: PipelineRecord
  last: number
  preview: string
}

const DAY = 86_400_000

function groupLabel(ts: number) {
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  if (ts >= startOfToday) return 'Today'
  if (ts >= startOfToday - DAY) return 'Yesterday'
  if (ts >= startOfToday - 7 * DAY) return 'Previous 7 days'
  return 'Older'
}

function plain(text: string) {
  return text.replace(/\*\*|`/g, '')
}

export function History() {
  const { state } = useStore()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const items = useMemo<Item[]>(() => {
    const runs = Object.values(state.runs)
    const pipes = Object.values(state.pipelines)
    return Object.values(state.conversations)
      .filter((c) => (c.owner ?? 'sp') === state.viewer)
      .map((convo) => {
        const mine = runs.filter((r) => r.conversationId === convo.id)
        const run = mine.find((r) => r.status === 'running') ?? [...mine].reverse()[0]
        const lastAssistant = [...convo.messages].reverse().find((m) => m.role === 'assistant' && m.blocks?.some((b) => b.type === 'text'))
        const text = lastAssistant?.blocks?.find((b) => b.type === 'text')
        const pipeline = [...pipes].reverse().find((x) => x.conversationId === convo.id)
        return {
          convo,
          run,
          pipeline,
          last: Math.max(convo.updatedAt ?? convo.createdAt, run?.completedAt ?? 0),
          preview: text && text.type === 'text' ? plain(text.text) : '',
        }
      })
      .sort((a, b) => b.last - a.last)
  }, [state.conversations, state.runs, state.pipelines, state.viewer])

  const counts = {
    all: items.length,
    reports: items.filter((i) => i.run?.status === 'completed').length,
    running: items.filter((i) => i.run?.status === 'running').length,
  }
  const q = query.trim().toLowerCase()
  const visible = items.filter(
    (i) =>
      (filter === 'all' || (filter === 'reports' ? i.run?.status === 'completed' : i.run?.status === 'running')) &&
      (!q || i.convo.title.toLowerCase().includes(q) || (i.convo.app ?? '').toLowerCase().includes(q) || i.preview.toLowerCase().includes(q)),
  )
  const groups = visible.reduce<{ label: string; items: Item[] }[]>((acc, item) => {
    const label = groupLabel(item.last)
    const g = acc.find((x) => x.label === label)
    if (g) g.items.push(item)
    else acc.push({ label, items: [item] })
    return acc
  }, [])

  return (
    <main className="history">
      <div className="history-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1>History</h1>
          <p className="secondary" style={{ margin: 0, fontSize: 15 }}>
            Past conversations and the analyses run in them.
          </p>
        </div>
        <Link to="/" className="btn btn-go">
          <Plus size={16} strokeWidth={2} aria-hidden />
          New conversation
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="history-empty">
          <span className="icon-tile">
            <MessageSquare size={18} {...stroke} />
          </span>
          <p className="prose">No conversations yet.</p>
          <p className="secondary" style={{ margin: 0, fontSize: 14 }}>
            Start one by asking about an application's coverage. It'll show up here, with any analysis you ran.
          </p>
          <Link to="/" className="btn btn-outline" style={{ marginTop: 8 }}>
            Start a conversation
          </Link>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <div role="group" aria-label="Filter conversations" className="segmented">
              {(
                [
                  ['all', 'All'],
                  ['reports', 'With reports'],
                  ['running', 'Running'],
                ] as const
              ).map(([key, label]) => (
                <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                  {label} <span className="count">{counts[key]}</span>
                </button>
              ))}
            </div>
            <label className="search">
              <Search size={15} {...stroke} />
              <span className="sr-only">Search conversations</span>
              <input type="search" placeholder="Search conversations" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>

          {groups.length === 0 && (
            <p className="secondary" style={{ margin: 0, fontSize: 14 }} aria-live="polite">
              No conversations match{q ? ` “${query}”` : ''}.
            </p>
          )}

          {groups.map((g) => (
            <section key={g.label} aria-label={g.label} className="history-group">
              <h2>{g.label}</h2>
              <ul className="history-list">
                {g.items.map((item) => (
                  <HistoryRow key={item.convo.id} item={item} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </main>
  )
}

function HistoryRow({ item }: { item: Item }) {
  const { convo, run, pipeline, last, preview } = item
  const ps = pipeline && pipelineStatus(pipeline)
  const { deleteConversation } = useStore()
  const [menu, setMenu] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const turns = convo.messages.filter((m) => m.role === 'user').length
  const isToday = groupLabel(last) === 'Today' || groupLabel(last) === 'Yesterday'
  const closeMenu = () => {
    setMenu(false)
    setConfirming(false)
  }

  return (
    <li className="history-row">
      <div className="history-main">
        <Link to={paths.conversation(convo.id)} className="history-title">
          {convo.title}
        </Link>
        {preview && <span className="history-preview">{preview}</span>}
        <span className="history-meta">
          {convo.app && <span className="id-chip" style={{ padding: '3px 6px', fontSize: 12 }}>{convo.app}</span>}
          <span>
            {turns} {turns === 1 ? 'message' : 'messages'} · {isToday ? formatTime(last) : formatDateTime(last)}
          </span>
        </span>
      </div>

      <div className="history-side">
        {run?.status === 'running' && (
          <span className="history-status" role="status">
            <Spinner size={16} />
            <span className="num">Analysing · {run.pct}%</span>
          </span>
        )}
        {pipeline && ps && (
          <Link to={paths.pipeline(convo.id, pipeline.id, currentView(pipeline))} className="ghost history-status link">
            {ps.kind === 'running' ? <Spinner size={16} /> : ps.kind === 'waiting' ? <span className="gate-dot static" style={{ margin: 0 }} aria-hidden="true" /> : null}
            <span>Matrix · {ps.text}</span>
          </Link>
        )}
        {!pipeline && run?.status === 'completed' && (
          <Link to={paths.report(convo.id, run.id)} className="ghost history-status link">
            <span className="check-badge" style={{ width: 18, height: 18 }}>
              <Check size={10} strokeWidth={3} aria-hidden />
            </span>
            <span>
              Report · {coveragePct(REPORT.covered, REPORT.requirements)}% coverage
            </span>
          </Link>
        )}
        {(run?.status === 'stopped' || run?.status === 'failed') && <span className="history-status">Analysis {run.status}</span>}

        <div style={{ position: 'relative' }}>
          <button type="button" className="ghost icon-btn xs" aria-label={`More actions for “${convo.title}”`} aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={16} {...stroke} />
          </button>
          <Popover open={menu} onClose={closeMenu} label="Conversation actions" className="menu" style={{ right: 0, top: 36, width: 240 }}>
            {confirming ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>Delete this conversation?</span>
                <span className="panel-meta">
                  {run?.status === 'running' ? 'The running analysis will be stopped. ' : ''}This removes it from this browser and can't be undone.
                </span>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                  <button type="button" className="btn ghost" style={{ height: 32, fontSize: 13 }} onClick={closeMenu}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ height: 32, fontSize: 13, padding: '0 12px' }}
                    onClick={() => {
                      closeMenu()
                      deleteConversation(convo.id)
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <>
                <Link to={paths.conversation(convo.id)} className="menu-item">
                  Open conversation
                </Link>
                {run?.status === 'completed' && (
                  <Link to={paths.report(convo.id, run.id)} className="menu-item">
                    Open report
                  </Link>
                )}
                <button type="button" className="menu-item" onClick={() => setConfirming(true)}>
                  Delete…
                </button>
              </>
            )}
          </Popover>
        </div>
      </div>
    </li>
  )
}
