import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  FolderOpen, FileText, Cpu, Music2, Headphones,
  CheckCircle2, ChevronRight, Workflow, Mic, ArrowRight,
  TrendingUp, Clock,
} from 'lucide-react'
import { getStats, getDatasetStats, listBRPipelines } from '../api'

const PIPELINE_STAGES = [
  { num: 1, key: 'stage_1', path: 'classification', label: 'Classify' },
  { num: 2, key: 'stage_2', path: 'restructure',    label: 'Restructure' },
  { num: 3, key: 'stage_3', path: 'questions',      label: 'Questions' },
  { num: 4, key: 'stage_4', path: 'responses',      label: 'Responses' },
]

const STAT_CARDS = (stats) => [
  { title: 'Text Datasets',      value: stats?.text_datasets ?? 0,  icon: FolderOpen,    color: '#4a9eff' },
  { title: 'Text Records',       value: stats?.text_records ?? 0,   icon: FileText,      color: '#3dd68c' },
  { title: 'Pipeline Completed', value: stats?.text_annotated ?? 0, icon: Cpu,           color: '#a78bfa' },
  { title: 'ASR Datasets',       value: stats?.asr_datasets ?? 0,   icon: Music2,        color: '#e8a820' },
  { title: 'Audio Files',        value: stats?.audio_files ?? 0,    icon: Headphones,    color: '#f472b6' },
  { title: 'ASR Completed',      value: stats?.asr_completed ?? 0,  icon: CheckCircle2,  color: '#2dd4bf' },
]

/** Mini pipeline progress for the dataset table */
function PipelineProgress({ pipeline }) {
  if (!pipeline) return null
  const currentStage = pipeline.current_stage_num || 1

  return (
    <div className="flex items-center gap-2">
      {PIPELINE_STAGES.map((stage) => {
        const progress = pipeline.stage_progress?.[stage.key]
        const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0
        const isDone = stage.num < currentStage || pct === 100
        const isActive = stage.num === currentStage

        return (
          <Link
            key={stage.key}
            to={`/br-pipeline/${stage.path}/${pipeline.id}`}
            title={`${stage.label}: ${progress?.done ?? 0}/${progress?.total ?? 0}`}
            className="group flex flex-col items-center gap-0.5 w-14"
          >
            <div className="progress-track w-full">
              <div
                className="progress-fill"
                style={{
                  width: `${pct}%`,
                  background: isDone ? 'var(--green)' : isActive ? 'var(--amber)' : undefined,
                }}
              />
            </div>
            <span
              className="text-[10px] font-medium group-hover:underline"
              style={{
                fontFamily: 'var(--mono)',
                color: isDone ? 'var(--green)' : isActive ? 'var(--amber)' : 'var(--text-dim)',
              }}
            >
              {stage.label}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

function Dashboard() {
  const [stats, setStats] = useState(null)
  const [datasetStats, setDatasetStats] = useState(null)
  const [pipelines, setPipelines] = useState({})
  const [selectedType, setSelectedType] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchStats() }, [])

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
      ;(pipelinesRes.data?.pipelines ?? []).forEach(p => {
        if (!pipelineMap[p.dataset_id] || p.id > pipelineMap[p.dataset_id].id) {
          pipelineMap[p.dataset_id] = p
        }
      })
      setPipelines(pipelineMap)
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-72 gap-4">
        <div
          className="w-8 h-8 rounded-full border-2 border-transparent animate-spin"
          style={{ borderTopColor: 'var(--accent)', borderRightColor: 'var(--accent)' }}
        />
        <p className="text-sm" style={{ color: 'var(--text-dim)' }}>Loading dashboard…</p>
      </div>
    )
  }

  const cards = STAT_CARDS(stats)

  return (
    <div className="space-y-8">

      {/* ── Page header ──────────────────────────────────── */}
      <div>
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}
        >
          Overview
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-dim)' }}>
          Current status of your datasets and pipelines
        </p>
      </div>

      {/* ── Stat cards ───────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <div
              key={card.title}
              className="surface p-5 flex items-center gap-4"
              style={{ borderLeftColor: card.color, borderLeftWidth: '3px' }}
            >
              <div
                className="flex-shrink-0 w-9 h-9 rounded flex items-center justify-center"
                style={{ background: `color-mix(in srgb, ${card.color} 18%, transparent)` }}
              >
                <Icon size={17} style={{ color: card.color }} strokeWidth={2} />
              </div>
              <div>
                <p
                  className="text-[11px] font-bold tracking-widest uppercase"
                  style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}
                >
                  {card.title}
                </p>
                <p
                  className="text-2xl font-bold leading-none mt-0.5"
                  style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}
                >
                  {card.value.toLocaleString()}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Dataset breakdown ────────────────────────────── */}
      {datasetStats && (
        <div className="surface overflow-hidden">
          <div
            className="flex items-center justify-between px-6 py-4"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <h2
              className="text-base font-bold"
              style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}
            >
              Dataset Breakdown
            </h2>
            <select
              value={selectedType}
              onChange={e => setSelectedType(e.target.value)}
              className="form-input !w-auto text-xs py-1 px-2"
            >
              <option value="all">All Datasets</option>
              <option value="text">Text Datasets</option>
              <option value="asr">ASR Datasets</option>
            </select>
          </div>

          <div className="p-6 space-y-6">
            {/* Text datasets */}
            {(selectedType === 'all' || selectedType === 'text') && (datasetStats.text_datasets?.length > 0) && (
              <div>
                <p className="section-label mb-3">Text Datasets</p>
                <div className="space-y-2">
                  {datasetStats.text_datasets.map(ds => (
                    <div
                      key={ds.id}
                      className="flex items-center justify-between px-4 py-3 rounded"
                      style={{ background: 'var(--bg-input)' }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-hi)' }}>
                          {ds.name}
                        </p>
                        <p className="text-xs mt-0.5 capitalize" style={{ color: 'var(--text-dim)' }}>
                          {ds.task_type?.replace(/_/g, ' ')}
                          {ds.has_pipeline === false && ' · No pipeline runs'}
                        </p>
                      </div>
                      <div className="ml-6 flex-shrink-0">
                        {pipelines[ds.id]
                          ? <PipelineProgress pipeline={pipelines[ds.id]} />
                          : <span className="text-xs italic" style={{ color: 'var(--text-dim)' }}>Not started</span>
                        }
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ASR datasets */}
            {(selectedType === 'all' || selectedType === 'asr') && (datasetStats.asr_datasets?.length > 0) && (
              <div>
                <p className="section-label mb-3">ASR Datasets</p>
                <div className="space-y-2">
                  {datasetStats.asr_datasets.map(ds => {
                    const pct = ds.file_count > 0 ? Math.round((ds.completed_count / ds.file_count) * 100) : 0
                    return (
                      <div
                        key={ds.id}
                        className="flex items-center justify-between px-4 py-3 rounded"
                        style={{ background: 'var(--bg-input)' }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-hi)' }}>
                            {ds.name}
                          </p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>
                            {ds.pending_count} pending · {ds.completed_count}/{ds.file_count} files
                          </p>
                        </div>
                        <div className="ml-6 flex items-center gap-3 flex-shrink-0">
                          <div className="w-28 progress-track">
                            <div className="progress-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-semibold w-9 text-right tabular-nums" style={{ color: 'var(--text-dim)' }}>
                            {pct}%
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {(!datasetStats.text_datasets?.length && !datasetStats.asr_datasets?.length) && (
              <p className="text-sm text-center py-6" style={{ color: 'var(--text-dim)' }}>
                No datasets yet. Create one to get started.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Quick actions ────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <a
          href="/text"
          className="surface p-5 group flex items-start gap-4 transition-colors"
        >
          <div
            className="flex-shrink-0 w-10 h-10 rounded flex items-center justify-center"
            style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)" }}
          >
            <Workflow size={18} style={{ color: 'var(--accent)' }} strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-hi)' }}>
              BR Pipeline
            </p>
            <p className="text-sm mt-0.5 leading-snug" style={{ color: 'var(--text-dim)' }}>
              Batch-process Bahasa Rojak data through the 4-stage automated pipeline
            </p>
          </div>
          <ArrowRight
            size={16}
            strokeWidth={2}
            className="flex-shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--text-dim)' }}
          />
        </a>

        <a
          href="/asr"
          className="surface p-5 group flex items-start gap-4 transition-colors"
        >
          <div
            className="flex-shrink-0 w-10 h-10 rounded flex items-center justify-center"
            style={{ background: "color-mix(in srgb, #a78bfa 15%, transparent)" }}
          >
            <Mic size={18} style={{ color: '#a78bfa' }} strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-hi)' }}>
              ASR Datasets
            </p>
            <p className="text-sm mt-0.5 leading-snug" style={{ color: 'var(--text-dim)' }}>
              Transcribe and correct audio files using Whisper or Qwen3 ASR
            </p>
          </div>
          <ArrowRight
            size={16}
            strokeWidth={2}
            className="flex-shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--text-dim)' }}
          />
        </a>
      </div>

      {/* ── Getting started ──────────────────────────────── */}
      <div className="surface overflow-hidden">
        <div
          className="px-6 py-4 flex items-center gap-2"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <TrendingUp size={15} style={{ color: 'var(--text-dim)' }} strokeWidth={2} />
          <h2
            className="text-base font-bold"
            style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}
          >
            Getting Started
          </h2>
        </div>

        <div className="p-6 grid md:grid-cols-2 gap-8">
          {/* BR Pipeline */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Workflow size={14} style={{ color: 'var(--accent)' }} strokeWidth={2} />
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-hi)' }}>
                BR Pipeline (Automated)
              </h3>
            </div>
            <ol className="space-y-1.5 text-sm" style={{ color: 'var(--text-dim)' }}>
              {[
                'Create a text dataset with "General (For BR Pipeline)" type',
                'Upload a JSON or CSV file with Malaysian English conversation data',
                'Start the BR Pipeline — all 4 stages run automatically in batch',
                'Review and edit Stage 4 model responses for quality control',
                'Export results as CSV for analysis or model training',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className="flex-shrink-0 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center mt-0.5"
                    style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                  >
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <div
              className="mt-4 px-4 py-3 rounded text-xs leading-relaxed"
              style={{ background: 'var(--bg-input)', color: 'var(--text-dim)' }}
            >
              <strong style={{ color: 'var(--text-hi)' }}>Tip:</strong> Stages 1–3 run fully
              automatically. You only need to review Stage 4 responses.
            </div>
          </div>

          {/* ASR Workflow */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Mic size={14} style={{ color: '#a78bfa' }} strokeWidth={2} />
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-hi)' }}>
                ASR Annotation Workflow
              </h3>
            </div>
            <ol className="space-y-1.5 text-sm" style={{ color: 'var(--text-dim)' }}>
              {[
                'Create an ASR dataset',
                'Upload audio files in batch (MP3, WAV, etc.) or import from YouTube',
                'Auto-segment long recordings into manageable chunks',
                'Run Whisper or Qwen3 transcription on all files in batch',
                'Review transcripts, listen to audio, and correct mistakes',
                'Export completed transcriptions for training data',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span
                    className="flex-shrink-0 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center mt-0.5"
                    style={{ background: 'color-mix(in srgb, #a78bfa 20%, transparent)', color: '#a78bfa' }}
                  >
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
