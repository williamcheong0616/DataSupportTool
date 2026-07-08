import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { runBRStage2, mergeBRRecords, getBRStageProgress, getBRPipelineStatus, getBRRestructureRecords, updateBRRestructure, exportBRRestructureCSV, autoRestructureBR, searchBRRestructureRecords } from '../api'

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
  const prevActiveIndex = useRef(0)
  const containerRef = useRef(null)
  const cardRefs = useRef([])
  const [copiedId, setCopiedId] = useState(null)

  // Search side panel state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchPage, setSearchPage] = useState(1)
  const [searchTotalPages, setSearchTotalPages] = useState(1)
  const [isSearching, setIsSearching] = useState(false)
  const [searchPanelOpen, setSearchPanelOpen] = useState(false)
  const [lastSearchQuery, setLastSearchQuery] = useState('')
  const searchInputRef = useRef(null)

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
    let consecutiveFailures = 0
    const MAX_POLL_FAILURES = 5
    const interval = setInterval(async () => {
      try {
        const res = await getBRStageProgress(pipelineId)
        consecutiveFailures = 0
        setProgress(res.data)
        if (res.data.status !== 'running') {
          setPolling(false)
          fetchRecords()
          fetchPipelineInfo()
        }
      } catch (err) {
        consecutiveFailures += 1
        console.error(`Poll failed (${consecutiveFailures}/${MAX_POLL_FAILURES}):`, err)
        if (consecutiveFailures >= MAX_POLL_FAILURES) {
          console.error('Stopping progress polling after repeated failures')
          setPolling(false)
        }
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [polling, pipelineId])

  // Auto-save previous record when navigating to a different row
  useEffect(() => {
    const prevIdx = prevActiveIndex.current
    if (prevIdx !== activeIndex && records[prevIdx]) {
      const prevRecord = records[prevIdx]
      if (prevRecord.restructured_text && prevRecord.restructured_text.trim() !== '') {
        handleSave(prevRecord.id)
      }
    }
    prevActiveIndex.current = activeIndex
  }, [activeIndex])

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
        case 'w': // Discard
          e.preventDefault()
          handleDiscard(activeRecord.id)
          break
        case 'r': // Restore
          e.preventDefault()
          if (activeRecord.is_discarded) handleRestore(activeRecord.id)
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

  const handleCopyOriginal = (recordId, text) => {
    // Use Clipboard API if available (secure context), otherwise fall back to execCommand
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedId(recordId)
        setTimeout(() => setCopiedId(null), 2000)
      }).catch(() => {
        fallbackCopy(recordId, text)
      })
    } else {
      fallbackCopy(recordId, text)
    }
  }

  const fallbackCopy = (recordId, text) => {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
      setCopiedId(recordId)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
    document.body.removeChild(textarea)
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

  const handleDiscard = async (recordId) => {
    setSaving(prev => ({ ...prev, [`discard_${recordId}`]: true }))
    try {
      await updateBRRestructure(recordId, { is_discarded: true })
      setRecords(prev => prev.map(r => 
        r.id === recordId ? { ...r, is_discarded: true } : r
      ))
    } catch (err) {
      console.error('Failed to discard:', err)
      alert('Failed to discard')
    } finally {
      setSaving(prev => ({ ...prev, [`discard_${recordId}`]: false }))
    }
  }

  const handleRestore = async (recordId) => {
    setSaving(prev => ({ ...prev, [`restore_${recordId}`]: true }))
    try {
      await updateBRRestructure(recordId, { is_discarded: false })
      setRecords(prev => prev.map(r => 
        r.id === recordId ? { ...r, is_discarded: false } : r
      ))
    } catch (err) {
      console.error('Failed to restore:', err)
      alert('Failed to restore')
    } finally {
      setSaving(prev => ({ ...prev, [`restore_${recordId}`]: false }))
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

  // ── Search helpers ────────────────────────────────────────────────────────
  const handleSearch = async (e) => {
    if (e) e.preventDefault()
    const q = searchQuery.trim()
    if (!q) return
    setIsSearching(true)
    setSearchPanelOpen(true)
    setSearchPage(1)
    setLastSearchQuery(q)
    try {
      const res = await searchBRRestructureRecords(pipelineId, q, 1)
      setSearchResults(res.data.results)
      setSearchTotal(res.data.total)
      setSearchTotalPages(res.data.total_pages)
    } catch (err) {
      console.error('Search failed:', err)
      alert('Search failed: ' + (err.message || ''))
    } finally {
      setIsSearching(false)
    }
  }

  const loadMoreSearchResults = async (nextPage) => {
    if (!lastSearchQuery || isSearching) return
    setIsSearching(true)
    try {
      const res = await searchBRRestructureRecords(pipelineId, lastSearchQuery, nextPage)
      setSearchResults(res.data.results)
      setSearchTotal(res.data.total)
      setSearchTotalPages(res.data.total_pages)
      setSearchPage(nextPage)
    } catch (err) {
      console.error('Search page failed:', err)
    } finally {
      setIsSearching(false)
    }
  }

  const navigateToRecord = (result) => {
    // Navigate to the correct page, then set the active card index
    setSearchPanelOpen(false)
    if (result.target_page !== page) {
      setPage(result.target_page)
      // activeIndex will be set after records reload — store intended index
      setTimeout(() => setActiveIndex(result.card_index), 300)
    } else {
      setActiveIndex(result.card_index)
    }
  }

  const highlightText = (text, query) => {
    if (!query || !text) return text
    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i} className="bg-[var(--amber)] text-[var(--text-hi)] rounded px-0.5">{part}</mark>
        : part
    )
  }

  if (loading && records.length === 0) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="text-[var(--text-dim)]">Loading restructure records...</div>
      </div>
    )
  }

  const handleExportCSV = async () => {
    try {
      const res = await exportBRRestructureCSV(pipelineId)
      const blob = new Blob([res.data], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pipeline_${pipelineId}_restructure.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export CSV:', err)
      alert('Failed to export CSV: ' + (err.message || ''))
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] p-6" ref={containerRef}>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-[var(--text-hi)]">
              Stage 2: Text Restructure
            </h1>
            <p className="text-[var(--text-dim)] mt-1">
              Only Bahasa Rojak records shown. Consolidate text or keep original.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExportCSV}
              className="px-4 py-2 bg-[var(--green)] text-white rounded hover:bg-[var(--green)] flex items-center gap-2"
            >
              📥 Export CSV
            </button>
            <button
              onClick={() => setShowRerunModal(true)}
              disabled={rerunning}
              className="px-4 py-2 bg-[var(--accent)] text-white rounded hover:bg-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {rerunning ? 'Starting...' : 'Rerun Stage 2'}
            </button>
            <button
              onClick={() => navigate('/text')}
              className="px-4 py-2 text-[var(--text-dim)] hover:text-[var(--text-hi)]"
            >
              Back to Datasets
            </button>
          </div>
        </div>

        {/* Stage Navigation */}
        <div className="bg-[var(--bg-panel)] rounded border p-4 mb-6">
          <div className="flex items-center gap-2">
            <Link
              to={`/br-pipeline/classification/${pipelineId}`}
              className="px-3 py-1 text-sm bg-[var(--bg-input)] text-[var(--text)] rounded hover:bg-[var(--bg-hover)]"
            >
              1. Classification
            </Link>
            <span className="text-[var(--text-dim)]">-&gt;</span>
            <span className="px-3 py-1 text-sm bg-[var(--accent-dim)] text-white rounded">
              2. Restructure
            </span>
            <span className="text-[var(--text-dim)]">-&gt;</span>
            <Link
              to={`/br-pipeline/questions/${pipelineId}`}
              className="px-3 py-1 text-sm bg-[var(--bg-input)] text-[var(--text)] rounded hover:bg-[var(--bg-hover)]"
            >
              3. Question Validation
            </Link>
            <span className="text-[var(--text-dim)]">-&gt;</span>
            <Link
              to={`/br-pipeline/responses/${pipelineId}`}
              className="px-3 py-1 text-sm bg-[var(--bg-input)] text-[var(--text)] rounded hover:bg-[var(--bg-hover)]"
            >
              4. Model Responses
            </Link>
          </div>
        </div>

        {/* Keyboard Shortcuts Help */}
        <div className="bg-[var(--bg-panel)] rounded border p-3 mb-6">
          <div className="flex items-center gap-4 flex-wrap text-xs text-[var(--text-hi)]">
            <span className="font-semibold text-[var(--text-hi)]">⌨ Hotkeys:</span>
            <span><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono">A</kbd> Keep Original</span>
            <span><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono">W</kbd> Discard</span>
            <span><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono">R</kbd> Restore</span>
            <span><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono">D</kbd> Save</span>
            <span className="border-l pl-4"><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono">↑</kbd><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono ml-1">↓</kbd> Navigate cards</span>
            <span><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono">S</kbd> Next page</span>
            <span><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono">P</kbd> Prev page</span>
          </div>
        </div>

        {/* Progress Banner (shown when running) */}
        {polling && progress && (
          <div className="bg-[var(--accent-dim)] border border-[var(--accent)] rounded p-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="animate-spin text-[var(--accent)]">&#9203;</div>
              <div>
                <div className="font-medium text-[var(--accent)]">
                  Stage 2 running in background...
                </div>
                <div className="text-sm text-[var(--accent)]">
                  {progress.stage2_restructured} / {progress.bahasa_rojak_count} BR records restructured
                  {progress.error_message && (
                    <span className="text-[var(--red)] ml-2">Error: {progress.error_message}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Stats Bar */}
        <div className="bg-[var(--bg-panel)] rounded border p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-[var(--accent)]">
                  {total}
                </div>
                <div className="text-sm text-[var(--text-dim)]">BR Records</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-[var(--green)]">
                  {restructuredCount}
                </div>
                <div className="text-sm text-[var(--text-dim)]">Restructured</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-[var(--amber)]">
                  {total - restructuredCount}
                </div>
                <div className="text-sm text-[var(--text-dim)]">Pending</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Merge Mode Toggle */}
              <button
                onClick={() => {
                  setMergeMode(!mergeMode)
                  setSelectedIds([])
                }}
                className={`px-4 py-2 rounded text-sm font-medium ${
                  mergeMode
                    ? 'bg-[var(--amber-dim)] text-[var(--amber)] border-2 border-[var(--amber)]'
                    : 'bg-[var(--bg-input)] text-[var(--text)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {mergeMode ? 'Cancel Merge' : 'Merge Mode'}
              </button>

              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--text-dim)]">
                  {total > 0 ? Math.round((restructuredCount / total) * 100) : 0}% Complete
                </span>
                <div className="w-32 bg-[var(--bg-input)] rounded-full h-2">
                  <div
                    className="bg-[var(--accent)] h-2 rounded-full transition-all duration-300"
                    style={{ width: `${total > 0 ? (restructuredCount / total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Status Filter + Merge Bar + Search */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-sm text-[var(--text-dim)] font-medium">Filter:</span>
          {['all', 'pending', 'completed', 'discarded'].map(f => (
            <button
              key={f}
              onClick={() => changeFilter(f)}
              className={`px-3 py-1.5 text-sm rounded font-medium transition-colors ${
                statusFilter === f
                  ? f === 'all' ? 'bg-[var(--accent)] text-white'
                    : f === 'pending' ? 'bg-[var(--amber)] text-white'
                    : f === 'discarded' ? 'bg-[var(--red)] text-white'
                    : 'bg-[var(--green)] text-white'
                  : 'bg-[var(--bg-input)]  text-[var(--text)]  hover:bg-[var(--bg-hover)] '
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}

          {/* Search bar */}
          <form onSubmit={handleSearch} className="flex items-center gap-1 ml-auto">
            <div className="relative">
              <span className="absolute inset-y-0 left-2 flex items-center text-[var(--text-dim)] pointer-events-none text-sm">🔍</span>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search original or restructured text…"
                className="pl-7 pr-3 py-1.5 text-sm w-72 border bg-[var(--bg-panel)] text-[var(--text-hi)] rounded"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching || !searchQuery.trim()}
              className="px-3 py-1.5 text-sm bg-[var(--accent)] text-white rounded hover:bg-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {isSearching ? '⏳' : 'Search'}
            </button>
            {searchPanelOpen && (
              <button
                type="button"
                onClick={() => setSearchPanelOpen(false)}
                className="px-3 py-1.5 text-sm bg-[var(--bg-input)] text-[var(--text)] rounded hover:bg-[var(--bg-hover)]"
              >
                Close Panel
              </button>
            )}
          </form>
        </div>

        {/* Merge Bar (shown when in merge mode with selections) */}
        {mergeMode && (
          <div className="bg-[var(--amber-dim)] border border-[var(--amber)] rounded p-4 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-[var(--amber)]">
                  Merge Mode: Select records to concatenate
                </div>
                <div className="text-sm text-[var(--amber)] mt-1">
                  {selectedIds.length === 0 
                    ? 'Click the checkboxes to select records. They will be merged in selection order.'
                    : `${selectedIds.length} records selected (IDs: ${selectedIds.join(', ')})`
                  }
                </div>
                <div className="text-xs text-[var(--amber)] mt-1">
                  Original texts are preserved. Only the restructured_text field is updated.
                </div>
              </div>
              <button
                onClick={handleMerge}
                disabled={selectedIds.length < 2 || merging}
                className="px-4 py-2 bg-[var(--amber-dim)] text-white rounded hover:bg-[var(--amber-dim)] disabled:opacity-50 disabled:cursor-not-allowed"
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
                className={`rounded border transition-all duration-200 cursor-pointer
                  ${isActive
                    ? 'bg-[var(--bg-panel)] scale-[1.01] border-2 border-[var(--accent)]'
                    : isDone
                      ? 'bg-[var(--bg)] opacity-60 hover:opacity-80'
                      : 'bg-[var(--bg-panel)] hover:border'
                  }
                  ${isMerged ? 'opacity-40' : ''}
                  ${isSelected ? 'border-2 border-[var(--green)]' : ''}
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
                        className="w-5 h-5 text-[var(--amber)] rounded cursor-pointer"
                      />
                      {isSelected && (
                        <span className="text-xs font-bold text-[var(--amber)]">
                          #{selectionIndex + 1}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Card number + active indicator */}
                  <div className="flex items-center gap-2">
                    {isActive && (
                      <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
                    )}
                    <div className={`text-sm font-medium ${isActive ? 'text-[var(--accent)] ' : 'text-[var(--text-dim)] '}`}>
                      #{(page - 1) * perPage + idx + 1}
                    </div>
                  </div>
                  
                  <div className="flex-1">
                    {/* Language badge + status */}
                    <div className="flex items-center gap-2 mb-3">
                      {record.detected_language && (
                        <span className="px-2 py-0.5 text-xs bg-[var(--accent-dim)] text-[var(--accent)] rounded">
                          {record.detected_language}
                        </span>
                      )}
                      {record.was_restructured && (
                        <span className="px-2 py-0.5 text-xs bg-[var(--green-dim)] text-[var(--green)] rounded">
                          ✓ Done
                        </span>
                      )}
                      {record.is_discarded && (
                        <span className="px-2 py-0.5 text-xs bg-[var(--red-dim)] text-[var(--red)] rounded">
                          ✗ Discarded
                        </span>
                      )}
                      {isMerged && (
                        <span className="px-2 py-0.5 text-xs bg-[var(--bg-input)] text-[var(--text-dim)] rounded">
                          {record.restructured_text}
                        </span>
                      )}
                    </div>
                    
                    {!isMerged && (
                      <div className="grid grid-cols-2 gap-4">
                        {/* Original Text */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium text-[var(--text)]">
                              Original Text (preserved)
                            </label>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCopyOriginal(record.id, record.original_text) }}
                              className="px-2 py-0.5 text-xs bg-[var(--bg-input)] text-[var(--text-dim)] rounded hover:bg-[var(--bg-hover)] transition-colors"
                              title="Copy original text to clipboard"
                            >
                              {copiedId === record.id ? '✓ Copied!' : '📋 Copy'}
                            </button>
                          </div>
                          <div className="p-3 bg-[var(--bg)] rounded border text-sm text-[var(--text-hi)] min-h-[120px] whitespace-pre-wrap">
                            {record.original_text}
                          </div>
                        </div>
                        
                        {/* Restructured Text */}
                        <div>
                          <label className="block text-sm font-medium text-[var(--text)] mb-2">
                            Restructured Text
                          </label>
                          <textarea
                            value={record.restructured_text || ''}
                            onChange={(e) => handleRestructuredTextChange(record.id, e.target.value)}
                            placeholder="Click 'Keep Original' to use as-is, 'Auto-Restructure' for LLM, or edit manually..."
                            className="w-full p-3 border rounded bg-[var(--bg-panel)] text-[var(--text-hi)] min-h-[120px] text-sm resize-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Actions */}
                {!isMerged && (
                  <div className="flex justify-end gap-2">
                    {record.is_discarded ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRestore(record.id) }}
                        disabled={saving[`restore_${record.id}`]}
                        className="px-3 py-1 text-sm bg-[var(--accent-dim)] text-[var(--accent)] rounded hover:bg-[var(--accent-dim)] disabled:opacity-50"
                      >
                        {saving[`restore_${record.id}`] ? 'Restoring...' : '(R) Restore'}
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleKeepOriginal(record.id) }}
                          disabled={saving[`keep_${record.id}`]}
                          className="px-3 py-1 text-sm bg-[var(--bg-input)] text-[var(--text)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50"
                        >
                          {saving[`keep_${record.id}`] ? 'Saving...' : '(A) Keep Original'}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDiscard(record.id) }}
                          disabled={saving[`discard_${record.id}`]}
                          className="px-3 py-1 text-sm bg-[var(--red-dim)] text-[var(--red)] rounded hover:bg-[var(--red-dim)] disabled:opacity-50"
                        >
                          {saving[`discard_${record.id}`] ? 'Discarding...' : '(W) Discard'}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSave(record.id) }}
                          disabled={saving[record.id] || !record.restructured_text}
                          className="px-3 py-1 text-sm bg-[var(--green)] text-white rounded hover:bg-[var(--green)] disabled:opacity-50"
                        >
                          {saving[record.id] ? 'Saving...' : '(D) Save'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between bg-[var(--bg-panel)] rounded border p-4">
            <div className="text-sm text-[var(--text-dim)]">
              Showing {(page - 1) * perPage + 1} - {Math.min(page * perPage, total)} of {total} BR records
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => goToPage(1)}
                disabled={page === 1}
                className="px-3 py-1 text-sm bg-[var(--bg-input)] text-[var(--text)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                First
              </button>
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page === 1}
                className="px-3 py-1 text-sm bg-[var(--bg-input)] text-[var(--text)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                (P) Prev
              </button>
              <span className="px-3 py-1 text-sm text-[var(--text-dim)]">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page === totalPages}
                className="px-3 py-1 text-sm bg-[var(--bg-input)] text-[var(--text)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                (S) Next
              </button>
              <button
                onClick={() => goToPage(totalPages)}
                disabled={page === totalPages}
                className="px-3 py-1 text-sm bg-[var(--bg-input)] text-[var(--text)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Last
              </button>
              {/* Jump to page */}
              <form onSubmit={handleJumpPage} className="flex items-center gap-1 ml-3 border-l pl-3">
                <label className="text-sm text-[var(--text-dim)]">Go to:</label>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={jumpPage}
                  onChange={(e) => setJumpPage(e.target.value)}
                  placeholder="#"
                  className="w-16 px-2 py-1 text-sm border bg-[var(--bg-panel)] rounded"
                />
                <button
                  type="submit"
                  className="px-2 py-1 text-sm bg-[var(--accent)] text-white rounded hover:bg-[var(--accent)]"
                >
                  Go
                </button>
              </form>
            </div>
          </div>
        )}

        {total === 0 && !loading && (
          <div className="bg-[var(--bg-panel)] rounded border p-12 text-center">
            <div className="text-[var(--text-dim)] text-lg">
              No Bahasa Rojak records found for this pipeline.
            </div>
            <p className="text-[var(--text-dim)] mt-2">
              Make sure Stage 1 (Classification) has been run first and records are classified as Bahasa Rojak.
            </p>
            <Link
              to={`/br-pipeline/classification/${pipelineId}`}
              className="inline-block mt-4 px-4 py-2 bg-[var(--accent)] text-white rounded hover:bg-[var(--accent)]"
            >
              Go to Stage 1: Classification
            </Link>
          </div>
        )}
      </div>

      {/* ── Search Side Panel ──────────────────────────────────────────────── */}
      <div
        className={`fixed top-0 right-0 h-full w-[420px] max-w-full bg-[var(--bg-panel)]  border z-40 flex flex-col transition-transform duration-300 ease-in-out
          ${searchPanelOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Panel Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-[var(--accent-dim)]">
          <div>
            <h2 className="text-white font-semibold text-base">Search Results</h2>
            {lastSearchQuery && (
              <p className="text-[var(--accent)] text-xs mt-0.5">
                "{lastSearchQuery}" — {searchTotal} match{searchTotal !== 1 ? 'es' : ''}
              </p>
            )}
          </div>
          <button
            onClick={() => setSearchPanelOpen(false)}
            className="text-white hover:text-[var(--accent)] text-xl leading-none p-1"
            title="Close panel"
          >
            ✕
          </button>
        </div>

        {/* Search form inside panel for re-searching */}
        <form onSubmit={handleSearch} className="flex items-center gap-2 px-4 py-3 border-b">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search again…"
            className="flex-1 px-3 py-1.5 text-sm border bg-[var(--bg-panel)] text-[var(--text-hi)] rounded"
          />
          <button
            type="submit"
            disabled={isSearching || !searchQuery.trim()}
            className="px-3 py-1.5 text-sm bg-[var(--accent-dim)] text-white rounded hover:bg-[var(--accent-dim)] disabled:opacity-50"
          >
            {isSearching ? '⏳' : '🔍'}
          </button>
        </form>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto">
          {isSearching && (
            <div className="flex items-center justify-center py-12">
              <div className="text-[var(--accent)] animate-spin text-2xl mr-3">⏳</div>
              <span className="text-[var(--text-dim)]">Searching…</span>
            </div>
          )}

          {!isSearching && searchResults.length === 0 && lastSearchQuery && (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">🔍</div>
              <p className="text-[var(--text-dim)]">No matches found for</p>
              <p className="font-medium text-[var(--text)] mt-1">"{lastSearchQuery}"</p>
            </div>
          )}

          {!isSearching && searchResults.map((result) => (
            <div
              key={result.id}
              className="border-b px-4 py-4 hover:bg-[var(--accent-dim)] transition-colors"
            >
              {/* Record meta */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-[var(--accent)]">
                  #{result.global_position}
                </span>
                {result.detected_language && (
                  <span className="px-1.5 py-0.5 text-xs bg-[var(--accent-dim)] text-[var(--accent)] rounded">
                    {result.detected_language}
                  </span>
                )}
                {result.was_restructured && (
                  <span className="px-1.5 py-0.5 text-xs bg-[var(--green-dim)] text-[var(--green)] rounded">
                    ✓ Done
                  </span>
                )}
                <span className="ml-auto text-xs text-[var(--text-dim)]">Page {result.target_page}</span>
              </div>

              {/* Original text snippet */}
              <div className="mb-2">
                <p className="text-xs font-medium text-[var(--text-dim)] mb-1">Original:</p>
                <p className="text-xs text-[var(--text-hi)] line-clamp-3 leading-relaxed">
                  {highlightText(result.original_text?.slice(0, 300) + (result.original_text?.length > 300 ? '…' : ''), lastSearchQuery)}
                </p>
              </div>

              {/* Restructured text snippet if different */}
              {result.restructured_text && result.restructured_text !== result.original_text && (
                <div className="mb-2">
                  <p className="text-xs font-medium text-[var(--text-dim)] mb-1">Restructured:</p>
                  <p className="text-xs text-[var(--text)] line-clamp-2 leading-relaxed italic">
                    {highlightText(result.restructured_text?.slice(0, 200) + (result.restructured_text?.length > 200 ? '…' : ''), lastSearchQuery)}
                  </p>
                </div>
              )}

              {/* Navigate button */}
              <button
                onClick={() => navigateToRecord(result)}
                className="mt-1 w-full px-3 py-1.5 text-xs font-semibold bg-[var(--accent)] text-white rounded hover:bg-[var(--accent)] transition-colors flex items-center justify-center gap-1"
              >
                ✏️ Open &amp; Edit this Record
              </button>
            </div>
          ))}
        </div>

        {/* Panel Pagination */}
        {searchTotalPages > 1 && !isSearching && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-[var(--bg)]">
            <button
              onClick={() => loadMoreSearchResults(searchPage - 1)}
              disabled={searchPage === 1}
              className="px-3 py-1 text-xs bg-[var(--bg-input)] text-[var(--text)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Prev
            </button>
            <span className="text-xs text-[var(--text-dim)]">
              {searchPage} / {searchTotalPages}
            </span>
            <button
              onClick={() => loadMoreSearchResults(searchPage + 1)}
              disabled={searchPage === searchTotalPages}
              className="px-3 py-1 text-xs bg-[var(--bg-input)] text-[var(--text)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Backdrop overlay when panel is open */}
      {searchPanelOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-30"
          onClick={() => setSearchPanelOpen(false)}
        />
      )}

      {/* Rerun Modal */}
      {showRerunModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-panel)] rounded p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-[var(--text-hi)] mb-4">
              Rerun Stage 2: Text Restructure
            </h3>
            <p className="text-[var(--text-dim)] mb-2">
              Only <strong>Bahasa Rojak</strong> records will be processed.
            </p>
            <p className="text-[var(--text-dim)] mb-4">
              Choose restructuring option:
            </p>
            <div className="space-y-3 mb-6">
              <label className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-[var(--bg-hover)]">
                <input
                  type="radio"
                  checked={!skipRestructure}
                  onChange={() => setSkipRestructure(false)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-[var(--text-hi)]">
                    Consolidate Text (LLM)
                  </div>
                  <div className="text-sm text-[var(--text-dim)]">
                    LLM will consolidate text while keeping original language
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-[var(--bg-hover)]">
                <input
                  type="radio"
                  checked={skipRestructure}
                  onChange={() => setSkipRestructure(true)}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-[var(--text-hi)]">
                    Keep Original Text
                  </div>
                  <div className="text-sm text-[var(--text-dim)]">
                    Text is already contextualized enough - no changes needed
                  </div>
                </div>
              </label>
            </div>
            <div className="bg-[var(--amber)] p-3 rounded mb-4">
              <p className="text-sm text-[var(--amber)]">
                Original language is always preserved. No translation will occur.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleRerunStage}
                className="flex-1 px-4 py-2 bg-[var(--accent)] text-white rounded hover:bg-[var(--accent)]"
              >
                Confirm Rerun
              </button>
              <button
                onClick={() => setShowRerunModal(false)}
                className="flex-1 px-4 py-2 bg-[var(--bg-input)] text-[var(--text-hi)] rounded hover:bg-[var(--bg-hover)]"
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