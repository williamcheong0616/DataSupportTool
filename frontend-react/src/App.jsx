import React, { useState, useEffect, useRef } from 'react'
import { BrowserRouter as Router, Routes, Route, NavLink, useLocation } from 'react-router-dom'
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

const NAV_LINK_BASE = 'inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors'
const NAV_ACTIVE = 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300'
const NAV_INACTIVE = 'text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-50 dark:hover:bg-gray-700'

/** A dropdown nav item that groups multiple child links */
function NavDropdown({ label, icon, links }) {
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
        className={`${NAV_LINK_BASE} gap-1 ${isAnyActive ? NAV_ACTIVE : NAV_INACTIVE}`}
      >
        {icon && <span>{icon}</span>}
        {label}
        <svg className={`w-3.5 h-3.5 ml-0.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-52 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-xl z-50 py-1 overflow-hidden">
          {links.map(l => (
            <NavLink
              key={l.to}
              to={l.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-indigo-50 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`
              }
            >
              {l.icon && <span>{l.icon}</span>}
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
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      {/* Navigation */}
      <nav className="bg-white shadow-md dark:bg-gray-800 sticky top-0 z-40">
        <div className="px-4 mx-auto max-w-7xl">
          <div className="flex items-center justify-between h-14">
            {/* Logo */}
            <div className="flex items-center gap-6">
              <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                📝 Data Tool
              </span>

              {/* Primary links */}
              <div className="flex items-center gap-1">
                <NavLink to="/" end className={({ isActive }) => `${NAV_LINK_BASE} ${isActive ? NAV_ACTIVE : NAV_INACTIVE}`}>
                  Dashboard
                </NavLink>
                <NavLink to="/text" className={({ isActive }) => `${NAV_LINK_BASE} ${isActive ? NAV_ACTIVE : NAV_INACTIVE}`}>
                  Text
                </NavLink>
                <NavLink to="/asr" className={({ isActive }) => `${NAV_LINK_BASE} ${isActive ? NAV_ACTIVE : NAV_INACTIVE}`}>
                  ASR
                </NavLink>

                {/* Error Analysis dropdown */}
                <NavDropdown
                  label="Error Analysis"
                  icon="🔍"
                  links={[
                    { to: '/text-error-analysis', label: 'Text Error Analysis', icon: '📄' },
                    { to: '/asr-error-analysis',  label: 'ASR Error Analysis',  icon: '🎙️' },
                    { to: '/eval-error-analysis', label: 'Eval Error Analysis', icon: '🧪' },
                    { to: '/error-analytics',     label: 'Error Analytics',     icon: '📊' },
                  ]}
                />

                <NavLink to="/settings" className={({ isActive }) => `${NAV_LINK_BASE} ${isActive ? NAV_ACTIVE : NAV_INACTIVE}`}>
                  ⚙️ Settings
                </NavLink>
              </div>
            </div>

            {/* Dark mode toggle */}
            <button
              onClick={toggleDarkMode}
              className="p-2 transition-colors bg-gray-100 rounded-lg dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? (
                <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
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

          {/* Error Analysis */}
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
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode')
    return saved === 'true'
  })

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('darkMode', darkMode)
  }, [darkMode])

  const toggleDarkMode = () => setDarkMode(d => !d)

  return (
    <Router>
      <AppLayout darkMode={darkMode} toggleDarkMode={toggleDarkMode} />
    </Router>
  )
}

export default App
