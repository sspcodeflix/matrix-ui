import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom'

// Self-hosted fonts (enterprise networks often block Google Fonts).
import '@fontsource/albert-sans/400.css'
import '@fontsource/albert-sans/500.css'
import '@fontsource/albert-sans/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource-variable/newsreader/opsz.css'
import './styles/app.css'

import { AppHeader } from './components/AppHeader'
import { Sidebar } from './components/Sidebar'
import { AreaView } from './components/panel/AreaView'
import { ReportView } from './components/panel/ReportView'
import { RequirementView } from './components/panel/RequirementView'
import { PipelinePanel } from './components/pipeline/PipelinePanel'
import { BatchPanel } from './components/pipeline/batch'
import { RemediationPanel } from './components/remediation/RemediationPanel'
import { Conversation } from './pages/Conversation'
import { History } from './pages/History'
import { Reviews } from './pages/Reviews'
import { Connections } from './pages/Connections'
import { Welcome } from './pages/Welcome'
import { StoreProvider } from './state/store'

const SIDEBAR_KEY = 'matrix.sidebar'
const isPhone = () => window.matchMedia('(max-width: 720px)').matches

/**
 * The sidebar is part of the layout, not an overlay: on desktop it takes its
 * width and the app reflows; on a phone it pushes the whole screen right.
 */
function Shell() {
  const [open, setOpen] = useState(() => {
    try {
      return !isPhone() && localStorage.getItem(SIDEBAR_KEY) === 'open'
    } catch {
      return false
    }
  })
  const location = useLocation()
  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen((o) => !o), [])

  // Desktop remembers the choice; a phone closes it after you pick something.
  useEffect(() => {
    if (isPhone()) return
    try {
      localStorage.setItem(SIDEBAR_KEY, open ? 'open' : 'closed')
    } catch {
      /* ignore */
    }
  }, [open])
  useEffect(() => {
    if (isPhone()) setOpen(false)
  }, [location.pathname])

  return (
    <div className={`shell ${open ? 'sidebar-open' : ''}`}>
      <Sidebar open={open} onClose={close} />
      <div className="app">
        <AppHeader menuOpen={open} onToggleMenu={toggle} />
        <Outlet />
        {open && <button type="button" className="push-catcher" aria-label="Close menu" onClick={close} />}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Welcome />} />
            <Route path="history" element={<History />} />
            <Route path="reviews" element={<Reviews />} />
            <Route path="settings/connections" element={<Connections />} />
            <Route path="c/:conversationId" element={<Conversation />}>
              <Route path="runs/:runId/report" element={<ReportView />} />
              <Route path="runs/:runId/report/areas/:areaSlug" element={<AreaView />} />
              <Route path="runs/:runId/report/requirements/:frId" element={<RequirementView />} />
              <Route path="batches/:batchId" element={<BatchPanel />} />
              <Route path="remediation/:remediationId" element={<RemediationPanel />} />
              <Route path="remediation/:remediationId/:view" element={<RemediationPanel />} />
              <Route path="pipelines/:pipelineId" element={<PipelinePanel />} />
              <Route path="pipelines/:pipelineId/:view" element={<PipelinePanel />} />
            </Route>
            <Route path="*" element={<Welcome />} />
          </Route>
        </Routes>
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
)
