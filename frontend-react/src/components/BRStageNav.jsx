import React from 'react'
import { Link } from 'react-router-dom'

const STAGES = [
  { num: 1, path: 'classification', label: '1. Classification' },
  { num: 2, path: 'restructure',    label: '2. Restructure' },
  { num: 3, path: 'questions',      label: '3. Question Validation' },
  { num: 4, path: 'responses',      label: '4. Model Responses' },
]

/** Shared stage-to-stage nav pill strip used across the BR pipeline pages. */
function BRStageNav({ pipelineId, activeStage }) {
  return (
    <div className="surface p-4 flex items-center gap-2 flex-wrap">
      {STAGES.map((stage, i) => (
        <React.Fragment key={stage.num}>
          {i > 0 && <span style={{ color: 'var(--text-dim)' }}>→</span>}
          {stage.num === activeStage ? (
            <span
              className="px-3 py-1 text-sm rounded"
              style={{ fontFamily: 'var(--mono)', background: 'var(--accent)', color: 'var(--accent-text)' }}
            >
              {stage.label}
            </span>
          ) : (
            <Link
              to={`/br-pipeline/${stage.path}/${pipelineId}`}
              className="px-3 py-1 text-sm rounded transition-colors"
              style={{ fontFamily: 'var(--mono)', background: 'var(--bg-input)', color: 'var(--text-dim)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-hi)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-input)'; e.currentTarget.style.color = 'var(--text-dim)' }}
            >
              {stage.label}
            </Link>
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

export default BRStageNav
