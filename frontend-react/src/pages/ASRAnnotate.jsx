import React, { useState, useEffect, useRef, useCallback } from 'react'
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
} from '../api'

const STATUS_COLORS = {
  pending: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  transcribing: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
  transcribed: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  annotating: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  completed: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
}

function ASRAnnotate() {
  const { datasetId } = useParams()
  const navigate = useNavigate()
  const waveformRef = useRef(null)
  const wavesurferRef = useRef(null)
  
  const [dataset, setDataset] = useState(null)
  const [files, setFiles] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [waveformReady, setWaveformReady] = useState(false)
  const [waveformError, setWaveformError] = useState(null)
  
  // Audio fusing states
  const [fuseMode, setFuseMode] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState([])
  const [fusing, setFusing] = useState(false)

  const currentFile = files[currentIndex]

  // Initialize WaveSurfer when currentFile changes
  useEffect(() => {
    // Cleanup previous instance
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy()
      wavesurferRef.current = null
    }

    if (!waveformRef.current || !currentFile) return

    setWaveformReady(false)
    setWaveformError(null)
    setCurrentTime(0)
    setDuration(0)

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#c7d2fe',
      progressColor: '#6366f1',
      cursorColor: '#4f46e5',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 100,
      normalize: true,
      url: getAudioUrl(currentFile.id),
    })

    wavesurferRef.current = ws

    ws.on('ready', () => {
      setWaveformReady(true)
      setDuration(ws.getDuration())
    })

    ws.on('timeupdate', (time) => {
      setCurrentTime(time)
    })

    ws.on('play', () => setIsPlaying(true))
    ws.on('pause', () => setIsPlaying(false))
    ws.on('finish', () => setIsPlaying(false))

    ws.on('error', (err) => {
      console.error('WaveSurfer error:', err)
      setWaveformError('Failed to load audio waveform')
    })

    return () => {
      ws.destroy()
    }
  }, [currentFile?.id])

  // Update playback rate
  useEffect(() => {
    if (wavesurferRef.current && waveformReady) {
      wavesurferRef.current.setPlaybackRate(playbackRate)
    }
  }, [playbackRate, waveformReady])

  useEffect(() => {
    fetchDataset()
  }, [datasetId])

  useEffect(() => {
    if (dataset) {
      fetchFiles()
    }
  }, [dataset, statusFilter])

  useEffect(() => {
    if (files[currentIndex]) {
      setTranscript(
        files[currentIndex].corrected_transcript || 
        files[currentIndex].whisper_transcript || 
        ''
      )
    }
  }, [currentIndex, files])

  const fetchDataset = async () => {
    try {
      const res = await getASRDatasets()
      const ds = res.data.find(d => d.id === parseInt(datasetId))
      if (ds) {
        setDataset(ds)
      } else {
        navigate('/asr')
      }
    } catch (err) {
      console.error('Failed to fetch dataset:', err)
      navigate('/asr')
    }
  }

  const fetchFiles = async (preserveIndex = false, targetIndex = null) => {
    setLoading(true)
    try {
      const status = statusFilter === 'all' ? null : statusFilter
      const res = await getAudioFiles(datasetId, status, 100)
      const fetchedFiles = res.data.files || []
      setFiles(fetchedFiles)
      
      if (preserveIndex && targetIndex !== null && targetIndex < fetchedFiles.length) {
        // Use the target index provided (for navigation after mark complete)
        setCurrentIndex(targetIndex)
      } else if (!preserveIndex) {
        // Find the first file that's not completed to start from
        let startIndex = 0
        if (fetchedFiles.length > 0) {
          const firstIncompleteIndex = fetchedFiles.findIndex(f => f.status !== 'completed')
          // If found, start there; otherwise start at the beginning
          startIndex = firstIncompleteIndex >= 0 ? firstIncompleteIndex : 0
        }
        setCurrentIndex(startIndex)
      }
      // If preserveIndex is true but no targetIndex, keep the current index
      
      return fetchedFiles
    } catch (err) {
      console.error('Failed to fetch files:', err)
      return []
    } finally {
      setLoading(false)
    }
  }

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handlePlayPause = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause()
    }
  }

  const handleStop = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.stop()
      setCurrentTime(0)
    }
  }

  const handleSkip = (seconds) => {
    if (wavesurferRef.current && duration > 0) {
      const newTime = Math.max(0, Math.min(duration, currentTime + seconds))
      wavesurferRef.current.seekTo(newTime / duration)
    }
  }

  const handleTranscribe = async () => {
    if (!currentFile) return
    const currentFileId = currentFile.id
    setTranscribing(true)
    try {
      const res = await transcribeAudio(currentFile.id)
      // Response contains transcript directly now (synchronous mode)
      setTranscript(res.data.transcript || res.data.whisper_transcript || '')
      // Update the current file in the list without changing position
      setFiles(prevFiles => {
        const updatedFiles = [...prevFiles]
        const fileIndex = updatedFiles.findIndex(f => f.id === currentFileId)
        if (fileIndex >= 0) {
          updatedFiles[fileIndex] = {
            ...updatedFiles[fileIndex],
            whisper_transcript: res.data.transcript || res.data.whisper_transcript,
            whisper_language: res.data.language || res.data.whisper_language,
            whisper_confidence: res.data.confidence || res.data.whisper_confidence,
            status: 'transcribed',
            transcribed_at: new Date().toISOString(),
          }
        }
        return updatedFiles
      })
    } catch (err) {
      alert('Failed to transcribe: ' + (err.response?.data?.detail || err.message))
    } finally {
      setTranscribing(false)
    }
  }

  const handleRetranscribe = async () => {
    if (!currentFile) return
    if (!confirm('This will clear the existing transcription and re-transcribe the audio. Continue?')) return
    const currentFileId = currentFile.id
    setTranscribing(true)
    try {
      const res = await retranscribeAudio(currentFile.id)
      setTranscript(res.data.transcript || res.data.whisper_transcript || '')
      // Update the current file in the list without changing position
      setFiles(prevFiles => {
        const updatedFiles = [...prevFiles]
        const fileIndex = updatedFiles.findIndex(f => f.id === currentFileId)
        if (fileIndex >= 0) {
          updatedFiles[fileIndex] = {
            ...updatedFiles[fileIndex],
            whisper_transcript: res.data.transcript || res.data.whisper_transcript,
            whisper_language: res.data.language || res.data.whisper_language,
            whisper_confidence: res.data.confidence || res.data.whisper_confidence,
            status: 'transcribed',
            transcribed_at: new Date().toISOString(),
          }
        }
        return updatedFiles
      })
    } catch (err) {
      alert('Failed to re-transcribe: ' + (err.response?.data?.detail || err.message))
    } finally {
      setTranscribing(false)
    }
  }

  const handleDelete = async () => {
    if (!currentFile) return
    if (!confirm(`Delete "${currentFile.filename}"? This cannot be undone.`)) return
    
    try {
      await deleteAudioFile(currentFile.id)
      // Navigate to next file or previous if at end
      const newIndex = currentIndex >= files.length - 1 ? Math.max(0, currentIndex - 1) : currentIndex
      await fetchFiles(false)
      if (files.length > 1) {
        setCurrentIndex(Math.min(newIndex, files.length - 2))
      }
    } catch (err) {
      alert('Failed to delete: ' + (err.response?.data?.detail || err.message))
    }
  }

  const toggleFuseMode = () => {
    setFuseMode(!fuseMode)
    setSelectedFiles([])
  }

  const toggleFileSelection = (fileId) => {
    setSelectedFiles(prev => 
      prev.includes(fileId) 
        ? prev.filter(id => id !== fileId)
        : [...prev, fileId]
    )
  }

  const handleFuseSelected = async () => {
    if (selectedFiles.length < 2) {
      alert('Please select at least 2 files to fuse')
      return
    }
    
    if (!confirm(`Fuse ${selectedFiles.length} selected audio files into one?\n\nFiles will be concatenated in the order they were selected.`)) return
    
    setFusing(true)
    try {
      const res = await fuseAudioFiles(selectedFiles)
      alert(`✓ Successfully fused ${selectedFiles.length} files!\n\nNew file: ${res.data.filename}\nDuration: ${Math.round(res.data.duration)}s`)
      setFuseMode(false)
      setSelectedFiles([])
      await fetchFiles(false)
    } catch (err) {
      alert('Failed to fuse files: ' + (err.response?.data?.detail || err.message))
    } finally {
      setFusing(false)
    }
  }

  const handleSave = async () => {
    if (!currentFile) return
    const currentFileId = currentFile.id
    setSaving(true)
    try {
      await annotateTranscript(currentFile.id, transcript)
      // Update the current file in the list without changing position
      setFiles(prevFiles => {
        const updatedFiles = [...prevFiles]
        const fileIndex = updatedFiles.findIndex(f => f.id === currentFileId)
        if (fileIndex >= 0) {
          updatedFiles[fileIndex] = {
            ...updatedFiles[fileIndex],
            corrected_transcript: transcript,
          }
        }
        return updatedFiles
      })
    } catch (err) {
      alert('Failed to save: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSaving(false)
    }
  }

  const handleMarkComplete = async () => {
    if (!currentFile) return
    setSaving(true)
    try {
      // Save transcript first
      await annotateTranscript(currentFile.id, transcript)
      // Then mark as completed
      await updateFileStatus(currentFile.id, 'completed')
      
      // Refresh file list and find next incomplete file
      const updatedFiles = await fetchFiles(true, null)
      
      // Find next incomplete file starting from current position
      let nextIndex = -1
      for (let i = currentIndex + 1; i < updatedFiles.length; i++) {
        if (updatedFiles[i].status !== 'completed') {
          nextIndex = i
          break
        }
      }
      
      // If no incomplete file found after current, check from beginning
      if (nextIndex === -1) {
        for (let i = 0; i < currentIndex; i++) {
          if (updatedFiles[i].status !== 'completed') {
            nextIndex = i
            break
          }
        }
      }
      
      // Navigate to next incomplete file, or stay at current + 1 if all complete
      if (nextIndex >= 0) {
        setCurrentIndex(nextIndex)
      } else if (currentIndex < updatedFiles.length - 1) {
        setCurrentIndex(currentIndex + 1)
      }
      // If we're at the last file and all are complete, stay there
      
    } catch (err) {
      alert('Failed to complete: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e) => {
    // Ctrl/Cmd + Enter to save and mark complete
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleMarkComplete()
    }
    // Ctrl/Cmd + S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }

  // Keyboard shortcuts for audio control
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Only if not typing in textarea
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return
      
      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handlePlayPause()
      }
      // Arrow left/right to skip
      if (e.code === 'ArrowLeft') {
        e.preventDefault()
        handleSkip(-5)
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault()
        handleSkip(5)
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [waveformReady, duration, currentTime])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-12 h-12 border-b-2 border-indigo-600 rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <button
            onClick={() => navigate('/asr')}
            className="mb-2 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300"
          >
            ← Back to Datasets
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {dataset?.name || 'ASR Annotation'}
          </h1>
        </div>
        <div className="flex items-center space-x-4">
          <button
            onClick={toggleFuseMode}
            className={`px-4 py-2 rounded-lg border transition ${
              fuseMode
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            {fuseMode ? '✓ Fuse Mode Active' : '🔗 Fuse Audio'}
          </button>
          {fuseMode && selectedFiles.length >= 2 && (
            <button
              onClick={handleFuseSelected}
              disabled={fusing}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              {fusing ? '⏳ Fusing...' : `⚡ Fuse ${selectedFiles.length} Selected`}
            </button>
          )}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg"
          >
            <option value="all">All Files</option>
            <option value="pending">Pending</option>
            <option value="transcribed">Transcribed</option>
            <option value="annotating">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-lg shadow-md">
          <p className="mb-4 text-xl">No files found</p>
          <p>Upload audio files or change the filter to see files.</p>
        </div>
      ) : (
        <>
          {fuseMode && (
            <div className="mb-4 p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="text-2xl">🔗</span>
                <div className="flex-1">
                  <h3 className="font-medium text-indigo-900 dark:text-indigo-200">Audio Fuse Mode Active</h3>
                  <p className="text-sm text-indigo-700 dark:text-indigo-300 mt-1">
                    Select 2 or more audio files from the list using checkboxes. They will be concatenated in the
                    order selected. The fused file will be added to this dataset.
                  </p>
                </div>
                <button
                  onClick={toggleFuseMode}
                  className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* File List */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 h-fit lg:max-h-[600px] overflow-y-auto">
            <h2 className="mb-3 font-semibold text-gray-900 dark:text-gray-100">
              Files ({files.length})
              {fuseMode && selectedFiles.length > 0 && (
                <span className="ml-2 text-sm text-indigo-600 dark:text-indigo-400">
                  ({selectedFiles.length} selected)
                </span>
              )}
            </h2>
            <div className="space-y-2">
              {files.map((file, index) => (
                <div
                  key={file.id}
                  className={`relative w-full text-left p-3 rounded-lg border transition ${
                    index === currentIndex
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 dark:border-indigo-400'
                      : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {fuseMode && (
                    <div className="absolute left-2 top-3">
                      <input
                        type="checkbox"
                        checked={selectedFiles.includes(file.id)}
                        onChange={() => toggleFileSelection(file.id)}
                        className="w-4 h-4 text-indigo-600 rounded focus:ring-2 focus:ring-indigo-500"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  )}
                  <button
                    onClick={() => !fuseMode && setCurrentIndex(index)}
                    className="w-full text-left"
                    style={{ paddingLeft: fuseMode ? '24px' : '0px' }}
                  >
                    <div className="flex items-start justify-between">
                      <span className="flex-1 text-sm font-medium truncate dark:text-gray-100">
                        {file.filename}
                      </span>
                      <span
                        className={`text-xs px-2 py-1 rounded ml-2 ${
                          STATUS_COLORS[file.status] || STATUS_COLORS.pending
                        }`}
                      >
                        {file.status}
                      </span>
                    </div>
                    {file.duration && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {Math.floor(file.duration / 60)}:{String(Math.floor(file.duration % 60)).padStart(2, '0')}
                      </span>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Annotation Area */}
          <div className="space-y-4 lg:col-span-2">
            {currentFile && (
              <>
                {/* Audio Player with Waveform */}
                <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                      {currentFile.filename}
                    </h2>
                    <div className="flex items-center space-x-2">
                      <span
                        className={`text-sm px-3 py-1 rounded ${
                          STATUS_COLORS[currentFile.status] || STATUS_COLORS.pending
                        }`}
                      >
                        {currentFile.status}
                      </span>
                      <button
                        onClick={handleRetranscribe}
                        disabled={transcribing}
                        className="px-2 py-1 text-xs text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 disabled:opacity-50"
                        title="Re-transcribe audio"
                      >
                        {transcribing ? '...' : '🔄 Re-transcribe'}
                      </button>
                      <button
                        onClick={handleDelete}
                        className="px-2 py-1 text-xs text-red-600 dark:text-red-400 border border-red-300 dark:border-red-600 rounded hover:bg-red-50 dark:hover:bg-red-900/30"
                        title="Delete this audio file"
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                  
                  {/* Waveform */}
                  <div className="mb-4">
                    <div 
                      ref={waveformRef} 
                      className="w-full rounded-lg bg-gray-50 dark:bg-gray-700"
                      style={{ minHeight: '100px' }}
                    />
                    {!waveformReady && !waveformError && (
                      <div className="flex items-center justify-center h-24 text-gray-400">
                        <div className="animate-pulse">Loading waveform...</div>
                      </div>
                    )}
                    {waveformError && (
                      <div className="mt-2">
                        <div className="mb-2 text-sm text-red-500">{waveformError}</div>
                        <audio
                          controls
                          className="w-full"
                          src={getAudioUrl(currentFile.id)}
                          onLoadedMetadata={(e) => setDuration(e.target.duration)}
                          onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
                        />
                      </div>
                    )}
                  </div>

                  {/* Time Display */}
                  <div className="flex justify-between mb-3 text-sm text-gray-500 dark:text-gray-400">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>

                  {/* Playback Controls */}
                  <div className="flex items-center justify-center mb-4 space-x-4">
                    <button
                      onClick={() => handleSkip(-5)}
                      disabled={!waveformReady}
                      className="p-2 bg-gray-100 dark:bg-gray-700 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                      title="Rewind 5s"
                    >
                      ⏪ -5s
                    </button>
                    <button
                      onClick={handlePlayPause}
                      disabled={!waveformReady}
                      className="p-4 text-xl text-white bg-indigo-600 rounded-full hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {isPlaying ? '⏸️' : '▶️'}
                    </button>
                    <button
                      onClick={handleStop}
                      disabled={!waveformReady}
                      className="p-2 bg-gray-100 dark:bg-gray-700 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                      title="Stop"
                    >
                      ⏹️
                    </button>
                    <button
                      onClick={() => handleSkip(5)}
                      disabled={!waveformReady}
                      className="p-2 bg-gray-100 dark:bg-gray-700 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                      title="Forward 5s"
                    >
                      +5s ⏩
                    </button>
                  </div>
                  
                  {/* Playback Speed */}
                  <div className="flex items-center justify-center space-x-4">
                    <label className="text-sm text-gray-600 dark:text-gray-300">Speed:</label>
                    <div className="flex space-x-2">
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                        <button
                          key={rate}
                          onClick={() => setPlaybackRate(rate)}
                          className={`px-2 py-1 text-sm rounded ${
                            playbackRate === rate
                              ? 'bg-indigo-600 text-white'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-center text-gray-400 dark:text-gray-500">
                    Press <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">Space</kbd> to play/pause (when not typing)
                  </div>
                </div>

                {/* Original Transcription */}
                <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                      <span className="mr-2">📝</span>
                      Original Transcription (Whisper)
                    </h2>
                    <div className="flex items-center space-x-2">
                      {currentFile.corrected_transcript && currentFile.corrected_transcript !== currentFile.whisper_transcript && (
                        <span className="px-2 py-1 text-xs text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/40 rounded">
                          ✓ Has correction saved
                        </span>
                      )}
                      {(!currentFile.whisper_transcript && currentFile.status === 'pending') && (
                        <button
                          onClick={handleTranscribe}
                          disabled={transcribing}
                          className="px-4 py-2 text-white bg-yellow-500 rounded-lg hover:bg-yellow-600 disabled:opacity-50"
                        >
                          {transcribing ? 'Transcribing...' : '🎤 Run Whisper'}
                        </button>
                      )}
                    </div>
                  </div>

                  {currentFile.whisper_transcript ? (
                    <div className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700">
                      <p className="leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {currentFile.whisper_transcript}
                      </p>
                    </div>
                  ) : (
                    <div className="p-4 text-center text-gray-400 dark:text-gray-500 border border-gray-300 dark:border-gray-600 border-dashed rounded-lg bg-gray-50 dark:bg-gray-700">
                      {currentFile.status === 'transcribing' 
                        ? '⏳ Transcription in progress...'
                        : 'No transcription yet. Click "Run Whisper" to transcribe.'}
                    </div>
                  )}
                </div>

                {/* Corrected/Modified Transcription */}
                <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                      <span className="mr-2">✏️</span>
                      Corrected Transcription
                    </h2>
                    <div className="flex items-center space-x-2">
                      {currentFile.corrected_transcript && (
                        <span className="px-2 py-1 text-xs text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 rounded">
                          Saved in DB
                        </span>
                      )}
                      {currentFile.whisper_transcript && transcript !== currentFile.whisper_transcript && transcript !== currentFile.corrected_transcript && (
                        <span className="px-2 py-1 text-xs text-yellow-700 dark:text-yellow-300 bg-yellow-100 dark:bg-yellow-900/40 rounded">
                          Unsaved changes
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <textarea
                      value={transcript}
                      onChange={(e) => setTranscript(e.target.value)}
                      onKeyDown={handleKeyDown}
                      rows={6}
                      placeholder="Edit the transcript here... The corrected version will be saved for training."
                      className="w-full px-3 py-2 leading-relaxed border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    />
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Make corrections to the original transcription above. Your changes will be saved as the ground truth.
                    </p>
                  </div>

                  <div className="flex items-center justify-between mt-4">
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">Ctrl</kbd> + 
                      <kbd className="px-2 py-1 ml-1 bg-gray-100 dark:bg-gray-700 rounded">S</kbd> to save,
                      <kbd className="px-2 py-1 ml-2 bg-gray-100 dark:bg-gray-700 rounded">Ctrl</kbd> + 
                      <kbd className="px-2 py-1 ml-1 bg-gray-100 dark:bg-gray-700 rounded">Enter</kbd> to complete
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 border border-gray-300 dark:border-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={handleMarkComplete}
                        disabled={saving}
                        className="px-4 py-2 text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
                      >
                        ✓ Mark Complete
                      </button>
                    </div>
                  </div>
                </div>

                {/* Navigation */}
                <div className="flex justify-between">
                  <button
                    onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                    disabled={currentIndex === 0}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    ← Previous
                  </button>
                  <span className="py-2 text-gray-600">
                    {currentIndex + 1} of {files.length}
                  </span>
                  <button
                    onClick={() => setCurrentIndex(Math.min(files.length - 1, currentIndex + 1))}
                    disabled={currentIndex >= files.length - 1}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    Next →
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        </>
      )}
    </div>
  )
}

export default ASRAnnotate
