import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ERROR_CATEGORIES, getCategoryColor } from '../utils/errorCategories';

const HighlightableText = ({
  text,
  annotations,
  onAddAnnotation,
  onDeleteAnnotation,
  sourceSide,
}) => {
  const containerRef = useRef(null);
  const popupRef = useRef(null);
  const [pendingSelection, setPendingSelection] = useState(null);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
  const [customError, setCustomError] = useState('');
  const [commentText, setCommentText] = useState('');

  // ── Render annotated text as React spans ──────────────────────────────────
  const renderText = () => {
    if (!text) return null;

    const sorted = annotations
      ? [...annotations].sort((a, b) => a.start_index - b.start_index)
      : [];

    if (sorted.length === 0) return <span className="whitespace-pre-wrap">{text}</span>;

    const elements = [];
    let lastIdx = 0;

    sorted.forEach((ann, i) => {
      // Plain text before this annotation
      if (ann.start_index > lastIdx) {
        elements.push(
          <span key={`plain-${lastIdx}`} className="whitespace-pre-wrap">
            {text.substring(lastIdx, ann.start_index)}
          </span>
        );
      }

      const start = Math.max(ann.start_index, lastIdx);
      const end = Math.max(ann.end_index, start);
      const chunk = text.substring(start, end);

      if (sourceSide === 'model_output' && ann.error_type) {
        // Boxed annotation with badge label on top
        const catColor = getCategoryColor(ann.error_type);
        elements.push(
          <ruby
            key={`ann-${ann.id || i}`}
            className="cursor-pointer rounded px-1"
            style={{ rubyPosition: 'over', rubyAlign: 'center', borderBottom: `2px solid ${catColor}` }}
            onClick={() => {
              if (window.confirm(`Remove annotation: "${ann.error_type}"?`)) {
                onDeleteAnnotation(ann.id);
              }
            }}
            title={`${ann.error_type} — click to remove`}
          >
            {chunk}
            <rt
              data-error={ann.error_type}
              className="text-[10px] font-bold px-1.5 py-0.5 tracking-wide text-white before:content-[attr(data-error)] block"
              style={{ transform: 'translateY(-2px)', background: catColor, borderRadius: 2, fontFamily: 'var(--mono)' }}
            />
          </ruby>
        );
      } else if (sourceSide === 'ground_truth' && ann.comment) {
        // Ground-truth comment underline
        elements.push(
          <span
            key={`ann-${ann.id || i}`}
            className="relative inline cursor-pointer group mx-0.5"
            style={{ borderBottom: '2px solid var(--accent)' }}
            title={ann.comment}
            onClick={() => {
              if (window.confirm(`Remove comment: "${ann.comment}"?`)) {
                onDeleteAnnotation(ann.id);
              }
            }}
          >
            {chunk}
            {/* comment tooltip */}
            <span
              data-comment={`💬 ${ann.comment}`}
              className="dst-panel absolute bottom-full left-0 mb-1 hidden group-hover:block text-xs px-2 py-1 whitespace-nowrap z-50 before:content-[attr(data-comment)]"
              style={{ color: 'var(--text-hi)', boxShadow: '0 6px 20px rgba(0,0,0,0.4)' }}
            />
          </span>
        );
      } else {
        // Fallback plain
        elements.push(
          <span key={`ann-${ann.id || i}`} className="rounded px-0.5" style={{ background: 'var(--bg-hover)' }}>
            {chunk}
          </span>
        );
      }

      lastIdx = Math.max(lastIdx, ann.end_index);
    });

    // Trailing plain text
    if (lastIdx < text.length) {
      elements.push(
        <span key={`plain-${lastIdx}`} className="whitespace-pre-wrap">
          {text.substring(lastIdx)}
        </span>
      );
    }

    return elements;
  };

  // ── Selection capture ─────────────────────────────────────────────────────
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !containerRef.current) {
      return;
    }

    try {
      const range = sel.getRangeAt(0);
      // Make sure the selection is within our container
      if (!containerRef.current.contains(range.commonAncestorContainer)) return;

      const preRange = range.cloneRange();
      preRange.selectNodeContents(containerRef.current);
      preRange.setEnd(range.startContainer, range.startOffset);
      const start = preRange.toString().length;
      const end = start + range.toString().length;
      const selectedText = range.toString().trim();

      if (!selectedText || start === end) return;

      // Position popup just below the selection
      const rect = range.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();

      setPendingSelection({ start_index: start, end_index: end, selected_text: selectedText });
      setPopupPos({
        top: rect.bottom - containerRect.top + 8,
        left: Math.min(
          rect.left - containerRect.left + rect.width / 2,
          containerRect.width - 160 // keep inside box
        ),
      });
    } catch (e) {
      // ignore edge-case selection errors
    }
  }, []);

  // ── Submit handlers ───────────────────────────────────────────────────────
  const handleAddError = useCallback((errorType) => {
    if (!pendingSelection) return;
    onAddAnnotation({
      ...pendingSelection,
      source_side: sourceSide,
      error_type: errorType,
      comment: null,
    });
    setPendingSelection(null);
    setCustomError('');
    window.getSelection()?.removeAllRanges();
  }, [pendingSelection, sourceSide, onAddAnnotation]);

  const handleAddComment = useCallback(() => {
    if (!pendingSelection || !commentText.trim()) return;
    onAddAnnotation({
      ...pendingSelection,
      source_side: sourceSide,
      error_type: null,
      comment: commentText.trim(),
    });
    setPendingSelection(null);
    setCommentText('');
    window.getSelection()?.removeAllRanges();
  }, [pendingSelection, commentText, sourceSide, onAddAnnotation]);

  const closePopup = useCallback(() => {
    setPendingSelection(null);
    setCustomError('');
    setCommentText('');
    window.getSelection()?.removeAllRanges();
  }, []);

  // ── Close popup on outside click — but NOT when clicking inside the popup ──
  useEffect(() => {
    const handler = (e) => {
      if (!pendingSelection) return;
      if (popupRef.current && popupRef.current.contains(e.target)) return;
      if (containerRef.current && containerRef.current.contains(e.target)) return;
      closePopup();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pendingSelection, closePopup]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="relative" ref={containerRef}>
      {/* Text body */}
      <div
        className="dst-panel p-4 min-h-[80px] text-base leading-9 cursor-text select-text"
        onMouseUp={handleMouseUp}
      >
        {renderText()}
      </div>

      {/* ── Popup ── */}
      {pendingSelection && (
        <div
          ref={popupRef}
          className="dst-panel absolute z-50 -translate-x-1/2 p-3 min-w-[240px] max-w-[300px]"
          style={{ top: popupPos.top, left: popupPos.left, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
          // Prevent mousedown inside popup from triggering the outside-click handler
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Small caret */}
          <div
            className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45"
            style={{ background: 'var(--bg-panel)', borderLeft: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}
          />

          <div className="text-xs mb-2 truncate" style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
            "{pendingSelection.selected_text.length > 30
              ? pendingSelection.selected_text.substring(0, 30) + '…'
              : pendingSelection.selected_text}"
          </div>

          {sourceSide === 'model_output' ? (
            <div className="flex flex-col gap-1 max-h-56 overflow-y-auto pr-1">
              {ERROR_CATEGORIES.map((cat) => (
                <button
                  key={cat.label}
                  // Use onMouseDown so it fires before any outside-click blur
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                  onClick={() => handleAddError(cat.label)}
                  className="text-left px-2 py-1.5 text-xs font-medium hover:opacity-80 active:scale-95 transition-all text-white"
                  style={{ background: cat.color, borderRadius: 3, fontFamily: 'var(--mono)' }}
                >
                  {cat.label}
                </button>
              ))}
              {/* Custom tag input */}
              <div className="mt-1 pt-2 flex gap-1" style={{ borderTop: '1px solid var(--border)' }}>
                <input
                  type="text"
                  value={customError}
                  onChange={(e) => setCustomError(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && customError) handleAddError(customError); }}
                  placeholder="Custom tag…"
                  className="dst-input flex-1"
                  style={{ height: 26, fontSize: 12 }}
                  onMouseDown={(e) => e.stopPropagation()}
                />
                <button
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                  onClick={() => customError && handleAddError(customError)}
                  className="dst-btn-primary"
                  style={{ height: 26, padding: '0 10px' }}
                >
                  ＋
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a reference comment…"
                rows={3}
                className="dst-textarea"
                onMouseDown={(e) => e.stopPropagation()}
              />
              <button
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onClick={handleAddComment}
                className="dst-btn-primary"
              >
                Save Comment
              </button>
            </div>
          )}

          <button
            onClick={closePopup}
            className="mt-2 w-full text-xs text-center transition-colors"
            style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-hi)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-dim)' }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};

export default HighlightableText;
