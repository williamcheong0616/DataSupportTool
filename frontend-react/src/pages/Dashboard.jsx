import { useState, useEffect } from 'react'
import { getStats, getPipelineRuns } from '../api'
import { Database, FileText, Play, CheckCircle } from 'lucide-react'

function Dashboard() {
  const [stats, setStats] = useState(null)
  const [recentRuns, setRecentRuns] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [statsRes, runsRes] = await Promise.all([
        getStats(),
        getPipelineRuns(null, 5)
      ])
      setStats(statsRes.data)
      setRecentRuns(runsRes.data)
    } catch (error) {
      console.error('Failed to load dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="p-8">Loading...</div>
  }

  const statCards = [
    { label: 'Datasets', value: stats?.total_datasets || 0, icon: Database, color: 'bg-blue-500' },
    { label: 'Records', value: stats?.total_records || 0, icon: FileText, color: 'bg-green-500' },
    { label: 'Pipeline Runs', value: stats?.total_runs || 0, icon: Play, color: 'bg-purple-500' },
    { label: 'Pass Rate', value: stats?.pass_rate ? `${(stats.pass_rate * 100).toFixed(1)}%` : 'N/A', icon: CheckCircle, color: 'bg-orange-500' },
  ]

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm">{label}</p>
                <p className="text-2xl font-bold">{value}</p>
              </div>
              <div className={`${color} p-3 rounded-lg`}>
                <Icon className="text-white" size={24} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline Flow */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Pipeline Flow</h2>
        <div className="flex items-center justify-between">
          {['Collection', 'Preprocess', 'Inference', 'Validate', 'Iterate'].map((step, i) => (
            <div key={step} className="flex items-center">
              <div className="text-center">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold mb-2">
                  {i + 1}
                </div>
                <p className="text-sm">{step}</p>
              </div>
              {i < 4 && <div className="w-16 h-0.5 bg-gray-300 mx-2" />}
            </div>
          ))}
        </div>
      </div>

      {/* Recent Runs */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Recent Pipeline Runs</h2>
        {recentRuns.length === 0 ? (
          <p className="text-gray-500">No pipeline runs yet</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left text-gray-500 text-sm">
                <th className="pb-2">ID</th>
                <th className="pb-2">Dataset</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Iteration</th>
                <th className="pb-2">Started</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run) => (
                <tr key={run.id} className="border-t">
                  <td className="py-2">#{run.id}</td>
                  <td className="py-2">Dataset #{run.dataset_id}</td>
                  <td className="py-2">
                    <span className={`px-2 py-1 rounded text-xs ${
                      run.status === 'completed' ? 'bg-green-100 text-green-700' :
                      run.status === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="py-2">{run.iteration}</td>
                  <td className="py-2 text-sm text-gray-500">
                    {new Date(run.started_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default Dashboard
