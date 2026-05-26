import React, { useState, useEffect, useRef } from 'react'
import { BrowserRouter as Router, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, FileText, Mic, Search, Settings2,
  Sun, Moon, ChevronDown, ScanSearch, MicOff,
  FlaskConical, BarChart2, Database,
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

/* ── Shared nav classes ────────────────────────────────────── */
const NAV_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold tracking-widest uppercase font-display transition-all duration-150 select-none'
const NAV_ACTIVE =
  'nav-active'
const NAV_INACTIVE =
  'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/70'

/** Dropdown nav group */
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
        className={`${NAV_BASE} gap-1.5 ${isAnyActive ? NAV_ACTIVE : NAV_INACTIVE}`}
      >
        {Icon && <Icon size={12} strokeWidth={2.5} />}
        {label}
        <ChevronDown
          size={10}
          strokeWidth={3}
          className={`ml-0.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1.5 w-56 rounded-xl shadow-xl z-50 py-1.5 overflow-hidden"
          style={{
            background: 'var(--clr-surface)',
            border: '1px solid var(--clr-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          }}
        >
          {links.map(l => (
            <NavLink
              key={l.to}
              to={l.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-950/50'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`
              }
            >
              {l.icon && <l.icon size={14} strokeWidth={2} className="flex-shrink-0 opacity-70" />}
              {l.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

function AppLayout({ darkMode, toggleDarkMode }) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--clr-bg)' }}>
      {/* ── Navigation ──────────────────────────────────────── */}
      <nav
        className="sticky top-0 z-40"
        style={{
          background: 'var(--clr-surface)',
          borderBottom: '1px solid var(--clr-border)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <div className="px-4 mx-auto max-w-7xl">
          <div className="flex items-center justify-between h-14">

            {/* Brand + links */}
            <div className="flex items-center gap-5">
              {/* Logo mark */}
              <div className="flex items-center gap-2.5 mr-1">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--clr-primary)' }}
                >
                  <Database size={14} className="text-white" strokeWidth={2.5} />
                </div>
                <span
                  className="text-[15px] font-bold tracking-tight"
                  style={{ fontFamily: 'Syne, sans-serif', color: 'var(--clr-text)' }}
                >
                  DataTool
                </span>
              </div>

              {/* Divider */}
              <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />

              {/* Primary links */}
              <div className="flex items-center gap-0.5">
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) => `${NAV_BASE} ${isActive ? NAV_ACTIVE : NAV_INACTIVE}`}
                >
                  <LayoutDashboard size={12} strokeWidth={2.5} />
                  Dashboard
                </NavLink>

                <NavLink
                  to="/text"
                  className={({ isActive }) => `${NAV_BASE} ${isActive ? NAV_ACTIVE : NAV_INACTIVE}`}
                >
                  <FileText size={12} strokeWidth={2.5} />
                  Text
                </NavLink>

                <NavLink
                  to="/asr"
                  className={({ isActive }) => `${NAV_BASE} ${isActive ? NAV_ACTIVE : NAV_INACTIVE}`}
                >
                  <Mic size={12} strokeWidth={2.5} />
                  ASR
                </NavLink>

                <NavDropdown
                  label="Error Analysis"
                  icon={Search}
                  links={[
                    { to: '/text-error-analysis', label: 'Text Errors',  icon: ScanSearch },
                    { to: '/asr-error-analysis',  label: 'ASR Errors',   icon: MicOff     },
                    { to: '/eval-error-analysis', label: 'Eval Errors',  icon: FlaskConical },
                    { to: '/error-analytics',     label: 'Analytics',    icon: BarChart2  },
                  ]}
                />

                <NavLink
                  to="/settings"
                  className={({ isActive }) => `${NAV_BASE} ${isActive ? NAV_ACTIVE : NAV_INACTIVE}`}
                >
                  <Settings2 size={12} strokeWidth={2.5} />
                  Settings
                </NavLink>
              </div>
            </div>

            {/* Dark mode toggle */}
            <button
              onClick={toggleDarkMode}
              className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors duration-150"
              style={{ background: 'var(--clr-surface-2)', border: '1px solid var(--clr-border)' }}
              title={darkMode ? 'Light mode' : 'Dark mode'}
            >
              {darkMode
                ? <Sun size={15} className="text-amber-400" strokeWidth={2} />
                : <Moon size={15} className="text-slate-500" strokeWidth={2} />
              }
            </button>
          </div>
        </div>
      </nav>

      {/* ── Main content ────────────────────────────────────── */}
      <main className="px-4 py-8 mx-auto max-w-7xl sm:px-6 lg:px-8">
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
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    localStorage.setItem('darkMode', darkMode)
  }, [darkMode])

  return (
    <Router>
      <AppLayout darkMode={darkMode} toggleDarkMode={() => setDarkMode(d => !d)} />
    </Router>
  )
}

export default App
