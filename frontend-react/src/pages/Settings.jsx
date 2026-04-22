import React, { useState, useEffect, useCallback } from 'react'
import {
  getModelConfig, updateModelConfig,
  getOllamaModels, pullOllamaModel,
  getWhisperStatus,
  createDatabaseBackup, listDatabaseBackups, downloadDatabaseBackup
} from '../api'

function Settings() {
  const [config, setConfig] = useState(null)
  const [ollamaModels, setOllamaModels] = useState([])
  const [ollamaRunning, setOllamaRunning] = useState(false)
  const [whisperStatus, setWhisperStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [pullModel, setPullModel] = useState('')
  const [msg, setMsg] = useState(null)
  const [username, setUsername] = useState(() => localStorage.getItem('dst_username') || '')
  const [backingUp, setBackingUp] = useState(false)
  const [backups, setBackups] = useState([])
  const [loadingBackups, setLoadingBackups] = useState(false)

  const flash = (text, type = 'success') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

  const loadBackups = useCallback(async () => {
    setLoadingBackups(true)
    try {
      const res = await listDatabaseBackups()
      setBackups(res.data.backups || [])
    } catch (e) {
      // silently fail - backups list is non-critical
    }
    setLoadingBackups(false)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cfgRes, ollamaRes, whisperRes] = await Promise.all([
        getModelConfig(),
        getOllamaModels(),
        getWhisperStatus()
      ])
      setConfig(cfgRes.data)
      setOllamaModels(ollamaRes.data.models || [])
      setOllamaRunning(ollamaRes.data.ollama_running)
      setWhisperStatus(whisperRes.data)
    } catch (e) {
      flash('Failed to load settings', 'error')
    }
    setLoading(false)
    loadBackups()
  }, [loadBackups])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await updateModelConfig(config)
      setConfig(res.data)
      flash('Settings saved')
    } catch (e) {
      flash('Failed to save settings', 'error')
    }
    setSaving(false)
  }

  const handlePull = async () => {
    if (!pullModel.trim()) return
    setPulling(true)
    try {
      await pullOllamaModel(pullModel.trim())
      flash(`Model "${pullModel.trim()}" pulled successfully`)
      setPullModel('')
      // Refresh available models
      const res = await getOllamaModels()
      setOllamaModels(res.data.models || [])
    } catch (e) {
      const detail = e.response?.data?.detail || 'Pull failed'
      flash(detail, 'error')
    }
    setPulling(false)
  }

  const saveUsername = (val) => {
    setUsername(val)
    localStorage.setItem('dst_username', val)
  }

  const handleBackup = async () => {
    setBackingUp(true)
    try {
      const res = await createDatabaseBackup()
      flash(`Backup created: ${res.data.filename} (${res.data.size_human})`)
      loadBackups()
    } catch (e) {
      const detail = e.response?.data?.detail || 'Backup failed'
      flash(detail, 'error')
    }
    setBackingUp(false)
  }

  const handleDownloadBackup = async (filename) => {
    try {
      const res = await downloadDatabaseBackup(filename)
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (e) {
      flash('Download failed', 'error')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-lg text-gray-500 dark:text-gray-400">Loading settings...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">⚙️ Settings</h1>

      {msg && (
        <div className={`px-4 py-3 rounded-lg text-sm font-medium ${
          msg.type === 'error'
            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
        }`}>
          {msg.text}
        </div>
      )}

      {/* User Identity */}
      <div className="p-6 bg-white rounded-lg shadow dark:bg-gray-800">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">👤 User Identity</h2>
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
          Your name is used to track who created datasets and annotated records.
        </p>
        <div className="max-w-md">
          <label className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">Your Name</label>
          <input
            type="text"
            value={username}
            onChange={e => saveUsername(e.target.value)}
            placeholder="Enter your name"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Ollama Configuration */}
      <div className="p-6 bg-white rounded-lg shadow dark:bg-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">🤖 Ollama (LLM)</h2>
          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
            ollamaRunning
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          }`}>
            {ollamaRunning ? '● Running' : '● Not Running'}
          </span>
        </div>

        <div className="space-y-4">
          {/* Base URL */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">Base URL</label>
            <input
              type="text"
              value={config?.ollama_base_url || ''}
              onChange={e => setConfig({ ...config, ollama_base_url: e.target.value })}
              className="w-full max-w-md px-3 py-2 text-sm border border-gray-300 rounded-lg dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Active Model */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">Active Model</label>
            <div className="flex items-center max-w-md gap-2">
              <select
                value={config?.ollama_model || ''}
                onChange={e => setConfig({ ...config, ollama_model: e.target.value })}
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              >
                {ollamaModels.map(m => (
                  <option key={m.name} value={m.name}>
                    {m.name} ({m.size_gb} GB)
                  </option>
                ))}
                {/* Show current config even if not in list */}
                {config?.ollama_model && !ollamaModels.find(m => m.name === config.ollama_model) && (
                  <option value={config.ollama_model}>{config.ollama_model} (not downloaded)</option>
                )}
              </select>
            </div>
          </div>

          {/* Pull New Model */}
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">Pull New Model</label>
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              Enter a model name from the Ollama library (e.g. <code>llama3:8b</code>, <code>mistral:7b</code>, <code>gemma3:4b</code>)
            </p>
            <div className="flex items-center max-w-md gap-2">
              <input
                type="text"
                value={pullModel}
                onChange={e => setPullModel(e.target.value)}
                placeholder="e.g. gemma3:4b"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                onKeyDown={e => e.key === 'Enter' && handlePull()}
              />
              <button
                onClick={handlePull}
                disabled={pulling || !pullModel.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {pulling ? 'Pulling...' : 'Pull Model'}
              </button>
            </div>
          </div>

          {/* Available Models */}
          {ollamaModels.length > 0 && (
            <div>
              <label className="block mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                Downloaded Models ({ollamaModels.length})
              </label>
              <div className="flex flex-wrap gap-2">
                {ollamaModels.map(m => (
                  <span
                    key={m.name}
                    className={`px-3 py-1 text-xs rounded-full cursor-pointer transition-colors ${
                      config?.ollama_model === m.name
                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 ring-2 ring-indigo-500'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                    onClick={() => setConfig({ ...config, ollama_model: m.name })}
                  >
                    {m.name} · {m.size_gb}GB
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Whisper Configuration */}
      <div className="p-6 bg-white rounded-lg shadow dark:bg-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">🎙️ Whisper (ASR)</h2>
          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
            whisperStatus?.available
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
          }`}>
            {whisperStatus?.detected_backend
              ? `● ${whisperStatus.detected_backend.toUpperCase()} backend`
              : '● Not detected'}
          </span>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">Model Name (HuggingFace)</label>
            <input
              type="text"
              value={config?.whisper_model || ''}
              onChange={e => setConfig({ ...config, whisper_model: e.target.value })}
              placeholder="mlx-community/whisper-large-v3-turbo"
              className="w-full max-w-md px-3 py-2 text-sm border border-gray-300 rounded-lg dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              HuggingFace repo for MLX, or model size for CUDA/CPU (e.g. <code>large-v3-turbo</code>)
            </p>
          </div>

          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">Backend</label>
            <select
              value={config?.whisper_backend || 'auto'}
              onChange={e => setConfig({ ...config, whisper_backend: e.target.value })}
              className="w-full max-w-md px-3 py-2 text-sm border border-gray-300 rounded-lg dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              <option value="auto">Auto-detect</option>
              <option value="mlx">MLX (Apple Silicon)</option>
              <option value="cuda">CUDA (NVIDIA GPU)</option>
              <option value="cpu">CPU</option>
            </select>
          </div>
        </div>
      </div>

      {/* Database Backup */}
      <div className="p-6 bg-white rounded-lg shadow dark:bg-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">💾 Database Backup</h2>
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
            Auto-backup daily at 6:00 PM
          </span>
        </div>

        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Create a full SQL dump of the database. Backups are saved to <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">sql_backups/</code> and the last 30 are kept.
        </p>

        <button
          onClick={handleBackup}
          disabled={backingUp}
          className="px-5 py-2.5 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-colors inline-flex items-center gap-2"
        >
          {backingUp ? (
            <>
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Creating Backup...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Backup Now
            </>
          )}
        </button>

        {/* Backup History */}
        {backups.length > 0 && (() => {
          const scheduledBackups = backups.filter(b => b.filename.includes('_10min_') || b.filename.includes('_30min_'));
          const standardBackups = backups.filter(b => !b.filename.includes('_10min_') && !b.filename.includes('_30min_'));

          const renderTable = (list) => (
            <div className="overflow-hidden border border-gray-200 rounded-lg dark:border-gray-700">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Filename</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Size</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Created</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {list.slice(0, 10).map((b) => (
                    <tr key={b.filename} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-4 py-2 font-mono text-xs text-gray-900 dark:text-gray-100">{b.filename}</td>
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{b.size_human}</td>
                      <td className="px-4 py-2 text-gray-500 dark:text-gray-400">
                        {new Date(b.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => handleDownloadBackup(b.filename)}
                          className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 text-xs font-medium"
                        >
                          Download
                        </button>
                      </td>
                    </tr>
                  ))}
                  {list.length === 0 && (
                    <tr>
                      <td colSpan="4" className="px-4 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                        No backups found in this category.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );

          return (
            <div className="mt-8 space-y-6">
              {/* Scheduled Frequency Snapshots */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  High-Frequency Auto-Snapshots ({scheduledBackups.length} stored)
                </h3>
                {renderTable(scheduledBackups)}
              </div>

              {/* Standard Backups */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  Full Backups (Daily & Manual) ({standardBackups.length} stored)
                </h3>
                {renderTable(standardBackups)}
              </div>

              {loadingBackups && (
                <p className="mt-2 text-xs text-gray-400">Loading backups...</p>
              )}
            </div>
          );
        })()}
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

export default Settings
