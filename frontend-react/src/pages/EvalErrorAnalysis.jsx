import React, { useState, useEffect, useRef } from 'react';
import HighlightableText from '../components/HighlightableText';
import { getEvalDatasets, getEvalErrorAnalysis, uploadEvalDataset, addErrorAnnotation, deleteErrorAnnotation, deleteEvalDataset } from '../api';

const EvalErrorAnalysis = () => {
  const [datasets, setDatasets] = useState([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState(null);
  const [records, setRecords] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loadingDatasets, setLoadingDatasets] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [error, setError] = useState(null);

  // Upload State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const fetchDatasets = async () => {
    try {
      setLoadingDatasets(true);
      const res = await getEvalDatasets();
      setDatasets(res.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load datasets');
    } finally {
      setLoadingDatasets(false);
    }
  };

  useEffect(() => {
    fetchDatasets();
  }, []);

  const loadRecords = async (datasetId, isBackground = false) => {
    if (!datasetId) return;
    try {
      if (!isBackground) {
        setLoadingRecords(true);
        setCurrentIndex(0);
      }
      setError(null);
      const res = await getEvalErrorAnalysis(datasetId);
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

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!uploadFile || !uploadName) return;

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('name', uploadName);
      formData.append('description', uploadDesc);
      formData.append('file', uploadFile);

      const res = await uploadEvalDataset(formData);
      alert('Dataset uploaded successfully!');
      setShowUploadModal(false);
      setUploadName('');
      setUploadDesc('');
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      
      // Select the newly uploaded dataset
      setSelectedDatasetId(res.data.dataset_id);
      await fetchDatasets();
    } catch (err) {
      console.error('Upload failed', err);
      alert(err.response?.data?.detail || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDataset = async (datasetId, e) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this dataset? This cannot be undone.")) return;
    try {
      await deleteEvalDataset(datasetId);
      await fetchDatasets();
    } catch (err) {
      console.error(err);
      alert("Failed to delete dataset");
    }
  };

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
          <div className="flex items-center gap-3">
            {selectedDatasetId && (
              <button
                onClick={() => setSelectedDatasetId(null)}
                className="p-1.5 bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] rounded transition-colors text-[var(--text-dim)]"
                title="Back to Datasets"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
            )}
            <h1 className="text-2xl font-bold text-[var(--text-hi)]">Custom Evaluation Analysis</h1>
          </div>
          <p className="text-sm text-[var(--text-dim)] mt-1">
            Analyze your pre-tested offline datasets. Upload a CSV with Ground Truth and Model Outputs to begin.
          </p>
        </div>

        <button 
          onClick={() => setShowUploadModal(true)}
          className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent)] text-white text-sm font-medium rounded border transition-colors whitespace-nowrap"
        >
          + Upload Dataset
        </button>
      </div>

      {/* Dataset Selection View */}
      {!selectedDatasetId && (
        <div className="bg-[var(--bg-panel)] border border rounded overflow-hidden">
          {loadingDatasets ? (
            <div className="flex items-center justify-center h-40 text-[var(--text-dim)]">Loading datasets...</div>
          ) : datasets.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <div className="w-16 h-16 bg-[var(--bg-input)] rounded-full flex items-center justify-center mb-4">
                <span className="text-2xl">📁</span>
              </div>
              <h3 className="text-lg font-medium text-[var(--text-hi)]">No Evaluation Datasets</h3>
              <p className="text-sm text-[var(--text-dim)] mt-1 max-w-sm">
                You haven't uploaded any evaluation datasets yet. Click "Upload Dataset" to get started.
              </p>
            </div>
          ) : (
            <ul className="divide-y  ">
              {datasets.map((dataset) => (
                <li 
                  key={dataset.id} 
                  className="p-5 hover:bg-[var(--bg-hover)] transition flex items-center justify-between group cursor-pointer"
                  onClick={() => setSelectedDatasetId(dataset.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded bg-[var(--accent-dim)] flex items-center justify-center text-[var(--accent)]">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-[var(--text-hi)]">{dataset.name}</h3>
                      <p className="text-sm text-[var(--text-dim)] mt-0.5">Dataset #{dataset.id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={(e) => handleDeleteDataset(dataset.id, e)}
                      className="p-2 text-[var(--text-dim)] hover:text-[var(--red)] hover:bg-[var(--red-dim)] rounded transition opacity-0 group-hover:opacity-100"
                      title="Delete dataset"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                    <button className="text-sm font-medium text-[var(--accent)] hover:text-[var(--accent)] opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
                      Analyze Errors <span aria-hidden="true">&rarr;</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-[var(--bg-panel)] rounded border p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-[var(--text-hi)] mb-4">Upload Evaluation Dataset</h2>
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text)] mb-1">Dataset Name</label>
                <input 
                  type="text" 
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border rounded"
                  placeholder="e.g. Llama vs Qwen Test"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text)] mb-1">Description (Optional)</label>
                <textarea 
                  value={uploadDesc}
                  onChange={(e) => setUploadDesc(e.target.value)}
                  className="w-full px-3 py-2 border rounded"
                  rows={2}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text)] mb-1">CSV/JSON File</label>
                <input 
                  type="file" 
                  accept=".csv,.json,.jsonl"
                  ref={fileInputRef}
                  onChange={(e) => setUploadFile(e.target.files[0])}
                  required
                  className="w-full text-sm text-[var(--text-dim)] file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-[var(--accent-dim)] file:text-[var(--accent)] hover:file:bg-[var(--accent-dim)]"
                />
                <p className="text-xs text-[var(--text-dim)] mt-2">
                  Columns named <strong>'ground truth'</strong> or <strong>'gt'</strong> will be used as reference. Other columns will automatically be mapped as Model Outputs.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <button 
                  type="button" 
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 text-sm text-[var(--text-dim)] hover:text-[var(--text-hi)]"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={uploading || !uploadFile || !uploadName}
                  className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent)] text-white text-sm font-medium rounded border disabled:opacity-50"
                >
                  {uploading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
          No records found in this evaluation dataset.
        </div>
      )}

      {!loadingRecords && records.length > 0 && currentRecord && (
        <>
          {/* Pagination */}
          <div className="flex items-center justify-between bg-[var(--bg-panel)] px-4 py-2 rounded border border">
            <span className="text-sm text-[var(--text-dim)]">
              Eval Record ID: <span className="font-mono font-medium text-[var(--text)]">{currentRecord.record_id}</span>
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

          {/* Prompt Section */}
          {currentRecord.prompt && (
            <div className="bg-[var(--accent-dim)] p-4 rounded border border-[var(--accent)]">
              <h3 className="text-xs font-bold text-[var(--accent)] uppercase mb-2">Prompt / Instruction</h3>
              <p className="text-sm text-[var(--text-hi)] whitespace-pre-wrap">{currentRecord.prompt}</p>
            </div>
          )}

          {/* Side-by-Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Ground Truth */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-[var(--text)]">📖 Reference (Ground Truth)</h2>
                <span className="text-xs bg-[var(--green-dim)] text-[var(--green)] px-2 py-0.5 rounded-full">Reference</span>
              </div>

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
        </>
      )}
    </div>
  );
};

export default EvalErrorAnalysis;
