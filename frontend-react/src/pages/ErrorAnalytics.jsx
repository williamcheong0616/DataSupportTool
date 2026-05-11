import React, { useState, useEffect, useMemo } from 'react';
import { getErrorStats } from '../api';
import { getCategoryColor } from '../utils/errorCategories';

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
      // Pick color based on category, but we just need a solid hex or CSS color for conic-gradient.
      // Since getCategoryColor returns a tailwind class string like 'bg-red-200 text-white', 
      // we'll just assign a generic distinct color palette based on index for the pie chart.
      const colors = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#4ade80', '#2dd4bf', '#38bdf8', '#818cf8', '#c084fc', '#f472b6'];
      const color = colors[index % colors.length];
      const startAngle = currentAngle;
      const sliceAngle = (item.count / totalErrors) * 360;
      currentAngle += sliceAngle;
      return `${color} ${startAngle}deg ${currentAngle}deg`;
    });
    return `conic-gradient(${parts.join(', ')})`;
  }, [aggregatedByType, totalErrors]);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading analytics...</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Error Analytics Dashboard</h1>

      {stats.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow text-center text-gray-500 dark:text-gray-400">
          No error annotations found yet. Start annotating to see the dashboard!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Total Overview / Pie Chart */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border dark:border-gray-700 flex flex-col items-center gap-6">
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 w-full">Error Distribution</h2>
            <div 
              className="w-48 h-48 rounded-full shadow-inner"
              style={{ background: pieGradient }}
            ></div>
            <div className="w-full">
              {aggregatedByType.map((item, index) => {
                 const colors = ['bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-lime-400', 'bg-green-400', 'bg-teal-400', 'bg-sky-400', 'bg-indigo-400', 'bg-purple-400', 'bg-pink-400'];
                 const color = colors[index % colors.length];
                 return (
                  <div key={item.type} className="flex items-center justify-between py-1 text-sm dark:text-gray-300 border-b dark:border-gray-700 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-3 h-3 rounded-full ${color}`}></span>
                      {item.type}
                    </div>
                    <span className="font-semibold">{item.count} ({Math.round((item.count/totalErrors)*100)}%)</span>
                  </div>
                 )
              })}
            </div>
          </div>

          {/* Bar Chart for Models */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border dark:border-gray-700 flex flex-col gap-6">
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 w-full">Errors per Model</h2>
            <div className="flex flex-col gap-4 w-full h-full justify-center">
              {aggregatedByModel.map((item) => {
                const maxCount = aggregatedByModel[0].count;
                const widthPercent = (item.count / maxCount) * 100;
                return (
                  <div key={item.model} className="flex flex-col gap-1">
                    <div className="flex justify-between text-sm dark:text-gray-300">
                      <span>{item.model}</span>
                      <span className="font-bold">{item.count}</span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 h-4 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full transition-all duration-1000" style={{ width: `${widthPercent}%` }}></div>
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
