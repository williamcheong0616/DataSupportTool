import React, { useState, useEffect, useMemo } from 'react';
import { getErrorStats } from '../api';

// Qualitative palette shared by the pie chart slices and its legend dots
const PIE_COLORS = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#4ade80', '#2dd4bf', '#38bdf8', '#818cf8', '#c084fc', '#f472b6'];

const ErrorAnalytics = () => {
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await getErrorStats();
        setStats(res.data);
      } catch (err) {
        console.error("Failed to load error stats", err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  const aggregatedByType = useMemo(() => {
    const counts = {};
    stats.forEach(s => {
      counts[s.error_type] = (counts[s.error_type] || 0) + s.count;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));
  }, [stats]);

  const aggregatedByModel = useMemo(() => {
    const counts = {};
    stats.forEach(s => {
      counts[s.model_name] = (counts[s.model_name] || 0) + s.count;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([model, count]) => ({ model, count }));
  }, [stats]);

  const totalErrors = aggregatedByType.reduce((sum, item) => sum + item.count, 0);

  // CSS Conic Gradient string for Pie Chart
  const pieGradient = useMemo(() => {
    if (totalErrors === 0) return 'conic-gradient(#e5e7eb 0deg, #e5e7eb 360deg)';
    
    let currentAngle = 0;
    const parts = aggregatedByType.map((item, index) => {
      const color = PIE_COLORS[index % PIE_COLORS.length];
      const startAngle = currentAngle;
      const sliceAngle = (item.count / totalErrors) * 360;
      currentAngle += sliceAngle;
      return `${color} ${startAngle}deg ${currentAngle}deg`;
    });
    return `conic-gradient(${parts.join(', ')})`;
  }, [aggregatedByType, totalErrors]);

  if (loading) return <div className="p-8 text-center text-[var(--text-dim)]">Loading analytics...</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-[var(--text-hi)]">Error Analytics Dashboard</h1>

      {stats.length === 0 ? (
        <div className="bg-[var(--bg-panel)] p-8 rounded border text-center text-[var(--text-dim)]">
          No error annotations found yet. Start annotating to see the dashboard!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Total Overview / Pie Chart */}
          <div className="bg-[var(--bg-panel)] p-6 rounded border flex flex-col items-center gap-6">
            <h2 className="text-lg font-semibold text-[var(--text)] w-full">Error Distribution</h2>
            <div
              className="w-48 h-48 rounded-full"
              style={{ background: pieGradient, boxShadow: 'inset 0 0 0 1px var(--border)' }}
            ></div>
            <div className="w-full">
              {aggregatedByType.map((item, index) => {
                 const color = PIE_COLORS[index % PIE_COLORS.length];
                 return (
                  <div key={item.type} className="flex items-center justify-between py-1 text-sm border-b last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ background: color }}></span>
                      {item.type}
                    </div>
                    <span className="font-semibold">{item.count} ({Math.round((item.count/totalErrors)*100)}%)</span>
                  </div>
                 )
              })}
            </div>
          </div>

          {/* Bar Chart for Models */}
          <div className="bg-[var(--bg-panel)] p-6 rounded border flex flex-col gap-6">
            <h2 className="text-lg font-semibold text-[var(--text)] w-full">Errors per Model</h2>
            <div className="flex flex-col gap-4 w-full h-full justify-center">
              {aggregatedByModel.map((item) => {
                const maxCount = aggregatedByModel[0].count;
                const widthPercent = (item.count / maxCount) * 100;
                return (
                  <div key={item.model} className="flex flex-col gap-1">
                    <div className="flex justify-between text-sm ">
                      <span>{item.model}</span>
                      <span className="font-bold">{item.count}</span>
                    </div>
                    <div className="w-full bg-[var(--bg-input)] h-4 rounded-full overflow-hidden">
                      <div className="h-full bg-[var(--accent)] rounded-full transition-all duration-1000" style={{ width: `${widthPercent}%` }}></div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          
        </div>
      )}
    </div>
  );
};

export default ErrorAnalytics;
