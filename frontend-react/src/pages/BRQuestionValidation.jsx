import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import axios from 'axios'
import { runBRStage3 } from '../api'

const API_BASE_URL = 'http://localhost:8000'

function BRQuestionValidation() {
  const { pipelineId } = useParams()
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})
  const [generating, setGenerating] = useState({})
  const [validatorName, setValidatorName] = useState(localStorage.getItem('validatorName') || '')
  const [rerunning, setRerunning] = useState(false)
  
  // Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [validatedCount, setValidatedCount] = useState(0)
  const perPage = 10

  useEffect(() => {
    fetchRecords()
  }, [pipelineId, page])

  const fetchRecords = async () => {
    setLoading(true)
    try {
      const res = await axios.get(
        `${API_BASE_URL}/api/br-pipeline/questions/${pipelineId}?page=${page}&per_page=${perPage}`
      )
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
      const res = await axios.post(
        `${API_BASE_URL}/api/br-pipeline/questions/${recordId}/generate`
      )
      setRecords(prev => prev.map(r => 
        r.id === recordId ? { ...r, generated_questions: res.data.questions } : r
      ))
    } catch (err) {
      console.error('Failed to generate questions:', err)
      alert('Failed to generate questions')
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
      await axios.post(
        `${API_BASE_URL}/api/br-pipeline/questions/${recordId}/select`,
        {
          question_index: questionIndex,
          validated_by: validatorName
        }
      )
      
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

  const handleRerunStage = async () => {
    if (!confirm('Rerun Stage 3 (Question Generation in Bahasa Rojak) for all records?\n\nThis will process in the background. You can continue working while it runs.')) return
    
    setRerunning(true)
    try {
      const res = await runBRStage3(pipelineId, null, true)
      alert(`✓ Stage 3 started in background!\n\n${res.data.message}\n\nRefresh this page to see updated results.`)
      // Optionally refresh after a delay
      setTimeout(() => {
        fetchRecords()
      }, 2000)
    } catch (err) {
      console.error('Failed to rerun stage:', err)
      alert('Failed to start Stage 3: ' + (err.response?.data?.detail || err.message))
    } finally {
      setRerunning(false)
    }
  }

  if (loading && records.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading question records...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Stage 3: Question Validation
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Generate 3 questions per item from restructured text, then select the best one
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRerunStage}
              disabled={rerunning}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {rerunning ? '⏳ Starting...' : '🔄 Rerun Stage 3'}
            </button>
            <button
              onClick={() => navigate('/text')}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              ← Back to Datasets
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
            <span className="text-gray-400">→</span>
            <Link
              to={`/br-pipeline/restructure/${pipelineId}`}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              2. Restructure
            </Link>
            <span className="text-gray-400">→</span>
            <span className="px-3 py-1 text-sm bg-indigo-600 text-white rounded">
              3. Question Validation
            </span>
            <span className="text-gray-400">→</span>
            <Link
              to={`/br-pipeline/responses/${pipelineId}`}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              4. Model Responses
            </Link>
          </div>
        </div>

        {/* Validator Name */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Your Name:
            </label>
            <input
              type="text"
              value={validatorName}
              onChange={(e) => setValidatorName(e.target.value)}
              placeholder="Enter your name"
              className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Stats Bar */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                  {total}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Total Records</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {validatedCount}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Validated</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                  {total - validatedCount}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Pending</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {Math.round((validatedCount / total) * 100) || 0}% Complete
              </span>
              <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-green-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(validatedCount / total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Records */}
        <div className="space-y-4 mb-6">
          {records.map((record, idx) => (
            <div key={record.id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="flex items-start gap-4 mb-4">
                <div className="text-sm font-medium text-gray-500 dark:text-gray-400 w-8">
                  #{(page - 1) * perPage + idx + 1}
                </div>
                <div className="flex-1">
                  {/* Language Badge */}
                  {record.detected_language && (
                    <div className="mb-2">
                      <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                        {record.detected_language}
                      </span>
                    </div>
                  )}

                  {/* Restructured Text (Primary - from Stage 2) */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Restructured Text <span className="text-xs text-gray-400 font-normal">(from Stage 2)</span>
                    </label>
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded border border-indigo-200 dark:border-indigo-700 text-sm text-gray-900 dark:text-white whitespace-pre-wrap">
                      {record.restructured_text || <span className="text-gray-400 italic">No restructured text yet</span>}
                    </div>
                  </div>

                  {/* Original Text (Collapsible reference) */}
                  {record.original_text && (
                    <details className="mb-4">
                      <summary className="text-sm font-medium text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                        Show Original Text
                      </summary>
                      <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                        {record.original_text}
                      </div>
                    </details>
                  )}
                  
                  {/* Generated Questions */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Generated Questions
                      </label>
                      {(!record.generated_questions || record.generated_questions.length === 0) && (
                        <button
                          onClick={() => handleGenerateQuestions(record.id)}
                          disabled={generating[record.id] || !record.restructured_text}
                          className="px-3 py-1 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                        >
                          {generating[record.id] ? 'Generating...' : '🤖 Generate 3 Questions'}
                        </button>
                      )}
                    </div>
                    
                    {record.generated_questions && record.generated_questions.length > 0 ? (
                      <div className="space-y-2">
                        {record.generated_questions.map((question, qIdx) => (
                          <div
                            key={qIdx}
                            onClick={() => handleSelectQuestion(record.id, qIdx)}
                            className={`p-3 rounded border cursor-pointer transition ${
                              record.selected_question_index === qIdx
                                ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                                : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
                            } ${saving[record.id] ? 'opacity-50 pointer-events-none' : ''}`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium ${
                                record.selected_question_index === qIdx
                                  ? 'bg-green-500 text-white'
                                  : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300'
                              }`}>
                                {qIdx + 1}
                              </div>
                              <div className="flex-1 text-sm text-gray-900 dark:text-white">
                                {question}
                              </div>
                              {record.selected_question_index === qIdx && (
                                <span className="text-green-600 dark:text-green-400 text-sm">✓ Selected</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-center text-gray-500 dark:text-gray-400">
                        No questions generated yet. Click "Generate 3 Questions" to create them.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Showing {(page - 1) * perPage + 1} - {Math.min(page * perPage, total)} of {total} records
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
              Prev
            </button>
            <span className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page === totalPages}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
            <button
              onClick={() => goToPage(totalPages)}
              disabled={page === totalPages}
              className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Last
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BRQuestionValidation
