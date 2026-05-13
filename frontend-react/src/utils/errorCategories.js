export const ERROR_CATEGORIES = [
  { label: 'Good Output',               color: 'bg-green-200 text-green-900 dark:bg-green-700 dark:text-green-100' },
  { label: 'Bad Output',                color: 'bg-red-200 text-red-900 dark:bg-red-700 dark:text-red-100' },
  { label: 'Hallucinations',            color: 'bg-orange-200 text-orange-900 dark:bg-orange-700 dark:text-orange-100' },
  { label: 'Wrong Facts',               color: 'bg-purple-200 text-purple-900 dark:bg-purple-700 dark:text-purple-100' },
  { label: 'Partial Informations',      color: 'bg-yellow-200 text-yellow-900 dark:bg-yellow-600 dark:text-yellow-100' },
  { label: 'Unnatural Bhs Rojak',       color: 'bg-amber-700 text-white' },
  { label: 'Catastrophic Forgetting',   color: 'bg-gray-800 text-white' },
  { label: 'Model Not Learning Well',   color: 'bg-slate-200 text-slate-900 dark:bg-slate-600 dark:text-slate-100' },
  { label: 'Worded Slightly Different', color: 'bg-blue-200 text-blue-900 dark:bg-blue-700 dark:text-blue-100' },
];

export const getCategoryColor = (label) => {
  const cat = ERROR_CATEGORIES.find((c) => c.label === label);
  return cat ? cat.color : 'bg-pink-200 text-pink-900 dark:bg-pink-700 dark:text-pink-100';
};
