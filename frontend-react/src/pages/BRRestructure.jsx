import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { runBRStage2, mergeBRRecords, getBRStageProgress, getBRPipelineStatus, getBRRestructureRecords, updateBRRestructure, autoRestructureBR } from '../api'

function BRRestructure() {
  const { pipelineId } = useParams()
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})
  const [pipelineInfo, setPipelineInfo] = useState(null)
  const [rerunning, setRerunning] = useState(false)
  const [showRerunModal, setShowRerunModal] = useState(false)
  const [skipRestructure, setSkipRestructure] = useState(false)
  
  // Selection state for merge
  const [selectedIds, setSelectedIds] = useState([])
  const [merging, setMerging] = useState(false)
  const [mergeMode, setMergeMode] = useState(false)
  
  // Progress polling
  const [progress, setProgress] = useState(null)
  const [polling, setPolling] = useState(false)
  
  // Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [restructuredCount, setRestructuredCount] = useState(0)
  const perPage = 10
  const [jumpPage, setJumpPage] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  // Active card index for keyboard navigation
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef(null)
  const cardRefs = useRef([])

  // Scroll to top on page change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setActiveIndex(0)
  }, [page])

  useEffect(() => {
    fetchPipelineInfo()
  }, [pipelineId])

  useEffect(() => {
    fetchRecords()
  }, [pipelineId, page, statusFilter])

  // Poll progress when pipeline is running
  useEffect(() => {
    if (!polling) return
    const interval = setInterval(async () => {
      try {
        const res = await getBRStageProgress(pipelineId)
        setProgress(res.data)
        if (res.data.status !== 'running') {
          setPolling(false)
          fetchRecords()
          fetchPipelineInfo()
        }
      } catch (err) {
        console.error('Poll failed:', err)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [polling, pipelineId])

  // Scroll active card into view
  useEffect(() => {
    if (cardRefs.current[activeIndex]) {
      cardRefs.current[activeIndex].scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeIndex])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      // Don't capture when typing in input/textarea or modal is open
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || showRerunModal) return

      const activeRecord = records[activeIndex]
      if (!activeRecord) return

      switch (e.key.toLowerCase()) {
        case 'a': // Keep Original
          e.preventDefault()
          handleKeepOriginal(activeRecord.id)
          break
        case 'w': // Auto-Restructure
          e.preventDefault()
          handleAutoRestructure(activeRecord.id)
          break
        case 'd': // Save
          e.preventDefault()
          if (activeRecord.restructured_text) handleSave(activeRecord.id)
          break
        case 's': // Next page
          e.preventDefault()
          if (page < totalPages) goToPage(page + 1)
          break
        case 'p': // Previous page
          e.preventDefault()
          if (page > 1) goToPage(page - 1)
          break
        case 'arrowdown':
        case 'j': // Next card
          e.preventDefault()
          setActiveIndex(prev => Math.min(prev + 1, records.length - 1))
          break
        case 'arrowup':
        case 'k': // Previous card
          e.preventDefault()
          setActiveIndex(prev => Math.max(prev - 1, 0))
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [records, activeIndex, page, totalPages, showRerunModal])

  const fetchPipelineInfo = async () => {
    try {
      const res = await getBRPipelineStatus(pipelineId)
      setPipelineInfo(res.data)
    } catch (err) {
      console.error('Failed to fetch pipeline info:', err)
    }
  }

  const fetchRecords = async () => {
    setLoading(true)
    try {
      const res = await getBRRestructureRecords(pipelineId, page, perPage, statusFilter)
      setRecords(res.data.records)
      setTotal(res.data.total)
      setTotalPages(res.data.total_pages)
      setRestructuredCount(res.data.restructured_count)
    } catch (err) {
      console.error('Failed to fetch records:', err)
      alert('Failed to load restructure records')
    } finally {
      setLoading(false)
    }
  }

  const handleRestructuredTextChange = (recordId, value) => {
    setRecords(prev => prev.map(r => 
      r.id === recordId ? { ...r, restructured_text: value } : r
    ))
  }

  const handleSave = async (recordId) => {
    const record = records.find(r => r.id === recordId)
    if (!record) return

    setSaving(prev => ({ ...prev, [recordId]: true }))
    try {
      await updateBRRestructure(recordId, { restructured_text: record.restructured_text })
      if (!record.was_restructured) {
        setRestructuredCount(prev => prev + 1)
        setRecords(prev => prev.map(r => 
          r.id === recordId ? { ...r, was_restructured: true } : r
        ))
      }
    } catch (err) {
      console.error('Failed to save restructured text:', err)
      alert('Failed to save')
    } finally {
      setSaving(prev => ({ ...prev, [recordId]: false }))
    }
  }

  const handleKeepOriginal = async (recordId) => {
    const record = records.find(r => r.id === recordId)
    if (!record) return

    setSaving(prev => ({ ...prev, [`keep_${recordId}`]: true }))
    try {
      await updateBRRestructure(recordId, { restructured_text: record.original_text })
      setRecords(prev => prev.map(r => 
        r.id === recordId ? { ...r, restructured_text: record.original_text, was_restructured: true } : r
      ))
      if (!record.was_restructured) {
        setRestructuredCount(prev => prev + 1)
      }
    } catch (err) {
      console.error('Failed to save:', err)
      alert('Failed to save')
    } finally {
      setSaving(prev => ({ ...prev, [`keep_${recordId}`]: false }))
    }
  }

  const handleAutoRestructure = async (recordId) => {
    setSaving(prev => ({ ...prev, [`auto_${recordId}`]: true }))
    try {
      const res = await autoRestructureBR(recordId)
      setRecords(prev => prev.map(r => 
        r.id === recordId ? { ...r, restructured_text: res.data.restructured_text, was_restructured: true } : r
      ))
      if (!records.find(r => r.id === recordId)?.was_restructured) {
        setRestructuredCount(prev => prev + 1)
      }
    } catch (err) {
      console.error('Failed to auto-restructure:', err)
      alert('Failed to auto-restructure')
    } finally {
      setSaving(prev => ({ ...prev, [`auto_${recordId}`]: false }))
    }
  }

  const handleRerunStage = async () => {
    setShowRerunModal(false)
    setRerunning(true)
    try {
      const res = await runBRStage2(pipelineId, skipRestructure, null, true)
      alert(`Stage 2 started in background!\n\n${res.data.message}\n\nThe page will auto-refresh as processing completes.`)
      setPolling(true)
    } catch (err) {
      console.error('Failed to rerun stage:', err)
      alert('Failed to start Stage 2: ' + (err.response?.data?.detail || err.message))
    } finally {
      setRerunning(false)
    }
  }

  // Selection & Merge functions
  const toggleSelect = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const handleMerge = async () => {
    if (selectedIds.length < 2) {
      alert('Select at least 2 records to merge')
      return
    }
    if (!confirm(`Merge ${selectedIds.length} selected records?\n\nThe texts will be concatenated in selection order into the first selected record. Other records will be marked as merged.\n\nOriginal texts are preserved and not modified.`)) return

    setMerging(true)
    try {
      const res = await mergeBRRecords(selectedIds)
      alert(res.data.message)
      setSelectedIds([])
      setMergeMode(false)
      fetchRecords()
    } catch (err) {
      console.error('Merge failed:', err)
      alert('Failed to merge: ' + (err.response?.data?.detail || err.message))
    } finally {
      setMerging(false)
    }
  }

  const goToPage = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage)
    }
  }

  const changeFilter = (f) => {
    setStatusFilter(f)
    setPage(1)
    setActiveIndex(0)
  }

  const handleJumpPage = (e) => {
    e.preventDefault()
    const p = parseInt(jumpPage, 10)
    if (p >= 1 && p <= totalPages) {
      goToPage(p)
      setJumpPage('')
    }
  }

  if (loading && records.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading restructure records...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6" ref={containerRef}>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Stage 2: Text Restructure
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Only Bahasa Rojak records shown. Consolidate text or keep original.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowRerunModal(true)}
              disabled={rerunning}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {rerunning ? 'Starting...' : 'Rerun Stage 2'}
            </button>
            <button
              onClick={() => navigate('/text')}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              Back to Datasets
            </button>
          </div>
        </div>

        {/* Stage Navigation */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <div className="flex items-center gap-2">
            <Link
              to={`/br-pipeline/classification/${pipelineId}`}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              1. Classification
            </Link>
            <span className="text-gray-400">-&gt;</span>
            <span className="px-3 py-1 text-sm bg-indigo-600 text-white rounded">
              2. Restructure
            </span>
            <span className="text-gray-400">-&gt;</span>
            <Link
              to={`/br-pipeline/questions/${pipelineId}`}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              3. Question Validation
            </Link>
            <span className="text-gray-400">-&gt;</span>
            <Link
              to={`/br-pipeline/responses/${pipelineId}`}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              4. Model Responses
            </Link>
          </div>
        </div>

        {/* Keyboard Shortcuts Help */}
        <div className="bg-gray-800 dark:bg-gray-900 rounded-lg shadow p-3 mb-6">
          <div className="flex items-center gap-4 flex-wrap text-xs text-gray-300">
            <span className="font-semibold text-gray-100">⌨ Hotkeys:</span>
            <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-200 font-mono">A</kbd> Keep Original</span>
            <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-200 font-mono">W</kbd> Auto-Restructure</span>
            <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-200 font-mono">D</kbd> Save</span>
            <span className="border-l border-gray-600 pl-4"><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-200 font-mono">↑</kbd><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-200 font-mono ml-1">↓</kbd> Navigate cards</span>
            <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-200 font-mono">S</kbd> Next page</span>
            <span><kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-200 font-mono">P</kbd> Prev page</span>
          </div>
        </div>

        {/* Progress Banner (shown when running) */}
        {polling && progress && (
          <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="animate-spin text-blue-600 dark:text-blue-400">&#9203;</div>
              <div>
                <div className="font-medium text-blue-900 dark:text-blue-200">
                  Stage 2 running in background...
                </div>
                <div className="text-sm text-blue-700 dark:text-blue-300">
                  {progress.stage2_restructured} / {progress.bahasa_rojak_count} BR records restructured
                  {progress.error_message && (
                    <span className="text-red-600 ml-2">Error: {progress.error_message}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Stats Bar */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                  {total}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">BR Records</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {restructuredCount}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Restructured</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                  {total - restructuredCount}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Pending</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Merge Mode Toggle */}
              <button
                onClick={() => {
                  setMergeMode(!mergeMode)
                  setSelectedIds([])
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  mergeMode
                    ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-2 border-amber-400'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {mergeMode ? 'Cancel Merge' : 'Merge Mode'}
              </button>

              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {total > 0 ? Math.round((restructuredCount / total) * 100) : 0}% Complete
                </span>
                <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${total > 0 ? (restructuredCount / total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Status Filter + Merge Bar */}
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

        {/* Merge Bar (shown when in merge mode with selections) */}
        {mergeMode && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-amber-900 dark:text-amber-200">
                  Merge Mode: Select records to concatenate
                </div>
                <div className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  {selectedIds.length === 0 
                    ? 'Click the checkboxes to select records. They will be merged in selection order.'
                    : `${selectedIds.length} records selected (IDs: ${selectedIds.join(', ')})`
                  }
                </div>
                <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Original texts are preserved. Only the restructured_text field is updated.
                </div>
              </div>
              <button
                onClick={handleMerge}
                disabled={selectedIds.length < 2 || merging}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {merging ? 'Merging...' : `Merge ${selectedIds.length} Records`}
              </button>
            </div>
          </div>
        )}

        {/* Records as cards */}
        <div className="space-y-4 mb-6">
          {records.map((record, idx) => {
            const isMerged = record.restructured_text?.startsWith('[MERGED into record')
            const isSelected = selectedIds.includes(record.id)
            const selectionIndex = selectedIds.indexOf(record.id)
            const isActive = idx === activeIndex
            const isDone = record.was_restructured && !isActive
            
            return (
              <div 
                key={record.id}
                ref={el => cardRefs.current[idx] = el}
                onClick={() => setActiveIndex(idx)}
                className={`rounded-lg shadow transition-all duration-200 cursor-pointer
                  ${isActive 
                    ? 'bg-white dark:bg-gray-800 ring-2 ring-indigo-500 scale-[1.01] shadow-lg' 
                    : isDone
                      ? 'bg-gray-50 dark:bg-gray-800/60 opacity-60 hover:opacity-80'
                      : 'bg-white dark:bg-gray-800 hover:shadow-md'
                  }
                  ${isMerged ? 'opacity-40' : ''}
                  ${isSelected ? 'ring-2 ring-amber-500' : ''}
                  p-5`}
              >
                <div className="flex items-start gap-4 mb-3">
                  {/* Merge checkbox */}
                  {mergeMode && !isMerged && (
                    <div className="flex flex-col items-center gap-1 pt-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(record.id)}
                        className="w-5 h-5 text-amber-600 rounded cursor-pointer"
                      />
                      {isSelected && (
                        <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                          #{selectionIndex + 1}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Card number + active indicator */}
                  <div className="flex items-center gap-2">
                    {isActive && (
                      <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                    )}
                    <div className={`text-sm font-medium ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-400'}`}>
                      #{(page - 1) * perPage + idx + 1}
                    </div>
                  </div>
                  
                  <div className="flex-1">
                    {/* Language badge + status */}
                    <div className="flex items-center gap-2 mb-3">
                      {record.detected_language && (
                        <span className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded">
                          {record.detected_language}
                        </span>
                      )}
                      {record.was_restructured && (
                        <span className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded">
                          ✓ Done
                        </span>
                      )}
                      {isMerged && (
                        <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
                          {record.restructured_text}
                        </span>
                      )}
                    </div>
                    
                    {!isMerged && (
                      <div className="grid grid-cols-2 gap-4">
                        {/* Original Text */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Original Text (preserved)
                          </label>
                          <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white min-h-[120px] whitespace-pre-wrap">
                            {record.original_text}
                          </div>
                        </div>
                        
                        {/* Restructured Text */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Restructured Text
                          </label>
                          <textarea
                            value={record.restructured_text || ''}
                            onChange={(e) => handleRestructuredTextChange(record.id, e.target.value)}
                            placeholder="Click 'Keep Original' to use as-is, 'Auto-Restructure' for LLM, or edit manually..."
                            className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white min-h-[120px] text-sm resize-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Actions */}
                {!isMerged && (
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleKeepOriginal(record.id) }}
                      disabled={saving[`keep_${record.id}`]}
                      className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                    >
                      {saving[`keep_${record.id}`] ? 'Saving...' : '(A) Keep Original'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAutoRestructure(record.id) }}
                      disabled={saving[`auto_${record.id}`]}
                      className="px-3 py-1 text-sm bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-900/60 disabled:opacity-50"
                    >
                      {saving[`auto_${record.id}`] ? 'Processing...' : '(W) Auto-Restructure'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSave(record.id) }}
                      disabled={saving[record.id] || !record.restructured_text}
                      className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      {saving[record.id] ? 'Saving...' : '(D) Save'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Showing {(page - 1) * perPage + 1} - {Math.min(page * perPage, total)} of {total} BR records
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => goToPage(1)}
                disabled={page === 1}
                className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                First
              </button>
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page === 1}
                className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                (P) Prev
              </button>
              <span className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page === totalPages}
                className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                (S) Next
              </button>
              <button
                onClick={() => goToPage(totalPages)}
                disabled={page === totalPages}
                className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Last
              </button>
              {/* Jump to page */}
              <form onSubmit={handleJumpPage} className="flex items-center gap-1 ml-3 border-l border-gray-300 dark:border-gray-600 pl-3">
                <label className="text-sm text-gray-500 dark:text-gray-400">Go to:</label>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
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
        )}

        {total === 0 && !loading && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-12 text-center">
            <div className="text-gray-500 dark:text-gray-400 text-lg">
              No Bahasa Rojak records found for this pipeline.
            </div>
            <p className="text-gray-400 dark:text-gray-500 mt-2">
              Make sure Stage 1 (Classification) has been run first and records are classified as Bahasa Rojak.
            </p>
            <Link
              to={`/br-pipeline/classification/${pipelineId}`}
              className="inline-block mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              Go to Stage 1: Classification
            </Link>
          </div>
        )}
      </div>

      {/* Rerun Modal */}
      {showRerunModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Rerun Stage 2: Text Restructure
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-2">
              Only <strong>Bahasa Rojak</strong> records will be processed.
            </p>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Choose restructuring option:
            </p>
            <div className="space-y-3 mb-6">
              <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
                <input
                  type="radio"
                  checked={!skipRestructure}
                  onChange={() => setSkipRestructure(false)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    Consolidate Text (LLM)
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    LLM will consolidate text while keeping original language
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
                <input
                  type="radio"
                  checked={skipRestructure}
                  onChange={() => setSkipRestructure(true)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    Keep Original Text
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Text is already contextualized enough - no changes needed
                  </div>
                </div>
              </label>
            </div>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg mb-4">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                Original language is always preserved. No translation will occur.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleRerunStage}
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                Confirm Rerun
              </button>
              <button
                onClick={() => setShowRerunModal(false)}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default BRRestructure