import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, ArrowLeft } from 'lucide-react'
import { getResponsePool } from '../api'

const PAGE_SIZE = 100

// Assign a stable qualitative color per dataset name
const PALETTE = ['#4a9eff', '#a78bfa', '#3dd68c', '#fb923c', '#f472b6', '#2dd4bf', '#e8a820', '#818cf8']

function highlightText(text, query) {
  if (!query) return <span>{text}</span>
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="rounded px-0.5" style={{ background: 'var(--amber)', color: '#000' }}>{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
  )
}

function DatasetBadge({ name, color }) {
  return (
    <span
      className="px-2 py-0.5 text-xs font-semibold rounded"
      style={{
        fontFamily: 'var(--mono)',
        background: `color-mix(in srgb, ${color} 18%, transparent)`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
      }}
    >
      {name}
    </span>
  )
}

function TextResponsePool() {
  const navigate = useNavigate()
  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [originalCount, setOriginalCount] = useState(0)
  const [modelResponseCount, setModelResponseCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [datasetColorMap, setDatasetColorMap] = useState({})
  const [filterType, setFilterType] = useState('all') // 'all' | 'original_text' | 'model_response'
  const debounceRef = useRef(null)

  const assignColors = useCallback((items) => {
    setDatasetColorMap(prev => {
      const updated = { ...prev }
      let idx = Object.keys(updated).length
      items.forEach(item => {
        if (!(item.dataset_name in updated)) {
          updated[item.dataset_name] = PALETTE[idx % PALETTE.length]
          idx++
        }
      })
      return updated
    })
  }, [])

  const fetchPool = useCallback(async (query, newOffset, typeFilter = 'all') => {
    setLoading(true)
    try {
      const res = await getResponsePool(query, PAGE_SIZE, newOffset, typeFilter)
      const data = res.data
      if (newOffset === 0) {
        setResults(data.results)
      } else {
        setResults(prev => [...prev, ...data.results])
      }
      setTotal(data.total)
      setOriginalCount(data.original_count)
      setModelResponseCount(data.model_response_count)
      setHasMore(newOffset + PAGE_SIZE < data.total)
      assignColors(data.results)
    } catch (err) {
      console.error('Failed to fetch response pool:', err)
    } finally {
      setLoading(false)
    }
  }, [assignColors])

  // Fetch on initial load and when filter changes
  useEffect(() => {
    setOffset(0)
    fetchPool('', 0, filterType)
  }, [filterType])

  // Debounced search: fires 400 ms after user stops typing
  const handleSearchChange = (e) => {
    const val = e.target.value
    setSearchInput(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setActiveQuery(val)
      setOffset(0)
      fetchPool(val, 0, filterType)
    }, 400)
  }

  const handleLoadMore = () => {
    const newOffset = offset + PAGE_SIZE
    setOffset(newOffset)
    fetchPool(activeQuery, newOffset, filterType)
  }

  const displayed = results

  const STATS = [
    { label: 'Total Entries',    value: total,              color: 'var(--text-hi)' },
    { label: 'Original Texts',   value: originalCount,       color: 'var(--accent)' },
    { label: 'Model Responses',  value: modelResponseCount,  color: '#a78bfa' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <button
            onClick={() => navigate('/text')}
            className="inline-flex items-center gap-1.5 text-sm font-medium mb-2 transition-colors"
            style={{ color: 'var(--text-dim)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            <ArrowLeft size={14} /> Back to Datasets
          </button>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--mono)', color: 'var(--text-hi)' }}>
            Cross-Dataset Response Pool
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-dim)' }}>
            All original texts and model responses from every dataset — search to detect overlap and assess over/under-training risk.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {STATS.map(s => (
          <div key={s.label} className="surface p-4 text-center">
            <div className="text-3xl font-bold" style={{ fontFamily: 'var(--mono)', color: s.color }}>
              {s.value.toLocaleString()}
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--text-dim)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search + filter bar */}
      <div className="surface p-4 mb-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
          <input
            type="text"
            value={searchInput}
            onChange={handleSearchChange}
            placeholder="Search across all original texts and model responses…"
            className="dst-input pl-9"
            style={{ height: 34 }}
          />
          {loading && (
            <span className="absolute inset-y-0 right-3 flex items-center">
              <div className="dst-spin" />
            </span>
          )}
        </div>
        <select
          value={filterType}
          onChange={e => { setFilterType(e.target.value); setOffset(0) }}
          className="dst-input dst-select"
          style={{ height: 34, width: 'auto' }}
        >
          <option value="all">All types</option>
          <option value="original_text">Original texts only</option>
          <option value="model_response">Model responses only</option>
        </select>
      </div>

      {/* Dataset legend */}
      {Object.keys(datasetColorMap).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(datasetColorMap).map(([name, color]) => (
            <DatasetBadge key={name} name={name} color={color} />
          ))}
        </div>
      )}

      {/* Results */}
      {displayed.length === 0 && !loading ? (
        <div className="surface p-12 text-center text-sm" style={{ color: 'var(--text-dim)' }}>
          {activeQuery ? `No results matching "${activeQuery}"` : 'No entries found across datasets.'}
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((item, i) => {
            const color = datasetColorMap[item.dataset_name] || PALETTE[0]
            return (
              <div key={`${item.type}-${item.record_id}-${item.model_name}-${i}`} className="surface p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {/* Dataset badge */}
                  <DatasetBadge name={item.dataset_name} color={color} />
                  {/* Type badge */}
                  {item.type === 'original_text' ? (
                    <span
                      className="px-2 py-0.5 text-xs rounded"
                      style={{ fontFamily: 'var(--mono)', background: 'var(--bg-input)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}
                    >
                      Original Text
                    </span>
                  ) : (
                    <span
                      className="px-2 py-0.5 text-xs rounded"
                      style={{
                        fontFamily: 'var(--mono)',
                        background: 'color-mix(in srgb, #a78bfa 15%, transparent)',
                        color: '#a78bfa',
                        border: '1px solid color-mix(in srgb, #a78bfa 35%, transparent)',
                      }}
                    >
                      Model Response · {item.model_name}
                    </span>
                  )}
                  <span className="text-xs ml-auto" style={{ color: 'var(--text-dim)' }}>record #{item.record_id}</span>
                </div>

                {/* If model response, show the question it was answering */}
                {item.type === 'model_response' && item.question && (
                  <div
                    className="mb-2 text-xs italic pl-2"
                    style={{ color: 'var(--text-dim)', borderLeft: '2px solid var(--border-hi)' }}
                  >
                    Q: {item.question}
                  </div>
                )}

                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text)' }}>
                  {highlightText(item.text, activeQuery)}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {/* Load more */}
      {hasMore && !loading && (
        <div className="mt-6 text-center">
          <button onClick={handleLoadMore} className="btn-primary">
            Load more ({results.length} / {total} loaded)
          </button>
        </div>
      )}

      {loading && results.length > 0 && (
        <div className="mt-4 flex justify-center">
          <div className="dst-spin" />
        </div>
      )}
    </div>
  )
}

export default TextResponsePool
