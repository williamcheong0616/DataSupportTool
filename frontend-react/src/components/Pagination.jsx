import React from 'react'

/** Numbered pagination strip (First/Prev/page numbers/Next/Last) for table-style listing pages. */
function Pagination({ page, pages, onGoPage }) {
  const pageBtnStyle = (active) => ({
    fontFamily: 'var(--mono)',
    background: active ? 'var(--accent)' : 'var(--bg-input)',
    color: active ? 'var(--accent-text)' : 'var(--text-dim)',
  })

  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onGoPage(1)} disabled={page === 1} className="px-3 py-1 text-sm rounded disabled:opacity-50" style={pageBtnStyle(false)}>
        First
      </button>
      <button onClick={() => onGoPage(page - 1)} disabled={page === 1} className="px-3 py-1 text-sm rounded disabled:opacity-50" style={pageBtnStyle(false)}>
        Prev
      </button>
      {Array.from({ length: Math.min(5, pages) }, (_, i) => {
        const p = pages <= 5 ? i + 1 : page <= 3 ? i + 1 : page >= pages - 2 ? pages - 4 + i : page - 2 + i
        return (
          <button key={p} onClick={() => onGoPage(p)} className="px-3 py-1 text-sm rounded" style={pageBtnStyle(page === p)}>
            {p}
          </button>
        )
      })}
      <button onClick={() => onGoPage(page + 1)} disabled={page === pages} className="px-3 py-1 text-sm rounded disabled:opacity-50" style={pageBtnStyle(false)}>
        Next
      </button>
      <button onClick={() => onGoPage(pages)} disabled={page === pages} className="px-3 py-1 text-sm rounded disabled:opacity-50" style={pageBtnStyle(false)}>
        Last
      </button>
    </div>
  )
}

export default Pagination
