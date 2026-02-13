import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'

const API_BASE_URL = 'http://localhost:8000'

function BRPipelineValidation() {
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [validatorName, setValidatorName] = useState(localStorage.getItem('validatorName') || '')

  const currentRecord = records[currentIndex]

  useEffect(() => {
    fetchPendingRecords()
  }, [])

  const fetchPendingRecords = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE_URL}/api/br-pipeline/pending-validation`)
      setRecords(res.data)
      setCurrentIndex(0)
    } catch (err) {
      console.error('Failed to fetch records:', err)
      alert('Failed to load pending records')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectQuestion = async (questionIndex) => {
    if (!validatorName.trim()) {
      alert('Please enter your name')
      return
    }

    localStorage.setItem('validatorName', validatorName)

    setSubmitting(true)
    try {
      await axios.post(
        `${API_BASE_URL}/api/br-pipeline/validate/${currentRecord.id}`,
        {
          question_index: questionIndex,
          validated_by: validatorName
        }
      )

      // Move to next record or finish
      if (currentIndex < records.length - 1) {
        setCurrentIndex(currentIndex + 1)
      } else {
        alert(`Completed! All ${records.length} records validated.`)
        navigate('/text/datasets')
      }
    } catch (err) {
      console.error('Failed to submit:', err)
      alert('Failed to submit selection')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSkip = () => {
    if (currentIndex < records.length - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
            <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">
              No Records Pending Validation
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              All questions have been validated!
            </p>
            <button
              onClick={() => navigate('/text/datasets')}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Back to Datasets
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!currentRecord) return null

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              BR Pipeline Validation
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Select the best question for each text
            </p>
          </div>
          <button
            onClick={() => navigate('/text/datasets')}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            ← Back
          </button>
        </div>

        {/* Progress */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Record {currentIndex + 1} of {records.length}
            </span>
            <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
              {Math.round(((currentIndex) / records.length) * 100)}% Complete
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${((currentIndex) / records.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Validator Name */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Your Name (Validator)
          </label>
          <input
            type="text"
            value={validatorName}
            onChange={(e) => setValidatorName(e.target.value)}
            placeholder="Enter your name"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>

        {/* Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Left: Original & Restructured Text */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
              Text Content
            </h3>
            
            {currentRecord.is_bahasa_rojak !== null && (
              <div className="mb-4 p-3 rounded bg-gray-50 dark:bg-gray-700">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  Bahasa Rojak:{' '}
                </span>
                <span className={currentRecord.is_bahasa_rojak ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-400'}>
                  {currentRecord.is_bahasa_rojak ? 'Yes' : 'No'}
                </span>
                {currentRecord.br_confidence && (
                  <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                    ({(currentRecord.br_confidence * 100).toFixed(1)}%)
                  </span>
                )}
              </div>
            )}
            
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Restructured Text
              </h4>
              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded text-gray-900 dark:text-white whitespace-pre-wrap max-h-96 overflow-y-auto">
                {currentRecord.restructured_text}
              </div>
            </div>
          </div>

          {/* Right: Generated Questions */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
              Select 1 of 3 Generated Questions
            </h3>
            
            <div className="space-y-4">
              {currentRecord.generated_questions?.map((question, idx) => (
                <div
                  key={idx}
                  className="border-2 border-gray-200 dark:border-gray-600 rounded-lg p-4 hover:border-indigo-500 dark:hover:border-indigo-400 transition-colors cursor-pointer"
                  onClick={() => !submitting && handleSelectQuestion(idx)}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 flex items-center justify-center font-semibold">
                      {idx + 1}
                    </div>
                    <div className="flex-1">
                      <p className="text-gray-900 dark:text-white">{question}</p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSelectQuestion(idx)
                        }}
                        disabled={submitting}
                        className="mt-3 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed w-full"
                      >
                        {submitting ? 'Submitting...' : 'Select This Question'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={handlePrevious}
            disabled={currentIndex === 0}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>
          
          <button
            onClick={handleSkip}
            disabled={currentIndex === records.length - 1}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Skip →
          </button>
        </div>
      </div>
    </div>
  )
}

export default BRPipelineValidation
