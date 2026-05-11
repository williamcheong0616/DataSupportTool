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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Text Error Analysis</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Highlight text on the model output side to tag errors. Highlight ground truth to add reference comments.
          </p>
        </div>

        {/* Dataset Selector */}
        {loadingDatasets ? (
          <div className="text-sm text-gray-400 animate-pulse">Loading datasets...</div>
        ) : datasets.length === 0 ? (
          <div className="text-sm text-red-500">No datasets with model outputs found. Please seed mock data first.</div>
        ) : (
          <select
            value={selectedDatasetId || ''}
            onChange={(e) => setSelectedDatasetId(Number(e.target.value))}
            className="px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 min-w-[200px]"
          >
            {datasets.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Body */}
      {loadingRecords && (
        <div className="flex items-center justify-center h-40 text-gray-400 dark:text-gray-500 animate-pulse">
          Loading records...
        </div>
      )}

      {error && !loadingRecords && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {!loadingRecords && !error && records.length === 0 && selectedDatasetId && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 px-4 py-8 rounded-lg text-center text-yellow-700 dark:text-yellow-300">
          No model outputs linked to this dataset yet.
          <div className="text-sm mt-1 text-gray-500">Use the seed script to add mock data for testing.</div>
        </div>
      )}

      {!loadingRecords && records.length > 0 && currentRecord && (
        <>
          {/* Pagination */}
          <div className="flex items-center justify-between bg-white dark:bg-gray-800 px-4 py-2 rounded-lg border dark:border-gray-700 shadow-sm">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Record ID: <span className="font-mono font-medium text-gray-700 dark:text-gray-200">{currentRecord.record_id}</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentIndex(c => Math.max(0, c - 1))}
                disabled={currentIndex === 0}
                className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg disabled:opacity-40 dark:text-white transition"
              >
                ← Prev
              </button>
              <span className="px-3 py-1.5 text-sm font-semibold bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 rounded-lg">
                {currentIndex + 1} / {records.length}
              </span>
              <button
                onClick={() => setCurrentIndex(c => Math.min(records.length - 1, c + 1))}
                disabled={currentIndex === records.length - 1}
                className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg disabled:opacity-40 dark:text-white transition"
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
                <h2 className="font-semibold text-gray-700 dark:text-gray-300">📖 Reference (Ground Truth)</h2>
                <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 px-2 py-0.5 rounded-full">Reference</span>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">Highlight to add a reference comment.</p>

              {currentRecord.finetuned_outputs[0] ? (
                <HighlightableText
                  text={currentRecord.ground_truth || '(No ground truth available)'}
                  annotations={(currentRecord.finetuned_outputs[0]?.annotations || []).filter(a => a.source_side === 'ground_truth')}
                  onAddAnnotation={(data) => handleAddAnnotation(currentRecord.finetuned_outputs[0].id, data)}
                  onDeleteAnnotation={handleDeleteAnnotation}
                  sourceSide="ground_truth"
                />
              ) : (
                <div className="p-4 border rounded dark:border-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-loose">
                  {currentRecord.ground_truth || '(No ground truth available)'}
                </div>
              )}
            </div>

            {/* Model Outputs */}
            <div className="flex flex-col gap-5">
              {currentRecord.finetuned_outputs.length === 0 ? (
                <div className="text-gray-400 italic p-6 border rounded dark:border-gray-700 text-center">
                  No model outputs attached to this record.
                </div>
              ) : (
                currentRecord.finetuned_outputs.map((output) => (
                  <div key={output.id} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <h2 className="font-semibold text-gray-700 dark:text-gray-300">🤖 Model Output</h2>
                      <span className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 px-2 py-0.5 rounded-full font-mono">
                        {output.model_name}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">Highlight text to tag an error category.</p>
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
                          <span key={a.id} className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
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
          <div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg px-4 py-3 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">Annotation Guide</p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Good Output', cls: 'bg-green-200 text-green-900 dark:bg-green-800 dark:text-green-100' },
                { label: 'Bad Output', cls: 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100' },
                { label: 'Hallucinations', cls: 'bg-orange-200 text-orange-900 dark:bg-orange-800 dark:text-orange-100' },
                { label: 'Wrong Facts', cls: 'bg-purple-200 text-purple-900 dark:bg-purple-800 dark:text-purple-100' },
                { label: 'Partial Informations', cls: 'bg-yellow-200 text-yellow-900 dark:bg-yellow-700 dark:text-yellow-100' },
                { label: 'Unnatural Bhs Rojak', cls: 'bg-amber-600 text-white' },
                { label: 'Catastrophic Forgetting', cls: 'bg-gray-800 text-white' },
                { label: 'Model Not Learning Well', cls: 'bg-gray-200 text-gray-900 dark:bg-gray-600 dark:text-gray-100' },
                { label: 'Worded Slightly Different', cls: 'bg-blue-200 text-blue-900 dark:bg-blue-800 dark:text-blue-100' },
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
