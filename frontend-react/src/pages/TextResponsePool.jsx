import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getResponsePool } from '../api'

const PAGE_SIZE = 100

// Assign a stable color per dataset name using a fixed palette
const PALETTE = [
  'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-700',
  'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 border-purple-200 dark:border-purple-700',
  'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border-green-200 dark:border-green-700',
  'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200 border-orange-200 dark:border-orange-700',
  'bg-pink-100 dark:bg-pink-900/40 text-pink-800 dark:text-pink-200 border-pink-200 dark:border-pink-700',
  'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200 border-teal-200 dark:border-teal-700',
  'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 border-yellow-200 dark:border-yellow-700',
  'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200 border-indigo-200 dark:border-indigo-700',
]

function highlightText(text, query) {
  if (!query) return <span>{text}</span>
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="bg-yellow-300 dark:bg-yellow-600 text-black dark:text-white rounded px-0.5">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
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

  const fetchPool = useCallback(async (query, newOffset) => {
    setLoading(true)
    try {
      const res = await getResponsePool(query, PAGE_SIZE, newOffset)
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

  // Initial load
  useEffect(() => {
    fetchPool('', 0)
  }, [])

  // Debounced search: fires 400 ms after user stops typing
  const handleSearchChange = (e) => {
    const val = e.target.value
    setSearchInput(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setActiveQuery(val)
      setOffset(0)
      fetchPool(val, 0)
    }, 400)
  }

  const handleLoadMore = () => {
    const newOffset = offset + PAGE_SIZE
    setOffset(newOffset)
    fetchPool(activeQuery, newOffset)
  }

  const displayed = filterType === 'all'
    ? results
    : results.filter(r => r.type === filterType)

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <button onClick={() => navigate('/text')} className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 mb-2">
            ← Back to Datasets
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">🔍 Cross-Dataset Response Pool</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
            All original texts and model responses from every dataset — search to detect overlap and assess over/under-training risk.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Entries', value: total, color: 'text-gray-700 dark:text-gray-300' },
          { label: 'Original Texts', value: originalCount, color: 'text-blue-600 dark:text-blue-400' },
          { label: 'Model Responses', value: modelResponseCount, color: 'text-purple-600 dark:text-purple-400' },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 text-center">
            <div className={`text-3xl font-bold ${s.color}`}>{s.value.toLocaleString()}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search + filter bar */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <span className="absolute inset-y-0 left-3 flex items-center text-gray-400">🔍</span>
          <input
            type="text"
            value={searchInput}
            onChange={handleSearchChange}
            placeholder="Search across all original texts and model responses…"
            className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
          {loading && (
            <span className="absolute inset-y-0 right-3 flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600" />
            </span>
          )}
        </div>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
        >
          <option value="all">All types</option>
          <option value="original_text">Original texts only</option>
          <option value="model_response">Model responses only</option>
        </select>
      </div>

      {/* Dataset legend */}
      {Object.keys(datasetColorMap).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(datasetColorMap).map(([name, cls]) => (
            <span key={name} className={`px-2 py-0.5 rounded text-xs border font-medium ${cls}`}>
              {name}
            </span>
          ))}
        </div>
      )}

      {/* Results */}
      {displayed.length === 0 && !loading ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-12 text-center text-gray-500 dark:text-gray-400">
          {activeQuery ? `No results matching "${activeQuery}"` : 'No entries found across datasets.'}
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((item, i) => {
            const colorCls = datasetColorMap[item.dataset_name] || PALETTE[0]
            return (
              <div key={`${item.type}-${item.record_id}-${item.model_name}-${i}`}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {/* Dataset badge */}
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded border ${colorCls}`}>
                    {item.dataset_name}
                  </span>
                  {/* Type badge */}
                  {item.type === 'original_text' ? (
                    <span className="px-2 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600">
                      Original Text
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-xs rounded bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700">
                      Model Response · {item.model_name}
                    </span>
                  )}
                  <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">record #{item.record_id}</span>
                </div>

                {/* If model response, show the question it was answering */}
                {item.type === 'model_response' && item.question && (
                  <div className="mb-2 text-xs text-gray-500 dark:text-gray-400 italic border-l-2 border-gray-300 dark:border-gray-600 pl-2">
                    Q: {item.question}
                  </div>
                )}

                <p className="text-gray-800 dark:text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
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
          <button onClick={handleLoadMore}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium">
            Load more ({results.length} / {total} loaded)
          </button>
        </div>
      )}

      {loading && results.length > 0 && (
        <div className="mt-4 flex justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
        </div>
      )}
    </div>
  )
}

export default TextResponsePool
