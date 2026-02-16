import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getTextDataset,
  getTextRecords,
  annotateBahasaRojak,
  annotateClassification,
  annotateModification,
  annotateQuestions,
} from '../api'

const LANGUAGES = [
  'Pure Malay', 'Pure English', 'Malay-English Mix',
  'Contains Chinese', 'Contains Tamil', 'Other',
]

const PAGE_SIZE = 50

function TextAnnotate() {
  const { datasetId } = useParams()
  const navigate = useNavigate()

  const [dataset, setDataset] = useState(null)
  const [records, setRecords] = useState([])
  const [idx, setIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [total, setTotal] = useState(0)
  const [done, setDone] = useState(0)
  const [canLoadMore, setCanLoadMore] = useState(true)
  const [loadedSoFar, setLoadedSoFar] = useState(0)

  // form fields
  const [modText, setModText] = useState('')
  const [subject, setSubject] = useState('')
  const [context, setContext] = useState('')
  const [q1, setQ1] = useState('')
  const [q2, setQ2] = useState('')
  const [q3, setQ3] = useState('')

  const cur = records[idx]

  // load dataset info
  useEffect(() => {
    getTextDataset(datasetId)
      .then(res => setDataset(res.data))
      .catch(() => navigate('/text'))
  }, [datasetId])

  // load first batch once we have the dataset
  useEffect(() => {
    if (!dataset) return
    loadBatch(0, true)
  }, [dataset])

  // sync form fields when navigating between records
  useEffect(() => {
    if (!cur) return
    setModText(cur.modified_text || cur.original_text || '')
    setSubject(cur.subject_added || '')
    setContext(cur.context_added || '')
    setQ1(cur.question_1 || '')
    setQ2(cur.question_2 || '')
    setQ3(cur.question_3 || '')
  }, [idx, records])

  async function loadBatch(offset, isFirst = false) {
    if (isFirst) setLoading(true)
    else setFetching(true)

    try {
      const res = await getTextRecords(datasetId, null, PAGE_SIZE, offset)
      const batch = res.data.records || []

      if (isFirst) {
        setRecords(batch)
        // jump to first unannotated record
        const start = batch.findIndex(r => !r.is_annotated)
        setIdx(start >= 0 ? start : 0)
      } else {
        setRecords(prev => [...prev, ...batch])
      }

      setTotal(res.data.total || 0)
      setDone(res.data.annotated || 0)
      setLoadedSoFar(offset + batch.length)
      setCanLoadMore(batch.length >= PAGE_SIZE)
    } catch (err) {
      console.error('Failed to load records:', err)
    } finally {
      setLoading(false)
      setFetching(false)
    }
  }

  function goNext() {
    // prefetch next batch if we're getting close to the end
    if (idx >= records.length - 5 && canLoadMore && !fetching) {
      loadBatch(loadedSoFar)
    }
    if (idx < records.length - 1) {
      setIdx(idx + 1)
    } else if (canLoadMore) {
      loadBatch(loadedSoFar)
    }
  }

  function goPrev() {
    if (idx > 0) setIdx(idx - 1)
  }

  async function afterSave() {
    // mark as done locally
    setRecords(prev => prev.map((r, i) => i === idx ? { ...r, is_annotated: true } : r))
    setDone(d => d + 1)
    goNext()
  }

  async function saveBR(val) {
    setSaving(true)
    try {
      await annotateBahasaRojak(cur.id, val)
      afterSave()
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.detail || err.message))
    }
    setSaving(false)
  }

  async function saveClassification(label) {
    setSaving(true)
    try {
      await annotateClassification(cur.id, label)
      afterSave()
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.detail || err.message))
    }
    setSaving(false)
  }

  async function saveMod() {
    setSaving(true)
    try {
      await annotateModification(cur.id, {
        modified_text: modText,
        subject_added: subject,
        context_added: context,
      })
      afterSave()
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.detail || err.message))
    }
    setSaving(false)
  }

  async function saveQuestions() {
    if (!q1 || !q2 || !q3) return alert('Please fill in all 3 questions')
    setSaving(true)
    try {
      await annotateQuestions(cur.id, { question_1: q1, question_2: q2, question_3: q3 })
      afterSave()
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.detail || err.message))
    }
    setSaving(false)
  }

  // --- render ---

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
      </div>
    )
  }

  if (!dataset) return <div className="text-gray-900 dark:text-gray-100">Dataset not found</div>

  const pct = total > 0 ? (done / total) * 100 : 0

  return (
    <div>
      {/* header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <button onClick={() => navigate('/text')} className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 mb-2">
            ← Back to Datasets
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{dataset.name}</h1>
          <p className="text-gray-500 dark:text-gray-400">
            {dataset.task_type === 'general'
              ? 'General Dataset (Use BR Pipeline)'
              : dataset.task_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
          </p>
        </div>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Loaded {records.length} / {total}{canLoadMore && ' (scroll for more)'}
        </span>
      </div>

      {/* progress bar */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-6">
        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
          <span>Progress: {done} / {total} annotated</span>
          <span>{pct.toFixed(1)}%</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div className="bg-indigo-600 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* main content */}
      {dataset.task_type === 'general' ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center">
          <p className="text-xl mb-4 text-gray-900 dark:text-gray-100">🤖 This is a general dataset for BR Pipeline</p>
          <p className="text-gray-600 dark:text-gray-400 mb-4">Use the BR Pipeline instead of manual annotation.</p>
          <button onClick={() => navigate('/text')} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">
            Go to Datasets & Start Pipeline
          </button>
        </div>
      ) : records.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 text-center text-gray-500 dark:text-gray-400">
          <p className="text-xl mb-4">No records found in this dataset</p>
          <button onClick={() => navigate('/text')} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            Back to Datasets
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          {/* nav */}
          <div className="flex justify-between items-center mb-4">
            <button onClick={goPrev} disabled={idx === 0}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
              ← Previous
            </button>
            <div className="text-center">
              <span className="text-gray-600 dark:text-gray-400">
                Record {idx + 1} of {records.length}
                {canLoadMore && <span className="text-xs text-gray-400 ml-1">({total} total)</span>}
              </span>
              {cur?.is_annotated && (
                <span className="ml-2 px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded">✓ Annotated</span>
              )}
            </div>
            <button onClick={goNext} disabled={idx >= records.length - 1 && !canLoadMore}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
              {idx >= records.length - 1 && canLoadMore
                ? (fetching ? 'Loading...' : 'Load More →')
                : 'Next →'}
            </button>
          </div>

          {fetching && (
            <div className="flex items-center justify-center gap-2 py-2 mb-4 text-sm text-indigo-600 dark:text-indigo-400">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600" />
              Loading more records...
            </div>
          )}

          {/* original text */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Original Text</label>
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 text-lg dark:text-gray-100">
              {cur?.original_text || 'No text'}
            </div>
            {cur?.raw_data && Object.keys(cur.raw_data).length > 1 && (
              <details className="mt-2">
                <summary className="text-sm text-gray-500 dark:text-gray-400 cursor-pointer">Show all columns</summary>
                <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-700 dark:text-gray-300 rounded text-sm overflow-x-auto">
                  {JSON.stringify(cur.raw_data, null, 2)}
                </pre>
              </details>
            )}
          </div>

          {/* task-specific annotation UI */}
          {dataset.task_type === 'bahasa_rojak_identification' && (
            <div className="space-y-4">
              <p className="text-gray-700 dark:text-gray-300 font-medium">Is this Bahasa Rojak?</p>
              <div className="flex space-x-4">
                <button onClick={() => saveBR(true)} disabled={saving}
                  className="flex-1 py-4 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-lg hover:bg-green-200 dark:hover:bg-green-900/60 font-semibold text-lg disabled:opacity-50">
                  ✓ Yes, Bahasa Rojak
                </button>
                <button onClick={() => saveBR(false)} disabled={saving}
                  className="flex-1 py-4 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/60 font-semibold text-lg disabled:opacity-50">
                  ✗ No, Not Bahasa Rojak
                </button>
              </div>
            </div>
          )}

          {dataset.task_type === 'bahasa_rojak_classification' && (
            <div className="space-y-4">
              <p className="text-gray-700 dark:text-gray-300 font-medium">Classify this text:</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {LANGUAGES.map(opt => (
                  <button key={opt} onClick={() => saveClassification(opt)} disabled={saving}
                    className="py-3 px-4 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900/60 font-medium disabled:opacity-50">
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {dataset.task_type === 'text_modification' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Modified Text</label>
                <textarea value={modText} onChange={e => setModText(e.target.value)} rows={3}
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject Added</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="What subject was added?"
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Context Added</label>
                <input value={context} onChange={e => setContext(e.target.value)} placeholder="What context was added?"
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500" />
              </div>
              <button onClick={saveMod} disabled={saving}
                className="w-full py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold disabled:opacity-50">
                {saving ? 'Saving...' : 'Save & Next'}
              </button>
            </div>
          )}

          {dataset.task_type === 'question_generation' && (
            <div className="space-y-4">
              <p className="text-gray-700 dark:text-gray-300 font-medium">Generate 3 questions based on this text:</p>
              {[['Question 1', q1, setQ1], ['Question 2', q2, setQ2], ['Question 3', q3, setQ3]].map(([label, val, setter]) => (
                <div key={label}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
                  <input value={val} onChange={e => setter(e.target.value)} placeholder={`Enter ${label.toLowerCase()}...`}
                    className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500" />
                </div>
              ))}
              <button onClick={saveQuestions} disabled={saving}
                className="w-full py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold disabled:opacity-50">
                {saving ? 'Saving...' : 'Save & Next'}
              </button>
            </div>
          )}

          {cur?.is_annotated && (
            <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg text-green-700 dark:text-green-300">
              ✓ This record has been annotated
              {cur.annotated_at && <span className="ml-2 text-sm">at {new Date(cur.annotated_at).toLocaleString()}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default TextAnnotate
