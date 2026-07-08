import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Trash2, RefreshCw } from 'lucide-react'
import { getBRClassificationRecords, updateBRClassification, deleteBRClassificationRecord, getBRPipelineStatus, runBRStage1, getBRStageProgress } from '../api'
import BRStageNav from '../components/BRStageNav'
import Pagination from '../components/Pagination'

const LANGUAGES = [
  'Malay', 'English', 'Mandarin', 'Tamil', 'Hokkien', 'Cantonese',
  'Malay + English', 'Malay + Mandarin', 'English + Mandarin',
  'Mixed (Multiple)', 'Unknown'
]

const FILTERS = [
  { value: '', label: 'All Records' },
  { value: 'true', label: 'Bahasa Rojak Only' },
  { value: 'false', label: 'Not Bahasa Rojak' },
  { value: 'unclassified', label: 'Unclassified' },
]

function BRClassification() {
  const { pipelineId } = useParams()
  const navigate = useNavigate()

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState({})
  const [deleting, setDeleting] = useState({})
  const [pipeline, setPipeline] = useState(null)
  const [rerunning, setRerunning] = useState(false)
  const [polling, setPolling] = useState(false)
  const [progress, setProgress] = useState(null)
  const [filter, setFilter] = useState('')

  // pagination
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [classified, setClassified] = useState(0)
  const perPage = 15

  useEffect(() => {
    getBRPipelineStatus(pipelineId)
      .then(res => setPipeline(res.data))
      .catch(err => console.error('Pipeline info failed:', err))
  }, [pipelineId])

  useEffect(() => { fetchRecords() }, [pipelineId, page, filter])

  // poll while stage is running
  useEffect(() => {
    if (!polling) return
    const id = setInterval(async () => {
      try {
        const res = await getBRStageProgress(pipelineId)
        setProgress(res.data)
        if (res.data.status !== 'running') {
          setPolling(false)
          fetchRecords()
          getBRPipelineStatus(pipelineId).then(r => setPipeline(r.data))
        }
      } catch (e) { console.error('Poll error:', e) }
    }, 3000)
    return () => clearInterval(id)
  }, [polling, pipelineId])

  async function fetchRecords() {
    setLoading(true)
    try {
      const res = await getBRClassificationRecords(pipelineId, page, perPage, filter || null)
      setRecords(res.data.records)
      setTotal(res.data.total)
      setPages(res.data.total_pages)
      setClassified(res.data.classified_count)
    } catch (err) {
      console.error('Fetch failed:', err)
      alert('Failed to load records')
    }
    setLoading(false)
  }

  async function setBR(id, val) {
    setSaving(s => ({ ...s, [id]: true }))
    try {
      await updateBRClassification(id, { is_bahasa_rojak: val })
      setRecords(prev => prev.map(r => r.id === id ? { ...r, is_bahasa_rojak: val } : r))
      const rec = records.find(r => r.id === id)
      if (rec && rec.is_bahasa_rojak === null) setClassified(c => c + 1)
    } catch (err) {
      alert('Failed to save')
    }
    setSaving(s => ({ ...s, [id]: false }))
  }

  async function setLang(id, val) {
    setSaving(s => ({ ...s, [`l${id}`]: true }))
    try {
      await updateBRClassification(id, { detected_language: val })
      setRecords(prev => prev.map(r => r.id === id ? { ...r, detected_language: val } : r))
    } catch (err) {
      alert('Failed to save')
    }
    setSaving(s => ({ ...s, [`l${id}`]: false }))
  }

  async function deleteRecord(id) {
    if (!confirm('Delete this record? This also removes the underlying text record and cannot be undone.')) return
    setDeleting(d => ({ ...d, [id]: true }))
    try {
      await deleteBRClassificationRecord(id)
      const rec = records.find(r => r.id === id)
      setRecords(prev => prev.filter(r => r.id !== id))
      setTotal(t => t - 1)
      if (rec && rec.is_bahasa_rojak !== null) setClassified(c => c - 1)
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.detail || err.message))
    }
    setDeleting(d => ({ ...d, [id]: false }))
  }

  async function rerunStage() {
    if (!confirm('Rerun Stage 1 (BR + Language Detection) for all records?\nThis runs in the background.')) return
    setRerunning(true)
    try {
      const res = await runBRStage1(pipelineId, null, true)
      alert(`Stage 1 started!\n${res.data.message}`)
      setPolling(true)
    } catch (err) {
      alert('Failed: ' + (err.response?.data?.detail || err.message))
    }
    setRerunning(false)
  }

  function changeFilter(val) {
    setFilter(val)
    setPage(1)
  }

  function goPage(p) {
    if (p >= 1 && p <= pages) setPage(p)
  }

  if (loading && records.length === 0) {
    return (
      <div className="flex items-center justify-center h-72">
        <div style={{ color: 'var(--text-dim)' }}>Loading classification records…</div>
      </div>
    )
  }

  const pct = total > 0 ? Math.round((classified / total) * 100) : 0

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>
            Stage 1: BR Classification
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-dim)' }}>
            Review detected language and Bahasa Rojak classification
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={rerunStage} disabled={rerunning} className="btn-primary">
            <RefreshCw size={13} /> {rerunning ? 'Starting…' : 'Rerun Stage 1'}
          </button>
          <button
            onClick={() => navigate('/text')}
            className="text-sm transition-colors"
            style={{ color: 'var(--text-dim)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            ← Back to Datasets
          </button>
        </div>
      </div>

      {/* stage nav */}
      <BRStageNav pipelineId={pipelineId} activeStage={1} />

      {/* progress banner */}
      {polling && progress && (
        <div
          className="rounded p-4"
          style={{ background: 'var(--accent-dim)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}
        >
          <div className="flex items-center gap-3">
            <div className="dst-spin" />
            <div>
              <div className="font-medium" style={{ color: 'var(--accent)' }}>Stage 1 running…</div>
              <div className="text-sm" style={{ color: 'var(--text-dim)' }}>
                {progress.stage1_classified} / {progress.total_records} classified
                {progress.error_message && <span className="ml-2" style={{ color: 'var(--red)' }}>Error: {progress.error_message}</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* stats + filter */}
      <div className="surface p-4 flex items-center justify-between flex-wrap gap-4">
        <div className="flex gap-6">
          <div className="text-center">
            <div className="text-2xl font-bold" style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>{total}</div>
            <div className="text-sm" style={{ color: 'var(--text-dim)' }}>{filter ? 'Filtered' : 'Total'} Records</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold" style={{ fontFamily: 'var(--mono)', color: 'var(--green)' }}>{classified}</div>
            <div className="text-sm" style={{ color: 'var(--text-dim)' }}>Classified</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold" style={{ fontFamily: 'var(--mono)', color: 'var(--amber)' }}>{total - classified}</div>
            <div className="text-sm" style={{ color: 'var(--text-dim)' }}>Pending</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm" style={{ color: 'var(--text-dim)' }}>Filter:</label>
            <select value={filter} onChange={e => changeFilter(e.target.value)} className="dst-input dst-select" style={{ width: 'auto' }}>
              {FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: 'var(--text-dim)' }}>{pct}% Complete</span>
            <div className="w-32 progress-track">
              <div className="progress-fill" style={{ width: `${pct}%`, background: 'var(--green)' }} />
            </div>
          </div>
        </div>
      </div>

      {/* table */}
      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="dst-table">
            <thead>
              <tr>
                <th className="w-16">#</th>
                <th>Text</th>
                <th className="w-48">Detected Language</th>
                <th className="text-center w-40">Bahasa Rojak?</th>
                <th className="text-center w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={r.id}>
                  <td style={{ color: 'var(--text-dim)' }}>{(page - 1) * perPage + i + 1}</td>
                  <td>
                    <div className="max-w-xl line-clamp-3" title={r.original_text}>{r.original_text}</div>
                  </td>
                  <td>
                    <select
                      value={r.detected_language || ''}
                      onChange={e => setLang(r.id, e.target.value)}
                      disabled={saving[`l${r.id}`]}
                      className="dst-input dst-select"
                      style={{ height: 30 }}
                    >
                      <option value="">— Select —</option>
                      {r.detected_language && !LANGUAGES.includes(r.detected_language) && (
                        <option value={r.detected_language}>{r.detected_language} (detected)</option>
                      )}
                      {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </td>
                  <td>
                    <div className="flex justify-center gap-2">
                      <button
                        onClick={() => setBR(r.id, true)}
                        disabled={saving[r.id]}
                        className="px-3 py-1 text-sm rounded transition-colors disabled:opacity-50"
                        style={r.is_bahasa_rojak === true
                          ? { background: 'var(--green)', color: '#000' }
                          : { background: 'var(--bg-input)', color: 'var(--text-dim)' }}
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setBR(r.id, false)}
                        disabled={saving[r.id]}
                        className="px-3 py-1 text-sm rounded transition-colors disabled:opacity-50"
                        style={r.is_bahasa_rojak === false
                          ? { background: 'var(--red)', color: '#fff' }
                          : { background: 'var(--bg-input)', color: 'var(--text-dim)' }}
                      >
                        No
                      </button>
                    </div>
                  </td>
                  <td className="text-center">
                    <button
                      onClick={() => deleteRecord(r.id)}
                      disabled={deleting[r.id]}
                      className="p-1.5 rounded transition-colors disabled:opacity-50"
                      style={{ color: 'var(--text-dim)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
                      title="Delete"
                    >
                      {deleting[r.id] ? <div className="dst-spin" /> : <Trash2 size={14} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm" style={{ color: 'var(--text-dim)' }}>
          Showing {(page - 1) * perPage + 1} - {Math.min(page * perPage, total)} of {total}
        </div>
        <Pagination page={page} pages={pages} onGoPage={goPage} />
      </div>
    </div>
  )
}

export default BRClassification
