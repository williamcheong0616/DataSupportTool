import React, { useState, useEffect, useCallback } from 'react'
import {
  getModelConfig, updateModelConfig,
  getOllamaModels, pullOllamaModel,
  getWhisperStatus
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

  const flash = (text, type = 'success') => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 4000)
  }

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
  }, [])

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
