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
        <div className="text-lg text-[var(--text-dim)]">Loading settings...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[var(--text-hi)]">⚙️ Settings</h1>

      {msg && (
        <div className={`px-4 py-3 rounded text-sm font-medium ${
          msg.type === 'error'
            ? 'bg-[var(--red-dim)] text-[var(--red)]  '
            : 'bg-[var(--green-dim)] text-[var(--green)]  '
        }`}>
          {msg.text}
        </div>
      )}

      {/* User Identity */}
      <div className="p-6 bg-[var(--bg-panel)] rounded border">
        <h2 className="mb-4 text-lg font-semibold text-[var(--text-hi)]">👤 User Identity</h2>
        <p className="mb-3 text-sm text-[var(--text-dim)]">
          Your name is used to track who created datasets and annotated records.
        </p>
        <div className="max-w-md">
          <label className="block mb-1 text-sm font-medium text-[var(--text)]">Your Name</label>
          <input
            type="text"
            value={username}
            onChange={e => saveUsername(e.target.value)}
            placeholder="Enter your name"
            className="w-full px-3 py-2 text-sm border rounded bg-[var(--bg-panel)] text-[var(--text-hi)] focus:border-transparent"
          />
        </div>
      </div>

      {/* Ollama Configuration */}
      <div className="p-6 bg-[var(--bg-panel)] rounded border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-hi)]">🤖 Ollama (LLM)</h2>
          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
            ollamaRunning
              ? 'bg-[var(--green-dim)] text-[var(--green)]  '
              : 'bg-[var(--red-dim)] text-[var(--red)]  '
          }`}>
            {ollamaRunning ? '● Running' : '● Not Running'}
          </span>
        </div>

        <div className="space-y-4">
          {/* Base URL */}
          <div>
            <label className="block mb-1 text-sm font-medium text-[var(--text)]">Base URL</label>
            <input
              type="text"
              value={config?.ollama_base_url || ''}
              onChange={e => setConfig({ ...config, ollama_base_url: e.target.value })}
              className="w-full max-w-md px-3 py-2 text-sm border rounded bg-[var(--bg-panel)] text-[var(--text-hi)] focus:border-transparent"
            />
          </div>

          {/* Active Model */}
          <div>
            <label className="block mb-1 text-sm font-medium text-[var(--text)]">Active Model</label>
            <div className="flex items-center max-w-md gap-2">
              <select
                value={config?.ollama_model || ''}
                onChange={e => setConfig({ ...config, ollama_model: e.target.value })}
                className="flex-1 px-3 py-2 text-sm border rounded bg-[var(--bg-panel)] text-[var(--text-hi)] focus:border-transparent"
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
            <label className="block mb-1 text-sm font-medium text-[var(--text)]">Pull New Model</label>
            <p className="mb-2 text-xs text-[var(--text-dim)]">
              Enter a model name from the Ollama library (e.g. <code>llama3:8b</code>, <code>mistral:7b</code>, <code>gemma3:4b</code>)
            </p>
            <div className="flex items-center max-w-md gap-2">
              <input
                type="text"
                value={pullModel}
                onChange={e => setPullModel(e.target.value)}
                placeholder="e.g. gemma3:4b"
                className="flex-1 px-3 py-2 text-sm border rounded bg-[var(--bg-panel)] text-[var(--text-hi)] focus:border-transparent"
                onKeyDown={e => e.key === 'Enter' && handlePull()}
              />
              <button
                onClick={handlePull}
                disabled={pulling || !pullModel.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-[var(--accent)] rounded hover:bg-[var(--accent)] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {pulling ? 'Pulling...' : 'Pull Model'}
              </button>
            </div>
          </div>

          {/* Available Models */}
          {ollamaModels.length > 0 && (
            <div>
              <label className="block mb-2 text-sm font-medium text-[var(--text)]">
                Downloaded Models ({ollamaModels.length})
              </label>
              <div className="flex flex-wrap gap-2">
                {ollamaModels.map(m => (
                  <span
                    key={m.name}
                    className={`px-3 py-1 text-xs rounded-full cursor-pointer transition-colors border-2 ${
                      config?.ollama_model === m.name
                        ? 'bg-[var(--accent-dim)] text-[var(--accent)] border-[var(--accent)] font-semibold'
                        : 'bg-[var(--bg-input)] text-[var(--text-dim)] border-transparent hover:bg-[var(--bg-hover)]'
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
      <div className="p-6 bg-[var(--bg-panel)] rounded border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-hi)]">🎙️ Whisper (ASR)</h2>
          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
            whisperStatus?.available
              ? 'bg-[var(--green-dim)] text-[var(--green)]  '
              : 'bg-[var(--amber-dim)] text-[var(--amber)]  '
          }`}>
            {whisperStatus?.detected_backend
              ? `● ${whisperStatus.detected_backend.toUpperCase()} backend`
              : '● Not detected'}
          </span>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block mb-1 text-sm font-medium text-[var(--text)]">Model Name (HuggingFace)</label>
            <input
              type="text"
              value={config?.whisper_model || ''}
              onChange={e => setConfig({ ...config, whisper_model: e.target.value })}
              placeholder="mlx-community/whisper-large-v3-turbo"
              className="w-full max-w-md px-3 py-2 text-sm border rounded bg-[var(--bg-panel)] text-[var(--text-hi)] focus:border-transparent"
            />
            <p className="mt-1 text-xs text-[var(--text-dim)]">
              HuggingFace repo for MLX, or model size for CUDA/CPU (e.g. <code>large-v3-turbo</code>)
            </p>
          </div>

          <div>
            <label className="block mb-1 text-sm font-medium text-[var(--text)]">Backend</label>
            <select
              value={config?.whisper_backend || 'auto'}
              onChange={e => setConfig({ ...config, whisper_backend: e.target.value })}
              className="w-full max-w-md px-3 py-2 text-sm border rounded bg-[var(--bg-panel)] text-[var(--text-hi)] focus:border-transparent"
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
      <div className="p-6 bg-[var(--bg-panel)] rounded border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--text-hi)]">💾 Database Backup</h2>
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-[var(--accent-dim)] text-[var(--accent)]">
            Auto-backup daily at 6:00 PM
          </span>
        </div>

        <p className="mb-4 text-sm text-[var(--text-dim)]">
          Create a full SQL dump of the database. Backups are saved to <code className="px-1 py-0.5 bg-[var(--bg-input)] rounded text-xs">sql_backups/</code> and the last 30 are kept.
        </p>

        <button
          onClick={handleBackup}
          disabled={backingUp}
          className="px-5 py-2.5 text-sm font-medium text-white bg-[var(--green)] rounded hover:bg-[var(--green)] disabled:opacity-50 disabled:cursor-not-allowed border transition-colors inline-flex items-center gap-2"
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
            <div className="overflow-hidden border rounded">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg)]">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-dim)] uppercase">Filename</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-dim)] uppercase">Size</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-dim)] uppercase">Created</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-dim)] uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y  ">
                  {list.slice(0, 10).map((b) => (
                    <tr key={b.filename} className="hover:bg-[var(--bg-hover)]">
                      <td className="px-4 py-2 font-mono text-xs text-[var(--text-hi)]">{b.filename}</td>
                      <td className="px-4 py-2 text-[var(--text-dim)]">{b.size_human}</td>
                      <td className="px-4 py-2 text-[var(--text-dim)]">
                        {new Date(b.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => handleDownloadBackup(b.filename)}
                          className="text-[var(--accent)] hover:text-[var(--accent)] text-xs font-medium"
                        >
                          Download
                        </button>
                      </td>
                    </tr>
                  ))}
                  {list.length === 0 && (
                    <tr>
                      <td colSpan="4" className="px-4 py-4 text-center text-xs text-[var(--text-dim)]">
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
                <h3 className="mb-2 text-sm font-medium text-[var(--text)] flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[var(--accent)]"></span>
                  High-Frequency Auto-Snapshots ({scheduledBackups.length} stored)
                </h3>
                {renderTable(scheduledBackups)}
              </div>

              {/* Standard Backups */}
              <div>
                <h3 className="mb-2 text-sm font-medium text-[var(--text)] flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[var(--green)]"></span>
                  Full Backups (Daily & Manual) ({standardBackups.length} stored)
                </h3>
                {renderTable(standardBackups)}
              </div>

              {loadingBackups && (
                <p className="mt-2 text-xs text-[var(--text-dim)]">Loading backups...</p>
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
          className="px-6 py-2.5 text-sm font-medium text-white bg-[var(--accent)] rounded hover:bg-[var(--accent)] disabled:opacity-50 border"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

export default Settings
