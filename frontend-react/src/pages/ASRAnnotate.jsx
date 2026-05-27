import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import WaveSurfer from 'wavesurfer.js'
import {
  ArrowLeft, Play, Pause, Square, SkipBack, SkipForward,
  RefreshCw, Trash2, Link2, Zap, CheckCircle2, Search,
  ChevronUp, ChevronDown,
} from 'lucide-react'
import {
  getASRDatasets,
  getAudioFiles,
  getAudioUrl,
  transcribeAudio,
  retranscribeAudio,
  deleteAudioFile,
  fuseAudioFiles,
  annotateTranscript,
  updateFileStatus,
  getTaskStatus,
  pollTaskUntilDone,
} from '../api'

const STATUS_CFG = {
  pending:     { label: 'Pending',     cls: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300' },
  transcribing:{ label: 'Processing',  cls: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300' },
  transcribed: { label: 'Transcribed', cls: 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300' },
  annotating:  { label: 'In Progress', cls: 'bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300' },
  completed:   { label: 'Completed',   cls: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' },
}

function StatusChip({ status, size = 'xs' }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.pending
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-${size} font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

function Kbd({ children }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium"
      style={{ background: 'var(--clr-surface-2)', border: '1px solid var(--clr-border)', color: 'var(--clr-text-muted)' }}>
      {children}
    </kbd>
  )
}

const PER_PAGE = 20

function ASRAnnotate() {
  const { datasetId } = useParams()
  const navigate = useNavigate()
  const waveformRef = useRef(null)
  const wsRef = useRef(null)

  const [dataset, setDataset] = useState(null)
  const [files, setFiles] = useState([])
  const [idx, setIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [filter, setFilter] = useState('all')
  const [rate, setRate] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [curTime, setCurTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [waveReady, setWaveReady] = useState(false)
  const [waveError, setWaveError] = useState(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [totalAll, setTotalAll] = useState(0)
  const [filteredTotal, setFilteredTotal] = useState(0)
  const [counts, setCounts] = useState({ pending: 0, transcribed: 0, completed: 0 })
  const [fuseMode, setFuseMode] = useState(false)
  const [selected, setSelected] = useState([])
  const [fusing, setFusing] = useState(false)
  const [sortBy, setSortBy] = useState('created_at')
  const [sortOrder, setSortOrder] = useState('asc')
  const [showFindReplace, setShowFindReplace] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)

  const cur = files[idx]

  // WaveSurfer setup
  useEffect(() => {
    if (wsRef.current) { wsRef.current.destroy(); wsRef.current = null }
    if (!waveformRef.current || !cur) return
    setWaveReady(false); setWaveError(null); setCurTime(0); setDur(0)

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#5EEAD4',       // teal-300
      progressColor: '#0D9488',   // teal-600
      cursorColor: '#0F766E',     // teal-700
      cursorWidth: 2, barWidth: 2, barGap: 1, barRadius: 2,
      height: 80, normalize: true, url: getAudioUrl(cur.id),
    })
    wsRef.current = ws

    ws.on('ready', () => { setWaveReady(true); setDur(ws.getDuration()) })
    ws.on('timeupdate', t => setCurTime(t))
    ws.on('play', () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))
    ws.on('finish', () => setPlaying(false))
    ws.on('error', err => { console.error('WaveSurfer:', err); setWaveError('Failed to load waveform') })

    return () => ws.destroy()
  }, [cur?.id])

  useEffect(() => {
    if (wsRef.current && waveReady) wsRef.current.setPlaybackRate(rate)
  }, [rate, waveReady])

  useEffect(() => {
    getASRDatasets()
      .then(res => {
        const ds = res.data.find(d => d.id === parseInt(datasetId))
        ds ? setDataset(ds) : navigate('/asr')
      })
      .catch(() => navigate('/asr'))
  }, [datasetId])

  useEffect(() => { if (dataset) fetchFiles() }, [dataset, page, filter, sortBy, sortOrder])
  useEffect(() => { if (cur) setTranscript(cur.corrected_transcript || cur.whisper_transcript || '') }, [idx, files])

  async function fetchFiles() {
    setLoading(true)
    try {
      const status = filter === 'all' ? null : filter
      const offset = (page - 1) * PER_PAGE
      const res = await getAudioFiles(datasetId, status, PER_PAGE, offset, sortBy, sortOrder)
      const batch = res.data.files || []
      setFiles(batch)
      setFilteredTotal(res.data.filtered_total || res.data.total || 0)
      setTotalAll(res.data.total || 0)
      setPages(res.data.total_pages || 1)
      setCounts({ pending: res.data.pending || 0, transcribed: res.data.transcribed || 0, completed: res.data.completed || 0 })
      const start = batch.findIndex(f => f.status !== 'completed')
      setIdx(start >= 0 ? start : 0)
    } catch (err) { console.error('Failed to load:', err) }
    setLoading(false)
  }

  function changeFilter(val) { setFilter(val); setPage(1); setIdx(0) }
  function changeSort(field) { setSortBy(field); setPage(1); setIdx(0) }
  function toggleSortOrder() { setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc'); setPage(1); setIdx(0) }
  function goPage(p) { if (p >= 1 && p <= pages) { setPage(p); setIdx(0) } }
  function fmtTime(s) { return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` }
  function playPause() { wsRef.current?.playPause() }
  function stop() { wsRef.current?.stop(); setCurTime(0) }
  function skip(s) {
    if (wsRef.current && dur > 0) wsRef.current.seekTo(Math.max(0, Math.min(dur, curTime + s)) / dur)
  }

  async function doTranscribe(engine = 'whisper') {
    if (!cur) return
    setTranscribing(true)
    try {
      const res = await transcribeAudio(cur.id, engine)
      if (res.data.task_id) {
        try {
          await pollTaskUntilDone(res.data.task_id, 2000, 150)
          await fetchFiles()
        } catch { alert('Transcription may still be running. Refresh to check.') }
      }
    } catch (err) { alert('Transcribe failed: ' + (err.response?.data?.detail || err.message)) }
    setTranscribing(false)
  }

  async function doRetranscribe(engine = 'whisper') {
    if (!cur || !confirm(`Re-transcribe with ${engine}? This clears the existing ${engine} transcription.`)) return
    setTranscribing(true)
    try {
      const res = await retranscribeAudio(cur.id, engine)
      if (res.data.task_id) {
        try { await pollTaskUntilDone(res.data.task_id, 2000, 150); await fetchFiles() }
        catch { alert('Re-transcription may still be running. Refresh to check.') }
      }
    } catch (err) { alert('Re-transcribe failed: ' + (err.response?.data?.detail || err.message)) }
    setTranscribing(false)
  }

  async function doDelete() {
    if (!cur || !confirm(`Delete "${cur.filename}"? Can't undo.`)) return
    try { await deleteAudioFile(cur.id); fetchFiles() }
    catch (err) { alert('Delete failed: ' + (err.response?.data?.detail || err.message)) }
  }

  function toggleFuse() { setFuseMode(!fuseMode); setSelected([]) }
  function toggleSelect(id) { setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]) }

  async function doFuse() {
    if (selected.length < 2) return alert('Select at least 2 files')
    if (!confirm(`Fuse ${selected.length} audio files into one?`)) return
    setFusing(true)
    try {
      const res = await fuseAudioFiles(selected)
      alert(`Fused ${selected.length} files → ${res.data.filename} (${Math.round(res.data.duration)}s)`)
      setFuseMode(false); setSelected([]); fetchFiles()
    } catch (err) { alert('Fuse failed: ' + (err.response?.data?.detail || err.message)) }
    setFusing(false)
  }

  async function save() {
    if (!cur) return
    setSaving(true)
    try {
      const annotator = localStorage.getItem('dst_username') || 'anonymous'
      await annotateTranscript(cur.id, transcript, annotator)
      setFiles(prev => prev.map(f => f.id === cur.id ? { ...f, corrected_transcript: transcript } : f))
    } catch (err) { alert('Save failed: ' + (err.response?.data?.detail || err.message)) }
    setSaving(false)
  }

  async function markComplete() {
    if (!cur) return
    setSaving(true)
    try {
      const annotator = localStorage.getItem('dst_username') || 'anonymous'
      await annotateTranscript(cur.id, transcript, annotator)
      await updateFileStatus(cur.id, 'completed')
      setFiles(prev => prev.map(f => f.id === cur.id ? { ...f, corrected_transcript: transcript, status: 'completed' } : f))
      setCounts(c => ({ ...c, completed: c.completed + 1 }))
      let next = files.findIndex((f, i) => i > idx && f.status !== 'completed')
      if (next === -1) next = files.findIndex((f, i) => i < idx && f.status !== 'completed')
      if (next >= 0) setIdx(next)
      else if (idx < files.length - 1) setIdx(idx + 1)
    } catch (err) { alert('Failed: ' + (err.response?.data?.detail || err.message)) }
    setSaving(false)
  }

  function onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); markComplete() }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save() }
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') { e.preventDefault(); setShowFindReplace(prev => !prev) }
  }

  const matchCount = (() => {
    if (!findText || !transcript) return 0
    try {
      const flags = caseSensitive ? 'g' : 'gi'
      return (transcript.match(new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)) || []).length
    } catch { return 0 }
  })()

  function doReplaceAll() {
    if (!findText) return
    try {
      const flags = caseSensitive ? 'g' : 'gi'
      setTranscript(prev => prev.replace(new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags), replaceText))
    } catch { /* ignore */ }
  }

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return
      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); playPause() }
      if (e.code === 'ArrowLeft') { e.preventDefault(); skip(-5) }
      if (e.code === 'ArrowRight') { e.preventDefault(); skip(5) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [waveReady, dur, curTime])

  if (loading && files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-72 gap-4">
        <div className="w-8 h-8 rounded-full border-2 border-transparent animate-spin"
          style={{ borderTopColor: 'var(--clr-primary)', borderRightColor: 'var(--clr-primary)' }} />
        <p className="text-sm" style={{ color: 'var(--clr-text-muted)' }}>Loading files…</p>
      </div>
    )
  }

  const pct = totalAll > 0 ? Math.round((counts.completed / totalAll) * 100) : 0

  return (
    <div className="space-y-5">

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <button
            onClick={() => navigate('/asr')}
            className="inline-flex items-center gap-1.5 text-sm font-medium mb-2 transition-colors"
            style={{ color: 'var(--clr-text-muted)' }}
            onMouseOver={e => e.currentTarget.style.color = 'var(--clr-primary)'}
            onMouseOut={e => e.currentTarget.style.color = 'var(--clr-text-muted)'}
          >
            <ArrowLeft size={14} /> Back to Datasets
          </button>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Raleway, sans-serif', color: 'var(--clr-text)' }}>
            {dataset?.name || 'ASR Annotation'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFuse}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors border ${
              fuseMode
                ? 'text-white border-teal-600'
                : 'border-slate-300 dark:border-slate-600'
            }`}
            style={fuseMode ? { background: 'var(--clr-primary)' } : { color: 'var(--clr-text)' }}
          >
            <Link2 size={13} /> {fuseMode ? 'Fuse Mode On' : 'Fuse Audio'}
          </button>
          {fuseMode && selected.length >= 2 && (
            <button
              onClick={doFuse}
              disabled={fusing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Zap size={13} /> {fusing ? 'Fusing…' : `Fuse ${selected.length} Files`}
            </button>
          )}
        </div>
      </div>

      {/* ── Stats + controls bar ────────────────────────────── */}
      <div className="surface px-5 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Counters */}
          <div className="flex items-center gap-5">
            {[
              { label: 'Total', val: totalAll, color: 'var(--clr-primary)' },
              { label: 'Pending', val: counts.pending, color: 'var(--clr-text-muted)' },
              { label: 'Transcribed', val: counts.transcribed, color: '#3B82F6' },
              { label: 'Completed', val: counts.completed, color: '#10B981' },
            ].map(({ label, val, color }) => (
              <div key={label} className="text-center">
                <div className="text-xl font-bold" style={{ fontFamily: 'Raleway, sans-serif', color }}>{val}</div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--clr-text-muted)' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--clr-text-muted)' }}>
              <span>Sort</span>
              <select
                value={sortBy}
                onChange={e => changeSort(e.target.value)}
                className="form-input !w-auto !py-1 text-xs"
              >
                <option value="created_at">Date Added</option>
                <option value="filename">Filename</option>
                <option value="id">File ID</option>
              </select>
              <button
                onClick={toggleSortOrder}
                className="inline-flex items-center gap-0.5 px-2 py-1 rounded border text-xs transition-colors"
                style={{ borderColor: 'var(--clr-border)', color: 'var(--clr-text-muted)' }}
              >
                {sortOrder === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                {sortOrder === 'asc' ? 'Asc' : 'Desc'}
              </button>
            </div>

            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--clr-text-muted)' }}>
              <span>Filter</span>
              <select value={filter} onChange={e => changeFilter(e.target.value)} className="form-input !w-auto !py-1 text-xs">
                <option value="all">All Files</option>
                <option value="pending">Pending</option>
                <option value="transcribed">Transcribed</option>
                <option value="annotating">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--clr-text-muted)' }}>{pct}%</span>
              <div className="w-28 progress-track">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Fuse mode banner ────────────────────────────────── */}
      {fuseMode && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm"
          style={{ background: 'var(--clr-primary-bg)', border: '1px solid color-mix(in srgb, var(--clr-primary) 30%, transparent)' }}
        >
          <Link2 size={15} style={{ color: 'var(--clr-primary)' }} />
          <div style={{ color: 'var(--clr-text)' }}>
            <span className="font-semibold">Fuse mode active</span>
            <span className="ml-2" style={{ color: 'var(--clr-text-muted)' }}>Select 2+ files using checkboxes to concatenate them.</span>
            {selected.length > 0 && <span className="ml-2 font-medium" style={{ color: 'var(--clr-primary)' }}>{selected.length} selected</span>}
          </div>
          <button onClick={toggleFuse} className="ml-auto opacity-50 hover:opacity-100 text-base leading-none">×</button>
        </div>
      )}

      {files.length === 0 ? (
        <div className="surface p-12 text-center">
          <p className="text-sm font-medium" style={{ color: 'var(--clr-text)' }}>No files found</p>
          <p className="text-sm mt-1" style={{ color: 'var(--clr-text-muted)' }}>Upload audio files or change the filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">

          {/* ── File list sidebar ─────────────────────────── */}
          <div className="surface p-4 h-fit lg:sticky lg:top-20">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold" style={{ fontFamily: 'Raleway, sans-serif', color: 'var(--clr-text)' }}>
                Files
              </h2>
              <span className="text-xs" style={{ color: 'var(--clr-text-muted)' }}>
                {filteredTotal}{filter !== 'all' ? ` ${filter}` : ''} total
                {fuseMode && selected.length > 0 && (
                  <span className="ml-1.5 font-medium" style={{ color: 'var(--clr-primary)' }}>· {selected.length} selected</span>
                )}
              </span>
            </div>

            <div className="space-y-1 max-h-[500px] overflow-y-auto -mx-1 px-1">
              {files.map((file, i) => {
                const isActive = i === idx
                return (
                  <div
                    key={file.id}
                    className="relative rounded-lg transition-colors"
                    style={{
                      background: isActive ? 'var(--clr-primary-bg)' : undefined,
                      border: `1px solid ${isActive ? 'color-mix(in srgb, var(--clr-primary) 40%, transparent)' : 'var(--clr-border)'}`,
                    }}
                  >
                    {fuseMode && (
                      <div className="absolute left-2.5 top-3">
                        <input
                          type="checkbox"
                          checked={selected.includes(file.id)}
                          onChange={() => toggleSelect(file.id)}
                          className="w-3.5 h-3.5 rounded accent-teal-600"
                          onClick={e => e.stopPropagation()}
                        />
                      </div>
                    )}
                    <button
                      onClick={() => !fuseMode && setIdx(i)}
                      className="w-full text-left px-3 py-2.5"
                      style={{ paddingLeft: fuseMode ? '28px' : undefined }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-medium truncate flex-1" style={{ color: 'var(--clr-text)' }}>
                          {file.filename}
                        </span>
                        <StatusChip status={file.status} />
                      </div>
                      {file.duration && (
                        <span className="text-[11px] mt-0.5 block" style={{ color: 'var(--clr-text-muted)' }}>
                          {fmtTime(file.duration)}
                        </span>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Pagination */}
            {pages > 1 && (
              <div
                className="flex items-center justify-between mt-3 pt-3"
                style={{ borderTop: '1px solid var(--clr-border)' }}
              >
                <button
                  onClick={() => goPage(page - 1)}
                  disabled={page === 1}
                  className="px-2 py-1 text-xs rounded-md transition-colors disabled:opacity-40"
                  style={{ background: 'var(--clr-surface-2)', color: 'var(--clr-text)' }}
                >
                  Prev
                </button>
                <span className="text-xs" style={{ color: 'var(--clr-text-muted)' }}>
                  {page} / {pages}
                </span>
                <button
                  onClick={() => goPage(page + 1)}
                  disabled={page === pages}
                  className="px-2 py-1 text-xs rounded-md transition-colors disabled:opacity-40"
                  style={{ background: 'var(--clr-surface-2)', color: 'var(--clr-text)' }}
                >
                  Next
                </button>
              </div>
            )}
          </div>

          {/* ── Annotation area ───────────────────────────── */}
          <div className="space-y-4 lg:col-span-2">
            {cur && (
              <>
                {/* Audio player */}
                <div className="surface p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-sm font-bold truncate" style={{ fontFamily: 'Raleway, sans-serif', color: 'var(--clr-text)' }}>
                        {cur.filename}
                      </h2>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusChip status={cur.status} />
                      <button
                        onClick={() => doRetranscribe('whisper')}
                        disabled={transcribing}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 hover:bg-blue-100 disabled:opacity-50"
                        title="Re-transcribe with Whisper"
                      >
                        <RefreshCw size={10} /> Whisper
                      </button>
                      <button
                        onClick={() => doRetranscribe('qwen3')}
                        disabled={transcribing}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 hover:bg-violet-100 disabled:opacity-50"
                        title="Re-transcribe with Qwen3"
                      >
                        <RefreshCw size={10} /> Qwen3
                      </button>
                      <button
                        onClick={doDelete}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 hover:bg-red-100"
                      >
                        <Trash2 size={10} /> Delete
                      </button>
                    </div>
                  </div>

                  {/* Waveform */}
                  <div className="rounded-lg overflow-hidden mb-3" style={{ background: 'var(--clr-surface-2)' }}>
                    <div ref={waveformRef} style={{ minHeight: '80px' }} />
                    {!waveReady && !waveError && (
                      <div className="flex items-center justify-center h-20 gap-2 text-xs" style={{ color: 'var(--clr-text-muted)' }}>
                        <div className="w-4 h-4 rounded-full border border-transparent animate-spin"
                          style={{ borderTopColor: 'var(--clr-primary)', borderRightColor: 'var(--clr-primary)' }} />
                        Loading waveform…
                      </div>
                    )}
                  </div>
                  {waveError && (
                    <div className="mb-3">
                      <p className="text-xs text-red-500 mb-2">{waveError}</p>
                      <audio
                        controls
                        className="w-full"
                        src={getAudioUrl(cur.id)}
                        onLoadedMetadata={e => setDur(e.target.duration)}
                        onTimeUpdate={e => setCurTime(e.target.currentTime)}
                      />
                    </div>
                  )}

                  {/* Time display */}
                  <div className="flex justify-between text-xs mb-4 tabular-nums" style={{ color: 'var(--clr-text-muted)' }}>
                    <span>{fmtTime(curTime)}</span>
                    <span>{fmtTime(dur)}</span>
                  </div>

                  {/* Playback controls */}
                  <div className="flex items-center justify-center gap-3 mb-4">
                    <button
                      onClick={() => skip(-5)}
                      disabled={!waveReady}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                      style={{ background: 'var(--clr-surface-2)', color: 'var(--clr-text)' }}
                    >
                      <SkipBack size={13} /> −5s
                    </button>
                    <button
                      onClick={playPause}
                      disabled={!waveReady}
                      className="w-11 h-11 rounded-full flex items-center justify-center text-white transition-all disabled:opacity-40 hover:brightness-110 active:scale-95"
                      style={{ background: 'var(--clr-primary)' }}
                    >
                      {playing ? <Pause size={18} /> : <Play size={18} />}
                    </button>
                    <button
                      onClick={stop}
                      disabled={!waveReady}
                      className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40"
                      style={{ background: 'var(--clr-surface-2)', color: 'var(--clr-text)' }}
                    >
                      <Square size={13} />
                    </button>
                    <button
                      onClick={() => skip(5)}
                      disabled={!waveReady}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                      style={{ background: 'var(--clr-surface-2)', color: 'var(--clr-text)' }}
                    >
                      +5s <SkipForward size={13} />
                    </button>
                  </div>

                  {/* Speed */}
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--clr-text-muted)' }}>Speed</span>
                    <div className="flex gap-1">
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map(r => (
                        <button
                          key={r}
                          onClick={() => setRate(r)}
                          className="px-2 py-0.5 rounded text-xs font-medium transition-colors"
                          style={{
                            background: rate === r ? 'var(--clr-primary)' : 'var(--clr-surface-2)',
                            color: rate === r ? '#fff' : 'var(--clr-text-muted)',
                          }}
                        >
                          {r}×
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Keyboard hints */}
                  <p className="mt-3 text-center text-[11px]" style={{ color: 'var(--clr-text-muted)' }}>
                    <Kbd>Space</Kbd> play/pause &nbsp;·&nbsp;
                    <Kbd>←</Kbd> <Kbd>→</Kbd> skip 5s
                  </p>
                </div>

                {/* Transcript panels (Whisper + Qwen3) */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {/* Whisper */}
                  <div className="surface p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-bold uppercase tracking-widest" style={{ fontFamily: 'Raleway, sans-serif', color: 'var(--clr-text-muted)' }}>
                        Whisper
                      </p>
                      <div className="flex gap-1.5">
                        {cur.whisper_transcript && (
                          <button
                            onClick={() => setTranscript(cur.whisper_transcript)}
                            className="px-2 py-0.5 text-xs font-medium rounded transition-colors"
                            style={{ background: 'var(--clr-primary-bg)', color: 'var(--clr-primary)' }}
                          >
                            Use as base
                          </button>
                        )}
                        {!cur.whisper_transcript && cur.status === 'pending' && (
                          <button
                            onClick={() => doTranscribe('whisper')}
                            disabled={transcribing}
                            className="px-2 py-0.5 text-xs font-medium rounded bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 hover:bg-amber-200 disabled:opacity-50"
                          >
                            {transcribing ? '…' : 'Run'}
                          </button>
                        )}
                      </div>
                    </div>
                    {cur.whisper_transcript ? (
                      <div className="p-3 rounded-lg" style={{ background: 'var(--clr-surface-2)', border: '1px solid var(--clr-border)' }}>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--clr-text)' }}>{cur.whisper_transcript}</p>
                        {cur.whisper_language && (
                          <p className="mt-2 text-[11px]" style={{ color: 'var(--clr-text-muted)' }}>
                            Lang: {cur.whisper_language}{cur.whisper_confidence ? ` · Conf: ${(cur.whisper_confidence * 100).toFixed(0)}%` : ''}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div
                        className="p-3 rounded-lg text-center text-xs border-dashed border"
                        style={{ color: 'var(--clr-text-muted)', background: 'var(--clr-surface-2)', borderColor: 'var(--clr-border-2)' }}
                      >
                        {cur.status === 'transcribing' ? 'Processing…' : 'Not available'}
                      </div>
                    )}
                  </div>

                  {/* Qwen3 */}
                  <div className="surface p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-bold uppercase tracking-widest" style={{ fontFamily: 'Raleway, sans-serif', color: 'var(--clr-text-muted)' }}>
                        Qwen3 ASR
                      </p>
                      <div className="flex gap-1.5">
                        {cur.qwen3_transcript && (
                          <button
                            onClick={() => setTranscript(cur.qwen3_transcript)}
                            className="px-2 py-0.5 text-xs font-medium rounded transition-colors"
                            style={{ background: 'var(--clr-primary-bg)', color: 'var(--clr-primary)' }}
                          >
                            Use as base
                          </button>
                        )}
                        {!cur.qwen3_transcript && (
                          <button
                            onClick={() => doTranscribe('qwen3')}
                            disabled={transcribing}
                            className="px-2 py-0.5 text-xs font-medium rounded bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 hover:bg-violet-200 disabled:opacity-50"
                          >
                            {transcribing ? '…' : 'Run'}
                          </button>
                        )}
                      </div>
                    </div>
                    {cur.qwen3_transcript ? (
                      <div className="p-3 rounded-lg" style={{ background: 'var(--clr-surface-2)', border: '1px solid var(--clr-border)' }}>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--clr-text)' }}>{cur.qwen3_transcript}</p>
                        {cur.qwen3_language && (
                          <p className="mt-2 text-[11px]" style={{ color: 'var(--clr-text-muted)' }}>Lang: {cur.qwen3_language}</p>
                        )}
                      </div>
                    ) : (
                      <div
                        className="p-3 rounded-lg text-center text-xs border-dashed border"
                        style={{ color: 'var(--clr-text-muted)', background: 'var(--clr-surface-2)', borderColor: 'var(--clr-border-2)' }}
                      >
                        {cur.status === 'transcribing' ? 'Processing…' : 'Not yet run — click Run to start'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Corrected transcript */}
                <div className="surface p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ fontFamily: 'Raleway, sans-serif', color: 'var(--clr-text-muted)' }}>
                      Corrected Transcription
                    </p>
                    <div className="flex gap-1.5">
                      {cur.corrected_transcript && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300">
                          Saved
                        </span>
                      )}
                    </div>
                  </div>

                  <textarea
                    value={transcript}
                    onChange={e => setTranscript(e.target.value)}
                    onKeyDown={onKeyDown}
                    rows={6}
                    placeholder="Edit transcript here…"
                    className="form-input font-mono text-sm leading-relaxed"
                  />
                  <p className="mt-1.5 text-[11px]" style={{ color: 'var(--clr-text-muted)' }}>
                    This corrected version will be saved as ground truth.
                  </p>

                  <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
                    <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--clr-text-muted)' }}>
                      <Kbd>Ctrl+S</Kbd> save &nbsp;
                      <Kbd>Ctrl+↵</Kbd> complete &nbsp;
                      <Kbd>Ctrl+H</Kbd> find/replace
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowFindReplace(prev => !prev)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                          showFindReplace
                            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-400 text-amber-700 dark:text-amber-300'
                            : 'border-slate-300 dark:border-slate-600'
                        }`}
                        style={!showFindReplace ? { color: 'var(--clr-text)' } : undefined}
                      >
                        <Search size={11} /> Find & Replace
                      </button>
                      <button
                        onClick={save}
                        disabled={saving}
                        className="btn-secondary text-xs px-3 py-1.5"
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={markComplete}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                      >
                        <CheckCircle2 size={12} /> Complete
                      </button>
                    </div>
                  </div>

                  {/* Find & Replace Panel */}
                  {showFindReplace && (
                    <div
                      className="mt-4 p-4 rounded-lg"
                      style={{ background: 'var(--clr-surface-2)', border: '1px solid var(--clr-border)' }}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-bold uppercase tracking-widest" style={{ fontFamily: 'Raleway, sans-serif', color: 'var(--clr-text-muted)' }}>
                          Find & Replace
                        </p>
                        <button
                          onClick={() => setShowFindReplace(false)}
                          className="text-xs opacity-50 hover:opacity-80"
                          style={{ color: 'var(--clr-text)' }}
                        >
                          Close
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--clr-text-muted)' }}>Find</label>
                          <input
                            type="text"
                            value={findText}
                            onChange={e => setFindText(e.target.value)}
                            placeholder="Word to find…"
                            className="form-input text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--clr-text-muted)' }}>Replace with</label>
                          <input
                            type="text"
                            value={replaceText}
                            onChange={e => setReplaceText(e.target.value)}
                            placeholder="Replacement text…"
                            className="form-input text-xs"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--clr-text-muted)' }}>
                            <input
                              type="checkbox"
                              checked={caseSensitive}
                              onChange={e => setCaseSensitive(e.target.checked)}
                              className="w-3.5 h-3.5 rounded accent-teal-600"
                            />
                            Case sensitive
                          </label>
                          {findText && (
                            <span className="text-xs" style={{ color: 'var(--clr-text-muted)' }}>
                              {matchCount} match{matchCount !== 1 ? 'es' : ''}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={doReplaceAll}
                          disabled={!findText || matchCount === 0}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
                        >
                          Replace All ({matchCount})
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Record navigation */}
                <div className="flex justify-between items-center">
                  <button
                    onClick={() => idx > 0 && setIdx(idx - 1)}
                    disabled={idx === 0}
                    className="btn-secondary text-xs px-4 py-2"
                  >
                    ← Previous
                  </button>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--clr-text-muted)' }}>
                    {(page - 1) * PER_PAGE + idx + 1} of {filteredTotal}
                  </span>
                  <button
                    onClick={() => {
                      if (idx < files.length - 1) setIdx(idx + 1)
                      else if (page < pages) goPage(page + 1)
                    }}
                    disabled={idx >= files.length - 1 && page >= pages}
                    className="btn-secondary text-xs px-4 py-2"
                  >
                    Next →
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default ASRAnnotate
