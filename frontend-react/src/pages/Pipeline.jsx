import { useState, useEffect } from 'react'
import { getDatasets, runPipeline, getPipelineRuns } from '../api'
import { Play, RefreshCw } from 'lucide-react'

function Pipeline() {
  const [datasets, setDatasets] = useState([])
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [runningPipeline, setRunningPipeline] = useState(null)

  useEffect(() => {
    loadData()
  }, [statusFilter])

  const loadData = async () => {
    try {
      const [datasetsRes, runsRes] = await Promise.all([
        getDatasets(),
        getPipelineRuns(statusFilter === 'all' ? null : statusFilter, 50)
      ])
      setDatasets(datasetsRes.data)
      setRuns(runsRes.data)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRunPipeline = async (datasetId) => {
    setRunningPipeline(datasetId)
    try {
      await runPipeline(datasetId)
      loadData()
    } catch (error) {
      console.error('Failed to run pipeline:', error)
      alert('Failed to run pipeline: ' + (error.response?.data?.detail || error.message))
    } finally {
      setRunningPipeline(null)
    }
  }

  const statusColors = {
    pending: 'bg-gray-100 text-gray-700',
    collecting: 'bg-blue-100 text-blue-700',
    preprocessing: 'bg-indigo-100 text-indigo-700',
    validating: 'bg-purple-100 text-purple-700',
    human_review: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    iterating: 'bg-orange-100 text-orange-700',
  }

  if (loading) return <div className="p-8">Loading...</div>

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Pipeline</h1>

      {/* Run Pipeline */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Run Pipeline</h2>
        {datasets.length === 0 ? (
          <p className="text-gray-500">No datasets available. Create a dataset first.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {datasets.map((dataset) => (
              <div key={dataset.id} className="border rounded-lg p-4">
                <h3 className="font-medium">{dataset.name}</h3>
                <p className="text-sm text-gray-500 mb-3">{dataset.record_count} records</p>
                <button
                  onClick={() => handleRunPipeline(dataset.id)}
                  disabled={runningPipeline === dataset.id || dataset.record_count === 0}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {runningPipeline === dataset.id ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play size={16} />
                      Run Pipeline
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-4 mb-4">
        <label className="text-sm font-medium">Filter by status:</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded-lg px-3 py-2"
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="preprocessing">Preprocessing</option>
          <option value="validating">Validating</option>
          <option value="human_review">Human Review</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="iterating">Iterating</option>
        </select>
        <button
          onClick={loadData}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {/* Runs Table */}
      <div className="bg-white rounded-lg shadow">
        {runs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No pipeline runs yet
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left text-gray-500 text-sm border-b">
                <th className="p-4">ID</th>
                <th className="p-4">Dataset</th>
                <th className="p-4">Status</th>
                <th className="p-4">Iteration</th>
                <th className="p-4">Started</th>
                <th className="p-4">Completed</th>
                <th className="p-4">Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b hover:bg-gray-50">
                  <td className="p-4">#{run.id}</td>
                  <td className="p-4">
                    {datasets.find(d => d.id === run.dataset_id)?.name || `Dataset #${run.dataset_id}`}
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs ${statusColors[run.status] || 'bg-gray-100'}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="p-4">{run.iteration}</td>
                  <td className="p-4 text-sm text-gray-500">
                    {new Date(run.started_at).toLocaleString()}
                  </td>
                  <td className="p-4 text-sm text-gray-500">
                    {run.completed_at ? new Date(run.completed_at).toLocaleString() : '-'}
                  </td>
                  <td className="p-4 text-sm text-red-600 max-w-xs truncate">
                    {run.error_message || '-'}
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

export default Pipeline
