import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Workflow } from 'lucide-react'
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

  const [modText, setModText] = useState('')
  const [subject, setSubject] = useState('')
  const [context, setContext] = useState('')
  const [q1, setQ1] = useState('')
  const [q2, setQ2] = useState('')
  const [q3, setQ3] = useState('')

  const cur = records[idx]

  useEffect(() => {
    getTextDataset(datasetId)
      .then(res => setDataset(res.data))
      .catch(err => { console.error('Failed to load dataset:', err); navigate('/text') })
  }, [datasetId])

  useEffect(() => {
    if (!dataset) return
    loadBatch(0, true)
  }, [dataset])

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
    if (isFirst) setLoading(true); else setFetching(true)
    try {
      const res = await getTextRecords(datasetId, null, PAGE_SIZE, offset)
      const batch = res.data.records || []
      if (isFirst) {
        setRecords(batch)
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
      setLoading(false); setFetching(false)
    }
  }

  function goNext() {
    if (idx >= records.length - 5 && canLoadMore && !fetching) loadBatch(loadedSoFar)
    if (idx < records.length - 1) setIdx(idx + 1)
    else if (canLoadMore) loadBatch(loadedSoFar)
  }

  function goPrev() { if (idx > 0) setIdx(idx - 1) }

  async function afterSave() {
    setRecords(prev => prev.map((r, i) => i === idx ? { ...r, is_annotated: true } : r))
    setDone(d => d + 1)
    goNext()
  }

  async function saveBR(val) {
    setSaving(true)
    try {
      const annotator = localStorage.getItem('dst_username') || 'anonymous'
      await annotateBahasaRojak(cur.id, val, annotator)
      afterSave()
    } catch (err) { alert('Save failed: ' + (err.response?.data?.detail || err.message)) }
    setSaving(false)
  }

  async function saveClassification(label) {
    setSaving(true)
    try {
      const annotator = localStorage.getItem('dst_username') || 'anonymous'
      await annotateClassification(cur.id, label, annotator)
      afterSave()
    } catch (err) { alert('Save failed: ' + (err.response?.data?.detail || err.message)) }
    setSaving(false)
  }

  async function saveMod() {
    setSaving(true)
    try {
      const annotator = localStorage.getItem('dst_username') || 'anonymous'
      await annotateModification(cur.id, { modified_text: modText, subject_added: subject, context_added: context }, annotator)
      afterSave()
    } catch (err) { alert('Save failed: ' + (err.response?.data?.detail || err.message)) }
    setSaving(false)
  }

  async function saveQuestions() {
    if (!q1 || !q2 || !q3) return alert('Please fill in all 3 questions')
    setSaving(true)
    try {
      const annotator = localStorage.getItem('dst_username') || 'anonymous'
      await annotateQuestions(cur.id, { question_1: q1, question_2: q2, question_3: q3 }, annotator)
      afterSave()
    } catch (err) { alert('Save failed: ' + (err.response?.data?.detail || err.message)) }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-72 gap-4">
        <div className="w-8 h-8 rounded-full border-2 border-transparent animate-spin"
          style={{ borderTopColor: 'var(--accent)', borderRightColor: 'var(--accent)' }} />
        <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Loading records…</p>
      </div>
    )
  }

  if (!dataset) return <p style={{ color: 'var(--text-hi)' }}>Dataset not found</p>

  const pct = total > 0 ? (done / total) * 100 : 0

  const taskLabel = dataset.task_type === 'general'
    ? 'General Dataset (Use BR Pipeline)'
    : dataset.task_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())

  return (
    <div className="space-y-5 max-w-3xl mx-auto">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => navigate('/text')}
            className="inline-flex items-center gap-1.5 text-sm font-medium mb-2 transition-colors"
            style={{ color: 'var(--text-dim)' }}
            onMouseOver={e => e.currentTarget.style.color = 'var(--accent)'}
            onMouseOut={e => e.currentTarget.style.color = 'var(--text-dim)'}
          >
            <ArrowLeft size={14} /> Back to Datasets
          </button>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>
            {dataset.name}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-dim)' }}>{taskLabel}</p>
        </div>
        <span className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
          Loaded {records.length} / {total}
          {canLoadMore && <span className="ml-1 opacity-60">(scroll for more)</span>}
        </span>
      </div>

      {/* ── Progress bar ────────────────────────────────────── */}
      <div className="surface px-5 py-4">
        <div className="flex justify-between text-xs mb-2" style={{ color: 'var(--text-dim)' }}>
          <span>{done} of {total} annotated</span>
          <span className="font-semibold tabular-nums">{pct.toFixed(1)}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* ── General dataset notice ──────────────────────────── */}
      {dataset.task_type === 'general' && (
        <div className="surface p-8 text-center">
          <div
            className="w-12 h-12 rounded flex items-center justify-center mx-auto mb-4"
            style={{ background: 'var(--accent-dim)' }}
          >
            <Workflow size={22} style={{ color: 'var(--accent)' }} />
          </div>
          <h2 className="text-base font-bold mb-2" style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>
            This dataset uses the BR Pipeline
          </h2>
          <p className="text-sm mb-5" style={{ color: 'var(--text-dim)' }}>
            Use the automated BR Pipeline instead of manual annotation for this dataset type.
          </p>
          <button onClick={() => navigate('/text')} className="btn-primary">
            Go to Datasets &amp; Start Pipeline
          </button>
        </div>
      )}

      {/* ── No records ──────────────────────────────────────── */}
      {dataset.task_type !== 'general' && records.length === 0 && (
        <div className="surface p-10 text-center">
          <p className="text-sm font-medium" style={{ color: 'var(--text-hi)' }}>No records in this dataset</p>
          <button onClick={() => navigate('/text')} className="btn-primary mt-4">Back to Datasets</button>
        </div>
      )}

      {/* ── Annotation card ─────────────────────────────────── */}
      {dataset.task_type !== 'general' && records.length > 0 && (
        <div className="surface p-6 space-y-5">

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={goPrev}
              disabled={idx === 0}
              className="btn-secondary text-xs px-4 py-2"
            >
              ← Previous
            </button>
            <div className="text-center">
              <span className="text-sm" style={{ color: 'var(--text-dim)' }}>
                Record {idx + 1} of {records.length}
                {canLoadMore && <span className="text-xs opacity-60 ml-1">({total} total)</span>}
              </span>
              {cur?.is_annotated && (
                <div className="flex items-center justify-center gap-1 mt-1">
                  <CheckCircle2 size={11} style={{ color: "var(--green)" }} />
                  <span className="text-[11px] font-medium" style={{ color: "var(--green)" }}>Annotated</span>
                </div>
              )}
            </div>
            <button
              onClick={goNext}
              disabled={idx >= records.length - 1 && !canLoadMore}
              className="btn-secondary text-xs px-4 py-2"
            >
              {idx >= records.length - 1 && canLoadMore
                ? (fetching ? 'Loading…' : 'Load More →')
                : 'Next →'}
            </button>
          </div>

          {/* Loading more indicator */}
          {fetching && (
            <div className="flex items-center justify-center gap-2 py-2 text-xs" style={{ color: 'var(--text-dim)' }}>
              <div className="w-3.5 h-3.5 rounded-full border border-transparent animate-spin"
                style={{ borderTopColor: 'var(--accent)', borderRightColor: 'var(--accent)' }} />
              Loading more records…
            </div>
          )}

          {/* Original text */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2"
              style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
              Original Text
            </p>
            <div
              className="p-4 rounded text-base leading-relaxed"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-hi)' }}
            >
              {cur?.original_text || 'No text'}
            </div>
            {cur?.raw_data && Object.keys(cur.raw_data).length > 1 && (
              <details className="mt-2">
                <summary className="text-xs cursor-pointer" style={{ color: 'var(--text-dim)' }}>
                  Show all columns
                </summary>
                <pre
                  className="mt-2 p-3 rounded text-xs overflow-x-auto"
                  style={{ background: 'var(--bg-input)', color: 'var(--text-dim)' }}
                >
                  {JSON.stringify(cur.raw_data, null, 2)}
                </pre>
              </details>
            )}
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border)' }} />

          {/* ── Task: Bahasa Rojak Identification ── */}
          {dataset.task_type === 'bahasa_rojak_identification' && (
            <div className="space-y-3">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-hi)' }}>
                Is this Bahasa Rojak?
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => saveBR(true)}
                  disabled={saving}
                  className="py-5 rounded text-base font-bold transition-all disabled:opacity-50 active:scale-[0.98]"
                  style={{ background: 'var(--green-dim)', color: 'var(--green)', border: '2px solid var(--green)' }}
                >
                  Yes, Bahasa Rojak
                </button>
                <button
                  onClick={() => saveBR(false)}
                  disabled={saving}
                  className="py-5 rounded text-base font-bold transition-all disabled:opacity-50 active:scale-[0.98]"
                  style={{ background: 'var(--red-dim)', color: 'var(--red)', border: '2px solid var(--red)' }}
                >
                  No, Not Bahasa Rojak
                </button>
              </div>
            </div>
          )}

          {/* ── Task: Language Classification ── */}
          {dataset.task_type === 'bahasa_rojak_classification' && (
            <div className="space-y-3">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-hi)' }}>
                Classify this text:
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                {LANGUAGES.map(opt => (
                  <button
                    key={opt}
                    onClick={() => saveClassification(opt)}
                    disabled={saving}
                    className="py-3 px-4 rounded text-sm font-medium transition-all disabled:opacity-50 active:scale-[0.98]"
                    style={{
                      background: 'var(--accent-dim)',
                      color: 'var(--accent)',
                      border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Task: Text Modification ── */}
          {dataset.task_type === 'text_modification' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                  style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
                  Modified Text
                </label>
                <textarea
                  value={modText}
                  onChange={e => setModText(e.target.value)}
                  rows={3}
                  className="form-input"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                  style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
                  Subject Added
                </label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="What subject was added?"
                  className="form-input"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                  style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
                  Context Added
                </label>
                <input
                  value={context}
                  onChange={e => setContext(e.target.value)}
                  placeholder="What context was added?"
                  className="form-input"
                />
              </div>
              <button
                onClick={saveMod}
                disabled={saving}
                className="btn-primary w-full justify-center py-3"
              >
                {saving ? 'Saving…' : 'Save & Next →'}
              </button>
            </div>
          )}

          {/* ── Task: Question Generation ── */}
          {dataset.task_type === 'question_generation' && (
            <div className="space-y-4">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-hi)' }}>
                Generate 3 questions based on this text:
              </p>
              {[['Question 1', q1, setQ1], ['Question 2', q2, setQ2], ['Question 3', q3, setQ3]].map(([label, val, setter]) => (
                <div key={label}>
                  <label className="block text-xs font-bold uppercase tracking-widest mb-1.5"
                    style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
                    {label}
                  </label>
                  <input
                    value={val}
                    onChange={e => setter(e.target.value)}
                    placeholder={`Enter ${label.toLowerCase()}…`}
                    className="form-input"
                  />
                </div>
              ))}
              <button
                onClick={saveQuestions}
                disabled={saving}
                className="btn-primary w-full justify-center py-3"
              >
                {saving ? 'Saving…' : 'Save & Next →'}
              </button>
            </div>
          )}

          {/* Annotated indicator */}
          {cur?.is_annotated && (
            <div
              className="flex items-center gap-2.5 px-4 py-3 rounded text-sm"
              style={{ background: 'var(--green-dim)', border: '1px solid var(--green)', color: 'var(--green)' }}
            >
              <CheckCircle2 size={15} />
              <span className="font-medium">This record has been annotated</span>
              {cur.annotated_at && (
                <span className="ml-auto text-xs opacity-70">
                  {new Date(cur.annotated_at).toLocaleString()}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default TextAnnotate
