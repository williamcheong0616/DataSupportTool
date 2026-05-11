import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ERROR_CATEGORIES, getCategoryColor } from '../utils/errorCategories';

// Map each error label to a solid border/badge color for the box outline
const BORDER_COLORS = {
  'Good Output':               'border-green-500 bg-green-50 dark:bg-green-950/30',
  'Bad Output':                'border-red-500 bg-red-50 dark:bg-red-950/30',
  'Hallucinations':            'border-orange-500 bg-orange-50 dark:bg-orange-950/30',
  'Wrong Facts':               'border-purple-500 bg-purple-50 dark:bg-purple-950/30',
  'Partial Informations':      'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/30',
  'Unnatural Bhs Rojak':       'border-amber-700 bg-amber-50 dark:bg-amber-950/30',
  'Catastrophic Forgetting':   'border-gray-700 bg-gray-100 dark:bg-gray-800/50',
  'Model Not Learning Well':   'border-slate-400 bg-slate-50 dark:bg-slate-800/30',
  'Worded Slightly Different': 'border-blue-500 bg-blue-50 dark:bg-blue-950/30',
};

const BADGE_COLORS = {
  'Good Output':               'bg-green-500 text-white',
  'Bad Output':                'bg-red-500 text-white',
  'Hallucinations':            'bg-orange-500 text-white',
  'Wrong Facts':               'bg-purple-500 text-white',
  'Partial Informations':      'bg-yellow-500 text-white',
  'Unnatural Bhs Rojak':       'bg-amber-700 text-white',
  'Catastrophic Forgetting':   'bg-gray-800 text-white',
  'Model Not Learning Well':   'bg-slate-400 text-white',
  'Worded Slightly Different': 'bg-blue-500 text-white',
};

const getBorderColor = (label) =>
  BORDER_COLORS[label] || 'border-pink-500 bg-pink-50 dark:bg-pink-950/30';

const getBadgeColor = (label) =>
  BADGE_COLORS[label] || 'bg-pink-500 text-white';

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
        const borderCls = getBorderColor(ann.error_type);
        const badgeCls = getBadgeColor(ann.error_type);
        elements.push(
          <ruby
            key={`ann-${ann.id || i}`}
            className={`cursor-pointer rounded px-1 border-b-2 ${borderCls}`}
            onClick={() => {
              if (window.confirm(`Remove annotation: "${ann.error_type}"?`)) {
                onDeleteAnnotation(ann.id);
              }
            }}
            title={`${ann.error_type} — click to remove`}
            style={{ rubyPosition: 'over', rubyAlign: 'center' }}
          >
            {chunk}
            <rt
              data-error={ann.error_type}
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm tracking-wide ${badgeCls} before:content-[attr(data-error)] block`}
              style={{ transform: 'translateY(-2px)' }}
            />
          </ruby>
        );
      } else if (sourceSide === 'ground_truth' && ann.comment) {
        // Ground-truth comment underline
        elements.push(
          <span
            key={`ann-${ann.id || i}`}
            className="relative inline border-b-2 border-blue-400 cursor-pointer group mx-0.5"
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
              className="absolute bottom-full left-0 mb-1 hidden group-hover:block bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-50 shadow-lg before:content-[attr(data-comment)]"
            />
          </span>
        );
      } else {
        // Fallback plain
        elements.push(
          <span key={`ann-${ann.id || i}`} className="bg-gray-200 dark:bg-gray-600 rounded px-0.5">
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
        className="p-4 border rounded-lg bg-white dark:bg-gray-800 dark:border-gray-700 min-h-[80px] text-base leading-9 shadow-sm cursor-text select-text"
        onMouseUp={handleMouseUp}
      >
        {renderText()}
      </div>

      {/* ── Popup ── */}
      {pendingSelection && (
        <div
          ref={popupRef}
          className="absolute z-50 -translate-x-1/2 bg-white dark:bg-gray-700 border dark:border-gray-600 rounded-xl shadow-2xl p-3 min-w-[240px] max-w-[300px]"
          style={{ top: popupPos.top, left: popupPos.left }}
          // Prevent mousedown inside popup from triggering the outside-click handler
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Small caret */}
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-white dark:bg-gray-700 border-l border-t dark:border-gray-600" />

          <div className="text-xs font-semibold text-gray-500 dark:text-gray-300 mb-2 truncate">
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
                  className={`text-left px-2 py-1.5 text-xs rounded-lg font-medium hover:opacity-80 active:scale-95 transition-all ${cat.color}`}
                >
                  {cat.label}
                </button>
              ))}
              {/* Custom tag input */}
              <div className="mt-1 pt-2 border-t dark:border-gray-600 flex gap-1">
                <input
                  type="text"
                  value={customError}
                  onChange={(e) => setCustomError(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && customError) handleAddError(customError); }}
                  placeholder="Custom tag…"
                  className="flex-1 px-2 py-1 text-xs border rounded dark:bg-gray-800 dark:text-white dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  onMouseDown={(e) => e.stopPropagation()}
                />
                <button
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                  onClick={() => customError && handleAddError(customError)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded text-xs font-semibold"
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
                className="w-full p-2 text-xs border rounded dark:bg-gray-800 dark:text-white dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
                onMouseDown={(e) => e.stopPropagation()}
              />
              <button
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                onClick={handleAddComment}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded text-xs font-semibold"
              >
                Save Comment
              </button>
            </div>
          )}

          <button
            onClick={closePopup}
            className="mt-2 w-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-center"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};

export default HighlightableText;
