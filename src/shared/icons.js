const paths = {
  chevronLeft:'<path d="m15 5-7 7 7 7"/>',
  chevronRight:'<path d="m9 5 7 7-7 7"/>',
  reset:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  theme:'<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  unlock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2m-3 10v2"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  train:'<rect x="5" y="3" width="14" height="15" rx="4"/><path d="M5 10h14M9 3v7M15 3v7M8 21l2-3m6 3-2-3"/><path d="M8 14h1m6 0h1"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h1m6 0h1"/>',
  file:'<path d="M14 2H5v20h14V7zM14 2v5h5M8 12h8m-8 4h6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2m0 3h.01"/>',
  schedule:'<path d="M5 3v18M3 7h18M9 11h9m-9 4h6m-6 4h11"/>',
  team:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/>',
  worker:'<path d="M4 10h16M6 10V8a6 6 0 0 1 12 0v2M12 3v4m-5 6a5 5 0 0 0 10 0M4 22v-2l5-3m6 0 5 3v2"/>',
  inspection:'<circle cx="10" cy="10" r="6"/><path d="m14.5 14.5 6 6M7 10l2 2 4-4"/>',
  shield:'<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6zM8 12l3 3 5-6"/>',
  wrench:'<path d="M14 6a5 5 0 0 0-6 6L3 17a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-3 3-4-4 3-3z"/>',
  package:'<path d="m12 3 9 5-9 5-9-5 9-5zM3 8v10l9 5 9-5V8M12 13v10M7.5 5.5l9 5"/>',
  warehouse:'<path d="m3 10 9-7 9 7v11H3V10zM8 21V11h8v10M8 15h8m-8 3h8"/>',
  equipment:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M6 12l3-3 3 3 5-5"/>',
  chart:'<path d="M4 3v17h17M8 16v-5m5 5V7m5 9V4"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  support:'<path d="M4 14v-3a8 8 0 0 1 16 0v3m-1 4a4 4 0 0 1-4 4h-3"/><rect x="2" y="11" width="4" height="7" rx="2"/><rect x="18" y="11" width="4" height="7" rx="2"/>',
};
export function icon(name, size=18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`
}

// Small drawings for actions: two tones, rounded strokes, and no text in the art.
const actionDrawings = {
  upload:'<path d="M7 4h12l6 6v17H7z" fill="var(--action-art-fill)"/><path d="M19 4v6h6M11 21v3h10v-3M16 20V12m-4 4 4-4 4 4"/>',
  download:'<path d="M7 4h12l6 6v17H7z" fill="var(--action-art-fill)"/><path d="M19 4v6h6M11 23h10M16 12v8m-4-4 4 4 4-4"/>',
  calendar:'<rect x="5" y="7" width="22" height="21" rx="4" fill="var(--action-art-fill)"/><path d="M5 14h22M11 4v6m10-6v6M10 19h3m5 0h3m-11 5h3"/><circle cx="22" cy="24" r="5" fill="var(--action-art-surface)"/><path d="m20 24 1.5 1.5L24 23"/>',
  simulate:'<rect x="4" y="5" width="24" height="22" rx="4" fill="var(--action-art-fill)"/><path d="M4 11h24M10 8h.01M7 16h6m-2 5h6M9 14v9"/><circle cx="24" cy="24" r="6" fill="var(--action-art-surface)"/><path d="m22.5 21 4 3-4 3z" fill="currentColor" stroke="none"/>',
  publish:'<path d="M6 5h15l5 5v17H6z" fill="var(--action-art-fill)"/><path d="M21 5v5h5M10 12h6m-6 5h8m-8 5h4"/><circle cx="24" cy="24" r="6" fill="var(--action-art-surface)"/><path d="m21 24 2 2 4-4"/>',
  reset:'<circle cx="16" cy="16" r="11" fill="var(--action-art-fill)" stroke="none"/><path d="M8 13a9 9 0 1 1 1 9M7 6v8h8M16 11v6l4 2"/>',
  lock:'<rect x="7" y="14" width="18" height="14" rx="4" fill="var(--action-art-fill)"/><path d="M11 14V9a5 5 0 0 1 10 0v5M16 19v4"/><circle cx="16" cy="19" r="1" fill="currentColor" stroke="none"/>',
  unlock:'<rect x="7" y="14" width="18" height="14" rx="4" fill="var(--action-art-fill)"/><path d="M11 14V9a5 5 0 0 1 9-3M16 19v4"/><circle cx="16" cy="19" r="1" fill="currentColor" stroke="none"/>',
  previous:'<circle cx="16" cy="16" r="12" fill="var(--action-art-fill)" stroke="none"/><path d="m18.5 10-6 6 6 6"/>',
  next:'<circle cx="16" cy="16" r="12" fill="var(--action-art-fill)" stroke="none"/><path d="m13.5 10 6 6-6 6"/>',
}
export function actionIcon(name, size=28) {
  return `<svg class="drawn-action-icon" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${actionDrawings[name] || actionDrawings.calendar}</svg>`
}
