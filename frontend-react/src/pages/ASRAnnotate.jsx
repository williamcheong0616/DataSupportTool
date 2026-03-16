import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import WaveSurfer from 'wavesurfer.js'
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

const STATUS_COLORS = {
  pending: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  transcribing: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
  transcribed: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  annotating: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  completed: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
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

  // pagination
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [totalAll, setTotalAll] = useState(0)
  const [filteredTotal, setFilteredTotal] = useState(0)
  const [counts, setCounts] = useState({ pending: 0, transcribed: 0, completed: 0 })

  // fuse mode
  const [fuseMode, setFuseMode] = useState(false)
  const [selected, setSelected] = useState([])
  const [fusing, setFusing] = useState(false)

  // sorting
  const [sortBy, setSortBy] = useState('created_at')
  const [sortOrder, setSortOrder] = useState('asc')

  const cur = files[idx]

  // wavesurfer
  useEffect(() => {
    if (wsRef.current) { wsRef.current.destroy(); wsRef.current = null }
    if (!waveformRef.current || !cur) return

    setWaveReady(false); setWaveError(null); setCurTime(0); setDur(0)

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#c7d2fe', progressColor: '#6366f1', cursorColor: '#4f46e5',
      cursorWidth: 2, barWidth: 2, barGap: 1, barRadius: 2,
      height: 100, normalize: true, url: getAudioUrl(cur.id),
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

  // load dataset
  useEffect(() => {
    getASRDatasets()
      .then(res => {
        const ds = res.data.find(d => d.id === parseInt(datasetId))
        ds ? setDataset(ds) : navigate('/asr')
      })
      .catch(() => navigate('/asr'))
  }, [datasetId])

  // fetch files when page/filter/sort changes
  useEffect(() => {
    if (dataset) fetchFiles()
  }, [dataset, page, filter, sortBy, sortOrder])

  // sync transcript
  useEffect(() => {
    if (cur) setTranscript(cur.corrected_transcript || cur.whisper_transcript || '')
  }, [idx, files])

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
      setCounts({
        pending: res.data.pending || 0,
        transcribed: res.data.transcribed || 0,
        completed: res.data.completed || 0,
      })

      // jump to first incomplete
      const start = batch.findIndex(f => f.status !== 'completed')
      setIdx(start >= 0 ? start : 0)
    } catch (err) {
      console.error('Failed to load:', err)
    }
    setLoading(false)
  }

  function changeFilter(val) { setFilter(val); setPage(1); setIdx(0) }
  function changeSort(field) { setSortBy(field); setPage(1); setIdx(0) }
  function toggleSortOrder() { setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc'); setPage(1); setIdx(0) }
  function goPage(p) { if (p >= 1 && p <= pages) { setPage(p); setIdx(0) } }

  function fmtTime(s) {
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  }

  function playPause() { wsRef.current?.playPause() }
  function stop() { wsRef.current?.stop(); setCurTime(0) }
  function skip(s) {
    if (wsRef.current && dur > 0) {
      const t = Math.max(0, Math.min(dur, curTime + s))
      wsRef.current.seekTo(t / dur)
    }
  }

  async function doTranscribe(engine = 'whisper') {
    if (!cur) return
    const id = cur.id
    setTranscribing(true)
    try {
      const res = await transcribeAudio(id, engine)
      const taskId = res.data.task_id
      
      if (taskId) {
        // Poll until transcription completes
        try {
          const result = await pollTaskUntilDone(taskId, 2000, 150)
          
          if (result && result.status === 'success') {
            // Refresh the file list to get updated data
            await fetchFiles()
          }
        } catch (pollErr) {
          alert('Transcription may still be running. Refresh to check.')
        }
      }
    } catch (err) {
      alert('Transcribe failed: ' + (err.response?.data?.detail || err.message))
    }
    setTranscribing(false)
  }

  async function doRetranscribe(engine = 'whisper') {
    if (!cur || !confirm(`Re-transcribe with ${engine}? This clears the existing ${engine} transcription.`)) return
    const id = cur.id
    setTranscribing(true)
    try {
      const res = await retranscribeAudio(id, engine)
      const taskId = res.data.task_id
      
      if (taskId) {
        try {
          const result = await pollTaskUntilDone(taskId, 2000, 150)
          if (result && result.status === 'success') {
            await fetchFiles()
          }
        } catch (pollErr) {
          alert('Re-transcription may still be running. Refresh to check.')
        }
      }
    } catch (err) {
      alert('Re-transcribe failed: ' + (err.response?.data?.detail || err.message))
    }
    setTranscribing(false)
  }

  async function doDelete() {
    if (!cur || !confirm(`Delete "${cur.filename}"? Can't undo.`)) return
    try {
      await deleteAudioFile(cur.id)
      fetchFiles()
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.detail || err.message))
    }
  }

  function toggleFuse() { setFuseMode(!fuseMode); setSelected([]) }
  function toggleSelect(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function doFuse() {
    if (selected.length < 2) return alert('Select at least 2 files')
    if (!confirm(`Fuse ${selected.length} audio files into one?`)) return
    setFusing(true)
    try {
      const res = await fuseAudioFiles(selected)
      alert(`✓ Fused ${selected.length} files → ${res.data.filename} (${Math.round(res.data.duration)}s)`)
      setFuseMode(false); setSelected([])
      fetchFiles()
    } catch (err) {
      alert('Fuse failed: ' + (err.response?.data?.detail || err.message))
    }
    setFusing(false)
  }

  async function save() {
    if (!cur) return
    const id = cur.id
    setSaving(true)
    try {
      const annotator = localStorage.getItem('dst_username') || 'anonymous'
      await annotateTranscript(id, transcript, annotator)
      setFiles(prev => prev.map(f => f.id === id ? { ...f, corrected_transcript: transcript } : f))
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.detail || err.message))
    }
    setSaving(false)
  }

  async function markComplete() {
    if (!cur) return
    setSaving(true)
    try {
      const annotator = localStorage.getItem('dst_username') || 'anonymous'
      await annotateTranscript(cur.id, transcript, annotator)
      await updateFileStatus(cur.id, 'completed')

      // update locally
      setFiles(prev => prev.map(f => f.id === cur.id ? { ...f, corrected_transcript: transcript, status: 'completed' } : f))
      setCounts(c => ({ ...c, completed: c.completed + 1 }))

      // go to next incomplete
      let next = files.findIndex((f, i) => i > idx && f.status !== 'completed')
      if (next === -1) next = files.findIndex((f, i) => i < idx && f.status !== 'completed')
      if (next >= 0) setIdx(next)
      else if (idx < files.length - 1) setIdx(idx + 1)
    } catch (err) {
      alert('Failed: ' + (err.response?.data?.detail || err.message))
    }
    setSaving(false)
  }

  function onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); markComplete() }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save() }
  }

  // global keyboard shortcuts
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
      <div className="flex items-center justify-center h-64">
        <div className="w-12 h-12 border-b-2 border-indigo-600 rounded-full animate-spin" />
      </div>
    )
  }

  const pct = totalAll > 0 ? Math.round((counts.completed / totalAll) * 100) : 0

  return (
    <div>
      {/* header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <button onClick={() => navigate('/asr')} className="mb-2 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300">
            ← Back to Datasets
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{dataset?.name || 'ASR Annotation'}</h1>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={toggleFuse}
            className={`px-4 py-2 rounded-lg border transition ${fuseMode
              ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
            {fuseMode ? '✓ Fuse Mode' : '🔗 Fuse Audio'}
          </button>
          {fuseMode && selected.length >= 2 && (
            <button onClick={doFuse} disabled={fusing}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
              {fusing ? '⏳ Fusing...' : `⚡ Fuse ${selected.length}`}
            </button>
          )}
        </div>
      </div>

      {/* stats + filter bar */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{totalAll}</div>
              <div className="text-sm text-gray-500">Total Files</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-600 dark:text-gray-300">{counts.pending}</div>
              <div className="text-sm text-gray-500">Pending</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{counts.transcribed}</div>
              <div className="text-sm text-gray-500">Transcribed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">{counts.completed}</div>
              <div className="text-sm text-gray-500">Completed</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-500">Sort:</label>
              <select value={sortBy} onChange={e => changeSort(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="created_at">Date Added</option>
                <option value="filename">Filename</option>
                <option value="id">File ID</option>
              </select>
              <button onClick={toggleSortOrder}
                className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600">
                {sortOrder === 'asc' ? 'Asc' : 'Desc'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-500">Filter:</label>
              <select value={filter} onChange={e => changeFilter(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="all">All Files</option>
                <option value="pending">Pending</option>
                <option value="transcribed">Transcribed</option>
                <option value="annotating">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">{pct}%</span>
              <div className="w-32 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div className="bg-green-600 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {fuseMode && (
        <div className="mb-4 p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-lg">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🔗</span>
            <div className="flex-1">
              <h3 className="font-medium text-indigo-900 dark:text-indigo-200">Audio Fuse Mode</h3>
              <p className="text-sm text-indigo-700 dark:text-indigo-300 mt-1">Select 2+ files using checkboxes to concatenate them.</p>
            </div>
            <button onClick={toggleFuse} className="text-indigo-600 hover:text-indigo-800">✕</button>
          </div>
        </div>
      )}

      {files.length === 0 ? (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-lg shadow-md">
          <p className="mb-4 text-xl">No files found</p>
          <p>Upload audio files or change the filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* file list sidebar */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 h-fit">
            <h2 className="mb-3 font-semibold text-gray-900 dark:text-gray-100">
              Files
              <span className="ml-1 text-sm font-normal text-gray-500">
                ({filteredTotal}{filter !== 'all' ? ` ${filter}` : ''})
              </span>
              {fuseMode && selected.length > 0 && (
                <span className="ml-1 text-sm text-indigo-600 dark:text-indigo-400">— {selected.length} selected</span>
              )}
            </h2>
            <div className="space-y-2 max-h-[480px] overflow-y-auto">
              {files.map((file, i) => (
                <div key={file.id}
                  className={`relative w-full text-left p-3 rounded-lg border transition ${
                    i === idx ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 dark:border-indigo-400'
                      : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                  {fuseMode && (
                    <div className="absolute left-2 top-3">
                      <input type="checkbox" checked={selected.includes(file.id)} onChange={() => toggleSelect(file.id)}
                        className="w-4 h-4 text-indigo-600 rounded" onClick={e => e.stopPropagation()} />
                    </div>
                  )}
                  <button onClick={() => !fuseMode && setIdx(i)} className="w-full text-left" style={{ paddingLeft: fuseMode ? '24px' : 0 }}>
                    <div className="flex items-start justify-between">
                      <span className="flex-1 text-sm font-medium truncate dark:text-gray-100">{file.filename}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ml-2 ${STATUS_COLORS[file.status] || STATUS_COLORS.pending}`}>{file.status}</span>
                    </div>
                    {file.duration && <span className="text-xs text-gray-500 dark:text-gray-400">{fmtTime(file.duration)}</span>}
                  </button>
                </div>
              ))}
            </div>

            {/* pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                <button onClick={() => goPage(page - 1)} disabled={page === 1}
                  className="px-2 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50">Prev</button>
                <span className="text-sm text-gray-500">Page {page} / {pages}</span>
                <button onClick={() => goPage(page + 1)} disabled={page === pages}
                  className="px-2 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50">Next</button>
              </div>
            )}
          </div>

          {/* annotation area */}
          <div className="space-y-4 lg:col-span-2">
            {cur && (
              <>
                {/* audio player */}
                <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-gray-900 dark:text-gray-100">{cur.filename}</h2>
                    <div className="flex items-center space-x-2">
                      <span className={`text-sm px-3 py-1 rounded ${STATUS_COLORS[cur.status] || STATUS_COLORS.pending}`}>{cur.status}</span>
                      <div className="flex items-center space-x-1">
                        <button onClick={() => doRetranscribe('whisper')} disabled={transcribing}
                          className="px-2 py-1 text-xs text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50">
                          {transcribing ? '...' : '🔄 Whisper'}
                        </button>
                        <button onClick={() => doRetranscribe('qwen3')} disabled={transcribing}
                          className="px-2 py-1 text-xs text-purple-600 dark:text-purple-400 border border-purple-300 dark:border-purple-600 rounded hover:bg-purple-50 dark:hover:bg-purple-900/30 disabled:opacity-50">
                          {transcribing ? '...' : '🔄 Qwen3'}
                        </button>
                      </div>
                      <button onClick={doDelete}
                        className="px-2 py-1 text-xs text-red-600 dark:text-red-400 border border-red-300 dark:border-red-600 rounded hover:bg-red-50 dark:hover:bg-red-900/30">
                        🗑️ Delete
                      </button>
                    </div>
                  </div>

                  {/* waveform */}
                  <div className="mb-4">
                    <div ref={waveformRef} className="w-full rounded-lg bg-gray-50 dark:bg-gray-700" style={{ minHeight: '100px' }} />
                    {!waveReady && !waveError && (
                      <div className="flex items-center justify-center h-24 text-gray-400"><div className="animate-pulse">Loading waveform...</div></div>
                    )}
                    {waveError && (
                      <div className="mt-2">
                        <div className="mb-2 text-sm text-red-500">{waveError}</div>
                        <audio controls className="w-full" src={getAudioUrl(cur.id)}
                          onLoadedMetadata={e => setDur(e.target.duration)} onTimeUpdate={e => setCurTime(e.target.currentTime)} />
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between mb-3 text-sm text-gray-500 dark:text-gray-400">
                    <span>{fmtTime(curTime)}</span><span>{fmtTime(dur)}</span>
                  </div>

                  {/* controls */}
                  <div className="flex items-center justify-center mb-4 space-x-4">
                    <button onClick={() => skip(-5)} disabled={!waveReady}
                      className="p-2 bg-gray-100 dark:bg-gray-700 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">⏪ -5s</button>
                    <button onClick={playPause} disabled={!waveReady}
                      className="p-4 text-xl text-white bg-indigo-600 rounded-full hover:bg-indigo-700 disabled:opacity-50">{playing ? '⏸️' : '▶️'}</button>
                    <button onClick={stop} disabled={!waveReady}
                      className="p-2 bg-gray-100 dark:bg-gray-700 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">⏹️</button>
                    <button onClick={() => skip(5)} disabled={!waveReady}
                      className="p-2 bg-gray-100 dark:bg-gray-700 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">+5s ⏩</button>
                  </div>

                  <div className="flex items-center justify-center space-x-4">
                    <label className="text-sm text-gray-600 dark:text-gray-300">Speed:</label>
                    <div className="flex space-x-2">
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map(r => (
                        <button key={r} onClick={() => setRate(r)}
                          className={`px-2 py-1 text-sm rounded ${rate === r
                            ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'}`}>
                          {r}x
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-center text-gray-400 dark:text-gray-500">
                    <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">Space</kbd> play/pause · 
                    <kbd className="px-1 py-0.5 ml-1 bg-gray-100 dark:bg-gray-700 rounded">←</kbd>/<kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">→</kbd> skip 5s
                  </div>
                </div>

                {/* Transcript panels (Whisper + Qwen3 side by side) */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {/* Whisper transcript */}
                  <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="font-semibold text-gray-900 dark:text-gray-100">📝 Whisper</h2>
                      <div className="flex items-center space-x-2">
                        {cur.whisper_transcript && (
                          <button onClick={() => setTranscript(cur.whisper_transcript)}
                            className="px-2 py-1 text-xs text-indigo-600 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-600 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/30">
                            Use as base
                          </button>
                        )}
                        {!cur.whisper_transcript && cur.status === 'pending' && (
                          <button onClick={() => doTranscribe('whisper')} disabled={transcribing}
                            className="px-3 py-1 text-xs text-white bg-yellow-500 rounded hover:bg-yellow-600 disabled:opacity-50">
                            {transcribing ? '...' : '🎤 Run'}
                          </button>
                        )}
                      </div>
                    </div>
                    {cur.whisper_transcript ? (
                      <div className="p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700">
                        <p className="leading-relaxed text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{cur.whisper_transcript}</p>
                        {cur.whisper_language && (
                          <div className="mt-2 text-xs text-gray-400">Lang: {cur.whisper_language}{cur.whisper_confidence ? ` · Conf: ${(cur.whisper_confidence * 100).toFixed(0)}%` : ''}</div>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 text-center text-sm text-gray-400 border border-gray-300 dark:border-gray-600 border-dashed rounded-lg bg-gray-50 dark:bg-gray-700">
                        {cur.status === 'transcribing' ? '⏳ Processing...' : 'Not available'}
                      </div>
                    )}
                  </div>

                  {/* Qwen3 transcript */}
                  <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="font-semibold text-gray-900 dark:text-gray-100">🤖 Qwen3</h2>
                      <div className="flex items-center space-x-2">
                        {cur.qwen3_transcript && (
                          <button onClick={() => setTranscript(cur.qwen3_transcript)}
                            className="px-2 py-1 text-xs text-indigo-600 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-600 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/30">
                            Use as base
                          </button>
                        )}
                        {!cur.qwen3_transcript && (
                          <button onClick={() => doTranscribe('qwen3')} disabled={transcribing}
                            className="px-3 py-1 text-xs text-white bg-purple-500 rounded hover:bg-purple-600 disabled:opacity-50">
                            {transcribing ? '...' : '🎤 Run'}
                          </button>
                        )}
                      </div>
                    </div>
                    {cur.qwen3_transcript ? (
                      <div className="p-3 border border-purple-200 dark:border-purple-600 rounded-lg bg-purple-50 dark:bg-purple-900/20">
                        <p className="leading-relaxed text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{cur.qwen3_transcript}</p>
                        {cur.qwen3_language && (
                          <div className="mt-2 text-xs text-gray-400">Lang: {cur.qwen3_language}</div>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 text-center text-sm text-gray-400 border border-gray-300 dark:border-gray-600 border-dashed rounded-lg bg-gray-50 dark:bg-gray-700">
                        {cur.status === 'transcribing' ? '⏳ Processing...' : 'Not available — click "🎤 Run"'}
                      </div>
                    )}
                  </div>
                </div>

                {/* corrected transcript */}
                <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-gray-900 dark:text-gray-100">✏️ Corrected Transcription</h2>
                    <div className="flex items-center space-x-2">
                      {cur.corrected_transcript && (
                        <span className="px-2 py-1 text-xs text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 rounded">Saved</span>
                      )}
                      {cur.whisper_transcript && transcript !== cur.whisper_transcript && transcript !== cur.corrected_transcript && (
                        <span className="px-2 py-1 text-xs text-yellow-700 dark:text-yellow-300 bg-yellow-100 dark:bg-yellow-900/40 rounded">Unsaved</span>
                      )}
                    </div>
                  </div>

                  <textarea value={transcript} onChange={e => setTranscript(e.target.value)} onKeyDown={onKeyDown} rows={6}
                    placeholder="Edit transcript here..."
                    className="w-full px-3 py-2 leading-relaxed border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Corrected version will be saved as ground truth.</p>

                  <div className="flex items-center justify-between mt-4">
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">Ctrl+S</kbd> save · 
                      <kbd className="px-2 py-1 ml-1 bg-gray-100 dark:bg-gray-700 rounded">Ctrl+Enter</kbd> complete
                    </div>
                    <div className="flex space-x-2">
                      <button onClick={save} disabled={saving}
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={markComplete} disabled={saving}
                        className="px-4 py-2 text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50">
                        ✓ Complete
                      </button>
                    </div>
                  </div>
                </div>

                {/* record navigation */}
                <div className="flex justify-between">
                  <button onClick={() => idx > 0 && setIdx(idx - 1)} disabled={idx === 0}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
                    ← Previous
                  </button>
                  <span className="py-2 text-gray-600 dark:text-gray-400">
                    {(page - 1) * PER_PAGE + idx + 1} of {filteredTotal}
                  </span>
                  <button onClick={() => {
                    if (idx < files.length - 1) setIdx(idx + 1)
                    else if (page < pages) goPage(page + 1)
                  }} disabled={idx >= files.length - 1 && page >= pages}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
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
