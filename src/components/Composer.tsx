import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp, Check, ChevronDown, Layers, Paperclip, X } from 'lucide-react'
import { stroke } from './icons'
import { Popover } from './Popover'
import { WORKSPACES } from '../data/workspaces'


export function Composer({
  onSend,
  placeholder = 'Ask a follow-up question…',
  large = false,
  app,
  onAppChange,
  autoFocus,
}: {
  onSend: (text: string) => void
  placeholder?: string
  large?: boolean
  app: string | null
  onAppChange: (app: string) => void
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Auto-grow
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const value = text.trim()
    if (!value) return
    onSend(value)
    setText('')
    setFiles([])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <form className={`composer ${large ? 'large' : ''}`} onSubmit={submit}>
      <label htmlFor="ask" className="sr-only">
        {large ? 'Ask Matrix' : 'Message Matrix'}
      </label>
      <textarea id="ask" ref={ref} rows={large ? 2 : 1} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} autoFocus={autoFocus} />
      {files.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {files.map((f) => (
            <span key={f.name} className="attachment">
              {f.name}
              <button type="button" className="ghost icon-btn" style={{ width: 22, height: 22, borderRadius: 6 }} aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}>
                <X size={12} strokeWidth={2} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer-bar">
        <div className="composer-tools">
          <button type="button" className="ghost icon-btn muted" aria-label="Attach files" onClick={() => fileRef.current?.click()} style={{ color: 'var(--mx-text-secondary)' }}>
            <Paperclip size={18} {...stroke} />
          </button>
          <input ref={fileRef} type="file" multiple hidden accept=".zip,.txt,.csv,.md" onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="ghost context-btn"
              aria-haspopup="menu"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen(!pickerOpen)}
              style={{ color: app ? 'var(--mx-text)' : 'var(--mx-text-secondary)' }}
            >
              <Layers size={16} {...stroke} />
              <span>
                {app ? (
                  <>
                    <span className="secondary">App Workspace ·</span> {app}
                  </>
                ) : (
                  'App Workspace · None'
                )}
              </span>
              <ChevronDown size={14} {...stroke} />
            </button>
            <Popover open={pickerOpen} onClose={() => setPickerOpen(false)} label="Choose an app workspace" className="menu" style={{ bottom: 44, left: 0, width: 260 }}>
              <div className="menu-label">App workspaces</div>
              <div role="menu">
                {WORKSPACES.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={app === a.id}
                    className="menu-item"
                    style={{ width: '100%' }}
                    onClick={() => {
                      onAppChange(a.id)
                      setPickerOpen(false)
                    }}
                  >
                    <span style={{ width: 16, display: 'flex' }}>{app === a.id && <Check size={15} {...stroke} />}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span className="mono" style={{ fontSize: 13.5 }}>
                        {a.id}
                      </span>
                      <span className="panel-meta">{a.note}</span>
                    </span>
                  </button>
                ))}
              </div>
            </Popover>
          </div>
        </div>
        <button type="submit" className="send-btn" aria-label="Send" disabled={!text.trim()}>
          <ArrowUp size={18} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </form>
  )
}
