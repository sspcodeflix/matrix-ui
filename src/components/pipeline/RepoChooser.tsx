import { useId, useState } from 'react'
import { AUTOMATION_REPOS } from '../../data/report'

const RECOMMENDED = 'ABCD-TestingScript'
const OTHER = '__other__'
const VALID = /^[\w.-]+(\/[\w.-]+)?$/

/**
 * Where the automation goes: the recommended repository, or any other one the
 * user picks from the app's automation repositories or types in. Reports '' while
 * the choice isn't valid yet, so the card can keep its Start button disabled.
 */
export function RepoChooser({ name, value, onChange }: { name: string; value: string; onChange: (repo: string) => void }) {
  const id = useId()
  const others = AUTOMATION_REPOS.filter((r) => r !== RECOMMENDED)
  const [mode, setMode] = useState<'recommended' | 'other'>(value && value !== RECOMMENDED ? 'other' : 'recommended')
  const [picked, setPicked] = useState(value && value !== RECOMMENDED ? (others.includes(value) ? value : OTHER) : others.length ? '' : OTHER)
  const [typed, setTyped] = useState(value && value !== RECOMMENDED && !others.includes(value) ? value : '')

  const report = (m: typeof mode, p: string, t: string) => {
    if (m === 'recommended') return onChange(RECOMMENDED)
    if (p === OTHER) return onChange(VALID.test(t.trim()) ? t.trim() : '')
    onChange(p)
  }

  return (
    <div className="opts">
      <label className="opt">
        <input
          type="radio"
          name={name}
          checked={mode === 'recommended'}
          onChange={() => {
            setMode('recommended')
            report('recommended', picked, typed)
          }}
        />
        <span className="opt-text">
          <span className="opt-title mono" style={{ fontSize: 13.5 }}>
            {RECOMMENDED}
          </span>
          <span className="opt-hint">ABCD’s automation suite for every component. Recommended.</span>
        </span>
      </label>
      {/* The picker sits beside the radio's label, not inside it, so the radio's name stays "Choose another repository". */}
      <div className="opt opt-stack">
        <label className="opt-row">
          <input
            type="radio"
            name={name}
            checked={mode === 'other'}
            onChange={() => {
              setMode('other')
              report('other', picked, typed)
            }}
          />
          <span className="opt-text">
            <span className="opt-title">Choose another repository</span>
            {mode !== 'other' && <span className="opt-hint">{others.length ? `Any of ABCD’s ${others.length} other automation repositories, or one you name.` : 'Name another repository, for example a team-owned suite.'}</span>}
          </span>
        </label>
        {mode === 'other' && (
          <div className="repo-pick">
            {others.length > 0 && (
              <>
                <label htmlFor={`${id}-select`} className="sr-only">
                  Repository
                </label>
                <select
                  id={`${id}-select`}
                  value={picked}
                  onChange={(e) => {
                    setPicked(e.target.value)
                    report('other', e.target.value, typed)
                  }}
                >
                  <option value="" disabled>
                    Select a repository…
                  </option>
                  {others.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                  <option value={OTHER}>Another repository (type its name)…</option>
                </select>
              </>
            )}
            {picked === OTHER && (
              <>
                <label htmlFor={`${id}-typed`} className="sr-only">
                  Repository name
                </label>
                <input
                  id={`${id}-typed`}
                  type="text"
                  autoFocus
                  spellCheck={false}
                  placeholder="e.g. abcd-org/payments-ui-tests"
                  value={typed}
                  onChange={(e) => {
                    setTyped(e.target.value)
                    report('other', OTHER, e.target.value)
                  }}
                />
                {typed && !VALID.test(typed.trim()) && <span className="opt-hint">Use a repository name like “org/repo” or “repo”.</span>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
