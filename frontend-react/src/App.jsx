import React, { useState, useEffect, useRef } from 'react'
import { BrowserRouter as Router, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, FileText, Mic, Search, Settings2,
  Sun, Moon, ChevronDown, ScanSearch, MicOff,
  FlaskConical, BarChart2, Database, Zap,
} from 'lucide-react'
import Dashboard from './pages/Dashboard'
import TextDatasets from './pages/TextDatasets'
import TextAnnotate from './pages/TextAnnotate'
import ASRDatasets from './pages/ASRDatasets'
import ASRAnnotate from './pages/ASRAnnotate'
import BRPipelineValidation from './pages/BRPipelineValidation'
import BRPipelineResults from './pages/BRPipelineResults'
import BRClassification from './pages/BRClassification'
import BRRestructure from './pages/BRRestructure'
import BRQuestionValidation from './pages/BRQuestionValidation'
import BRModelResponses from './pages/BRModelResponses'
import TextResponsePool from './pages/TextResponsePool'
import Settings from './pages/Settings'
import TextErrorAnalysis from './pages/TextErrorAnalysis'
import ASRErrorAnalysis from './pages/ASRErrorAnalysis'
import EvalErrorAnalysis from './pages/EvalErrorAnalysis'
import ErrorAnalytics from './pages/ErrorAnalytics'

const THEME_KEY = 'dst-theme'

/** Dropdown nav group, styled to match the dst-tab bar */
function NavDropdown({ label, icon: Icon, links }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const location = useLocation()
  const isAnyActive = links.some(l => location.pathname.startsWith(l.to))

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`dst-tab gap-1.5 ${isAnyActive ? 'dst-tab-active' : ''}`}
      >
        {Icon && <Icon size={12} strokeWidth={2.5} />}
        {label}
        <ChevronDown
          size={10}
          strokeWidth={3}
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className="dst-panel absolute top-full left-0 mt-1 w-52 z-50 py-1 overflow-hidden"
          style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
        >
          {links.map(l => (
            <NavLink
              key={l.to}
              to={l.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                'flex items-center gap-2.5 px-3 py-2 text-xs transition-colors'
              }
              style={({ isActive }) => ({
                fontFamily: 'var(--mono)',
                color: isActive ? 'var(--accent)' : 'var(--text)',
                background: isActive ? 'var(--accent-dim)' : 'transparent',
              })}
              onMouseEnter={(e) => { if (!e.currentTarget.classList.contains('active')) e.currentTarget.style.background = 'var(--bg-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = location.pathname === l.to ? 'var(--accent-dim)' : 'transparent' }}
            >
              {l.icon && <l.icon size={13} strokeWidth={2} className="flex-shrink-0" style={{ opacity: 0.7 }} />}
              {l.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

function ThemeToggle({ theme, toggle }) {
  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex items-center justify-center transition-all duration-150"
      style={{
        background: 'none',
        border: '1px solid var(--border)',
        borderRadius: 4,
        cursor: 'pointer',
        color: 'var(--text-dim)',
        padding: '5px 7px',
        lineHeight: 1,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-hi)'; e.currentTarget.style.borderColor = 'var(--border-hi)' }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.borderColor = 'var(--border)' }}
    >
      {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  )
}

function AppLayout({ theme, toggleTheme }) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* ── Top nav ─────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-40 flex items-stretch"
        style={{
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
          height: 40,
          paddingLeft: 12,
        }}
      >
        {/* Brand */}
        <div
          className="flex items-center gap-2 flex-shrink-0"
          style={{ paddingRight: 20, borderRight: '1px solid var(--border)', marginRight: 4 }}
        >
          <Zap size={14} style={{ color: 'var(--accent)' }} fill="var(--accent)" />
          <span
            style={{
              fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 12,
              color: 'var(--text-hi)', letterSpacing: '0.04em',
            }}
          >
            DataSupportTool
          </span>
        </div>

        {/* Tabs */}
        <nav className="flex items-stretch overflow-x-auto">
          <NavLink to="/" end className={({ isActive }) => `dst-tab ${isActive ? 'dst-tab-active' : ''}`}>
            <LayoutDashboard size={12} strokeWidth={2.5} className="mr-1.5" />
            Dashboard
          </NavLink>
          <NavLink to="/text" className={({ isActive }) => `dst-tab ${isActive ? 'dst-tab-active' : ''}`}>
            <FileText size={12} strokeWidth={2.5} className="mr-1.5" />
            Text
          </NavLink>
          <NavLink to="/asr" className={({ isActive }) => `dst-tab ${isActive ? 'dst-tab-active' : ''}`}>
            <Mic size={12} strokeWidth={2.5} className="mr-1.5" />
            ASR
          </NavLink>
          <NavDropdown
            label="Error Analysis"
            icon={Search}
            links={[
              { to: '/text-error-analysis', label: 'Text Errors', icon: ScanSearch },
              { to: '/asr-error-analysis', label: 'ASR Errors', icon: MicOff },
              { to: '/eval-error-analysis', label: 'Eval Errors', icon: FlaskConical },
              { to: '/error-analytics', label: 'Analytics', icon: BarChart2 },
            ]}
          />
          <NavLink to="/settings" className={({ isActive }) => `dst-tab ${isActive ? 'dst-tab-active' : ''}`}>
            <Settings2 size={12} strokeWidth={2.5} className="mr-1.5" />
            Settings
          </NavLink>
        </nav>

        {/* Right side */}
        <div className="flex items-center ml-auto" style={{ paddingRight: 14, gap: 10 }}>
          <ThemeToggle theme={theme} toggle={toggleTheme} />
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────── */}
      <main className="px-4 py-6 mx-auto max-w-7xl sm:px-6 lg:px-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/text" element={<TextDatasets />} />
          <Route path="/text/response-pool" element={<TextResponsePool />} />
          <Route path="/text/:datasetId/annotate" element={<TextAnnotate />} />
          <Route path="/br-pipeline/validate" element={<BRPipelineValidation />} />
          <Route path="/br-pipeline/results/:pipelineId" element={<BRPipelineResults />} />
          <Route path="/br-pipeline/classification/:pipelineId" element={<BRClassification />} />
          <Route path="/br-pipeline/restructure/:pipelineId" element={<BRRestructure />} />
          <Route path="/br-pipeline/questions/:pipelineId" element={<BRQuestionValidation />} />
          <Route path="/br-pipeline/responses/:pipelineId" element={<BRModelResponses />} />
          <Route path="/asr" element={<ASRDatasets />} />
          <Route path="/asr/:datasetId/annotate" element={<ASRAnnotate />} />
          <Route path="/text-error-analysis" element={<TextErrorAnalysis />} />
          <Route path="/text-error-analysis/:datasetId" element={<TextErrorAnalysis />} />
          <Route path="/asr-error-analysis" element={<ASRErrorAnalysis />} />
          <Route path="/asr-error-analysis/:datasetId" element={<ASRErrorAnalysis />} />
          <Route path="/eval-error-analysis" element={<EvalErrorAnalysis />} />
          <Route path="/eval-error-analysis/:datasetId" element={<EvalErrorAnalysis />} />
          <Route path="/error-analytics" element={<ErrorAnalytics />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

function App() {
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))

  return (
    <Router>
      <AppLayout theme={theme} toggleTheme={toggleTheme} />
    </Router>
  )
}

export default App
