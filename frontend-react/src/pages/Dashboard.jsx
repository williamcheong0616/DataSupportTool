import React, { useState, useEffect } from 'react'
import { getStats } from '../api'

function Dashboard() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const res = await getStats()
      setStats(res.data)
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  const statCards = [
    {
      title: 'Text Datasets',
      value: stats?.text_datasets || 0,
      icon: '📁',
      color: 'bg-blue-500',
    },
    {
      title: 'Text Records',
      value: stats?.text_records || 0,
      icon: '📝',
      color: 'bg-green-500',
    },
    {
      title: 'Text Annotated',
      value: stats?.text_annotated || 0,
      icon: '✅',
      color: 'bg-emerald-500',
    },
    {
      title: 'ASR Datasets',
      value: stats?.asr_datasets || 0,
      icon: '🎵',
      color: 'bg-purple-500',
    },
    {
      title: 'Audio Files',
      value: stats?.audio_files || 0,
      icon: '🎧',
      color: 'bg-pink-500',
    },
    {
      title: 'ASR Completed',
      value: stats?.asr_completed || 0,
      icon: '🎯',
      color: 'bg-orange-500',
    },
  ]

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {statCards.map((card, index) => (
          <div
            key={index}
            className="bg-white rounded-lg shadow-md overflow-hidden"
          >
            <div className={`${card.color} h-2`}></div>
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">{card.title}</p>
                  <p className="text-3xl font-bold text-gray-900">{card.value}</p>
                </div>
                <span className="text-4xl">{card.icon}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a
            href="/text"
            className="flex items-center p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition"
          >
            <span className="text-3xl mr-4">📝</span>
            <div>
              <h3 className="font-semibold text-blue-900">Text Annotation</h3>
              <p className="text-sm text-blue-700">
                Annotate Bahasa Rojak, classify text, or generate questions
              </p>
            </div>
          </a>
          <a
            href="/asr"
            className="flex items-center p-4 bg-purple-50 rounded-lg hover:bg-purple-100 transition"
          >
            <span className="text-3xl mr-4">🎧</span>
            <div>
              <h3 className="font-semibold text-purple-900">ASR Annotation</h3>
              <p className="text-sm text-purple-700">
                Transcribe and correct audio files using Whisper
              </p>
            </div>
          </a>
        </div>
      </div>

      {/* Instructions */}
      <div className="mt-8 bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Getting Started</h2>
        <div className="space-y-4 text-gray-600">
          <div>
            <h3 className="font-medium text-gray-900">1. Text Annotation Workflow</h3>
            <ul className="ml-4 mt-2 list-disc list-inside space-y-1">
              <li>Create a dataset and choose the task type (Bahasa Rojak ID, Classification, Modification, Questions)</li>
              <li>Upload your JSON or CSV file with text data</li>
              <li>Select the column containing the text to annotate</li>
              <li>Annotate each record based on the task type</li>
              <li>Export annotated data as CSV or JSONL</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-gray-900">2. ASR Annotation Workflow</h3>
            <ul className="ml-4 mt-2 list-disc list-inside space-y-1">
              <li>Create an ASR dataset</li>
              <li>Upload audio files in batch (supports MP3, WAV, etc.)</li>
              <li>Run Whisper transcription on each file</li>
              <li>Listen to audio and correct the transcript</li>
              <li>Mark as complete and export results</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
