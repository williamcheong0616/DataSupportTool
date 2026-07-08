export const ERROR_CATEGORIES = [
  { label: 'Good Output',               color: '#1a9b5c' },
  { label: 'Bad Output',                color: '#dc2626' },
  { label: 'Hallucinations',            color: '#ea580c' },
  { label: 'Wrong Facts',               color: '#9333ea' },
  { label: 'Partial Informations',      color: '#b45309' },
  { label: 'Unnatural Bhs Rojak',       color: '#92400e' },
  { label: 'Catastrophic Forgetting',   color: '#374151' },
  { label: 'Model Not Learning Well',   color: '#64748b' },
  { label: 'Worded Slightly Different', color: '#2563eb' },
];

export const FALLBACK_CATEGORY_COLOR = '#db2777';

export const getCategoryColor = (label) => {
  const cat = ERROR_CATEGORIES.find((c) => c.label === label);
  return cat ? cat.color : FALLBACK_CATEGORY_COLOR;
};
