import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import WaveSurfer from 'wavesurfer.js'
import {
  getASRDatasets,
  getAudioFiles,
  getAudioUrl,
  transcribeAudio,
  annotateTranscript,
  updateFileStatus,
} from '../api'

const STATUS_COLORS = {
  pending: 'bg-gray-100 text-gray-700',
  transcribing: 'bg-yellow-100 text-yellow-700',
  transcribed: 'bg-blue-100 text-blue-700',
  annotating: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
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

  const fetchFiles = async () => {
    setLoading(true)
    try {
      const status = statusFilter === 'all' ? null : statusFilter
      const res = await getAudioFiles(datasetId, status, 100)
      setFiles(res.data.files || [])
      setCurrentIndex(0)
    } catch (err) {
      console.error('Failed to fetch files:', err)
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
    setTranscribing(true)
    try {
      const res = await transcribeAudio(currentFile.id)
      setTranscript(res.data.whisper_transcript || '')
      fetchFiles()
    } catch (err) {
      alert('Failed to transcribe: ' + (err.response?.data?.detail || err.message))
    } finally {
      setTranscribing(false)
    }
  }

  const handleSave = async () => {
    if (!currentFile) return
    setSaving(true)
    try {
      await annotateTranscript(currentFile.id, transcript)
      fetchFiles()
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
      
      // Move to next file
      if (currentIndex < files.length - 1) {
        setCurrentIndex(currentIndex + 1)
      }
      fetchFiles()
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
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <button
            onClick={() => navigate('/asr')}
            className="text-indigo-600 hover:text-indigo-800 mb-2"
          >
            ← Back to Datasets
          </button>
          <h1 className="text-2xl font-bold text-gray-900">
            {dataset?.name || 'ASR Annotation'}
          </h1>
        </div>
        <div className="flex items-center space-x-4">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2"
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
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
          <p className="text-xl mb-4">No files found</p>
          <p>Upload audio files or change the filter to see files.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* File List */}
          <div className="bg-white rounded-lg shadow-md p-4 h-fit lg:max-h-[600px] overflow-y-auto">
            <h2 className="font-semibold text-gray-900 mb-3">
              Files ({files.length})
            </h2>
            <div className="space-y-2">
              {files.map((file, index) => (
                <button
                  key={file.id}
                  onClick={() => setCurrentIndex(index)}
                  className={`w-full text-left p-3 rounded-lg border transition ${
                    index === currentIndex
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <span className="text-sm font-medium truncate flex-1">
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
                    <span className="text-xs text-gray-500">
                      {Math.floor(file.duration / 60)}:{String(Math.floor(file.duration % 60)).padStart(2, '0')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Annotation Area */}
          <div className="lg:col-span-2 space-y-4">
            {currentFile && (
              <>
                {/* Audio Player with Waveform */}
                <div className="bg-white rounded-lg shadow-md p-4">
                  <div className="flex justify-between items-center mb-3">
                    <h2 className="font-semibold text-gray-900">
                      {currentFile.filename}
                    </h2>
                    <span
                      className={`text-sm px-3 py-1 rounded ${
                        STATUS_COLORS[currentFile.status] || STATUS_COLORS.pending
                      }`}
                    >
                      {currentFile.status}
                    </span>
                  </div>
                  
                  {/* Waveform */}
                  <div className="mb-4">
                    <div 
                      ref={waveformRef} 
                      className="w-full bg-gray-50 rounded-lg"
                      style={{ minHeight: '100px' }}
                    />
                    {!waveformReady && !waveformError && (
                      <div className="flex items-center justify-center h-24 text-gray-400">
                        <div className="animate-pulse">Loading waveform...</div>
                      </div>
                    )}
                    {waveformError && (
                      <div className="mt-2">
                        <div className="text-red-500 text-sm mb-2">{waveformError}</div>
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
                  <div className="flex justify-between text-sm text-gray-500 mb-3">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>

                  {/* Playback Controls */}
                  <div className="flex items-center justify-center space-x-4 mb-4">
                    <button
                      onClick={() => handleSkip(-5)}
                      disabled={!waveformReady}
                      className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                      title="Rewind 5s"
                    >
                      ⏪ -5s
                    </button>
                    <button
                      onClick={handlePlayPause}
                      disabled={!waveformReady}
                      className="p-4 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 text-xl"
                    >
                      {isPlaying ? '⏸️' : '▶️'}
                    </button>
                    <button
                      onClick={handleStop}
                      disabled={!waveformReady}
                      className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                      title="Stop"
                    >
                      ⏹️
                    </button>
                    <button
                      onClick={() => handleSkip(5)}
                      disabled={!waveformReady}
                      className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                      title="Forward 5s"
                    >
                      +5s ⏩
                    </button>
                  </div>
                  
                  {/* Playback Speed */}
                  <div className="flex items-center justify-center space-x-4">
                    <label className="text-sm text-gray-600">Speed:</label>
                    <div className="flex space-x-2">
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                        <button
                          key={rate}
                          onClick={() => setPlaybackRate(rate)}
                          className={`px-2 py-1 text-sm rounded ${
                            playbackRate === rate
                              ? 'bg-indigo-600 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 text-center text-xs text-gray-400">
                    Press <kbd className="px-1 py-0.5 bg-gray-100 rounded">Space</kbd> to play/pause (when not typing)
                  </div>
                </div>

                {/* Transcription */}
                <div className="bg-white rounded-lg shadow-md p-4">
                  <div className="flex justify-between items-center mb-3">
                    <h2 className="font-semibold text-gray-900">Transcript</h2>
                    {(!currentFile.whisper_transcript && currentFile.status === 'pending') && (
                      <button
                        onClick={handleTranscribe}
                        disabled={transcribing}
                        className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50"
                      >
                        {transcribing ? 'Transcribing...' : '🎤 Run Whisper'}
                      </button>
                    )}
                  </div>

                  {currentFile.whisper_transcript && (
                    <div className="mb-3 p-3 bg-gray-50 rounded-lg text-sm">
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Whisper Output (Original)
                      </label>
                      <p className="text-gray-700">{currentFile.whisper_transcript}</p>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Corrected Transcript
                    </label>
                    <textarea
                      value={transcript}
                      onChange={(e) => setTranscript(e.target.value)}
                      onKeyDown={handleKeyDown}
                      rows={6}
                      placeholder="Edit the transcript here..."
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="flex justify-between items-center mt-4">
                    <div className="text-sm text-gray-500">
                      <kbd className="px-2 py-1 bg-gray-100 rounded">Ctrl</kbd> + 
                      <kbd className="px-2 py-1 bg-gray-100 rounded ml-1">S</kbd> to save,
                      <kbd className="px-2 py-1 bg-gray-100 rounded ml-2">Ctrl</kbd> + 
                      <kbd className="px-2 py-1 bg-gray-100 rounded ml-1">Enter</kbd> to complete
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={handleMarkComplete}
                        disabled={saving}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
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
                  <span className="text-gray-600 py-2">
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
      )}
    </div>
  )
}

export default ASRAnnotate
