import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getStats, getDatasetStats, listBRPipelines } from '../api'

const PIPELINE_STAGES = [
  { num: 1, key: 'stage_1', path: 'classification', label: 'Classification', icon: '🏷️' },
  { num: 2, key: 'stage_2', path: 'restructure', label: 'Restructure', icon: '📝' },
  { num: 3, key: 'stage_3', path: 'questions', label: 'Questions', icon: '❓' },
  { num: 4, key: 'stage_4', path: 'responses', label: 'Responses', icon: '💬' },
]

function Dashboard() {
  const [stats, setStats] = useState(null)
  const [datasetStats, setDatasetStats] = useState(null)
  const [pipelines, setPipelines] = useState({})
  const [selectedType, setSelectedType] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const [statsRes, dsRes, pipelinesRes] = await Promise.all([
        getStats(), 
        getDatasetStats(),
        listBRPipelines().catch(() => ({ data: { pipelines: [] } }))
      ])
      setStats(statsRes.data)
      setDatasetStats(dsRes.data)
      
      const pipelineMap = {}
      if (pipelinesRes.data?.pipelines) {
        pipelinesRes.data.pipelines.forEach(p => {
          if (!pipelineMap[p.dataset_id] || p.id > pipelineMap[p.dataset_id].id) {
            pipelineMap[p.dataset_id] = p
          }
        })
      }
      setPipelines(pipelineMap)
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    } finally {
      setLoading(false)
    }
  }

  // Helper to render stage progress bar
  const renderStageProgress = (pipeline) => {
    if (!pipeline) return null;
    const currentStage = pipeline.current_stage_num || 1
    
    return (
      <div className="w-48">
        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-1">
          <span>Stage {currentStage} of 4</span>
        </div>
        <div className="flex gap-1">
          {PIPELINE_STAGES.map((stage) => {
            const progress = pipeline.stage_progress?.[stage.key]
            const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0
            const isActive = stage.num === currentStage
            const isComplete = stage.num < currentStage || pct === 100
            
            return (
              <Link
                key={stage.key}
                to={`/br-pipeline/${stage.path}/${pipeline.id}`}
                className={`flex-1 group relative`}
                title={`${stage.label}: ${progress?.done || 0}/${progress?.total || 0}`}
              >
                <div className={`h-2 rounded-full overflow-hidden ${
                  isActive ? 'bg-amber-200 dark:bg-amber-900/40' : 
                  isComplete ? 'bg-green-200 dark:bg-green-900/40' : 
                  'bg-gray-200 dark:bg-gray-700'
                }`}>
                  <div 
                    className={`h-full transition-all ${
                      isComplete ? 'bg-green-500' : isActive ? 'bg-amber-500' : 'bg-gray-400'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={`block text-center mt-0.5 text-[10px] ${
                  isActive ? 'text-amber-600 dark:text-amber-400 font-medium' : 
                  isComplete ? 'text-green-600 dark:text-green-400' : 
                  'text-gray-400 dark:text-gray-500'
                } group-hover:underline`}>
                  {stage.icon}
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    )
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
      title: 'Pipeline Completed',
      value: stats?.text_annotated || 0,
      icon: '⚙️',
      color: 'bg-indigo-500',
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
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-8">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {statCards.map((card, index) => (
          <div
            key={index}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden"
          >
            <div className={`${card.color} h-2`}></div>
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{card.title}</p>
                  <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{card.value}</p>
                </div>
                <span className="text-4xl">{card.icon}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Per-Dataset Breakdown */}
      {datasetStats && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Dataset Breakdown</h2>
            <select
              value={selectedType}
              onChange={e => setSelectedType(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">All Datasets</option>
              <option value="text">Text Datasets</option>
              <option value="asr">ASR Datasets</option>
            </select>
          </div>

          {(selectedType === 'all' || selectedType === 'text') && datasetStats.text_datasets?.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">Text Datasets</h3>
              <div className="grid gap-3">
                {datasetStats.text_datasets.map(ds => {
                  const pct = ds.record_count > 0 ? Math.round((ds.annotated_count / ds.record_count) * 100) : 0
                  return (
                    <div key={ds.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-900 dark:text-gray-100 truncate block">{ds.name}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {ds.task_type} {ds.has_pipeline === false && '· No pipeline runs'}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 ml-4">
                        {pipelines[ds.id] ? (
                          renderStageProgress(pipelines[ds.id])
                        ) : (
                          <span className="text-sm text-gray-500 dark:text-gray-400 italic">
                            Pipeline Not Started
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {(selectedType === 'all' || selectedType === 'asr') && datasetStats.asr_datasets?.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">ASR Datasets</h3>
              <div className="grid gap-3">
                {datasetStats.asr_datasets.map(ds => {
                  const pct = ds.file_count > 0 ? Math.round((ds.completed_count / ds.file_count) * 100) : 0
                  return (
                    <div key={ds.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-900 dark:text-gray-100 truncate block">{ds.name}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{ds.pending_count} pending</span>
                      </div>
                      <div className="flex items-center gap-4 ml-4">
                        <span className="text-sm text-gray-600 dark:text-gray-300">{ds.completed_count}/{ds.file_count} files</span>
                        <div className="w-24 bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                          <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-gray-500 w-10 text-right">{pct}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {(!datasetStats.text_datasets?.length && !datasetStats.asr_datasets?.length) && (
            <p className="text-gray-500 dark:text-gray-400 text-center py-4">No datasets created yet.</p>
          )}
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a
            href="/text"
            className="flex items-center p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition"
          >
            <span className="text-3xl mr-4">�</span>
            <div>
              <h3 className="font-semibold text-blue-900 dark:text-blue-300">BR Pipeline (Automated)</h3>
              <p className="text-sm text-blue-700 dark:text-blue-400">
                Batch process Bahasa Rojak data through 4-stage pipeline
              </p>
            </div>
          </a>
          <a
            href="/asr"
            className="flex items-center p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 transition"
          >
            <span className="text-3xl mr-4">🎧</span>
            <div>
              <h3 className="font-semibold text-purple-900 dark:text-purple-300">ASR Datasets</h3>
              <p className="text-sm text-purple-700 dark:text-purple-400">
                Transcribe and correct audio files with Whisper
              </p>
            </div>
          </a>
        </div>
      </div>

      {/* Instructions */}
      <div className="mt-8 bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Getting Started</h2>
        <div className="space-y-4 text-gray-600 dark:text-gray-300">
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100">1. BR Pipeline Workflow (Automated)</h3>
            <ul className="ml-4 mt-2 list-disc list-inside space-y-1">
              <li>Create a text dataset and select "General (For BR Pipeline)" task type</li>
              <li>Upload your JSON or CSV file with Malaysian English conversation data</li>
              <li>Start the BR Pipeline - processes all records automatically through 4 stages:</li>
              <li className="ml-6">• Stage 1: BR Detection + Language Classification (automated)</li>
              <li className="ml-6">• Stage 2: Text Restructuring/MCQ Consolidation (automated)</li>
              <li className="ml-6">• Stage 3: Question Generation (3 questions per record, automated)</li>
              <li className="ml-6">• Stage 4: Model Response Generation (multiple models respond, automated)</li>
              <li>Review and manually edit problems in model responses for fine-tuning datasets</li>
              <li>Export results as CSV for analysis and model training</li>
            </ul>
            <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                <strong>Note:</strong> The BR Pipeline runs automatically on all records in batch. 
                You only need to review and edit the problems in Stage 4 responses for quality control and fine-tuning preparation.
              </p>
            </div>
          </div>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-gray-100">2. ASR Annotation Workflow</h3>
            <ul className="ml-4 mt-2 list-disc list-inside space-y-1">
              <li>Create an ASR dataset</li>
              <li>Upload audio files in batch (supports MP3, WAV, etc.) or import from YouTube</li>
              <li>Auto-segment long audio files into manageable chunks</li>
              <li>Run Whisper transcription on all files (batch processing)</li>
              <li>Review transcripts, listen to audio, and make corrections</li>
              <li>Export completed transcriptions for training data</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
