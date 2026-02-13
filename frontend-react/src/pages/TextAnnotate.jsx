import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getTextDataset,
  getTextRecords,
  annotateBahasaRojak,
  annotateClassification,
  annotateModification,
  annotateQuestions,
} from '../api'

const CLASSIFICATION_OPTIONS = [
  'Pure Malay',
  'Pure English', 
  'Malay-English Mix',
  'Contains Chinese',
  'Contains Tamil',
  'Other',
]

function TextAnnotate() {
  const { datasetId } = useParams()
  const navigate = useNavigate()
  const [dataset, setDataset] = useState(null)
  const [records, setRecords] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [totalRecords, setTotalRecords] = useState(0)
  const [annotatedCount, setAnnotatedCount] = useState(0)

  // Annotation states
  const [modifiedText, setModifiedText] = useState('')
  const [subjectAdded, setSubjectAdded] = useState('')
  const [contextAdded, setContextAdded] = useState('')
  const [question1, setQuestion1] = useState('')
  const [question2, setQuestion2] = useState('')
  const [question3, setQuestion3] = useState('')

  useEffect(() => {
    fetchDataset()
  }, [datasetId])

  useEffect(() => {
    if (dataset) {
      fetchRecords()
    }
  }, [dataset])

  const fetchDataset = async () => {
    try {
      const res = await getTextDataset(datasetId)
      setDataset(res.data)
    } catch (err) {
      console.error('Failed to fetch dataset:', err)
      navigate('/text')
    }
  }

  const fetchRecords = async () => {
    setLoading(true)
    try {
      // Always load ALL records (pass null for is_annotated filter)
      const res = await getTextRecords(datasetId, null, 1000)
      const fetchedRecords = res.data.records || []
      setRecords(fetchedRecords)
      setTotalRecords(res.data.total || 0)
      setAnnotatedCount(res.data.annotated || 0)
      
      // Find the first unannotated record to start from
      let startIndex = 0
      if (fetchedRecords.length > 0) {
        const firstUnannotatedIndex = fetchedRecords.findIndex(r => !r.is_annotated)
        // If found, start there; otherwise start at the beginning
        startIndex = firstUnannotatedIndex >= 0 ? firstUnannotatedIndex : 0
      }
      setCurrentIndex(startIndex)
      if (fetchedRecords.length > 0) {
        initializeAnnotation(fetchedRecords[startIndex])
      }
    } catch (err) {
      console.error('Failed to fetch records:', err)
    } finally {
      setLoading(false)
    }
  }

  const initializeAnnotation = useCallback((record) => {
    if (!record) return
    setModifiedText(record.modified_text || record.original_text || '')
    setSubjectAdded(record.subject_added || '')
    setContextAdded(record.context_added || '')
    setQuestion1(record.question_1 || '')
    setQuestion2(record.question_2 || '')
    setQuestion3(record.question_3 || '')
  }, [])

  useEffect(() => {
    if (records[currentIndex]) {
      initializeAnnotation(records[currentIndex])
    }
  }, [currentIndex, records, initializeAnnotation])

  const currentRecord = records[currentIndex]

  const handleBahasaRojak = async (isBahasaRojak) => {
    if (!currentRecord) return
    setSaving(true)
    try {
      await annotateBahasaRojak(currentRecord.id, isBahasaRojak)
      moveToNextAfterSave()
    } catch (err) {
      alert('Failed to save: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSaving(false)
    }
  }

  const handleClassification = async (label) => {
    if (!currentRecord) return
    setSaving(true)
    try {
      await annotateClassification(currentRecord.id, label)
      moveToNextAfterSave()
    } catch (err) {
      alert('Failed to save: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSaving(false)
    }
  }

  const handleModification = async () => {
    if (!currentRecord) return
    setSaving(true)
    try {
      await annotateModification(currentRecord.id, {
        modified_text: modifiedText,
        subject_added: subjectAdded,
        context_added: contextAdded,
      })
      moveToNextAfterSave()
    } catch (err) {
      alert('Failed to save: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSaving(false)
    }
  }

  const handleQuestions = async () => {
    if (!currentRecord) return
    if (!question1 || !question2 || !question3) {
      alert('Please fill in all 3 questions')
      return
    }
    setSaving(true)
    try {
      await annotateQuestions(currentRecord.id, {
        question_1: question1,
        question_2: question2,
        question_3: question3,
      })
      moveToNextAfterSave()
    } catch (err) {
      alert('Failed to save: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSaving(false)
    }
  }

  const moveToNext = () => {
    if (currentIndex < records.length - 1) {
      setCurrentIndex(currentIndex + 1)
    } else {
      // Reload to get more unannotated records
      fetchRecords()
    }
  }

  const moveToNextAfterSave = () => {
    // Only increment count when actually saving an annotation
    // The count is fetched from the server on fetchRecords, so we refresh
    if (currentIndex < records.length - 1) {
      setCurrentIndex(currentIndex + 1)
    }
    // Refresh to get updated counts from database
    fetchRecords()
  }

  const moveToPrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (!dataset) {
    return <div className="text-gray-900 dark:text-gray-100">Dataset not found</div>
  }

  const progress = totalRecords > 0 ? (annotatedCount / totalRecords) * 100 : 0

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <button
            onClick={() => navigate('/text')}
            className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 mb-2"
          >
            ← Back to Datasets
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{dataset.name}</h1>
          <p className="text-gray-500 dark:text-gray-400">
            {dataset.task_type === 'general' ? 'General Dataset (Use BR Pipeline)' : dataset.task_type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
          </p>
        </div>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">Navigate to review previous annotations</span>
        </div>
      </div>

      {/* Progress */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-6">
        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
          <span>Progress: {annotatedCount} / {totalRecords} annotated</span>
          <span>{progress.toFixed(1)}%</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className="bg-indigo-600 h-2 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      </div>

      {/* Annotation Area */}
      {dataset.task_type === 'general' ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
          <p className="text-xl mb-4 text-gray-900 dark:text-gray-100">
            🤖 This is a general dataset for BR Pipeline
          </p>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Use the BR Pipeline instead of manual annotation for automated processing.
          </p>
          <button
            onClick={() => navigate('/text')}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            Go to Datasets & Start Pipeline
          </button>
        </div>
      ) : records.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center text-gray-500 dark:text-gray-400">
          <p className="text-xl mb-4">
            No records found in this dataset
          </p>
          <button
            onClick={() => navigate('/text')}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            Back to Datasets
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          {/* Navigation */}
          <div className="flex justify-between items-center mb-4">
            <button
              onClick={moveToPrev}
              disabled={currentIndex === 0}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              ← Previous
            </button>
            <div className="text-center">
              <span className="text-gray-600 dark:text-gray-400">
                Record {currentIndex + 1} of {records.length}
              </span>
              {currentRecord?.is_annotated && (
                <span className="ml-2 px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded">
                  ✓ Annotated
                </span>
              )}
            </div>
            <button
              onClick={moveToNext}
              disabled={currentIndex >= records.length - 1}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Next →
            </button>
          </div>

          {/* Original Text Display */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Original Text
            </label>
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 text-lg dark:text-gray-100">
              {currentRecord?.original_text || 'No text'}
            </div>
            {currentRecord?.raw_data && Object.keys(currentRecord.raw_data).length > 1 && (
              <details className="mt-2">
                <summary className="text-sm text-gray-500 dark:text-gray-400 cursor-pointer">
                  Show all columns
                </summary>
                <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-700 dark:text-gray-300 rounded text-sm overflow-x-auto">
                  {JSON.stringify(currentRecord.raw_data, null, 2)}
                </pre>
              </details>
            )}
          </div>

          {/* Task-specific UI */}
          {dataset.task_type === 'bahasa_rojak_identification' && (
            <div className="space-y-4">
              <p className="text-gray-700 dark:text-gray-300 font-medium">Is this Bahasa Rojak?</p>
              <div className="flex space-x-4">
                <button
                  onClick={() => handleBahasaRojak(true)}
                  disabled={saving}
                  className="flex-1 py-4 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-lg hover:bg-green-200 dark:hover:bg-green-900/60 font-semibold text-lg disabled:opacity-50"
                >
                  ✓ Yes, Bahasa Rojak
                </button>
                <button
                  onClick={() => handleBahasaRojak(false)}
                  disabled={saving}
                  className="flex-1 py-4 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/60 font-semibold text-lg disabled:opacity-50"
                >
                  ✗ No, Not Bahasa Rojak
                </button>
              </div>
            </div>
          )}

          {dataset.task_type === 'bahasa_rojak_classification' && (
            <div className="space-y-4">
              <p className="text-gray-700 dark:text-gray-300 font-medium">Classify this text:</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {CLASSIFICATION_OPTIONS.map((option) => (
                  <button
                    key={option}
                    onClick={() => handleClassification(option)}
                    disabled={saving}
                    className="py-3 px-4 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900/60 font-medium disabled:opacity-50"
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}

          {dataset.task_type === 'text_modification' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Modified Text
                </label>
                <textarea
                  value={modifiedText}
                  onChange={(e) => setModifiedText(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Subject Added
                </label>
                <input
                  type="text"
                  value={subjectAdded}
                  onChange={(e) => setSubjectAdded(e.target.value)}
                  placeholder="What subject was added?"
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Context Added
                </label>
                <input
                  type="text"
                  value={contextAdded}
                  onChange={(e) => setContextAdded(e.target.value)}
                  placeholder="What context was added?"
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                onClick={handleModification}
                disabled={saving}
                className="w-full py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save & Next'}
              </button>
            </div>
          )}

          {dataset.task_type === 'question_generation' && (
            <div className="space-y-4">
              <p className="text-gray-700 dark:text-gray-300 font-medium">
                Generate 3 questions based on this text:
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Question 1
                </label>
                <input
                  type="text"
                  value={question1}
                  onChange={(e) => setQuestion1(e.target.value)}
                  placeholder="Enter first question..."
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Question 2
                </label>
                <input
                  type="text"
                  value={question2}
                  onChange={(e) => setQuestion2(e.target.value)}
                  placeholder="Enter second question..."
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Question 3
                </label>
                <input
                  type="text"
                  value={question3}
                  onChange={(e) => setQuestion3(e.target.value)}
                  placeholder="Enter third question..."
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                onClick={handleQuestions}
                disabled={saving}
                className="w-full py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save & Next'}
              </button>
            </div>
          )}

          {/* Annotation Status */}
          {currentRecord?.is_annotated && (
            <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg text-green-700 dark:text-green-300">
              ✓ This record has been annotated
              {currentRecord.annotated_at && (
                <span className="ml-2 text-sm">
                  at {new Date(currentRecord.annotated_at).toLocaleString()}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Keyboard Shortcuts Help */}
      {(dataset.task_type === 'bahasa_rojak_identification' || 
        dataset.task_type === 'bahasa_rojak_classification') && (
        <div className="mt-4 text-sm text-gray-500 dark:text-gray-400 text-center">
          Tip: Use keyboard shortcuts for faster annotation
        </div>
      )}
    </div>
  )
}

export default TextAnnotate
