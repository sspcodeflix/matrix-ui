import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { TEAM, person, type Person } from '../../team/roster'

export function Avatar({ p, size = 26 }: { p: Person; size?: number }) {
  return (
    <span className="avatar-sm" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {p.initials}
    </span>
  )
}

/** Tag several teammates: chips + a filterable listbox. Type to search, Enter to add, Backspace to remove. */
export function PeoplePicker({ value, onChange, suggested }: { value: string[]; onChange: (ids: string[]) => void; suggested: string[] }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const options = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '')
    const pool = TEAM.filter((p) => !value.includes(p.id) && (!q || p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q)))
    // Suggested people first when not searching.
    return q ? pool : [...pool.filter((p) => suggested.includes(p.id)), ...pool.filter((p) => !suggested.includes(p.id))]
  }, [query, value, suggested])

  const add = (id: string) => {
    onChange([...value, id])
    setQuery('')
    setActive(0)
    // Close the list so it doesn't cover the form; typing or ↓ reopens it.
    setOpen(false)
    inputRef.current?.focus()
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(a + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && options[active]) {
        e.preventDefault()
        add(options[active].id)
      }
    } else if (e.key === 'Backspace' && !query && value.length) {
      onChange(value.slice(0, -1))
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="picker" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}>
      <div className="picker-field" onClick={() => inputRef.current?.focus()}>
        {value.map((id) => {
          const p = person(id)
          return (
            <span key={id} className="person-chip">
              <Avatar p={p} size={20} />
              {p.name}
              <button type="button" aria-label={`Remove ${p.name}`} onClick={() => onChange(value.filter((x) => x !== id))}>
                <X size={12} strokeWidth={2} aria-hidden />
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${options[active].id}` : undefined}
          aria-label="Tag reviewers"
          placeholder={value.length ? 'Add someone else…' : 'Type a name or role, e.g. @Priya or developer'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActive(0)
          }}
          onClick={() => setOpen(true)}
          onKeyDown={onKey}
        />
      </div>
      {open && options.length > 0 && (
        <ul className="popover picker-list" role="listbox" id={listId} aria-label="Team members">
          {options.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${p.id}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => add(p.id)}
            >
              <Avatar p={p} />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                <span style={{ fontWeight: 500 }}>{p.name}</span>
                <span className="panel-meta">{p.role}</span>
              </span>
              {suggested.includes(p.id) && !query && <span className="tag">Suggested</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
