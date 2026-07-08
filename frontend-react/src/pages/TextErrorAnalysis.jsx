import React, { useState, useEffect } from 'react';
import HighlightableText from '../components/HighlightableText';
import { getErrorAnalysisTextDatasets, getErrorAnalysisText, addErrorAnnotation, deleteErrorAnnotation } from '../api';

const TextErrorAnalysis = () => {
  const [datasets, setDatasets] = useState([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState(null);
  const [records, setRecords] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadingDatasets, setLoadingDatasets] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [error, setError] = useState(null);

  // Load available datasets on mount
  useEffect(() => {
    const fetchDatasets = async () => {
      try {
        setLoadingDatasets(true);
        const res = await getErrorAnalysisTextDatasets();
        setDatasets(res.data);
        if (res.data.length > 0) {
          setSelectedDatasetId(res.data[0].id);
        }
      } catch (err) {
        console.error(err);
        setError('Failed to load datasets');
      } finally {
        setLoadingDatasets(false);
      }
    };
    fetchDatasets();
  }, []);

  // Load records when dataset changes
  const loadRecords = async (datasetId, isBackground = false) => {
    if (!datasetId) return;
    try {
      if (!isBackground) {
        setLoadingRecords(true);
        setCurrentIndex(0);
      }
      setError(null);
      const res = await getErrorAnalysisText(datasetId);
      setRecords(res.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load records for this dataset');
    } finally {
      setLoadingRecords(false);
    }
  };

  useEffect(() => {
    if (selectedDatasetId) {
      loadRecords(selectedDatasetId);
    }
  }, [selectedDatasetId]);

  const handleAddAnnotation = async (outputId, annotationData) => {
    try {
      await addErrorAnnotation({ output_id: outputId, ...annotationData });
      loadRecords(selectedDatasetId, true);
    } catch (err) {
      console.error("Failed to add annotation", err);
      alert("Error adding annotation");
    }
  };

  const handleDeleteAnnotation = async (annotationId) => {
    try {
      await deleteErrorAnnotation(annotationId);
      loadRecords(selectedDatasetId, true);
    } catch (err) {
      console.error("Failed to delete annotation", err);
      alert("Error deleting annotation");
    }
  };

  const currentRecord = records[currentIndex];

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-hi)]">Text Error Analysis</h1>
          <p className="text-sm text-[var(--text-dim)] mt-1">
            Highlight text on the model output side to tag errors. Highlight ground truth to add reference comments.
          </p>
        </div>

        {/* Dataset Selector */}
        {loadingDatasets ? (
          <div className="text-sm text-[var(--text-dim)] animate-pulse">Loading datasets...</div>
        ) : datasets.length === 0 ? (
          <div className="text-sm text-[var(--red)]">No datasets with model outputs found. Please seed mock data first.</div>
        ) : (
          <select
            value={selectedDatasetId || ''}
            onChange={(e) => setSelectedDatasetId(Number(e.target.value))}
            className="px-3 py-2 border rounded text-sm min-w-[200px]"
          >
            {datasets.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Body */}
      {loadingRecords && (
        <div className="flex items-center justify-center h-40 text-[var(--text-dim)] animate-pulse">
          Loading records...
        </div>
      )}

      {error && !loadingRecords && (
        <div className="bg-[var(--red-dim)] border border-[var(--red)] text-[var(--red)] px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}

      {!loadingRecords && !error && records.length === 0 && selectedDatasetId && (
        <div className="bg-[var(--amber-dim)] border border-[var(--amber)] px-4 py-8 rounded text-center text-[var(--amber)]">
          No model outputs linked to this dataset yet.
          <div className="text-sm mt-1 text-[var(--text-dim)]">Use the seed script to add mock data for testing.</div>
        </div>
      )}

      {!loadingRecords && records.length > 0 && currentRecord && (
        <>
          {/* Pagination */}
          <div className="flex items-center justify-between bg-[var(--bg-panel)] px-4 py-2 rounded border border">
            <span className="text-sm text-[var(--text-dim)]">
              Record ID: <span className="font-mono font-medium text-[var(--text)]">{currentRecord.record_id}</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentIndex(c => Math.max(0, c - 1))}
                disabled={currentIndex === 0}
                className="px-3 py-1.5 text-sm bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] rounded disabled:opacity-40 transition"
              >
                ← Prev
              </button>
              <span className="px-3 py-1.5 text-sm font-semibold bg-[var(--accent-dim)] text-[var(--accent)] rounded">
                {currentIndex + 1} / {records.length}
              </span>
              <button
                onClick={() => setCurrentIndex(c => Math.min(records.length - 1, c + 1))}
                disabled={currentIndex === records.length - 1}
                className="px-3 py-1.5 text-sm bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] rounded disabled:opacity-40 transition"
              >
                Next →
              </button>
            </div>
          </div>

          {/* Side-by-Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Ground Truth */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-[var(--text)]">📖 Reference (Ground Truth)</h2>
                <span className="text-xs bg-[var(--green-dim)] text-[var(--green)] px-2 py-0.5 rounded-full">Reference</span>
              </div>
              <p className="text-xs text-[var(--text-dim)]">Highlight to add a reference comment.</p>

              {currentRecord.finetuned_outputs[0] ? (
                <HighlightableText
                  text={currentRecord.ground_truth || '(No ground truth available)'}
                  annotations={(currentRecord.finetuned_outputs[0]?.annotations || []).filter(a => a.source_side === 'ground_truth')}
                  onAddAnnotation={(data) => handleAddAnnotation(currentRecord.finetuned_outputs[0].id, data)}
                  onDeleteAnnotation={handleDeleteAnnotation}
                  sourceSide="ground_truth"
                />
              ) : (
                <div className="p-4 border rounded whitespace-pre-wrap leading-loose">
                  {currentRecord.ground_truth || '(No ground truth available)'}
                </div>
              )}
            </div>

            {/* Model Outputs */}
            <div className="flex flex-col gap-5">
              {currentRecord.finetuned_outputs.length === 0 ? (
                <div className="text-[var(--text-dim)] italic p-6 border rounded text-center">
                  No model outputs attached to this record.
                </div>
              ) : (
                currentRecord.finetuned_outputs.map((output) => (
                  <div key={output.id} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <h2 className="font-semibold text-[var(--text)]">🤖 Model Output</h2>
                      <span className="text-xs bg-[color-mix(in_srgb,#a78bfa_20%,transparent)] text-[#a78bfa] px-2 py-0.5 rounded-full font-mono">
                        {output.model_name}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-dim)]">Highlight text to tag an error category.</p>
                    <HighlightableText
                      text={output.output_text}
                      annotations={(output.annotations || []).filter(a => a.source_side === 'model_output')}
                      onAddAnnotation={(data) => handleAddAnnotation(output.id, data)}
                      onDeleteAnnotation={handleDeleteAnnotation}
                      sourceSide="model_output"
                    />

                    {/* Error tag summary */}
                    {output.annotations && output.annotations.filter(a => a.source_side === 'model_output').length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {output.annotations.filter(a => a.source_side === 'model_output').map(a => (
                          <span key={a.id} className="text-xs px-2 py-0.5 rounded-full bg-[var(--red-dim)] text-[var(--red)]">
                            {a.error_type}: <span className="font-mono italic">"{a.selected_text}"</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Legend */}
          <div className="bg-[var(--bg-panel)] border rounded px-4 py-3 border">
            <p className="text-xs font-semibold text-[var(--text-dim)] mb-2 uppercase tracking-wide">Annotation Guide</p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Good Output', cls: 'bg-[var(--green-dim)] text-[var(--green)]  ' },
                { label: 'Bad Output', cls: 'bg-[var(--red-dim)] text-[var(--red)]  ' },
                { label: 'Hallucinations', cls: 'bg-[var(--amber-dim)] text-[var(--amber)]  ' },
                { label: 'Wrong Facts', cls: 'bg-[color-mix(in_srgb,#a78bfa_20%,transparent)] text-[#a78bfa]  ' },
                { label: 'Partial Informations', cls: 'bg-[var(--amber-dim)] text-[var(--amber)]  ' },
                { label: 'Unnatural Bhs Rojak', cls: 'bg-[var(--amber)] text-white' },
                { label: 'Catastrophic Forgetting', cls: 'bg-[var(--bg-panel)] text-white' },
                { label: 'Model Not Learning Well', cls: 'bg-[var(--bg-input)] text-[var(--text-hi)]  ' },
                { label: 'Worded Slightly Different', cls: 'bg-[var(--accent-dim)] text-[var(--accent)]  ' },
              ].map(item => (
                <span key={item.label} className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.cls}`}>
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default TextErrorAnalysis;
