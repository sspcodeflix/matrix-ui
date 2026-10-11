import { useState } from 'react'
import { BarChart3, BookOpen, Folder, Layers, LayoutGrid, ShieldAlert, Target } from 'lucide-react'
import { Composer } from '../components/Composer'
import { Spark, stroke } from '../components/icons'
import { useStore } from '../state/store'

const SUGGESTIONS = [
  { icon: Target, label: 'Analyse coverage for an application', text: 'Analyse the functional coverage.' },
  { icon: BarChart3, label: 'Find the biggest coverage gaps', text: 'Find the biggest coverage gaps.' },
  { icon: BookOpen, label: 'Explain a requirement', text: 'Explain a requirement.' },
  { icon: LayoutGrid, label: 'Show untested functional areas', text: 'Show untested functional areas.' },
  { icon: Folder, label: 'List ABCD components', text: 'List the ABCD components.' },
]

export function Welcome() {
  const { send } = useStore()
  const [app, setApp] = useState<string | null>(null)

  return (
    <main className="welcome">
      <div className="welcome-inner">
        <Spark size={30} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <h1>Where are your gaps, and what will close them?</h1>
          <p className="subtitle">Matrix finds the requirements that lack test evidence, designs, automates and runs the tests that close them, then re-measures coverage so you see what changed. You approve at every gate.</p>
        </div>
        <Composer large placeholder="Ask Matrix anything…" app={app} onAppChange={setApp} onSend={(text) => send(text, undefined, app)} autoFocus />
        <div className="workflows">
          <button type="button" className="workflow" onClick={() => send('Close all the coverage gaps with Matrix, in one go.', undefined, app)}>
            <Layers size={20} {...stroke} />
            <span>
              <strong>Close all coverage gaps</strong>
              <span>Every uncovered requirement, one pipeline per area, decided in bulk</span>
            </span>
          </button>
          <button type="button" className="workflow" onClick={() => send('Find and fix vulnerabilities.', undefined, app)}>
            <ShieldAlert size={20} {...stroke} />
            <span>
              <strong>Vulnerability remediation</strong>
              <span>Scan the repos or bring your CWEs and CVEs; fix them in bulk or one at a time with me in chat</span>
            </span>
          </button>
        </div>
        <div className="chips">
          {SUGGESTIONS.map(({ icon: Icon, label, text }) => (
            <button key={label} type="button" className="chip chip-suggest" onClick={() => send(text, undefined, app)}>
              <span className="chip-icon">
                <Icon size={16} {...stroke} />
              </span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}
