import React from 'react'

/** Small colored pill button used for row-level actions (upload, export, delete, etc). */
function ActionChip({ onClick, disabled, color, icon: Icon, title, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-50"
      style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color, fontFamily: 'var(--mono)' }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = `color-mix(in srgb, ${color} 28%, transparent)` }}
      onMouseLeave={(e) => { e.currentTarget.style.background = `color-mix(in srgb, ${color} 15%, transparent)` }}
    >
      {Icon && <Icon size={11} />} {children}
    </button>
  )
}

export default ActionChip
