import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { runBRStage3, getBRQuestionRecords, generateBRQuestions, generateBRQuestionsBatch, selectBRQuestion, exportBRQuestionsJSONL, pollBRTask } from '../api'

function BRQuestionValidation() {
  const { pipelineId } = useParams()
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})
  const [generating, setGenerating] = useState({})
  const [validatorName, setValidatorName] = useState(localStorage.getItem('validatorName') || '')
  const [rerunning, setRerunning] = useState(false)

  // Export limit modal
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportLimit, setExportLimit] = useState('')
  
  // Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [validatedCount, setValidatedCount] = useState(0)
  const perPage = 10
  const [statusFilter, setStatusFilter] = useState('all')
  const [jumpPage, setJumpPage] = useState('')

  // Active card index for keyboard navigation
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef(null)
  const cardRefs = useRef([])

  useEffect(() => {
    fetchRecords()
  }, [pipelineId, page, statusFilter])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setActiveIndex(0)
  }, [page])

  // Scroll active card into view
  useEffect(() => {
    if (cardRefs.current[activeIndex]) {
      cardRefs.current[activeIndex].scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeIndex])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      // Don't capture when typing in input/textarea or if no records
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const activeRecord = records[activeIndex]
      if (!activeRecord) return

      switch (e.key.toLowerCase()) {
        case 'q': { // Generate/Regenerate Questions
          e.preventDefault()
          const hasRestructured = activeRecord.restructured_text && activeRecord.restructured_text.trim() !== ''
          if (!generating[activeRecord.id] && hasRestructured) {
            handleGenerateQuestions(activeRecord.id)
          }
          break
        }
        case 'a': { // Select Question 1
          e.preventDefault()
          if (activeRecord.generated_questions?.length >= 1 && !saving[activeRecord.id]) {
            handleSelectQuestion(activeRecord.id, 0)
          }
          break
        }
        case 'b': { // Select Question 2
          e.preventDefault()
          if (activeRecord.generated_questions?.length >= 2 && !saving[activeRecord.id]) {
            handleSelectQuestion(activeRecord.id, 1)
          }
          break
        }
        case 'd': { // Select Question 3
          e.preventDefault()
          if (activeRecord.generated_questions?.length >= 3 && !saving[activeRecord.id]) {
            handleSelectQuestion(activeRecord.id, 2)
          }
          break
        }
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
  }, [records, activeIndex, page, totalPages, generating, saving])


  const fetchRecords = async () => {
    setLoading(true)
    try {
      const res = await getBRQuestionRecords(pipelineId, page, perPage, statusFilter)
      setRecords(res.data.records)
      setTotal(res.data.total)
      setTotalPages(res.data.total_pages)
      setValidatedCount(res.data.validated_count)
    } catch (err) {
      console.error('Failed to fetch records:', err)
      alert('Failed to load question records')
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateQuestions = async (recordId) => {
    setGenerating(prev => ({ ...prev, [recordId]: true }))
    try {
      const res = await generateBRQuestions(recordId)
      const taskId = res.data.task_id
      // Poll until the Celery task finishes
      const result = await pollBRTask(taskId)
      setRecords(prev => prev.map(r => 
        r.id === recordId ? { ...r, generated_questions: result.questions } : r
      ))
    } catch (err) {
      console.error('Failed to generate questions:', err)
      alert('Failed to generate questions: ' + (err.message || ''))
    } finally {
      setGenerating(prev => ({ ...prev, [recordId]: false }))
    }
  }

  const handleSelectQuestion = async (recordId, questionIndex) => {
    if (!validatorName.trim()) {
      alert('Please enter your name at the top')
      return
    }
    localStorage.setItem('validatorName', validatorName)

    setSaving(prev => ({ ...prev, [recordId]: true }))
    try {
      await selectBRQuestion(recordId, questionIndex, validatorName)
      
      const record = records.find(r => r.id === recordId)
      setRecords(prev => prev.map(r => 
        r.id === recordId ? { 
          ...r, 
          selected_question_index: questionIndex,
          selected_question: r.generated_questions[questionIndex]
        } : r
      ))
      
      // Update validated count if not previously validated
      if (record && record.selected_question_index === null) {
        setValidatedCount(prev => prev + 1)
      }
    } catch (err) {
      console.error('Failed to select question:', err)
      alert('Failed to save selection')
    } finally {
      setSaving(prev => ({ ...prev, [recordId]: false }))
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
  }

  const handleJumpPage = (e) => {
    e.preventDefault()
    const p = parseInt(jumpPage, 10)
    if (p >= 1 && p <= totalPages) {
      goToPage(p)
      setJumpPage('')
    }
  }

  const handleRerunStage = async () => {
    if (!confirm('Rerun Stage 3 (Question Generation in Bahasa Rojak) for all records?\n\nThis will process in the background. You can continue working while it runs.')) return
    
    setRerunning(true)
    try {
      const res = await runBRStage3(pipelineId, null, true)
      const taskId = res.data.task_id
      alert(`✓ Stage 3 started in background!\n\n${res.data.message}\n\nThe page will periodically refresh.`)
      
      const interval = setInterval(() => {
        fetchRecords()
      }, 5000)
      
      pollBRTask(taskId, { interval: 3000, timeout: 1800000 })
        .then(result => {
          clearInterval(interval)
          alert(`✓ Stage 3 background task complete!`)
          fetchRecords()
          setRerunning(false)
        })
        .catch(err => {
          clearInterval(interval)
          alert('Stage 3 task finished with error context or timeout: ' + err.message)
          fetchRecords()
          setRerunning(false)
        })
    } catch (err) {
      console.error('Failed to rerun stage:', err)
      alert('Failed to start Stage 3: ' + (err.response?.data?.detail || err.message))
      setRerunning(false)
    }
  }

  const handleGenerateAllQuestions = async () => {
    if (!confirm('Generate questions for ALL pending records?\n\nThis sends a background task that may take some time. Proceed?')) return
    
    setRerunning(true)
    try {
      const res = await generateBRQuestionsBatch(pipelineId)
      const taskId = res.data.task_id
      alert('✓ Background generation started! The page will periodically refresh.')
      
      const interval = setInterval(() => {
        fetchRecords()
      }, 5000)
      
      pollBRTask(taskId, { interval: 3000, timeout: 1800000 })
        .then(result => {
          clearInterval(interval)
          alert(`✓ Batch generation complete! Processed: ${result.processed}, Errors: ${result.errors}`)
          fetchRecords()
          setRerunning(false)
        })
        .catch(err => {
          clearInterval(interval)
          alert('Batch task finished with error context or timeout: ' + err.message)
          fetchRecords()
          setRerunning(false)
        })
    } catch (err) {
      console.error('Failed to start batch generation:', err)
      alert('Failed to start batch generation: ' + (err.message || ''))
      setRerunning(false)
    }
  }

  const handleExportJSONL = async (limit = null) => {
    setShowExportModal(false)
    try {
      const res = await exportBRQuestionsJSONL(pipelineId, limit || null)
      const blob = new Blob([res.data], { type: 'application/x-ndjson' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const suffix = limit ? `_top${limit}` : ''
      a.download = `pipeline_${pipelineId}_questions${suffix}.jsonl`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export JSONL:', err)
      alert('Failed to export JSONL: ' + (err.message || ''))
    }
  }

  if (loading && records.length === 0) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="text-[var(--text-dim)]">Loading question records...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-[var(--text-hi)]">
              Stage 3: Question Validation
            </h1>
            <p className="text-[var(--text-dim)] mt-1">
              Generate 3 questions per item from restructured text, then select the best one
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Export JSONL split button */}
            <div className="flex items-center rounded overflow-hidden border">
              <button
                onClick={() => handleExportJSONL(null)}
                className="px-4 py-2 bg-[var(--green)] text-white hover:bg-[var(--green)] flex items-center gap-2 text-sm"
              >
                📥 Export All JSONL
              </button>
              <button
                onClick={() => { setExportLimit(''); setShowExportModal(true) }}
                className="px-3 py-2 bg-[var(--green)] text-white hover:bg-[var(--green)] border-l border-[var(--green)] text-sm"
                title="Export limited amount"
              >
                🔢
              </button>
            </div>
            <button
              onClick={handleRerunStage}
              disabled={rerunning}
              className="px-4 py-2 bg-[var(--accent)] text-white rounded hover:bg-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {rerunning ? '⏳ Starting...' : '🔄 Rerun Stage 3'}
            </button>
            <button
              onClick={() => navigate('/text')}
              className="px-4 py-2 text-[var(--text-dim)] hover:text-[var(--text-hi)]"
            >
              ← Back to Datasets
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
            <span className="text-[var(--text-dim)]">→</span>
            <Link
              to={`/br-pipeline/restructure/${pipelineId}`}
              className="px-3 py-1 text-sm bg-[var(--bg-input)] text-[var(--text)] rounded hover:bg-[var(--bg-hover)]"
            >
              2. Restructure
            </Link>
            <span className="text-[var(--text-dim)]">→</span>
            <span className="px-3 py-1 text-sm bg-[var(--accent-dim)] text-white rounded">
              3. Question Validation
            </span>
            <span className="text-[var(--text-dim)]">→</span>
            <Link
              to={`/br-pipeline/responses/${pipelineId}`}
              className="px-3 py-1 text-sm bg-[var(--bg-input)] text-[var(--text)] rounded hover:bg-[var(--bg-hover)]"
            >
              4. Model Responses
            </Link>
          </div>
        </div>

        {/* Validator Name */}
        <div className="bg-[var(--bg-panel)] rounded border p-4 mb-6">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-[var(--text)]">
              Your Name:
            </label>
            <input
              type="text"
              value={validatorName}
              onChange={(e) => setValidatorName(e.target.value)}
              placeholder="Enter your name"
              className="px-3 py-1 border rounded bg-[var(--bg-panel)] text-[var(--text-hi)]"
            />
          </div>
        </div>

        {/* Stats Bar */}
        <div className="bg-[var(--bg-panel)] rounded border p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-[var(--accent)]">
                  {total}
                </div>
                <div className="text-sm text-[var(--text-dim)]">Total Records</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-[var(--green)]">
                  {validatedCount}
                </div>
                <div className="text-sm text-[var(--text-dim)]">Validated</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-[var(--amber)]">
                  {total - validatedCount}
                </div>
                <div className="text-sm text-[var(--text-dim)]">Pending</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-dim)]">
                {Math.round((validatedCount / total) * 100) || 0}% Complete
              </span>
              <div className="w-32 bg-[var(--bg-input)] rounded-full h-2">
                <div
                  className="bg-[var(--green-dim)] h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(validatedCount / total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Keyboard Shortcuts Help */}
        <div className="bg-[var(--bg-panel)] rounded border p-3 mb-6">
          <div className="flex items-center gap-4 flex-wrap text-xs text-[var(--text-hi)]">
            <span className="font-semibold text-[var(--text-hi)]">⌨ Hotkeys (on active block):</span>
            <span><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono">Q</kbd> Gen/Regen questions</span>
            <span><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono">A</kbd> Select Q1</span>
            <span><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono">B</kbd> Select Q2</span>
            <span><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono">D</kbd> Select Q3</span>
            <span className="border-l pl-4"><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono">↑</kbd><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono ml-1">↓</kbd> Navigate cards</span>
            <span><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono">S</kbd> Next page</span>
            <span><kbd className="px-1.5 py-0.5 bg-[var(--bg-input)] rounded text-[var(--text-hi)] font-mono">P</kbd> Prev page</span>
          </div>
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-[var(--text-dim)] font-medium">Filter:</span>
          {['all', 'pending', 'completed'].map(f => (
            <button
              key={f}
              onClick={() => changeFilter(f)}
              className={`px-3 py-1.5 text-sm rounded font-medium transition-colors ${
                statusFilter === f
                  ? f === 'all' ? 'bg-[var(--accent)] text-white'
                    : f === 'pending' ? 'bg-[var(--amber)] text-white'
                    : 'bg-[var(--green)] text-white'
                  : 'bg-[var(--bg-input)]  text-[var(--text)]  hover:bg-[var(--bg-hover)] '
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Records */}
        <div className="space-y-4 mb-6">
          {records.map((record, idx) => {
            const isActive = idx === activeIndex;
            const isDone = record.selected_question_index !== null && record.selected_question_index !== undefined;

            return (
            <div 
              key={record.id} 
              ref={el => cardRefs.current[idx] = el}
              onClick={() => setActiveIndex(idx)}
              className={`rounded border p-6 transition-all duration-200 cursor-pointer
                ${isActive
                  ? 'bg-[var(--bg-panel)] scale-[1.01] border-2 border-[var(--accent)]'
                  : isDone
                    ? 'bg-[var(--bg)] opacity-70 hover:opacity-90'
                    : 'bg-[var(--bg-panel)] hover:border'
                }`}
            >
              <div className="flex items-start gap-4 mb-4">
                <div className="flex items-center gap-2 w-12">
                  {isActive && (
                    <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
                  )}
                  <div className={`text-sm font-medium ${isActive ? 'text-[var(--accent)] ' : 'text-[var(--text-dim)] '}`}>
                    #{(page - 1) * perPage + idx + 1}
                  </div>
                </div>
                <div className="flex-1">
                  {/* Language Badge */}
                  {record.detected_language && (
                    <div className="mb-2">
                      <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-[color-mix(in_srgb,#a78bfa_20%,transparent)] text-[#a78bfa]">
                        {record.detected_language}
                      </span>
                    </div>
                  )}

                  {/* Restructured Text (Primary - from Stage 2) */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-[var(--text)] mb-2">
                      Restructured Text <span className="text-xs text-[var(--text-dim)] font-normal">(from Stage 2)</span>
                    </label>
                    <div className="p-3 bg-[var(--bg)] rounded border border-[var(--accent)] text-sm text-[var(--text-hi)] whitespace-pre-wrap">
                      {record.restructured_text || <span className="text-[var(--text-dim)] italic">No restructured text yet</span>}
                    </div>
                  </div>

                  {/* Original Text (Collapsible reference) */}
                  {record.original_text && (
                    <details className="mb-4">
                      <summary className="text-sm font-medium text-[var(--text-dim)] cursor-pointer hover:text-[var(--text)]">
                        Show Original Text
                      </summary>
                      <div className="mt-2 p-3 bg-[var(--bg)] rounded border text-sm text-[var(--text-dim)] whitespace-pre-wrap">
                        {record.original_text}
                      </div>
                    </details>
                  )}
                  
                  {/* Generated Questions */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-[var(--text)]">
                        Generated Questions
                      </label>
                      <div className="flex gap-2">
                        {(record.generated_questions && record.generated_questions.length > 0) && (
                          <button
                            onClick={() => handleGenerateQuestions(record.id)}
                            disabled={generating[record.id]}
                            className="px-3 py-1 text-sm bg-[var(--accent)] text-white rounded hover:bg-[var(--accent)] disabled:opacity-50 flex items-center gap-1"
                          >
                            {generating[record.id] ? '⏳ Regenerating...' : '🔄 Regenerate'}
                          </button>
                        )}
                        {(!record.generated_questions || record.generated_questions.length === 0) && (
                          <button
                            onClick={() => handleGenerateQuestions(record.id)}
                            disabled={generating[record.id] || !record.restructured_text}
                            className="px-3 py-1 text-sm bg-[#a78bfa] text-white rounded hover:bg-[#a78bfa] disabled:opacity-50"
                          >
                            {generating[record.id] ? 'Generating...' : '🤖 Generate 3 Questions'}
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {generating[record.id] ? (
                      <div className="py-8 text-center bg-[var(--bg)] rounded border">
                        <div className="animate-spin text-3xl mb-2 text-[var(--accent)]">&#9203;</div>
                        <div className="text-sm font-medium text-[var(--text)]">
                          Generating Questions...
                        </div>
                        <div className="text-xs text-[var(--text-dim)] mt-1">
                          Using local LLM API for restructuring text logic. This may take 6-10 seconds per item.
                        </div>
                      </div>
                    ) : record.generated_questions && record.generated_questions.length > 0 ? (
                      <div className="space-y-3">
                        {record.generated_questions.map((question, qIdx) => {
                          const isSelected = record.selected_question_index === qIdx
                          const isOtherSelected = record.selected_question_index !== null && record.selected_question_index !== qIdx
                          const actionLabels = ['A', 'B', 'D']; // For Q1, Q2, Q3

                          return (
                            <div 
                              key={qIdx}
                              className={`p-4 rounded border transition-all ${
                                isSelected
                                  ? 'border-[var(--green)] bg-[var(--green-dim)] border-2'
                                  : isOtherSelected
                                    ? '  bg-[var(--bg)]  opacity-60'
                                    : 'border-[var(--accent)]  bg-[var(--bg-panel)]  hover:border-[var(--accent)] '
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold flex-shrink-0 mt-0.5 ${
                                  isSelected
                                    ? 'bg-[var(--green)] text-white'
                                    : 'bg-[var(--accent-dim)] text-[var(--accent)]'
                                }`}>
                                  Q{qIdx + 1}
                                </div>
                                <div className="flex-1">
                                  <div className={`text-sm ${
                                    isSelected 
                                      ? 'text-[var(--green)]  font-medium' 
                                      : 'text-[var(--text-hi)] '
                                  }`}>
                                    {question}
                                  </div>
                                </div>
                                <div className="flex-shrink-0">
                                  {!saving[record.id] && !isSelected && (
                                    <button
                                      onClick={() => handleSelectQuestion(record.id, qIdx)}
                                      className="px-4 py-1.5 text-xs font-semibold bg-[var(--bg-panel)] border border-[var(--accent)] text-[var(--accent)] rounded hover:bg-[var(--accent-dim)] transition-colors"
                                    >
                                      ({actionLabels[qIdx] || qIdx + 1}) Select
                                    </button>
                                  )}
                                  {isSelected && (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-[var(--green)] bg-[var(--green-dim)] rounded-full">
                                      ✓ Selected
                                    </span>
                                  )}
                                  {saving[record.id] && !isSelected && (
                                    <span className="px-3 py-1 text-xs text-[var(--text-dim)]">
                                      Saving...
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="py-8 text-center bg-[var(--bg)] rounded border border-dashed">
                        <div className="text-[var(--text-dim)] mb-4">
                          No questions generated for this record yet.
                        </div>
                        <button
                          onClick={() => handleGenerateQuestions(record.id)}
                          disabled={generating[record.id] || !record.restructured_text}
                          className="px-4 py-2 bg-[var(--accent-dim)] text-white rounded hover:bg-[var(--accent-dim)] disabled:opacity-50 inline-flex items-center gap-2 border"
                        >
                          {generating[record.id] ? '(Q) Generating...' : '(Q) Generate Questions'}
                        </button>
                        {!record.restructured_text && (
                          <div className="text-xs text-[var(--red)] mt-2">
                            Restructured text is required to generate questions. <br/>
                            Go back to Stage 2 to restructure this record.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            )
          })}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-[var(--text-dim)]">
            Showing {(page - 1) * perPage + 1} - {Math.min(page * perPage, total)} of {total} records
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

        {total === 0 && !loading && (
          <div className="bg-[var(--bg-panel)] rounded border p-12 text-center">
            <div className="text-[var(--text-dim)] text-lg">
              No pending questions found for this pipeline.
            </div>
            <p className="text-[var(--text-dim)] mt-2">
              If you haven't run Stage 3 yet, click "Rerun Stage 3" above to start generating questions.
            </p>
          </div>
        )}
      </div>

      {/* Export Limit Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-panel)] rounded border p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-[var(--text-hi)] mb-1">Export Limited JSONL</h3>
            <p className="text-sm text-[var(--text-dim)] mb-4">
              Enter how many validated QA pairs to export. Records are ordered by ID (oldest first).
              You have <span className="font-semibold text-[var(--green)]">{validatedCount}</span> validated records.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-[var(--text)] mb-1">Number of records</label>
              <input
                type="number"
                min={1}
                max={validatedCount || 9999}
                value={exportLimit}
                onChange={e => setExportLimit(e.target.value)}
                placeholder={`e.g. 100 (max ${validatedCount})`}
                className="w-full px-3 py-2 border rounded bg-[var(--bg-panel)] text-[var(--text-hi)]"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const n = parseInt(exportLimit, 10)
                    if (n >= 1) handleExportJSONL(n)
                  }
                }}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  const n = parseInt(exportLimit, 10)
                  if (!n || n < 1) { alert('Please enter a valid number'); return }
                  handleExportJSONL(n)
                }}
                className="flex-1 px-4 py-2 bg-[var(--green)] text-white rounded hover:bg-[var(--green)] font-medium"
              >
                📥 Download {exportLimit ? parseInt(exportLimit, 10) || '?' : '?'} Records
              </button>
              <button
                onClick={() => setShowExportModal(false)}
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

export default BRQuestionValidation
