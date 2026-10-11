import { useEffect, useRef } from 'react'
import { Link, useOutlet, useParams } from 'react-router-dom'
import { Composer } from '../components/Composer'
import { MessageList } from '../components/Messages'
import { RunStrip } from '../components/run'
import { PipelineStrip } from '../components/pipeline/chat'
import { BatchStrip } from '../components/pipeline/batch'
import { useStore } from '../state/store'
import { person } from '../team/roster'

/**
 * Scroll whatever holds the chat (the chat column when the report panel is beside it,
 * otherwise the page) all the way down. Scrolling the end of the messages into view
 * isn't enough: the composer is pinned over the bottom and would hide the newest reply.
 */
function scrollToLatest(anchor: HTMLElement | null, behavior: ScrollBehavior) {
  if (!anchor) return
  requestAnimationFrame(() => {
    const col = anchor.closest('.thread-col') as HTMLElement | null
    const scroller = col && getComputedStyle(col).overflowY === 'auto' && col.scrollHeight > col.clientHeight ? col : document.scrollingElement
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior })
  })
}

export function Conversation() {
  const { conversationId = '' } = useParams()
  const panel = useOutlet()
  const { state, send, setApp, stopRun, setForeground } = useStore()
  const convo = state.conversations[conversationId]
  const endRef = useRef<HTMLDivElement>(null)
  const count = convo?.messages.length ?? 0
  const lastPending = convo?.messages[count - 1]?.pending

  useEffect(() => {
    scrollToLatest(endRef.current, 'smooth')
  }, [count, lastPending])

  // Phone: coming back from a full-screen panel lands on the latest messages.
  const hasPanel = !!panel
  useEffect(() => {
    if (!hasPanel && window.matchMedia('(max-width: 720px)').matches) scrollToLatest(endRef.current, 'auto')
  }, [hasPanel])

  if (!convo) {
    return (
      <main className="welcome">
        <div className="welcome-inner" style={{ gap: 12 }}>
          <h1 style={{ fontSize: 32 }}>Conversation not found</h1>
          <p className="subtitle">It may have been cleared from this browser.</p>
          <Link to="/" className="btn btn-go">
            Start a new conversation
          </Link>
        </div>
      </main>
    )
  }

  const backgroundRun = Object.values(state.runs).find((r) => r.conversationId === convo.id && r.status === 'running' && !r.foreground)
  const lastId = convo.messages.at(-1)?.id
  const activePipelines = Object.values(state.pipelines).filter((p) => p.conversationId === convo.id && !p.batchId && (p.status === 'running' || p.status === 'waiting') && p.messageId !== lastId)
  const activeBatches = Object.values(state.batches).filter((b) => b.conversationId === convo.id && !b.done && b.messageId !== lastId)
  const awaitingScope = convo.messages.at(-1)?.blocks?.some((b) => b.type === 'scope' || b.type === 'handoff' || b.type === 'batchScope' || b.type === 'remScope')

  return (
    <div className={`workspace ${panel ? 'split' : ''}`}>
      <div className="thread-col">
        <main className="thread">
          <MessageList key={convo.id} convo={convo} />
          <div ref={endRef} />
          <div className="composer-dock">
            {backgroundRun && (
              <RunStrip
                run={backgroundRun}
                onStop={() => stopRun(backgroundRun.id)}
                onExpand={() => {
                  setForeground(backgroundRun.id, true)
                  setTimeout(() => document.getElementById(`run-${backgroundRun.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
                }}
              />
            )}
            {activePipelines.map((p) => (
              <PipelineStrip key={p.id} p={p} />
            ))}
            {activeBatches.map((b) => (
              <BatchStrip key={b.id} batch={b} />
            ))}
            {(convo.owner ?? 'sp') !== state.viewer ? (
              <div className="readonly-note" role="note">
                You’re viewing {person(convo.owner ?? 'sp').name}’s conversation as {person(state.viewer).name}. Reply to reviews from the panel; only the owner can chat here.
              </div>
            ) : (
            <Composer
              app={convo.app}
              onAppChange={(app) => setApp(convo.id, app)}
              placeholder={awaitingScope ? 'Add a message or ask a follow-up…' : 'Ask a follow-up question…'}
              onSend={(text) => send(text, convo.id)}
            />
            )}
          </div>
        </main>
      </div>
      {panel}
    </div>
  )
}
