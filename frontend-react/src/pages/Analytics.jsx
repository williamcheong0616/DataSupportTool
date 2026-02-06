import { useState, useEffect } from 'react'
import { getStats, getPipelineRuns } from '../api'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

function Analytics() {
  const [stats, setStats] = useState(null)
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [statsRes, runsRes] = await Promise.all([
        getStats(),
        getPipelineRuns(null, 100)
      ])
      setStats(statsRes.data)
      setRuns(runsRes.data)
    } catch (error) {
      console.error('Failed to load analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  // Calculate stats from runs
  const completedRuns = runs.filter(r => r.status === 'completed')
  const failedRuns = runs.filter(r => r.status === 'failed')
  const avgIterations = completedRuns.length > 0
    ? completedRuns.reduce((sum, r) => sum + r.iteration, 0) / completedRuns.length
    : 0

  // Status distribution
  const statusCounts = runs.reduce((acc, run) => {
    acc[run.status] = (acc[run.status] || 0) + 1
    return acc
  }, {})

  if (loading) return <div className="p-8">Loading...</div>

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Analytics</h1>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-gray-500 text-sm">Pass Rate</p>
          <div className="flex items-center gap-2">
            <p className="text-3xl font-bold">
              {stats?.pass_rate ? `${(stats.pass_rate * 100).toFixed(1)}%` : 'N/A'}
            </p>
            {stats?.pass_rate > 0.7 ? (
              <TrendingUp className="text-green-500" size={24} />
            ) : stats?.pass_rate < 0.5 ? (
              <TrendingDown className="text-red-500" size={24} />
            ) : (
              <Minus className="text-gray-400" size={24} />
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-gray-500 text-sm">Total Runs</p>
          <p className="text-3xl font-bold">{runs.length}</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-gray-500 text-sm">Completed</p>
          <p className="text-3xl font-bold text-green-600">{completedRuns.length}</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-gray-500 text-sm">Failed</p>
          <p className="text-3xl font-bold text-red-600">{failedRuns.length}</p>
        </div>
      </div>

      {/* Status Distribution */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Pipeline Status Distribution</h2>
        <div className="space-y-3">
          {Object.entries(statusCounts).map(([status, count]) => {
            const percentage = (count / runs.length) * 100
            const colors = {
              completed: 'bg-green-500',
              failed: 'bg-red-500',
              pending: 'bg-gray-400',
              preprocessing: 'bg-indigo-500',
              validating: 'bg-purple-500',
              human_review: 'bg-yellow-500',
              iterating: 'bg-orange-500',
            }
            return (
              <div key={status}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="capitalize">{status.replace('_', ' ')}</span>
                  <span>{count} ({percentage.toFixed(1)}%)</span>
                </div>
                <div className="h-3 bg-gray-200 rounded-full">
                  <div
                    className={`h-3 rounded-full ${colors[status] || 'bg-blue-500'}`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Metrics Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Average Iterations</h2>
          <p className="text-4xl font-bold text-blue-600">
            {avgIterations.toFixed(2)}
          </p>
          <p className="text-gray-500 text-sm mt-2">
            Average iterations before pipeline completion
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Data Overview</h2>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-500">Datasets</span>
              <span className="font-semibold">{stats?.total_datasets || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total Records</span>
              <span className="font-semibold">{stats?.total_records || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Pipeline Runs</span>
              <span className="font-semibold">{stats?.total_runs || 0}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Analytics
