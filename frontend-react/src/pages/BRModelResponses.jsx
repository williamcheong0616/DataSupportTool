import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getBRResponseRecords, generateBRResponse, generateBRResponseBatch, editBRResponseProblems, getOllamaModels, pollBRTask,
  getSystemPrompt, updateSystemPrompt, searchBRResponses, getBRResponseSimilarity } from '../api'

function BRModelResponses() {
  const { pipelineId } = useParams()
  const navigate = useNavigate()

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState({})
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(null) // { recordId, modelName }
  const [problemText, setProblemText] = useState('')

  // pagination
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [completed, setCompleted] = useState(0)
  const [dsName, setDsName] = useState('')
  const perPage = 10

  // Model selection
  const [availableModels, setAvailableModels] = useState([])
  const [selectedModels, setSelectedModels] = useState(['', '', ''])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [batchGenerating, setBatchGenerating] = useState(false)
  const [batchProgress, setBatchProgress] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [jumpPage, setJumpPage] = useState('')

  // Search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMode, setSearchMode] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchTrigger, setSearchTrigger] = useState(0)

  // Similarity
  const [showSimilarity, setShowSimilarity] = useState(false)
  const [similarityData, setSimilarityData] = useState(null)
  const [loadingSimilarity, setLoadingSimilarity] = useState(false)

  // System Prompt
  const [showPromptModal, setShowPromptModal] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [promptSource, setPromptSource] = useState('global_default')
  const [savingPrompt, setSavingPrompt] = useState(false)

  useEffect(() => {
    let interval;
    if (searchMode && searchQuery.trim()) {
      runSearch(searchQuery)
      interval = setInterval(() => {
        runSearch(searchQuery, true)
      }, 5000)
    } else if (!searchMode) {
      fetchRecords()
      interval = setInterval(() => {
        fetchRecords(true)
      }, 5000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [pipelineId, page, statusFilter, searchMode, searchTrigger])
  useEffect(() => { fetchAvailableModels() }, [])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }) }, [page])

  async function fetchAvailableModels() {
    setModelsLoading(true)
    try {
      const res = await getOllamaModels()
      const models = res.data.models || []
      setAvailableModels(models)
      // Default: set all 3 to first available model (or empty)
      if (models.length > 0) {
        const defaultModel = models[0].name
        setSelectedModels([
          models[0]?.name || '',
          models[1]?.name || models[0]?.name || '',
          models[2]?.name || models[0]?.name || ''
        ])
      }
    } catch (err) {
      console.error('Failed to fetch Ollama models:', err)
    }
    setModelsLoading(false)
  }

  async function fetchRecords(quiet = false) {
    if (!quiet) setLoading(true)
    try {
      const res = await getBRResponseRecords(pipelineId, page, perPage, statusFilter)
      setRecords(res.data.records)
      setTotal(res.data.total)
      setPages(res.data.total_pages)
      setCompleted(res.data.completed_count)
      setDsName(res.data.dataset_name || 'dataset')
    } catch (err) {
      console.error('Fetch failed:', err)
      if (!quiet) alert('Failed to load response records')
    }
    if (!quiet) setLoading(false)
  }

  function getModelConfigs() {
    return selectedModels.map((modelId, i) => ({
      name: `Model-${String.fromCharCode(65 + i)} (${modelId})`,
      model_id: modelId
    }))
  }

  async function generate(id) {
    setGenerating(g => ({ ...g, [id]: true }))
    try {
      const models = selectedModels.every(m => m) ? getModelConfigs() : null
      const res = await generateBRResponse(id, models)
      const taskId = res.data.task_id
      // Poll until the Celery task finishes
      const result = await pollBRTask(taskId)
      setRecords(prev => prev.map(r => r.id === id ? { ...r, model_responses: result.responses, completed: true } : r))
      setCompleted(c => c + 1)
    } catch (err) {
      alert('Generation failed: ' + (err.response?.data?.detail || err.message))
    }
    setGenerating(g => ({ ...g, [id]: false }))
  }

  async function batchGenerate() {
    if (!selectedModels.every(m => m)) {
      alert('Please select all 3 models before generating.')
      return
    }

    const pendingCount = total - completed
    if (pendingCount === 0) {
      alert('No pending records to generate.')
      return
    }

    if (!confirm(`Generate responses for ${pendingCount} pending records using:\n• ${selectedModels[0]}\n• ${selectedModels[1]}\n• ${selectedModels[2]}\n\nThis will run in the background. You can close this page and come back.\n\nContinue?`)) {
      return
    }

    setBatchGenerating(true)
    setBatchProgress({ current: 0, total: pendingCount })

    try {
      const models = getModelConfigs()
      const res = await generateBRResponseBatch(pipelineId, models)
      const taskId = res.data.task_id

      if (!taskId) {
        // No pending records or immediate response
        alert(res.data.message || 'No pending records')
        setBatchGenerating(false)
        setBatchProgress(null)
        return
      }

      // Poll task status, refreshing page data periodically
      const pollInterval = 3000
      const timeout = 1800000 // 30 min
      const start = Date.now()

      while (Date.now() - start < timeout) {
        const statusRes = await (await import('../api')).getBRTaskStatus(taskId)
        const { state, result, error } = statusRes.data

        if (state === 'SUCCESS') {
          const processed = result?.processed || 0
          alert(`✓ Batch generation complete!\n${processed} records processed.`)
          fetchRecords()
          break
        }
        if (state === 'FAILURE') {
          alert('Batch generation failed: ' + (error || 'Unknown error'))
          break
        }

        // Refresh records to show partial progress
        await fetchRecords(true)
        await new Promise(r => setTimeout(r, pollInterval))
      }
    } catch (err) {
      alert('Batch generation failed: ' + (err.response?.data?.detail || err.message))
    }

    setBatchGenerating(false)
    setBatchProgress(null)
  }

  function updateSelectedModel(index, value) {
    setSelectedModels(prev => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  function changeFilter(f) {
    setStatusFilter(f)
    setPage(1)
  }

  function handleJumpPage(e) {
    e.preventDefault()
    const p = parseInt(jumpPage, 10)
    if (p >= 1 && p <= pages) {
      goPage(p)
      setJumpPage('')
    }
  }

  function startEdit(recordId, modelName, problems) {
    setEditing({ recordId, modelName })
    setProblemText(Array.isArray(problems) ? problems.join('\n') : '')
  }

  function putInProblem(recordId, modelName, response) {
    setEditing({ recordId, modelName })
    setProblemText(response || '')
  }

  function cancelEdit() {
    setEditing(null)
    setProblemText('')
  }

  // --- System Prompt ---
  async function openPromptModal() {
    try {
      const res = await getSystemPrompt(pipelineId)
      setPromptText(res.data.system_prompt)
      setPromptSource(res.data.source)
    } catch (err) {
      console.error('Failed to fetch system prompt:', err)
    }
    setShowPromptModal(true)
  }

  async function savePromptOverride() {
    setSavingPrompt(true)
    try {
      const res = await updateSystemPrompt(pipelineId, { system_prompt: promptText })
      setPromptSource(res.data.source)
      setShowPromptModal(false)
    } catch (err) {
      alert('Failed to save: ' + (err.response?.data?.detail || err.message))
    }
    setSavingPrompt(false)
  }

  async function resetPromptToDefault() {
    setSavingPrompt(true)
    try {
      const res = await updateSystemPrompt(pipelineId, { system_prompt: null })
      setPromptText(res.data.system_prompt)
      setPromptSource(res.data.source)
    } catch (err) {
      alert('Failed to reset: ' + (err.response?.data?.detail || err.message))
    }
    setSavingPrompt(false)
  }

  // --- Search ---
  async function runSearch(q, quiet = false) {
    if (!q.trim()) return
    if (!quiet) setSearching(true)
    try {
      const res = await searchBRResponses(pipelineId, q, page, perPage)
      setRecords(res.data.records)
      setTotal(res.data.total)
      setPages(res.data.total_pages)
      setCompleted(res.data.completed_count)
    } catch (err) {
      if (!quiet) alert('Search failed: ' + (err.response?.data?.detail || err.message))
    }
    if (!quiet) setSearching(false)
  }

  async function handleSearch(e) {
    e.preventDefault()
    if (!searchQuery.trim()) return
    setSearchTrigger(t => t + 1)
    if (searchMode) {
      // Already in search mode - just re-run with potentially new query
      setPage(1)
      runSearch(searchQuery)
    } else {
      setSearchMode(true)
      setPage(1)
      // useEffect will fire runSearch when searchMode becomes true
    }
  }

  function exitSearch() {
    setSearchMode(false)
    setSearchQuery('')
    setPage(1)
  }

  // --- Similarity ---
  async function detectSimilarity() {
    setLoadingSimilarity(true)
    setShowSimilarity(true)
    setSimilarityData(null)
    try {
      const res = await getBRResponseSimilarity(pipelineId)
      setSimilarityData(res.data)
    } catch (err) {
      alert('Similarity check failed: ' + (err.response?.data?.detail || err.message))
      setShowSimilarity(false)
    }
    setLoadingSimilarity(false)
  }

  function highlightText(text, query) {
    if (!query || !text) return text
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-200 dark:bg-yellow-700 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    )
  }

  async function saveProblems() {
    if (!editing) return
    setSaving(true)
    try {
      const problems = problemText.split('\n').map(s => s.trim()).filter(Boolean)
      const res = await editBRResponseProblems(editing.recordId, editing.modelName, problems)
      setRecords(prev => prev.map(r => {
        if (r.id === editing.recordId && r.model_responses) {
          const updated = { ...r.model_responses }
          updated[editing.modelName] = res.data.updated_response
          return { ...r, model_responses: updated }
        }
        return r
      }))
      cancelEdit()
      alert('Problems saved!')
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.detail || err.message))
    }
    setSaving(false)
  }

  function exportCSV() {
    if (!records.length) return
    const headers = ['Record ID', 'Question', 'Model', 'Model ID', 'Response', 'Problems', 'Edited By']
    const rows = []
    records.forEach(r => {
      if (!r.model_responses) return
      Object.entries(r.model_responses).forEach(([name, d]) => {
        rows.push([
          r.text_record_id,
          `"${(r.selected_question || '').replace(/"/g, '""')}"`,
          name, d.model_id || '',
          `"${(d.response || '').replace(/"/g, '""')}"`,
          `"${(d.problems || []).join('; ')}"`,
          d.edited_by || '',
        ])
      })
    })
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(dsName || 'dataset').replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}_responses.csv`
    a.click()
  }

  function goPage(p) {
    if (p >= 1 && p <= pages) setPage(p)
  }

  if (loading && !records.length) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading response records...</div>
      </div>
    )
  }

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">

        {/* header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Stage 4: Model Responses</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">Generate responses from 3 selected models for each validated question</p>
          </div>
          <div className="flex gap-2">
            <button onClick={exportCSV} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">📥 Export CSV</button>
            <button onClick={() => navigate('/text')} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">← Back</button>
          </div>
        </div>

        {/* stage nav */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <div className="flex items-center gap-2">
            <Link to={`/br-pipeline/classification/${pipelineId}`} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300">1. Classification</Link>
            <span className="text-gray-400">→</span>
            <Link to={`/br-pipeline/restructure/${pipelineId}`} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300">2. Restructure</Link>
            <span className="text-gray-400">→</span>
            <Link to={`/br-pipeline/questions/${pipelineId}`} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300">3. Questions</Link>
            <span className="text-gray-400">→</span>
            <span className="px-3 py-1 text-sm bg-indigo-600 text-white rounded">4. Model Responses</span>
          </div>
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Filter:</span>
          {['all', 'pending', 'completed'].map(f => (
            <button
              key={f}
              onClick={() => changeFilter(f)}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                statusFilter === f
                  ? f === 'all' ? 'bg-indigo-600 text-white'
                    : f === 'pending' ? 'bg-orange-500 text-white'
                    : 'bg-green-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="flex items-center gap-2 mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search questions and responses..."
            className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
          />
          <button type="submit" disabled={searching || !searchQuery.trim()}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {searching ? 'Searching...' : 'Search'}
          </button>
          {searchMode && (
            <button type="button" onClick={exitSearch}
              className="px-4 py-2 text-sm bg-gray-500 text-white rounded-lg hover:bg-gray-600">
              Clear
            </button>
          )}
        </form>
        {searchMode && (
          <p className="text-sm text-indigo-600 dark:text-indigo-400 mb-4">
            Showing search results for "{searchQuery}" ({total} found)
          </p>
        )}

        {/* Model Selection Panel */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">🤖 Model Selection</h2>
            <div className="flex items-center gap-2">
              {modelsLoading && <span className="text-sm text-gray-400">Loading models...</span>}
              <button onClick={openPromptModal}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600">
                Edit System Prompt
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {['A', 'B', 'C'].map((label, i) => (
              <div key={label}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Model {label}
                </label>
                <select
                  value={selectedModels[i]}
                  onChange={(e) => updateSelectedModel(i, e.target.value)}
                  disabled={modelsLoading || batchGenerating}
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  <option value="">-- Select model --</option>
                  {availableModels.map(m => (
                    <option key={`${label}-${m.name}`} value={m.name}>
                      {m.name} ({m.size_gb} GB)
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {availableModels.length} model{availableModels.length !== 1 ? 's' : ''} available
              {total - completed > 0 && ` · ${total - completed} pending records`}
            </p>
            <button
              onClick={batchGenerate}
              disabled={batchGenerating || !selectedModels.every(m => m) || (total - completed) === 0}
              className="px-5 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 font-medium flex items-center gap-2"
            >
              {batchGenerating ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Generating... {batchProgress ? `(${batchProgress.current}/${batchProgress.total})` : ''}
                </>
              ) : (
                <>🤖 Generate All Responses ({total - completed} pending)</>
              )}
            </button>
          </div>
        </div>

        {/* stats */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{total}</div>
                <div className="text-sm text-gray-500">With Questions</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">{completed}</div>
                <div className="text-sm text-gray-500">Generated</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{total - completed}</div>
                <div className="text-sm text-gray-500">Pending</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">{pct}% Complete</span>
              <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div className="bg-green-600 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <button onClick={detectSimilarity} disabled={loadingSimilarity}
                className="ml-4 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50">
                {loadingSimilarity ? 'Analyzing...' : 'Detect Similarity'}
              </button>
            </div>
          </div>
        </div>

        {/* Similarity Results Panel */}
        {showSimilarity && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Similarity Analysis</h2>
              <button onClick={() => setShowSimilarity(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            {loadingSimilarity ? (
              <p className="text-gray-500 py-4 text-center">Analyzing responses...</p>
            ) : similarityData ? (
              <>
                <p className="text-sm text-gray-500 mb-4">{similarityData.total_comparisons} pairs compared (same model, different records)</p>
                {similarityData.overtrain_candidates.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-red-600 dark:text-red-400 mb-2 uppercase tracking-wide">
                      Overtrain Candidates ({similarityData.overtrain_candidates.length}) — similarity &ge; 0.85
                    </h3>
                    <div className="space-y-2">
                      {similarityData.overtrain_candidates.map((p, i) => (
                        <div key={i} className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm">
                          <div className="flex items-center gap-3 mb-1">
                            <span className="font-medium text-red-700 dark:text-red-300">Similarity: {(p.similarity * 100).toFixed(1)}%</span>
                            <span className="text-gray-500">Records #{p.record_id_a} & #{p.record_id_b}</span>
                            <span className="text-xs bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200 px-2 py-0.5 rounded-full">{p.model_name}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs text-gray-700 dark:text-gray-300">
                            <div className="bg-white dark:bg-gray-700 p-2 rounded">{p.response_a}...</div>
                            <div className="bg-white dark:bg-gray-700 p-2 rounded">{p.response_b}...</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {similarityData.undertrain_candidates.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-yellow-600 dark:text-yellow-400 mb-2 uppercase tracking-wide">
                      Undertrain Candidates ({similarityData.undertrain_candidates.length}) — similarity &le; 0.15
                    </h3>
                    <div className="space-y-2">
                      {similarityData.undertrain_candidates.map((p, i) => (
                        <div key={i} className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-sm">
                          <div className="flex items-center gap-3 mb-1">
                            <span className="font-medium text-yellow-700 dark:text-yellow-300">Similarity: {(p.similarity * 100).toFixed(1)}%</span>
                            <span className="text-gray-500">Records #{p.record_id_a} & #{p.record_id_b}</span>
                            <span className="text-xs bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200 px-2 py-0.5 rounded-full">{p.model_name}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs text-gray-700 dark:text-gray-300">
                            <div className="bg-white dark:bg-gray-700 p-2 rounded">{p.response_a}...</div>
                            <div className="bg-white dark:bg-gray-700 p-2 rounded">{p.response_b}...</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {similarityData.overtrain_candidates.length === 0 && similarityData.undertrain_candidates.length === 0 && (
                  <p className="text-gray-500 text-center py-4">No similarity issues detected.</p>
                )}
              </>
            ) : null}
          </div>
        )}

        {/* records */}
        <div className="space-y-6 mb-6">
          {records.map((rec, i) => (
            <div key={rec.id} className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              {/* record header */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <span className="text-sm font-medium text-gray-500">Record #{(page - 1) * perPage + i + 1}</span>
                    <h3 className="text-lg font-medium mt-1">
                      <span className="text-gray-600 dark:text-gray-400">Question: </span>
                      <span className="text-gray-900 dark:text-gray-100">{rec.selected_question || <i className="text-gray-400">None</i>}</span>
                    </h3>
                  </div>
                  <div>
                    {rec.model_responses ? (
                      <button onClick={() => generate(rec.id)} disabled={generating[rec.id]}
                        className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
                        {generating[rec.id] ? '⏳ Regenerating...' : '🔄 Regenerate All'}
                      </button>
                    ) : rec.selected_question && (
                      <button onClick={() => generate(rec.id)} disabled={generating[rec.id]}
                        className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50">
                        {generating[rec.id] ? '⏳ Generating...' : '🤖 Generate Responses'}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* body: restructured text + model responses */}
              {rec.model_responses ? (
                <div className="flex">
                  {/* left: restructured text */}
                  {rec.restructured_text && (
                    <div className="w-1/3 border-r border-gray-200 dark:border-gray-700 p-4">
                      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                        Original Response (Restructured Text)
                      </label>
                      <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white whitespace-pre-wrap max-h-64 overflow-y-auto">
                        {rec.restructured_text}
                      </div>
                    </div>
                  )}

                  {/* right: model responses table */}
                  <div className={rec.restructured_text ? 'w-2/3' : 'w-full'}>
                    <table className="w-full">
                      <thead className="bg-gray-100 dark:bg-gray-700">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-40">Model</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Response</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-48">Problems</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-40">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {Object.entries(rec.model_responses).map(([name, data]) => {
                          const isEditing = editing?.recordId === rec.id && editing?.modelName === name
                          return (
                            <tr key={name} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                              <td className="px-4 py-4 text-sm">
                                <div className="font-medium text-gray-900 dark:text-white">{name}</div>
                                <div className="text-xs text-gray-500">{data.model_id}</div>
                                {data.corrected_response && (
                                  <div className="mt-1 text-xs text-green-600 font-medium">✓ Corrected</div>
                                )}
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-900 dark:text-white">
                                <div className="whitespace-pre-wrap max-h-40 overflow-y-auto">{data.response}</div>
                              </td>
                              <td className="px-4 py-4 text-sm">
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <textarea value={problemText} onChange={e => setProblemText(e.target.value)}
                                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white min-h-[100px]"
                                      placeholder="One problem per line..." />
                                    <div className="flex gap-2">
                                      <button onClick={saveProblems} disabled={saving}
                                        className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50">
                                        {saving ? 'Saving...' : '💾 Save'}
                                      </button>
                                      <button onClick={cancelEdit} disabled={saving}
                                        className="px-3 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600 disabled:opacity-50">Cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    {data.problems?.length > 0 ? (
                                      <div className="space-y-1">
                                        {data.problems.map((p, j) => (
                                          <div key={j} className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">{p}</div>
                                        ))}
                                        {data.edited_by && <div className="text-xs text-gray-500 mt-1">by {data.edited_by}</div>}
                                      </div>
                                    ) : (
                                      <span className="text-gray-400 text-xs">None</span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-4 text-sm">
                                {!isEditing && (
                                  <div className="flex flex-col gap-2">
                                    <button onClick={() => startEdit(rec.id, name, data.problems)}
                                      className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700">
                                      ✏️ Edit
                                    </button>
                                    <button onClick={() => putInProblem(rec.id, name, data.response)}
                                      className="px-3 py-1.5 bg-amber-600 text-white text-xs rounded hover:bg-amber-700"
                                      title="Copy response into Problems for annotation">
                                      ⚠️ Put in Problem
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-gray-500">
                  {rec.selected_question ? 'Click "Generate Responses" to get model outputs' : 'No question selected. Complete Stage 3 first.'}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* pagination */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Showing {(page - 1) * perPage + 1} - {Math.min(page * perPage, total)} of {total}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => goPage(1)} disabled={page === 1} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50">First</button>
            <button onClick={() => goPage(page - 1)} disabled={page === 1} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50">Prev</button>
            <span className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400">Page {page} / {pages}</span>
            <button onClick={() => goPage(page + 1)} disabled={page === pages} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50">Next</button>
            <button onClick={() => goPage(pages)} disabled={page === pages} className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50">Last</button>
            {/* Jump to page */}
            <form onSubmit={handleJumpPage} className="flex items-center gap-1 ml-3 border-l border-gray-300 dark:border-gray-600 pl-3">
              <label className="text-sm text-gray-500 dark:text-gray-400">Go to:</label>
              <input
                type="number"
                min={1}
                max={pages}
                value={jumpPage}
                onChange={(e) => setJumpPage(e.target.value)}
                placeholder="#"
                className="w-16 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="submit"
                className="px-2 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
              >
                Go
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* System Prompt Modal */}
      {showPromptModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl">
            <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Edit System Prompt</h2>
                <p className="text-xs text-gray-500 mt-0.5">Source: <span className={promptSource === 'pipeline_override' ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500'}>{promptSource === 'pipeline_override' ? 'Pipeline Override' : 'Global Default'}</span></p>
              </div>
              <button onClick={() => setShowPromptModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="p-5">
              <textarea
                value={promptText}
                onChange={e => setPromptText(e.target.value)}
                rows={12}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>
            <div className="flex items-center justify-between p-5 border-t border-gray-200 dark:border-gray-700">
              <button onClick={resetPromptToDefault} disabled={savingPrompt || promptSource === 'global_default'}
                className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
                Reset to Default
              </button>
              <div className="flex gap-2">
                <button onClick={() => setShowPromptModal(false)}
                  className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600">
                  Cancel
                </button>
                <button onClick={savePromptOverride} disabled={savingPrompt}
                  className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  {savingPrompt ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default BRModelResponses
