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
  {
    title: 'Text Datasets',
    value: stats?.text_datasets ?? 0,
    icon: FolderOpen,
    border: '#3B82F6',
    iconCls: 'text-blue-500',
    iconBg: 'bg-blue-50 dark:bg-blue-950/60',
  },
  {
    title: 'Text Records',
    value: stats?.text_records ?? 0,
    icon: FileText,
    border: '#10B981',
    iconCls: 'text-emerald-500',
    iconBg: 'bg-emerald-50 dark:bg-emerald-950/60',
  },
  {
    title: 'Pipeline Completed',
    value: stats?.text_annotated ?? 0,
    icon: Cpu,
    border: '#8B5CF6',
    iconCls: 'text-violet-500',
    iconBg: 'bg-violet-50 dark:bg-violet-950/60',
  },
  {
    title: 'ASR Datasets',
    value: stats?.asr_datasets ?? 0,
    icon: Music2,
    border: '#F59E0B',
    iconCls: 'text-amber-500',
    iconBg: 'bg-amber-50 dark:bg-amber-950/60',
  },
  {
    title: 'Audio Files',
    value: stats?.audio_files ?? 0,
    icon: Headphones,
    border: '#EC4899',
    iconCls: 'text-pink-500',
    iconBg: 'bg-pink-50 dark:bg-pink-950/60',
  },
  {
    title: 'ASR Completed',
    value: stats?.asr_completed ?? 0,
    icon: CheckCircle2,
    border: '#0D9488',
    iconCls: 'text-teal-600 dark:text-teal-400',
    iconBg: 'bg-teal-50 dark:bg-teal-950/60',
  },
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
                  background: isDone ? '#10B981' : isActive ? '#F59E0B' : undefined,
                }}
              />
            </div>
            <span className={`text-[10px] font-medium group-hover:underline ${
              isDone    ? 'text-emerald-600 dark:text-emerald-400' :
              isActive  ? 'text-amber-600 dark:text-amber-400' :
              'text-slate-400 dark:text-slate-500'
            }`}>
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
          style={{ borderTopColor: 'var(--clr-primary)', borderRightColor: 'var(--clr-primary)' }}
        />
        <p className="text-sm" style={{ color: 'var(--clr-text-muted)' }}>Loading dashboard…</p>
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
          style={{ fontFamily: 'Syne, sans-serif', color: 'var(--clr-text)' }}
        >
          Overview
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--clr-text-muted)' }}>
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
              style={{ borderLeftColor: card.border, borderLeftWidth: '3px' }}
            >
              <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${card.iconBg}`}>
                <Icon size={17} className={card.iconCls} strokeWidth={2} />
              </div>
              <div>
                <p
                  className="text-[11px] font-bold tracking-widest uppercase"
                  style={{ fontFamily: 'Syne, sans-serif', color: 'var(--clr-text-muted)' }}
                >
                  {card.title}
                </p>
                <p
                  className="text-2xl font-bold leading-none mt-0.5"
                  style={{ fontFamily: 'Syne, sans-serif', color: 'var(--clr-text)' }}
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
            style={{ borderBottom: '1px solid var(--clr-border)' }}
          >
            <h2
              className="text-base font-bold"
              style={{ fontFamily: 'Syne, sans-serif', color: 'var(--clr-text)' }}
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
                      className="flex items-center justify-between px-4 py-3 rounded-lg"
                      style={{ background: 'var(--clr-surface-2)' }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--clr-text)' }}>
                          {ds.name}
                        </p>
                        <p className="text-xs mt-0.5 capitalize" style={{ color: 'var(--clr-text-muted)' }}>
                          {ds.task_type?.replace(/_/g, ' ')}
                          {ds.has_pipeline === false && ' · No pipeline runs'}
                        </p>
                      </div>
                      <div className="ml-6 flex-shrink-0">
                        {pipelines[ds.id]
                          ? <PipelineProgress pipeline={pipelines[ds.id]} />
                          : <span className="text-xs italic" style={{ color: 'var(--clr-text-muted)' }}>Not started</span>
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
                        className="flex items-center justify-between px-4 py-3 rounded-lg"
                        style={{ background: 'var(--clr-surface-2)' }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate" style={{ color: 'var(--clr-text)' }}>
                            {ds.name}
                          </p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--clr-text-muted)' }}>
                            {ds.pending_count} pending · {ds.completed_count}/{ds.file_count} files
                          </p>
                        </div>
                        <div className="ml-6 flex items-center gap-3 flex-shrink-0">
                          <div className="w-28 progress-track">
                            <div className="progress-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-semibold w-9 text-right tabular-nums" style={{ color: 'var(--clr-text-muted)' }}>
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
              <p className="text-sm text-center py-6" style={{ color: 'var(--clr-text-muted)' }}>
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
          className="surface p-5 group flex items-start gap-4 hover:shadow-md transition-shadow"
        >
          <div
            className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: '#EFF6FF' }}
          >
            <Workflow size={18} style={{ color: '#3B82F6' }} strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--clr-text)' }}>
              BR Pipeline
            </p>
            <p className="text-sm mt-0.5 leading-snug" style={{ color: 'var(--clr-text-muted)' }}>
              Batch-process Bahasa Rojak data through the 4-stage automated pipeline
            </p>
          </div>
          <ArrowRight
            size={16}
            strokeWidth={2}
            className="flex-shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--clr-text-muted)' }}
          />
        </a>

        <a
          href="/asr"
          className="surface p-5 group flex items-start gap-4 hover:shadow-md transition-shadow"
        >
          <div
            className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: '#F5F3FF' }}
          >
            <Mic size={18} style={{ color: '#8B5CF6' }} strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--clr-text)' }}>
              ASR Datasets
            </p>
            <p className="text-sm mt-0.5 leading-snug" style={{ color: 'var(--clr-text-muted)' }}>
              Transcribe and correct audio files using Whisper or Qwen3 ASR
            </p>
          </div>
          <ArrowRight
            size={16}
            strokeWidth={2}
            className="flex-shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--clr-text-muted)' }}
          />
        </a>
      </div>

      {/* ── Getting started ──────────────────────────────── */}
      <div className="surface overflow-hidden">
        <div
          className="px-6 py-4 flex items-center gap-2"
          style={{ borderBottom: '1px solid var(--clr-border)' }}
        >
          <TrendingUp size={15} style={{ color: 'var(--clr-text-muted)' }} strokeWidth={2} />
          <h2
            className="text-base font-bold"
            style={{ fontFamily: 'Syne, sans-serif', color: 'var(--clr-text)' }}
          >
            Getting Started
          </h2>
        </div>

        <div className="p-6 grid md:grid-cols-2 gap-8">
          {/* BR Pipeline */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Workflow size={14} style={{ color: '#3B82F6' }} strokeWidth={2} />
              <h3 className="text-sm font-bold" style={{ color: 'var(--clr-text)' }}>
                BR Pipeline (Automated)
              </h3>
            </div>
            <ol className="space-y-1.5 text-sm" style={{ color: 'var(--clr-text-muted)' }}>
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
                    style={{ background: '#EFF6FF', color: '#3B82F6' }}
                  >
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <div
              className="mt-4 px-4 py-3 rounded-lg text-xs leading-relaxed"
              style={{ background: 'var(--clr-surface-2)', color: 'var(--clr-text-muted)' }}
            >
              <strong style={{ color: 'var(--clr-text)' }}>Tip:</strong> Stages 1–3 run fully
              automatically. You only need to review Stage 4 responses.
            </div>
          </div>

          {/* ASR Workflow */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Mic size={14} style={{ color: '#8B5CF6' }} strokeWidth={2} />
              <h3 className="text-sm font-bold" style={{ color: 'var(--clr-text)' }}>
                ASR Annotation Workflow
              </h3>
            </div>
            <ol className="space-y-1.5 text-sm" style={{ color: 'var(--clr-text-muted)' }}>
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
                    style={{ background: '#F5F3FF', color: '#8B5CF6' }}
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
