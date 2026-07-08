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
import ActionChip from '../components/ActionChip'

const STATUS_CFG = {
  pending:      { label: 'Pending',     color: 'var(--text-dim)' },
  transcribing: { label: 'Processing',  color: 'var(--amber)' },
  transcribed:  { label: 'Transcribed', color: 'var(--accent)' },
  annotating:   { label: 'In Progress', color: '#a78bfa' },
  completed:    { label: 'Completed',   color: 'var(--green)' },
}

function StatusChip({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.pending
  return (
    <span
      className="dst-badge"
      style={{ background: `color-mix(in srgb, ${cfg.color} 18%, transparent)`, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

function Kbd({ children }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={{ fontFamily: 'var(--mono)', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}>
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
      waveColor: '#353c52',      // border-hi
      progressColor: '#4a9eff',  // accent
      cursorColor: '#e8eaf0',    // text-hi
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
          style={{ borderTopColor: 'var(--accent)', borderRightColor: 'var(--accent)' }} />
        <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Loading files…</p>
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
            style={{ color: 'var(--text-dim)' }}
            onMouseOver={e => e.currentTarget.style.color = 'var(--accent)'}
            onMouseOut={e => e.currentTarget.style.color = 'var(--text-dim)'}
          >
            <ArrowLeft size={14} /> Back to Datasets
          </button>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>
            {dataset?.name || 'ASR Annotation'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFuse}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded transition-colors border"
            style={fuseMode
              ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-text)' }
              : { borderColor: 'var(--border-hi)', color: 'var(--text-hi)' }}
          >
            <Link2 size={13} /> {fuseMode ? 'Fuse Mode On' : 'Fuse Audio'}
          </button>
          {fuseMode && selected.length >= 2 && (
            <button
              onClick={doFuse}
              disabled={fusing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded text-white disabled:opacity-50 transition-colors"
              style={{ background: 'var(--green)', fontFamily: 'var(--mono)' }}
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
              { label: 'Total', val: totalAll, color: 'var(--accent)' },
              { label: 'Pending', val: counts.pending, color: 'var(--text-dim)' },
              { label: 'Transcribed', val: counts.transcribed, color: 'var(--accent)' },
              { label: 'Completed', val: counts.completed, color: 'var(--green)' },
            ].map(({ label, val, color }) => (
              <div key={label} className="text-center">
                <div className="text-xl font-bold" style={{ fontFamily: 'var(--mono)', color }}>{val}</div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-dim)' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-dim)' }}>
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
                style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}
              >
                {sortOrder === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                {sortOrder === 'asc' ? 'Asc' : 'Desc'}
              </button>
            </div>

            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-dim)' }}>
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
              <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-dim)' }}>{pct}%</span>
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
          className="flex items-center gap-3 px-4 py-3 rounded text-sm"
          style={{ background: 'var(--accent-dim)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}
        >
          <Link2 size={15} style={{ color: 'var(--accent)' }} />
          <div style={{ color: 'var(--text-hi)' }}>
            <span className="font-semibold">Fuse mode active</span>
            <span className="ml-2" style={{ color: 'var(--text-dim)' }}>Select 2+ files using checkboxes to concatenate them.</span>
            {selected.length > 0 && <span className="ml-2 font-medium" style={{ color: 'var(--accent)' }}>{selected.length} selected</span>}
          </div>
          <button onClick={toggleFuse} className="ml-auto opacity-50 hover:opacity-100 text-base leading-none">×</button>
        </div>
      )}

      {files.length === 0 ? (
        <div className="surface p-12 text-center">
          <p className="text-sm font-medium" style={{ color: 'var(--text-hi)' }}>No files found</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-dim)' }}>Upload audio files or change the filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">

          {/* ── File list sidebar ─────────────────────────── */}
          <div className="surface p-4 h-fit lg:sticky lg:top-20">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold" style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>
                Files
              </h2>
              <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
                {filteredTotal}{filter !== 'all' ? ` ${filter}` : ''} total
                {fuseMode && selected.length > 0 && (
                  <span className="ml-1.5 font-medium" style={{ color: 'var(--accent)' }}>· {selected.length} selected</span>
                )}
              </span>
            </div>

            <div className="space-y-1 max-h-[500px] overflow-y-auto -mx-1 px-1">
              {files.map((file, i) => {
                const isActive = i === idx
                return (
                  <div
                    key={file.id}
                    className="relative rounded transition-colors"
                    style={{
                      background: isActive ? 'var(--accent-dim)' : undefined,
                      border: `1px solid ${isActive ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border)'}`,
                    }}
                  >
                    {fuseMode && (
                      <div className="absolute left-2.5 top-3">
                        <input
                          type="checkbox"
                          checked={selected.includes(file.id)}
                          onChange={() => toggleSelect(file.id)}
                          className="w-3.5 h-3.5 rounded"
                          style={{ accentColor: 'var(--accent)' }}
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
                        <span className="text-xs font-medium truncate flex-1" style={{ color: 'var(--text-hi)' }}>
                          {file.filename}
                        </span>
                        <StatusChip status={file.status} />
                      </div>
                      {file.duration && (
                        <span className="text-[11px] mt-0.5 block" style={{ color: 'var(--text-dim)' }}>
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
                style={{ borderTop: '1px solid var(--border)' }}
              >
                <button
                  onClick={() => goPage(page - 1)}
                  disabled={page === 1}
                  className="px-2 py-1 text-xs rounded transition-colors disabled:opacity-40"
                  style={{ background: 'var(--bg-input)', color: 'var(--text-hi)' }}
                >
                  Prev
                </button>
                <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
                  {page} / {pages}
                </span>
                <button
                  onClick={() => goPage(page + 1)}
                  disabled={page === pages}
                  className="px-2 py-1 text-xs rounded transition-colors disabled:opacity-40"
                  style={{ background: 'var(--bg-input)', color: 'var(--text-hi)' }}
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
                      <h2 className="text-sm font-bold truncate" style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>
                        {cur.filename}
                      </h2>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusChip status={cur.status} />
                      <ActionChip
                        onClick={() => doRetranscribe('whisper')}
                        disabled={transcribing}
                        color="var(--accent)"
                        icon={RefreshCw}
                        title="Re-transcribe with Whisper"
                      >
                        Whisper
                      </ActionChip>
                      <ActionChip
                        onClick={() => doRetranscribe('qwen3')}
                        disabled={transcribing}
                        color="#a78bfa"
                        icon={RefreshCw}
                        title="Re-transcribe with Qwen3"
                      >
                        Qwen3
                      </ActionChip>
                      <ActionChip onClick={doDelete} color="var(--red)" icon={Trash2}>
                        Delete
                      </ActionChip>
                    </div>
                  </div>

                  {/* Waveform */}
                  <div className="rounded overflow-hidden mb-3" style={{ background: 'var(--bg-input)' }}>
                    <div ref={waveformRef} style={{ minHeight: '80px' }} />
                    {!waveReady && !waveError && (
                      <div className="flex items-center justify-center h-20 gap-2 text-xs" style={{ color: 'var(--text-dim)' }}>
                        <div className="w-4 h-4 rounded-full border border-transparent animate-spin"
                          style={{ borderTopColor: 'var(--accent)', borderRightColor: 'var(--accent)' }} />
                        Loading waveform…
                      </div>
                    )}
                  </div>
                  {waveError && (
                    <div className="mb-3">
                      <p className="text-xs mb-2" style={{ color: 'var(--red)' }}>{waveError}</p>
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
                  <div className="flex justify-between text-xs mb-4 tabular-nums" style={{ color: 'var(--text-dim)' }}>
                    <span>{fmtTime(curTime)}</span>
                    <span>{fmtTime(dur)}</span>
                  </div>

                  {/* Playback controls */}
                  <div className="flex items-center justify-center gap-3 mb-4">
                    <button
                      onClick={() => skip(-5)}
                      disabled={!waveReady}
                      className="flex items-center gap-1 px-3 py-2 rounded text-xs font-medium transition-colors disabled:opacity-40"
                      style={{ background: 'var(--bg-input)', color: 'var(--text-hi)' }}
                    >
                      <SkipBack size={13} /> −5s
                    </button>
                    <button
                      onClick={playPause}
                      disabled={!waveReady}
                      className="w-11 h-11 rounded-full flex items-center justify-center text-white transition-all disabled:opacity-40 hover:brightness-110 active:scale-95"
                      style={{ background: 'var(--accent)' }}
                    >
                      {playing ? <Pause size={18} /> : <Play size={18} />}
                    </button>
                    <button
                      onClick={stop}
                      disabled={!waveReady}
                      className="w-8 h-8 rounded flex items-center justify-center transition-colors disabled:opacity-40"
                      style={{ background: 'var(--bg-input)', color: 'var(--text-hi)' }}
                    >
                      <Square size={13} />
                    </button>
                    <button
                      onClick={() => skip(5)}
                      disabled={!waveReady}
                      className="flex items-center gap-1 px-3 py-2 rounded text-xs font-medium transition-colors disabled:opacity-40"
                      style={{ background: 'var(--bg-input)', color: 'var(--text-hi)' }}
                    >
                      +5s <SkipForward size={13} />
                    </button>
                  </div>

                  {/* Speed */}
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Speed</span>
                    <div className="flex gap-1">
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map(r => (
                        <button
                          key={r}
                          onClick={() => setRate(r)}
                          className="px-2 py-0.5 rounded text-xs font-medium transition-colors"
                          style={{
                            background: rate === r ? 'var(--accent)' : 'var(--bg-input)',
                            color: rate === r ? '#fff' : 'var(--text-dim)',
                          }}
                        >
                          {r}×
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Keyboard hints */}
                  <p className="mt-3 text-center text-[11px]" style={{ color: 'var(--text-dim)' }}>
                    <Kbd>Space</Kbd> play/pause &nbsp;·&nbsp;
                    <Kbd>←</Kbd> <Kbd>→</Kbd> skip 5s
                  </p>
                </div>

                {/* Transcript panels (Whisper + Qwen3) */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {/* Whisper */}
                  <div className="surface p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-bold uppercase tracking-widest" style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
                        Whisper
                      </p>
                      <div className="flex gap-1.5">
                        {cur.whisper_transcript && (
                          <button
                            onClick={() => setTranscript(cur.whisper_transcript)}
                            className="px-2 py-0.5 text-xs font-medium rounded transition-colors"
                            style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                          >
                            Use as base
                          </button>
                        )}
                        {!cur.whisper_transcript && cur.status === 'pending' && (
                          <button
                            onClick={() => doTranscribe('whisper')}
                            disabled={transcribing}
                            className="px-2 py-0.5 text-xs font-medium rounded disabled:opacity-50 transition-colors"
                            style={{ background: 'var(--amber-dim)', color: 'var(--amber)', fontFamily: 'var(--mono)' }}
                          >
                            {transcribing ? '…' : 'Run'}
                          </button>
                        )}
                      </div>
                    </div>
                    {cur.whisper_transcript ? (
                      <div className="p-3 rounded" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-hi)' }}>{cur.whisper_transcript}</p>
                        {cur.whisper_language && (
                          <p className="mt-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>
                            Lang: {cur.whisper_language}{cur.whisper_confidence ? ` · Conf: ${(cur.whisper_confidence * 100).toFixed(0)}%` : ''}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div
                        className="p-3 rounded text-center text-xs border-dashed border"
                        style={{ color: 'var(--text-dim)', background: 'var(--bg-input)', borderColor: 'var(--border-hi)' }}
                      >
                        {cur.status === 'transcribing' ? 'Processing…' : 'Not available'}
                      </div>
                    )}
                  </div>

                  {/* Qwen3 */}
                  <div className="surface p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-bold uppercase tracking-widest" style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
                        Qwen3 ASR
                      </p>
                      <div className="flex gap-1.5">
                        {cur.qwen3_transcript && (
                          <button
                            onClick={() => setTranscript(cur.qwen3_transcript)}
                            className="px-2 py-0.5 text-xs font-medium rounded transition-colors"
                            style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                          >
                            Use as base
                          </button>
                        )}
                        {!cur.qwen3_transcript && (
                          <button
                            onClick={() => doTranscribe('qwen3')}
                            disabled={transcribing}
                            className="px-2 py-0.5 text-xs font-medium rounded disabled:opacity-50 transition-colors"
                            style={{ background: 'color-mix(in srgb, #a78bfa 20%, transparent)', color: '#a78bfa', fontFamily: 'var(--mono)' }}
                          >
                            {transcribing ? '…' : 'Run'}
                          </button>
                        )}
                      </div>
                    </div>
                    {cur.qwen3_transcript ? (
                      <div className="p-3 rounded" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-hi)' }}>{cur.qwen3_transcript}</p>
                        {cur.qwen3_language && (
                          <p className="mt-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>Lang: {cur.qwen3_language}</p>
                        )}
                      </div>
                    ) : (
                      <div
                        className="p-3 rounded text-center text-xs border-dashed border"
                        style={{ color: 'var(--text-dim)', background: 'var(--bg-input)', borderColor: 'var(--border-hi)' }}
                      >
                        {cur.status === 'transcribing' ? 'Processing…' : 'Not yet run — click Run to start'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Corrected transcript */}
                <div className="surface p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
                      Corrected Transcription
                    </p>
                    <div className="flex gap-1.5">
                      {cur.corrected_transcript && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded"
                          style={{ background: 'var(--accent-dim)', color: 'var(--accent)', fontFamily: 'var(--mono)' }}>
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
                  <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>
                    This corrected version will be saved as ground truth.
                  </p>

                  <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
                    <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-dim)' }}>
                      <Kbd>Ctrl+S</Kbd> save &nbsp;
                      <Kbd>Ctrl+↵</Kbd> complete &nbsp;
                      <Kbd>Ctrl+H</Kbd> find/replace
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowFindReplace(prev => !prev)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border transition-colors"
                        style={showFindReplace
                          ? { background: 'var(--amber-dim)', borderColor: 'var(--amber)', color: 'var(--amber)' }
                          : { borderColor: 'var(--border-hi)', color: 'var(--text-hi)' }}
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
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded text-white disabled:opacity-50 transition-colors"
                        style={{ background: 'var(--green)', fontFamily: 'var(--mono)' }}
                      >
                        <CheckCircle2 size={12} /> Complete
                      </button>
                    </div>
                  </div>

                  {/* Find & Replace Panel */}
                  {showFindReplace && (
                    <div
                      className="mt-4 p-4 rounded"
                      style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-bold uppercase tracking-widest" style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
                          Find & Replace
                        </p>
                        <button
                          onClick={() => setShowFindReplace(false)}
                          className="text-xs opacity-50 hover:opacity-80"
                          style={{ color: 'var(--text-hi)' }}
                        >
                          Close
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text-dim)' }}>Find</label>
                          <input
                            type="text"
                            value={findText}
                            onChange={e => setFindText(e.target.value)}
                            placeholder="Word to find…"
                            className="form-input text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text-dim)' }}>Replace with</label>
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
                          <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-dim)' }}>
                            <input
                              type="checkbox"
                              checked={caseSensitive}
                              onChange={e => setCaseSensitive(e.target.checked)}
                              className="w-3.5 h-3.5 rounded"
                          style={{ accentColor: 'var(--accent)' }}
                            />
                            Case sensitive
                          </label>
                          {findText && (
                            <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
                              {matchCount} match{matchCount !== 1 ? 'es' : ''}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={doReplaceAll}
                          disabled={!findText || matchCount === 0}
                          className="px-3 py-1.5 text-xs font-semibold rounded text-white disabled:opacity-50 transition-colors"
                          style={{ background: 'var(--amber)', color: '#000', fontFamily: 'var(--mono)' }}
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
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-dim)' }}>
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
