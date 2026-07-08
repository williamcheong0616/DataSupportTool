import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Plus, Search, FileText, CheckCircle2, ChevronLeft,
  ChevronRight, BarChart2, Trash2, Download, Play,
  ExternalLink, Layers,
} from 'lucide-react'
import {
  getTextDatasets,
  createTextDataset,
  deleteTextDataset,
  uploadTextData,
  exportTextDataset,
  startBRPipeline,
  listBRPipelines,
} from '../api'

const TASK_TYPES = [
  { value: 'general',                       label: 'General (For BR Pipeline)' },
  { value: 'bahasa_rojak_identification',    label: 'Bahasa Rojak Identification (Yes/No)' },
  { value: 'bahasa_rojak_classification',    label: 'Bahasa Rojak Classification' },
  { value: 'text_modification',             label: 'Text Modification (Subject/Context)' },
  { value: 'question_generation',           label: 'Question Generation (3 Questions)' },
]

const PIPELINE_STAGES = [
  { num: 1, key: 'stage_1', path: 'classification', label: 'Classify' },
  { num: 2, key: 'stage_2', path: 'restructure',    label: 'Restructure' },
  { num: 3, key: 'stage_3', path: 'questions',      label: 'Questions' },
  { num: 4, key: 'stage_4', path: 'responses',      label: 'Responses' },
]

/* ── Shared modal chrome ───────────────────────────────────── */
function Modal({ title, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="surface w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--clr-border)' }}>
          <h2 className="text-base font-bold" style={{ fontFamily: 'Raleway, sans-serif', color: 'var(--clr-text)' }}>
            {title}
          </h2>
          <button onClick={onClose} className="text-xl leading-none opacity-40 hover:opacity-70 transition-opacity">×</button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-6 py-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--clr-border)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

function FieldLabel({ children }) {
  return (
    <label className="block text-xs font-semibold mb-1.5 uppercase tracking-wide" style={{ fontFamily: 'Raleway, sans-serif', color: 'var(--clr-text-muted)' }}>
      {children}
    </label>
  )
}

/* ── Pipeline stage progress strip ────────────────────────── */
function StageProgress({ pipeline }) {
  if (!pipeline) return null
  const currentStage = pipeline.current_stage_num || 1
  return (
    <div className="flex gap-1 mt-2">
      {PIPELINE_STAGES.map(stage => {
        const prog = pipeline.stage_progress?.[stage.key]
        const pct = prog ? Math.round((prog.done / prog.total) * 100) : 0
        const isDone = stage.num < currentStage || pct === 100
        const isActive = stage.num === currentStage
        return (
          <Link
            key={stage.key}
            to={`/br-pipeline/${stage.path}/${pipeline.id}`}
            className="group flex-1 flex flex-col items-center gap-0.5"
            title={`${stage.label}: ${prog?.done ?? 0}/${prog?.total ?? 0}`}
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
            <span className={`text-[9px] font-medium group-hover:underline ${
              isDone   ? 'text-emerald-600 dark:text-emerald-400' :
              isActive ? 'text-amber-600 dark:text-amber-400' :
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

function TextDatasets() {
  const navigate = useNavigate()
  const [datasets, setDatasets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showUpload, setShowUpload] = useState(null)
  const [newDataset, setNewDataset] = useState({ name: '', task_type: 'general', created_by: localStorage.getItem('dst_username') || '' })
  const [uploadFile, setUploadFile] = useState(null)
  const [headers, setHeaders] = useState([])
  const [selectedColumn, setSelectedColumn] = useState('')
  const [uploading, setUploading] = useState(false)
  const [pipelines, setPipelines] = useState({})
  const [pipelineList, setPipelineList] = useState([])
  const [startingPipeline, setStartingPipeline] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [filterText, setFilterText] = useState('')

  useEffect(() => { fetchDatasets(); fetchPipelines() }, [])

  const fetchDatasets = async () => {
    try {
      const res = await getTextDatasets()
      setDatasets(res.data)
    } catch (err) {
      console.error('Failed to fetch datasets:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchPipelines = async () => {
    try {
      const res = await listBRPipelines()
      setPipelineList(res.data.pipelines || [])
      const map = {}
      ;(res.data.pipelines || []).forEach(p => {
        if (!map[p.dataset_id] || p.id > map[p.dataset_id].id) map[p.dataset_id] = p
      })
      setPipelines(map)
    } catch (err) {
      console.error('Failed to fetch pipelines:', err)
    }
  }

  const handleStartPipeline = async (datasetId) => {
    if (!confirm('Start BR Pipeline Stage 1 (BR Detection + Language Detection)?\n\nNote: This only runs Stage 1. Use the rerun buttons in the BR Classification page to manually run Stages 2 & 3 when ready.')) return
    setStartingPipeline(datasetId)
    try {
      const res = await startBRPipeline(datasetId)
      alert(`Pipeline #${res.data.id} started — ${res.data.total_records} records will be processed.`)
      fetchPipelines()
      navigate(`/br-pipeline/classification/${res.data.id}`)
    } catch (err) {
      alert('Failed to start pipeline: ' + (err.response?.data?.detail || err.message))
    } finally {
      setStartingPipeline(null)
    }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      await createTextDataset(newDataset)
      if (newDataset.created_by) localStorage.setItem('dst_username', newDataset.created_by)
      setShowCreate(false)
      setNewDataset({ name: '', task_type: 'general', created_by: newDataset.created_by })
      fetchDatasets()
    } catch (err) {
      alert('Failed to create dataset: ' + (err.response?.data?.detail || err.message))
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this dataset?')) return
    try {
      await deleteTextDataset(id)
      fetchDatasets()
    } catch (err) {
      alert('Failed to delete dataset')
    }
  }

  const handleFileSelect = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploadFile(file)
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target.result
      try {
        if (file.name.endsWith('.jsonl')) {
          const firstLine = content.split('\n').find(l => l.trim())
          if (firstLine) setHeaders(Object.keys(JSON.parse(firstLine)))
        } else if (file.name.endsWith('.json')) {
          const data = JSON.parse(content)
          setHeaders(Object.keys(Array.isArray(data) ? data[0] : data))
        } else if (file.name.endsWith('.csv')) {
          const lines = content.split('\n')
          if (lines.length > 0) setHeaders(lines[0].split(',').map(h => h.trim().replace(/"/g, '')))
        }
      } catch (err) {
        console.error('Failed to parse file headers:', err)
        setHeaders([])
      }
    }
    reader.readAsText(file)
  }

  const handleUpload = async () => {
    if (!uploadFile || !selectedColumn) { alert('Please select a file and choose the text column'); return }
    setUploading(true)
    try {
      await uploadTextData(showUpload, uploadFile, selectedColumn)
      setShowUpload(null); setUploadFile(null); setHeaders([]); setSelectedColumn('')
      fetchDatasets()
    } catch (err) {
      alert('Failed to upload: ' + (err.response?.data?.detail || err.message))
    } finally {
      setUploading(false)
    }
  }

  const handleExport = async (id, format) => {
    try {
      const dataset = datasets.find(d => d.id === id)
      const res = await exportTextDataset(id, format)
      const blob = new Blob([res.data], { type: format === 'csv' ? 'text/csv' : 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const date = new Date().toISOString().split('T')[0]
      a.download = `${(dataset?.name || 'dataset').replace(/[^a-zA-Z0-9]/g, '_')}_${date}.${format === 'csv' ? 'csv' : 'jsonl'}`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      alert('Failed to export: ' + (err.response?.data?.detail || err.message))
    }
  }

  const getTaskLabel = (taskType) => TASK_TYPES.find(t => t.value === taskType)?.label || taskType

  const pipelineStatusChip = (pipeline) => {
    const color = pipeline.status === 'completed' ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50'
      : pipeline.status === 'running' ? 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50'
      : 'text-slate-500 bg-slate-100 dark:bg-slate-800'
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${color}`}>{pipeline.status}</span>
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-72 gap-4">
        <div className="w-8 h-8 rounded-full border-2 border-transparent animate-spin"
          style={{ borderTopColor: 'var(--clr-primary)', borderRightColor: 'var(--clr-primary)' }} />
        <p className="text-sm" style={{ color: 'var(--clr-text-muted)' }}>Loading datasets…</p>
      </div>
    )
  }

  const visibleDatasets = datasets.filter(d => !filterText || d.name.toLowerCase().includes(filterText.toLowerCase()))

  return (
    <div className="flex gap-5">

      {/* ── BR Pipeline sidebar ─────────────────────────────── */}
      <div className={`${sidebarCollapsed ? 'w-10' : 'w-64'} flex-shrink-0 transition-all duration-200`}>
        <div className="surface overflow-hidden sticky top-20">
          {/* Sidebar header */}
          <div
            className="flex items-center justify-between px-3 py-2.5"
            style={{ background: 'linear-gradient(135deg, #D97706, #F59E0B)', borderBottom: '1px solid var(--clr-border)' }}
          >
            {!sidebarCollapsed && (
              <span className="text-white text-xs font-bold tracking-widest uppercase" style={{ fontFamily: 'Raleway, sans-serif' }}>
                BR Pipelines
              </span>
            )}
            <button
              onClick={() => setSidebarCollapsed(c => !c)}
              className="p-1 text-white hover:bg-white/20 rounded transition-colors"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          </div>

          {!sidebarCollapsed && (
            <div className="max-h-[70vh] overflow-y-auto">
              {pipelineList.length === 0 ? (
                <p className="text-xs p-4" style={{ color: 'var(--clr-text-muted)' }}>
                  No pipelines started yet.
                </p>
              ) : (
                <div className="divide-y" style={{ borderColor: 'var(--clr-border)' }}>
                  {pipelineList.map(pipeline => (
                    <div key={pipeline.id} className="px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold truncate" style={{ color: 'var(--clr-text)' }}>
                          {pipeline.dataset_name}
                        </span>
                        <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--clr-text-muted)' }}>
                          #{pipeline.id}
                        </span>
                      </div>
                      <StageProgress pipeline={pipeline} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Raleway, sans-serif', color: 'var(--clr-text)' }}>
              Text Datasets
            </h1>
            <p className="mt-0.5 text-sm" style={{ color: 'var(--clr-text-muted)' }}>
              Manage text datasets and BR pipeline workflows
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" style={{ color: 'var(--clr-text)' }} />
              <input
                type="text"
                placeholder="Search…"
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                className="form-input pl-8 !w-44"
              />
            </div>
            <button
              onClick={() => navigate('/text/response-pool')}
              className="btn-secondary"
              title="View all original texts and model responses"
            >
              <BarChart2 size={13} /> Response Pool
            </button>
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              <Plus size={14} strokeWidth={2.5} /> New Dataset
            </button>
          </div>
        </div>

        {/* Create modal */}
        {showCreate && (
          <Modal
            title="Create Text Dataset"
            onClose={() => setShowCreate(false)}
            footer={
              <>
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
                <button form="create-text-form" type="submit" className="btn-primary">Create Dataset</button>
              </>
            }
          >
            <form id="create-text-form" onSubmit={handleCreate} className="space-y-4">
              <div>
                <FieldLabel>Dataset Name</FieldLabel>
                <input
                  type="text"
                  value={newDataset.name}
                  onChange={e => setNewDataset({ ...newDataset, name: e.target.value })}
                  className="form-input"
                  placeholder="e.g. MY English Corpus v1"
                  required
                />
              </div>
              <div>
                <FieldLabel>Task Type</FieldLabel>
                <select
                  value={newDataset.task_type}
                  onChange={e => setNewDataset({ ...newDataset, task_type: e.target.value })}
                  className="form-input"
                >
                  {TASK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Your Name</FieldLabel>
                <input
                  type="text"
                  value={newDataset.created_by}
                  onChange={e => setNewDataset({ ...newDataset, created_by: e.target.value })}
                  className="form-input"
                  placeholder="Enter your name"
                  required
                />
              </div>
            </form>
          </Modal>
        )}

        {/* Upload modal */}
        {showUpload && (
          <Modal
            title="Upload Data File"
            onClose={() => { setShowUpload(null); setUploadFile(null); setHeaders([]); setSelectedColumn('') }}
            footer={
              <>
                <button type="button" onClick={() => { setShowUpload(null); setUploadFile(null); setHeaders([]); setSelectedColumn('') }} className="btn-secondary">
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  disabled={uploading || !uploadFile || !selectedColumn}
                  className="btn-primary"
                >
                  {uploading ? 'Uploading…' : 'Upload'}
                </button>
              </>
            }
          >
            <div className="space-y-4">
              <div>
                <FieldLabel>Select JSON, JSONL, or CSV File</FieldLabel>
                <input
                  type="file"
                  accept=".json,.jsonl,.csv"
                  onChange={handleFileSelect}
                  className="form-input"
                />
              </div>
              {headers.length > 0 && (
                <div>
                  <FieldLabel>Text Column</FieldLabel>
                  <select
                    value={selectedColumn}
                    onChange={e => setSelectedColumn(e.target.value)}
                    className="form-input"
                  >
                    <option value="">— Choose column —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <p className="mt-1.5 text-xs" style={{ color: 'var(--clr-text-muted)' }}>
                    Detected columns: {headers.join(', ')}
                  </p>
                </div>
              )}
            </div>
          </Modal>
        )}

        {/* Dataset list */}
        {visibleDatasets.length === 0 ? (
          <div className="surface p-12 text-center">
            <FileText size={32} className="mx-auto mb-3 opacity-30" style={{ color: 'var(--clr-text)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--clr-text)' }}>No datasets yet</p>
            <p className="text-sm mt-1" style={{ color: 'var(--clr-text-muted)' }}>
              Create a dataset and upload your JSON, JSONL, or CSV file.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleDatasets.map(dataset => {
              const pipeline = pipelines[dataset.id]
              const pct = dataset.record_count > 0
                ? Math.round(((dataset.annotated_count || 0) / dataset.record_count) * 100)
                : 0

              return (
                <div key={dataset.id} className="surface p-5">
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-bold truncate" style={{ fontFamily: 'Raleway, sans-serif', color: 'var(--clr-text)' }}>
                        {dataset.name}
                      </h3>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--clr-text-muted)' }}>
                        {getTaskLabel(dataset.task_type)}
                      </p>
                      <div className="flex flex-wrap gap-4 mt-1.5 text-xs" style={{ color: 'var(--clr-text-muted)' }}>
                        <span className="flex items-center gap-1"><Layers size={11} /> {dataset.record_count || 0} records</span>
                        <span className="flex items-center gap-1"><CheckCircle2 size={11} /> {dataset.annotated_count || 0} annotated</span>
                        {dataset.original_headers && (
                          <span>Columns: {dataset.original_headers.join(', ')}</span>
                        )}
                      </div>

                      {/* Progress */}
                      <div className="mt-3 max-w-xs">
                        {pipeline ? (
                          <>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px]" style={{ color: 'var(--clr-text-muted)' }}>
                                Stage {pipeline.current_stage_num ?? 1} of 4
                              </span>
                              {pipelineStatusChip(pipeline)}
                            </div>
                            <StageProgress pipeline={pipeline} />
                          </>
                        ) : dataset.record_count > 0 && (
                          <div>
                            <div className="flex justify-between text-[11px] mb-1" style={{ color: 'var(--clr-text-muted)' }}>
                              <span>Annotation Progress</span><span>{pct}%</span>
                            </div>
                            <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: actions */}
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      {(!dataset.record_count || dataset.record_count === 0) ? (
                        <button
                          onClick={() => setShowUpload(dataset.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 transition-colors"
                        >
                          <Plus size={11} /> Upload Data
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => navigate(`/text/${dataset.id}/annotate`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg btn-primary"
                          >
                            Annotate
                          </button>
                          {pipeline ? (
                            <button
                              onClick={() => navigate(`/br-pipeline/classification/${pipeline.id}`)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 hover:bg-amber-100 transition-colors"
                            >
                              <ExternalLink size={11} /> View Pipeline
                            </button>
                          ) : (
                            <button
                              onClick={() => handleStartPipeline(dataset.id)}
                              disabled={startingPipeline === dataset.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 hover:bg-orange-100 transition-colors disabled:opacity-50"
                            >
                              <Play size={11} /> {startingPipeline === dataset.id ? 'Starting…' : 'Start Pipeline'}
                            </button>
                          )}
                          <button
                            onClick={() => handleExport(dataset.id, 'csv')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 hover:bg-blue-100 transition-colors"
                          >
                            <Download size={11} /> CSV
                          </button>
                          <button
                            onClick={() => handleExport(dataset.id, 'jsonl')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 hover:bg-violet-100 transition-colors"
                          >
                            <Download size={11} /> JSONL
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleDelete(dataset.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 hover:bg-red-100 transition-colors"
                      >
                        <Trash2 size={11} /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default TextDatasets
