import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Search, Scissors, Mic, Download, Trash2,
  Music2, Clock, CheckCircle2, RefreshCw, Youtube, Upload,
} from 'lucide-react'
import {
  getASRDatasets,
  createASRDataset,
  deleteASRDataset,
  uploadAudioFiles,
  exportASRDataset,
  getAudioFiles,
  transcribeAudio,
  batchTranscribe,
  segmentAllFiles,
  importYoutubeAudio,
  getTaskStatus,
  downloadASRExport,
  pollTaskUntilDone
} from '../api'

/* ── Shared modal chrome ───────────────────────────────────── */
function Modal({ title, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="surface w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--clr-border)' }}>
          <h2 className="text-base font-bold" style={{ fontFamily: 'Syne, sans-serif', color: 'var(--clr-text)' }}>
            {title}
          </h2>
          <button onClick={onClose} className="text-xl leading-none opacity-40 hover:opacity-70 transition-opacity">×</button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-6 py-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--clr-border)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Label / field helpers ─────────────────────────────────── */
function FieldLabel({ children }) {
  return (
    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ fontFamily: 'Syne, sans-serif', color: 'var(--clr-text-muted)' }}>
      {children}
    </label>
  )
}

function ASRDatasets() {
  const navigate = useNavigate()
  const [datasets, setDatasets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newDataset, setNewDataset] = useState({ name: '', description: '', created_by: localStorage.getItem('dst_username') || '' })
  const [showUpload, setShowUpload] = useState(null)
  const [uploadFiles, setUploadFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [transcribing, setTranscribing] = useState({})
  const [segmenting, setSegmenting] = useState({})
  const [exporting, setExporting] = useState({})
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [youtubeImporting, setYoutubeImporting] = useState(false)
  const [youtubeAutoSegment, setYoutubeAutoSegment] = useState(true)
  const [youtubeChunkLength, setYoutubeChunkLength] = useState(30)
  const [useVad, setUseVad] = useState(true)
  const [minSpeechDuration, setMinSpeechDuration] = useState(500)
  const [minSilenceDuration, setMinSilenceDuration] = useState(300)
  const [filterText, setFilterText] = useState('')

  useEffect(() => { fetchDatasets() }, [])

  const fetchDatasets = async () => {
    try {
      const res = await getASRDatasets()
      setDatasets(res.data)
    } catch (err) {
      console.error('Failed to fetch datasets:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      await createASRDataset(newDataset)
      if (newDataset.created_by) localStorage.setItem('dst_username', newDataset.created_by)
      setShowCreate(false)
      setNewDataset({ name: '', description: '', created_by: newDataset.created_by })
      fetchDatasets()
    } catch (err) {
      alert('Failed to create dataset: ' + (err.response?.data?.detail || err.message))
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this dataset and all audio files?')) return
    try {
      await deleteASRDataset(id)
      fetchDatasets()
    } catch (err) {
      alert('Failed to delete dataset')
    }
  }

  const handleUpload = async () => {
    if (!uploadFiles.length) { alert('Please select audio files'); return }
    setUploading(true)
    try {
      await uploadAudioFiles(showUpload, Array.from(uploadFiles))
      setShowUpload(null); setUploadFiles([]); fetchDatasets()
    } catch (err) {
      alert('Failed to upload: ' + (err.response?.data?.detail || err.message))
    } finally {
      setUploading(false)
    }
  }

  const handleYoutubeImport = async (datasetId) => {
    if (!youtubeUrl.trim()) { alert('Please enter a YouTube URL'); return }
    setYoutubeImporting(true)
    try {
      const res = await importYoutubeAudio(datasetId, youtubeUrl, youtubeAutoSegment, youtubeChunkLength, false, useVad, minSpeechDuration, minSilenceDuration)
      const data = res.data
      alert(data.chunks_created
        ? `Downloaded "${data.youtube_title}" → ${data.chunks_created} segments`
        : `Downloaded "${data.youtube_title}" (${Math.round(data.youtube_duration)}s)`)
      setYoutubeUrl(''); setShowUpload(null); fetchDatasets()
    } catch (err) {
      alert('Failed to import: ' + (err.response?.data?.detail || err.message))
    } finally {
      setYoutubeImporting(false)
    }
  }

  const handleTranscribeAll = async (datasetId) => {
    setTranscribing(t => ({ ...t, [datasetId]: true }))
    try {
      const res = await batchTranscribe(datasetId)
      const result = res.data
      if (result.status === 'no_files' || result.files_processed === 0) {
        alert('No pending files to transcribe')
        setTranscribing(t => ({ ...t, [datasetId]: false }))
        return
      }
      if (result.status === 'queued' && result.task_id) {
        const taskId = result.task_id
        let attempts = 0
        while (attempts < 600) {
          await new Promise(r => setTimeout(r, 2000))
          attempts++
          try {
            const statusRes = await getTaskStatus(taskId)
            const ts = statusRes.data
            if (ts.status === 'SUCCESS') {
              alert(`Transcription complete: ${ts.result?.count ?? result.pending_count ?? 0} files processed`)
              break
            } else if (ts.status === 'FAILURE') {
              alert(`Transcription failed: ${ts.error || 'Unknown error'}`)
              break
            }
            if (attempts % 5 === 0) fetchDatasets()
          } catch (pollErr) { console.warn('Poll error:', pollErr) }
        }
        if (attempts >= 600) alert('Transcription still running in background. Refresh to check progress.')
      }
      fetchDatasets()
    } catch (err) {
      alert('Failed to transcribe: ' + (err.response?.data?.detail || err.message))
    } finally {
      setTranscribing(t => ({ ...t, [datasetId]: false }))
    }
  }

  const handleSegmentAll = async (datasetId) => {
    setSegmenting(s => ({ ...s, [datasetId]: true }))
    try {
      const res = await segmentAllFiles(datasetId, 30, false)
      const result = res.data
      if (result.success_count > 0) alert(`Segmented ${result.success_count} files into ${result.total_chunks_created} segments`)
      else if (result.files_found === 0) alert('No files to segment')
      else alert('Segmentation completed with some errors.')
      fetchDatasets()
    } catch (err) {
      alert('Failed to segment: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSegmenting(s => ({ ...s, [datasetId]: false }))
    }
  }

  const handleExport = async (id, format) => {
    setExporting(e => ({ ...e, [id]: true }))
    try {
      const dataset = datasets.find(d => d.id === id)
      const initRes = await exportASRDataset(id, format, true)
      await pollTaskUntilDone(initRes.data.task_id, 2000, 300)
      const res = await downloadASRExport(initRes.data.task_id)
      const blob = new Blob([res.data], { type: 'application/zip' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const date = new Date().toISOString().split('T')[0]
      a.download = `${(dataset?.name || 'asr').replace(/[^a-zA-Z0-9]/g, '_')}_${date}_${format}.zip`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      alert('Failed to export: ' + (err.response?.data?.detail || err.message))
    } finally {
      setExporting(e => ({ ...e, [id]: false }))
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-72 gap-4">
        <div className="w-8 h-8 rounded-full border-2 border-transparent animate-spin"
          style={{ borderTopColor: 'var(--clr-primary)', borderRightColor: 'var(--clr-primary)' }} />
        <p className="text-sm" style={{ color: 'var(--clr-text-muted)' }}>Loading datasets…</p>
      </div>
    )
  }

  const visibleDatasets = datasets.filter(d => !filterText || d.name.toLowerCase().includes(filterText.toLowerCase()))

  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Syne, sans-serif', color: 'var(--clr-text)' }}>
            ASR Datasets
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--clr-text-muted)' }}>
            Manage audio datasets for transcription and annotation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" style={{ color: 'var(--clr-text)' }} />
            <input
              type="text"
              placeholder="Search datasets…"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              className="form-input pl-8 !w-52"
            />
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={14} strokeWidth={2.5} /> New Dataset
          </button>
        </div>
      </div>

      {/* ── Create modal ─────────────────────────────────────── */}
      {showCreate && (
        <Modal
          title="Create ASR Dataset"
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
              <button form="create-form" type="submit" className="btn-primary">Create Dataset</button>
            </>
          }
        >
          <form id="create-form" onSubmit={handleCreate} className="space-y-4">
            <div>
              <FieldLabel>Dataset Name</FieldLabel>
              <input
                type="text"
                value={newDataset.name}
                onChange={e => setNewDataset({ ...newDataset, name: e.target.value })}
                className="form-input"
                placeholder="e.g. Malay News Corpus"
                required
              />
            </div>
            <div>
              <FieldLabel>Description (optional)</FieldLabel>
              <textarea
                value={newDataset.description}
                onChange={e => setNewDataset({ ...newDataset, description: e.target.value })}
                className="form-input"
                rows={2}
                placeholder="Brief description of this dataset"
              />
            </div>
            <div>
              <FieldLabel>Your Name</FieldLabel>
              <input
                type="text"
                value={newDataset.created_by}
                onChange={e => setNewDataset({ ...newDataset, created_by: e.target.value })}
                className="form-input"
                placeholder="Enter your name"
                required
              />
            </div>
          </form>
        </Modal>
      )}

      {/* ── Upload / YouTube import modal ─────────────────────── */}
      {showUpload && (
        <Modal
          title="Add Audio to Dataset"
          onClose={() => { setShowUpload(null); setUploadFiles([]); setYoutubeUrl('') }}
        >
          <div className="space-y-5">
            {/* Upload files */}
            <div className="surface p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Upload size={14} style={{ color: 'var(--clr-text-muted)' }} />
                <p className="text-sm font-semibold" style={{ color: 'var(--clr-text)' }}>Upload Audio Files</p>
              </div>
              <input
                type="file"
                accept="audio/*"
                multiple
                onChange={e => setUploadFiles(e.target.files)}
                className="form-input"
              />
              {uploadFiles.length > 0 && (
                <p className="text-xs" style={{ color: 'var(--clr-text-muted)' }}>{uploadFiles.length} file(s) selected</p>
              )}
              <button
                onClick={handleUpload}
                disabled={uploading || !uploadFiles.length}
                className="btn-primary w-full justify-center"
              >
                {uploading ? 'Uploading…' : 'Upload Files'}
              </button>
            </div>

            {/* YouTube import */}
            <div className="surface p-4 space-y-3" style={{ borderColor: '#FECACA' }}>
              <div className="flex items-center gap-2">
                <Youtube size={14} className="text-red-500" />
                <p className="text-sm font-semibold" style={{ color: 'var(--clr-text)' }}>Import from YouTube</p>
              </div>
              <input
                type="text"
                placeholder="https://www.youtube.com/watch?v=…"
                value={youtubeUrl}
                onChange={e => setYoutubeUrl(e.target.value)}
                className="form-input"
              />

              <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--clr-text-muted)' }}>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={youtubeAutoSegment}
                    onChange={e => setYoutubeAutoSegment(e.target.checked)}
                    className="rounded"
                  />
                  Auto-segment
                </label>
                {youtubeAutoSegment && !useVad && (
                  <select
                    value={youtubeChunkLength}
                    onChange={e => setYoutubeChunkLength(Number(e.target.value))}
                    className="form-input !w-auto text-xs"
                  >
                    {[15, 30, 60, 120].map(n => <option key={n} value={n}>{n}s</option>)}
                  </select>
                )}
              </div>

              {youtubeAutoSegment && (
                <div className="flex gap-4 text-sm" style={{ color: 'var(--clr-text-muted)' }}>
                  {[{ label: 'VAD (natural speech)', val: true }, { label: 'Fixed-length', val: false }].map(opt => (
                    <label key={String(opt.val)} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="vadMode" checked={useVad === opt.val} onChange={() => setUseVad(opt.val)} />
                      {opt.label}
                    </label>
                  ))}
                </div>
              )}

              {youtubeAutoSegment && useVad && (
                <div className="space-y-3 p-3 rounded-lg" style={{ background: 'var(--clr-surface-2)' }}>
                  {[
                    { label: 'Min Speech Duration', val: minSpeechDuration, setter: setMinSpeechDuration, min: 100, max: 2000, step: 100, unit: 'ms' },
                    { label: 'Min Silence Duration', val: minSilenceDuration, setter: setMinSilenceDuration, min: 100, max: 2000, step: 50, unit: 'ms' },
                  ].map(({ label, val, setter, min, max, step, unit }) => (
                    <div key={label}>
                      <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--clr-text-muted)' }}>
                        <span className="font-medium">{label}</span>
                        <span>{val}{unit}</span>
                      </div>
                      <input
                        type="range" min={min} max={max} step={step} value={val}
                        onChange={e => setter(Number(e.target.value))}
                        className="w-full accent-teal-600"
                      />
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => handleYoutubeImport(showUpload)}
                disabled={youtubeImporting || !youtubeUrl.trim()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg bg-red-500 hover:bg-red-600 transition disabled:opacity-50"
              >
                <Youtube size={14} />
                {youtubeImporting ? 'Importing…' : 'Import from YouTube'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Dataset list ─────────────────────────────────────── */}
      {visibleDatasets.length === 0 ? (
        <div className="surface p-12 text-center">
          <Music2 size={32} className="mx-auto mb-3 opacity-30" style={{ color: 'var(--clr-text)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--clr-text)' }}>No ASR datasets yet</p>
          <p className="text-sm mt-1" style={{ color: 'var(--clr-text-muted)' }}>
            Create a dataset and add audio files to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleDatasets.map(dataset => {
            const transcribedTotal = (dataset.transcribed_count || 0) + (dataset.completed_count || 0)
            const transcriptionPct = dataset.file_count > 0 ? (transcribedTotal / dataset.file_count) * 100 : 0
            const annotationPct = dataset.file_count > 0 ? (dataset.completed_count / dataset.file_count) * 100 : 0

            return (
              <div key={dataset.id} className="surface p-5">
                <div className="flex items-start justify-between gap-4">
                  {/* Left: info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold truncate" style={{ fontFamily: 'Syne, sans-serif', color: 'var(--clr-text)' }}>
                      {dataset.name}
                    </h3>
                    {dataset.description && (
                      <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--clr-text-muted)' }}>{dataset.description}</p>
                    )}
                    <div className="flex flex-wrap gap-4 mt-2 text-xs" style={{ color: 'var(--clr-text-muted)' }}>
                      <span className="flex items-center gap-1"><Music2 size={11} /> {dataset.file_count || 0} files</span>
                      <span className="flex items-center gap-1"><Clock size={11} /> {dataset.pending_count || 0} pending</span>
                      <span className="flex items-center gap-1"><RefreshCw size={11} /> {dataset.transcribed_count || 0} ready</span>
                      <span className="flex items-center gap-1"><CheckCircle2 size={11} /> {dataset.completed_count || 0} annotated</span>
                    </div>

                    {dataset.file_count > 0 && (
                      <div className="mt-3 space-y-2 max-w-xs">
                        <div>
                          <div className="flex justify-between text-[11px] mb-1" style={{ color: 'var(--clr-text-muted)' }}>
                            <span>Transcription</span><span>{transcriptionPct.toFixed(0)}%</span>
                          </div>
                          <div className="progress-track"><div className="progress-fill" style={{ width: `${transcriptionPct}%`, background: '#3B82F6' }} /></div>
                        </div>
                        <div>
                          <div className="flex justify-between text-[11px] mb-1" style={{ color: 'var(--clr-text-muted)' }}>
                            <span>Annotation</span><span>{annotationPct.toFixed(0)}%</span>
                          </div>
                          <div className="progress-track"><div className="progress-fill" style={{ width: `${annotationPct}%` }} /></div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right: actions */}
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setShowUpload(dataset.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950"
                      >
                        <Plus size={11} /> Add Audio
                      </button>
                      {dataset.file_count > 0 && (
                        <>
                          <button
                            onClick={() => handleSegmentAll(dataset.id)}
                            disabled={segmenting[dataset.id]}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-950 disabled:opacity-50"
                            title="Segment using VAD"
                          >
                            <Scissors size={11} /> {segmenting[dataset.id] ? 'Segmenting…' : 'Segment'}
                          </button>
                          <button
                            onClick={() => handleTranscribeAll(dataset.id)}
                            disabled={transcribing[dataset.id]}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950 disabled:opacity-50"
                          >
                            <Mic size={11} /> {transcribing[dataset.id] ? 'Processing…' : 'Transcribe All'}
                          </button>
                          <button
                            onClick={() => navigate(`/asr/${dataset.id}/annotate`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors btn-primary"
                          >
                            Annotate
                          </button>
                        </>
                      )}
                    </div>
                    {dataset.file_count > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => handleExport(dataset.id, 'csv')}
                          disabled={exporting[dataset.id]}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 hover:bg-blue-100 disabled:opacity-50"
                          title="Export as CSV + Audio ZIP"
                        >
                          <Download size={11} /> CSV + Audio
                        </button>
                        <button
                          onClick={() => handleExport(dataset.id, 'jsonl')}
                          disabled={exporting[dataset.id]}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 hover:bg-violet-100 disabled:opacity-50"
                          title="Export as JSONL + Audio ZIP"
                        >
                          <Download size={11} /> JSONL + Audio
                        </button>
                        {exporting[dataset.id] && (
                          <span className="text-xs italic self-center" style={{ color: 'var(--clr-text-muted)' }}>Packing…</span>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => handleDelete(dataset.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 hover:bg-red-100 self-start"
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── How-to tip ──────────────────────────────────────── */}
      <div className="surface p-5" style={{ borderLeftColor: '#3B82F6', borderLeftWidth: '3px' }}>
        <p className="text-xs font-bold mb-2 uppercase tracking-widest" style={{ fontFamily: 'Syne, sans-serif', color: '#3B82F6' }}>
          How ASR Annotation Works
        </p>
        <ol className="space-y-1 text-sm" style={{ color: 'var(--clr-text-muted)' }}>
          {[
            'Create a dataset and add audio — upload files or import from YouTube',
            'Optional: Segment long recordings into speech segments using VAD',
            'Run Transcribe All to process files with Whisper + Qwen3 via Celery',
            'Click Annotate to review and correct transcriptions',
            'Export as a ZIP (audio segments + CSV or JSONL) when done',
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="flex-shrink-0 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center mt-0.5"
                style={{ background: '#EFF6FF', color: '#3B82F6' }}>
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

    </div>
  )
}

export default ASRDatasets
