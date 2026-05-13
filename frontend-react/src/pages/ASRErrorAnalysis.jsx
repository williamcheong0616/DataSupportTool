import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import HighlightableText from '../components/HighlightableText';
import { getErrorAnalysisASR, addErrorAnnotation, deleteErrorAnnotation, getAudioUrl } from '../api';

const ASRErrorAnalysis = () => {
  const { datasetId } = useParams();
  const [records, setRecords] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);

  const loadRecords = async (dId, isBackground = false) => {
    if (!dId) return;
    try {
      if (!isBackground) {
        setLoading(true);
        setCurrentIndex(0);
      }
      setError(null);
      const res = await getErrorAnalysisASR(dId);
      setRecords(res.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load ASR error analysis data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecords(datasetId);
  }, [datasetId]);

  const handleAddAnnotation = async (outputId, annotationData) => {
    try {
      await addErrorAnnotation({
        output_id: outputId,
        ...annotationData
      });
      loadRecords(datasetId, true);
    } catch (err) {
      console.error("Failed to add annotation", err);
      alert("Error adding annotation");
    }
  };

  const handleDeleteAnnotation = async (annotationId) => {
    try {
      await deleteErrorAnnotation(annotationId);
      loadRecords(datasetId, true);
    } catch (err) {
      console.error("Failed to delete annotation", err);
      alert("Error deleting annotation");
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading ASR analysis data...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  if (records.length === 0) return (
    <div className="p-8 text-center text-gray-500 dark:text-gray-400">
      No records found. Try seeding data via the API!
      <div className="mt-4">
        <Link to="/" className="text-indigo-600 underline">Back to Dashboard</Link>
      </div>
    </div>
  );

  const currentRecord = records[currentIndex];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">ASR Error Analysis</h1>
        <div className="flex gap-2">
          <button 
            onClick={() => setCurrentIndex(c => Math.max(0, c - 1))}
            disabled={currentIndex === 0}
            className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50 dark:text-white"
          >
            Prev
          </button>
          <span className="py-1 px-3 bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 rounded font-medium">
            {currentIndex + 1} / {records.length}
          </span>
          <button 
            onClick={() => setCurrentIndex(c => Math.min(records.length - 1, c + 1))}
            disabled={currentIndex === records.length - 1}
            className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-50 dark:text-white"
          >
            Next
          </button>
        </div>
      </div>

      {/* Audio Player */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow border dark:border-gray-700 flex flex-col gap-3">
        <h2 className="text-lg font-medium dark:text-gray-200 truncate" title={currentRecord.filename}>
          Listen: {currentRecord.filename}
        </h2>
        <audio 
          ref={audioRef}
          controls 
          src={getAudioUrl(currentRecord.record_id)} 
          className="w-full"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Ground Truth Column */}
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Reference Transcript</h2>
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            Highlight text to add a comment referencing a failure in the model.
          </div>
          
          <HighlightableText 
            text={currentRecord.ground_truth || "(No reference transcript available)"}
            annotations={currentRecord.finetuned_outputs[0]?.annotations.filter(a => a.source_side === 'ground_truth') || []}
            onAddAnnotation={(data) => handleAddAnnotation(currentRecord.finetuned_outputs[0]?.id, data)}
            onDeleteAnnotation={handleDeleteAnnotation}
            sourceSide="ground_truth"
          />
        </div>

        {/* Finetuned Outputs Column */}
        <div className="flex flex-col gap-6">
          {currentRecord.finetuned_outputs.length === 0 ? (
            <div className="text-gray-500 italic p-4 border rounded dark:border-gray-700">No model outputs available for this record.</div>
          ) : (
            currentRecord.finetuned_outputs.map((output, idx) => (
              <div key={output.id} className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 flex items-center justify-between">
                  Hypothesis Transcript
                  <span className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 px-2 py-1 rounded-full">
                    {output.model_name}
                  </span>
                </h2>
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                  Highlight text to tag specific errors made by the ASR model.
                </div>
                
                <HighlightableText 
                  text={output.output_text || "(No model output)"}
                  annotations={output.annotations.filter(a => a.source_side === 'model_output')}
                  onAddAnnotation={(data) => handleAddAnnotation(output.id, data)}
                  onDeleteAnnotation={handleDeleteAnnotation}
                  sourceSide="model_output"
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ASRErrorAnalysis;
