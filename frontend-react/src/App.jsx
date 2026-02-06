import { Routes, Route, NavLink } from 'react-router-dom'
import { Home, Database, Play, CheckCircle, BarChart3 } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Datasets from './pages/Datasets'
import Pipeline from './pages/Pipeline'
import Annotate from './pages/Annotate'
import Analytics from './pages/Analytics'

function App() {
  const navItems = [
    { path: '/', icon: Home, label: 'Dashboard' },
    { path: '/datasets', icon: Database, label: 'Datasets' },
    { path: '/pipeline', icon: Play, label: 'Pipeline' },
    { path: '/annotate', icon: CheckCircle, label: 'Annotate' },
    { path: '/analytics', icon: BarChart3, label: 'Analytics' },
  ]

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-white">
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-xl font-bold">🔄 Data Pipeline</h1>
          <p className="text-gray-400 text-sm">Annotation Tool</p>
        </div>
        <nav className="p-4">
          {navItems.map(({ path, icon: Icon, label }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg mb-1 transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800'
                }`
              }
            >
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/datasets" element={<Datasets />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/annotate" element={<Annotate />} />
          <Route path="/analytics" element={<Analytics />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
