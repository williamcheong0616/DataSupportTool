import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getBRPendingValidation, validateBRQuestion } from '../api'

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
      const res = await getBRPendingValidation()
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
      await validateBRQuestion(currentRecord.id, questionIndex, validatorName)

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
      <div className="flex items-center justify-center h-72">
        <div style={{ color: 'var(--text-dim)' }}>Loading…</div>
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="surface p-8 text-center">
          <h2 className="text-xl font-bold mb-3" style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>
            No Records Pending Validation
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--text-dim)' }}>
            All questions have been validated!
          </p>
          <button onClick={() => navigate('/text/datasets')} className="btn-primary">
            Back to Datasets
          </button>
        </div>
      </div>
    )
  }

  if (!currentRecord) return null

  const pct = Math.round((currentIndex / records.length) * 100)

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>
            BR Pipeline Validation
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-dim)' }}>
            Select the best question for each text
          </p>
        </div>
        <button
          onClick={() => navigate('/text/datasets')}
          className="text-sm transition-colors"
          style={{ color: 'var(--text-dim)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
        >
          ← Back
        </button>
      </div>

      {/* Progress */}
      <div className="surface p-4">
        <div className="flex items-center justify-between mb-2 text-sm">
          <span style={{ color: 'var(--text-dim)' }}>
            Record {currentIndex + 1} of {records.length}
          </span>
          <span className="font-medium" style={{ color: 'var(--accent)' }}>
            {pct}% Complete
          </span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Validator Name */}
      <div className="surface p-4">
        <label className="dst-label">Your Name (Validator)</label>
        <input
          type="text"
          value={validatorName}
          onChange={(e) => setValidatorName(e.target.value)}
          placeholder="Enter your name"
          className="dst-input"
        />
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: Original & Restructured Text */}
        <div className="surface p-5">
          <h3 className="text-sm font-bold mb-3" style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>
            Text Content
          </h3>

          {currentRecord.is_bahasa_rojak !== null && (
            <div className="mb-4 p-3 rounded" style={{ background: 'var(--bg-input)' }}>
              <span className="text-sm font-medium" style={{ color: 'var(--text-dim)' }}>Bahasa Rojak: </span>
              <span style={{ color: currentRecord.is_bahasa_rojak ? 'var(--green)' : 'var(--text-dim)' }}>
                {currentRecord.is_bahasa_rojak ? 'Yes' : 'No'}
              </span>
              {currentRecord.br_confidence && (
                <span className="text-sm ml-2" style={{ color: 'var(--text-dim)' }}>
                  ({(currentRecord.br_confidence * 100).toFixed(1)}%)
                </span>
              )}
            </div>
          )}

          <div>
            <h4 className="dst-label">Restructured Text</h4>
            <div
              className="p-4 rounded whitespace-pre-wrap max-h-96 overflow-y-auto text-sm"
              style={{ background: 'var(--bg-input)', color: 'var(--text-hi)' }}
            >
              {currentRecord.restructured_text}
            </div>
          </div>
        </div>

        {/* Right: Generated Questions */}
        <div className="surface p-5">
          <h3 className="text-sm font-bold mb-3" style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>
            Select 1 of 3 Generated Questions
          </h3>

          <div className="space-y-3">
            {currentRecord.generated_questions?.map((question, idx) => (
              <div
                key={idx}
                className="rounded p-4 transition-colors cursor-pointer"
                style={{ border: '2px solid var(--border)' }}
                onClick={() => !submitting && handleSelectQuestion(idx)}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm"
                    style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                  >
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm" style={{ color: 'var(--text-hi)' }}>{question}</p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleSelectQuestion(idx)
                      }}
                      disabled={submitting}
                      className="btn-primary mt-3 w-full justify-center"
                    >
                      {submitting ? 'Submitting…' : 'Select This Question'}
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
        <button onClick={handlePrevious} disabled={currentIndex === 0} className="btn-secondary">
          ← Previous
        </button>
        <button onClick={handleSkip} disabled={currentIndex === records.length - 1} className="btn-secondary">
          Skip →
        </button>
      </div>
    </div>
  )
}

export default BRPipelineValidation
