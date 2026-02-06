import { useState, useEffect } from 'react'
import { getPendingReviews, submitReview } from '../api'
import { CheckCircle, XCircle, SkipForward, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'

function Annotate() {
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadReviews()
  }, [])

  const loadReviews = async () => {
    try {
      const res = await getPendingReviews(100)
      setReviews(res.data)
      setCurrentIndex(0)
      setFeedback('')
    } catch (error) {
      console.error('Failed to load reviews:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (approved) => {
    if (!currentReview) return
    
    setSubmitting(true)
    try {
      await submitReview(currentReview.id, {
        approved,
        human_score: approved ? 1.0 : 0.0,
        feedback: feedback || null
      })
      
      // Move to next review
      const newReviews = reviews.filter((_, i) => i !== currentIndex)
      setReviews(newReviews)
      setFeedback('')
      
      if (currentIndex >= newReviews.length && newReviews.length > 0) {
        setCurrentIndex(newReviews.length - 1)
      }
    } catch (error) {
      console.error('Failed to submit review:', error)
      alert('Failed to submit: ' + (error.response?.data?.detail || error.message))
    } finally {
      setSubmitting(false)
    }
  }

  const goNext = () => {
    if (currentIndex < reviews.length - 1) {
      setCurrentIndex(currentIndex + 1)
      setFeedback('')
    }
  }

  const goPrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
      setFeedback('')
    }
  }

  const currentReview = reviews[currentIndex]

  if (loading) return <div className="p-8">Loading...</div>

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Annotation / Human Review</h1>
        <button
          onClick={loadReviews}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {reviews.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <CheckCircle size={48} className="mx-auto text-green-500 mb-4" />
          <h2 className="text-xl font-semibold mb-2">All Caught Up!</h2>
          <p className="text-gray-500">No pending reviews. Run a pipeline to generate validation records.</p>
        </div>
      ) : (
        <>
          {/* Progress */}
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-500">
                Review {currentIndex + 1} of {reviews.length}
              </span>
              <span className="text-sm font-medium">
                {reviews.length} pending
              </span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full">
              <div
                className="h-2 bg-blue-600 rounded-full transition-all"
                style={{ width: `${((currentIndex + 1) / reviews.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Review Card */}
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            {/* Navigation */}
            <div className="flex justify-between mb-4">
              <button
                onClick={goPrev}
                disabled={currentIndex === 0}
                className="flex items-center gap-1 text-gray-600 hover:text-gray-800 disabled:opacity-50"
              >
                <ChevronLeft size={20} />
                Previous
              </button>
              <button
                onClick={goNext}
                disabled={currentIndex === reviews.length - 1}
                className="flex items-center gap-1 text-gray-600 hover:text-gray-800 disabled:opacity-50"
              >
                Next
                <ChevronRight size={20} />
              </button>
            </div>

            {/* Input */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Input</h3>
              <div className="bg-gray-50 rounded-lg p-4 border">
                <pre className="whitespace-pre-wrap text-sm">
                  {currentReview.input_text}
                </pre>
              </div>
            </div>

            {/* Expected Output */}
            {currentReview.expected_output && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Expected Output</h3>
                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                  <pre className="whitespace-pre-wrap text-sm">
                    {currentReview.expected_output}
                  </pre>
                </div>
              </div>
            )}

            {/* Model Response */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Model Response</h3>
              <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                <pre className="whitespace-pre-wrap text-sm">
                  {currentReview.model_output || 'No model response yet'}
                </pre>
              </div>
            </div>

            {/* Metrics */}
            {currentReview.metrics && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Automated Metrics</h3>
                <div className="grid grid-cols-3 gap-4">
                  {Object.entries(currentReview.metrics).map(([key, value]) => (
                    <div key={key} className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500 uppercase">{key}</p>
                      <p className="text-lg font-semibold">
                        {typeof value === 'number' ? value.toFixed(3) : value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Feedback */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Feedback (optional)</h3>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Add notes or corrections..."
                className="w-full border rounded-lg px-4 py-3"
                rows={3}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-4">
              <button
                onClick={() => handleSubmit(true)}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                <CheckCircle size={20} />
                Approve
              </button>
              <button
                onClick={() => handleSubmit(false)}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white py-3 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                <XCircle size={20} />
                Reject
              </button>
              <button
                onClick={goNext}
                disabled={currentIndex === reviews.length - 1}
                className="flex items-center justify-center gap-2 bg-gray-200 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-300 disabled:opacity-50"
              >
                <SkipForward size={20} />
                Skip
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default Annotate
