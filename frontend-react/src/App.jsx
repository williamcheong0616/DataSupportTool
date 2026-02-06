import React from 'react'
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import TextDatasets from './pages/TextDatasets'
import TextAnnotate from './pages/TextAnnotate'
import ASRDatasets from './pages/ASRDatasets'
import ASRAnnotate from './pages/ASRAnnotate'

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-100">
        {/* Navigation */}
        <nav className="bg-white shadow-lg">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex justify-between h-16">
              <div className="flex">
                <div className="flex-shrink-0 flex items-center">
                  <span className="text-xl font-bold text-indigo-600">
                    📝 Data Annotation Tool
                  </span>
                </div>
                <div className="hidden sm:ml-8 sm:flex sm:space-x-4">
                  <NavLink
                    to="/"
                    className={({ isActive }) =>
                      `inline-flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                        isActive
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'text-gray-600 hover:text-indigo-600 hover:bg-gray-50'
                      }`
                    }
                  >
                    Dashboard
                  </NavLink>
                  <NavLink
                    to="/text"
                    className={({ isActive }) =>
                      `inline-flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                        isActive
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'text-gray-600 hover:text-indigo-600 hover:bg-gray-50'
                      }`
                    }
                  >
                    Text Annotation
                  </NavLink>
                  <NavLink
                    to="/asr"
                    className={({ isActive }) =>
                      `inline-flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                        isActive
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'text-gray-600 hover:text-indigo-600 hover:bg-gray-50'
                      }`
                    }
                  >
                    ASR Annotation
                  </NavLink>
                </div>
              </div>
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/text" element={<TextDatasets />} />
            <Route path="/text/:datasetId/annotate" element={<TextAnnotate />} />
            <Route path="/asr" element={<ASRDatasets />} />
            <Route path="/asr/:datasetId/annotate" element={<ASRAnnotate />} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}

export default App
