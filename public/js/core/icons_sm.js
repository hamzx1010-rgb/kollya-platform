/**
 * KOLIYA — icons_sm.js
 * ============================================================
 * One SVG icon set for the whole app. No emoji anywhere in the UI.
 *
 * Why not emoji:
 *   - they render differently on Windows, Android, macOS and Linux,
 *     so the app looks inconsistent and cheap
 *   - they cannot inherit colour, size or stroke weight
 *   - they carry no accessible name
 *   - reaction emoji in particular looked like clip-art
 *
 * All icons are 24×24, stroke-based, currentColor, so they follow
 * the surrounding text colour and the theme automatically.
 *
 * Reactions are the exception worth noting: they are *filled*
 * custom glyphs with their own brand colours, not Unicode faces.
 * ============================================================ */

/* ------------------------------------------------------------
   1. LINE ICONS  — UI chrome
   ------------------------------------------------------------ */

const P = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}${extra}</svg>`;

export const I = {
  /* navigation */
  home:      P('<path d="M3 10.4 12 3l9 7.4V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  compass:   P('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
  message:   P('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  bell:      P('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
  trophy:    P('<path d="M8 21h8M12 17v4"/><path d="M17 4h3v3a5 5 0 0 1-5 5M7 4H4v3a5 5 0 0 0 5 5"/><path d="M7 3h10v6a5 5 0 0 1-10 0z"/>'),
  shield:    P('<path d="M12 3 4 6v6c0 4.5 3.2 8.3 8 9 4.8-.7 8-4.5 8-9V6l-8-3Z"/>'),
  hash:      P('<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>'),
  calendar:  P('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>'),
  help:      P('<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
  bookmark:  P('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
  user:      P('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>'),
  users:     P('<circle cx="9" cy="8" r="3.6"/><path d="M2 21c0-3.6 3.2-5.8 7-5.8s7 2.2 7 5.8"/><path d="M16.5 4.6a3.6 3.6 0 0 1 0 6.9M18 14.6c2.6.6 4 2.2 4 4.4"/>'),
  settings:  P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),

  /* actions */
  search:    P('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  plus:      P('<path d="M12 5v14M5 12h14"/>'),
  close:     P('<path d="M18 6 6 18M6 6l12 12"/>'),
  check:     P('<path d="M20 6 9 17l-5-5"/>'),
  chevron:   P('<path d="m9 18 6-6-6-6"/>'),
  chevronDown: P('<path d="m6 9 6 6 6-6"/>'),
  arrowLeft: P('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
  arrowDown: P('<path d="M12 5v14M19 12l-7 7-7-7"/>'),
  more:      P('<circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none"/>'),
  moreH:     P('<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>'),

  /* post actions */
  comment:   P('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>'),
  repost:    P('<path d="M17 2.5 21 6l-4 3.5"/><path d="M3 12V9a3 3 0 0 1 3-3h15"/><path d="M7 21.5 3 18l4-3.5"/><path d="M21 12v3a3 3 0 0 1-3 3H3"/>'),
  share:     P('<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4M12 2v14"/>'),
  link:      P('<path d="M10 13a5 5 0 0 0 7.5.5l3-3A5 5 0 0 0 13.5 3.5L11.7 5.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3A5 5 0 0 0 10.5 20.5l1.8-1.7"/>'),
  copy:      P('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  edit:      P('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash:     P('<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>'),
  reply:     P('<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>'),
  forward:   P('<path d="m15 17 5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>'),
  pin:       P('<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>'),
  flag:      P('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22V4"/>'),
  mute:      P('<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>'),
  eyeOff:    P('<path d="M9.9 5A9.8 9.8 0 0 1 12 4.8c7 0 10 7.2 10 7.2a17 17 0 0 1-2.8 3.9M6.6 6.6A17 17 0 0 0 2 12s3 7.2 10 7.2a9.8 9.8 0 0 0 4.4-1"/><path d="m2 2 20 20"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  block:     P('<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>'),

  /* composer */
  image:     P('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="m21 15-5-5L5 21"/>'),
  camera:    P('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  video:     P('<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4z"/>'),
  mic:       P('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v4M8 22h8"/>'),
  send:      P('<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4z"/>'),
  paperclip: P('<path d="M21.4 11.1 12.3 20a5.5 5.5 0 1 1-7.8-7.8l9.2-9.1a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.1a1.8 1.8 0 0 1-2.6-2.6l8.5-8.4"/>'),
  smile:     P('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>'),
  gif:       P('<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M9.7 10.4a2.4 2.4 0 1 0 .3 3.2v-1.1H8.8"/><path d="M13 9.8v4.6"/><path d="M16 14.4V9.8h3M16 12.3h2.3"/>'),
  poll:      P('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),

  /* media playback */
  play:      P('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>'),
  pause:     P('<rect x="7" y="4.5" width="3.5" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="4.5" width="3.5" height="15" rx="1" fill="currentColor" stroke="none"/>'),
  volume:    P('<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  download:  P('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>'),

  /* editor */
  crop:      P('<path d="M6.1 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6.1h14a2 2 0 0 1 2 2v14"/>'),
  rotate:    P('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  flip:      P('<path d="M12 3v18"/><path d="M8 7 4 12l4 5zM16 7l4 5-4 5z"/>'),
  sliders:   P('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>'),
  undo:      P('<path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 1 2.1 6.4"/>'),
  redo:      P('<path d="M21 7v6h-6"/><path d="M20.5 13a9 9 0 1 0-2.1 6.4"/>'),
  text:      P('<path d="M4 6V4h16v2M9 20h6M12 4v16"/>'),
  brush:     P('<path d="M9.1 14.9 3 21s3.5.5 5-1a2.1 2.1 0 0 0-1.9-3.6"/><path d="M13 12 21.2 3.8a1.9 1.9 0 0 0-2.7-2.7L10.3 9.3"/><path d="m9.6 10.6 3.8 3.8"/>'),
  blur:      P('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" opacity=".18" stroke="none"/><path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01M12 12h.01"/>'),

  /* status */
  lock:      P('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  globe:     P('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>'),
  clock:     P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  spark:     P('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>'),
  sun:       P('<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon:      P('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  monitor:   P('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  keyboard:  P('<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14.5h8"/>'),
  logout:    P('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  inbox:     P('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>'),
  fire:      P('<path d="M12 22a7 7 0 0 0 7-7c0-5-4-6-4-9 0 0-3 1.5-3 5 0 1.5-1 2-1.5 1.2C10 11 10 9 10 9s-5 2.5-5 6a7 7 0 0 0 7 7z"/>'),
  graduation:P('<path d="m22 9-10-5L2 9l10 5z"/><path d="M6 11.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5"/>'),

  /* delivery ticks — one grey, two blue */
  tick:      P('<path d="M20 6 9 17l-5-5"/>'),
  tickDouble:P('<path d="M17 6 8 15l-3.5-3.5"/><path d="m22 6-8.5 8.5"/>')
};

/* ------------------------------------------------------------
   2. REACTIONS  — custom filled glyphs, not Unicode faces
   Each keeps its own colour so a row of reactions reads instantly.
   ------------------------------------------------------------ */

const RX = (body, color) =>
  `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style="--rx:${color}">${body}</svg>`;

export const REACTIONS = {
  like: {
    label: "J'aime",
    color: '#2563EB',
    svg: RX('<path d="M7 10.5v9.2a1.3 1.3 0 0 1-1.3 1.3H4a1.3 1.3 0 0 1-1.3-1.3v-7.9A1.3 1.3 0 0 1 4 10.5z" fill="var(--rx)" opacity=".55"/><path d="M7 10.5 12 2a2.6 2.6 0 0 1 2.6 2.6V8h4.7a2 2 0 0 1 2 2.4l-1.5 8a2 2 0 0 1-2 1.6H7z" fill="var(--rx)"/>', '#2563EB')
  },
  love: {
    label: "J'adore",
    color: '#F43F5E',
    svg: RX('<path d="M12 20.7 4.3 13a4.9 4.9 0 0 1 0-7 4.9 4.9 0 0 1 7 0l.7.7.7-.7a4.9 4.9 0 0 1 7 0 4.9 4.9 0 0 1 0 7z" fill="var(--rx)"/>', '#F43F5E')
  },
  haha: {
    label: 'Haha',
    color: '#F59E0B',
    svg: RX('<circle cx="12" cy="12" r="9.4" fill="var(--rx)"/><path d="M6.8 13.4h10.4a5.2 5.2 0 0 1-10.4 0z" fill="#fff"/><path d="M7.4 9.2 10.4 8M16.6 9.2 13.6 8" stroke="#7C3F00" stroke-width="1.7" stroke-linecap="round"/>', '#F59E0B')
  },
  wow: {
    label: 'Waouh',
    color: '#F59E0B',
    svg: RX('<circle cx="12" cy="12" r="9.4" fill="var(--rx)"/><ellipse cx="12" cy="15" rx="2.4" ry="3.1" fill="#7C3F00"/><ellipse cx="8.6" cy="9.6" rx="1.25" ry="1.6" fill="#7C3F00"/><ellipse cx="15.4" cy="9.6" rx="1.25" ry="1.6" fill="#7C3F00"/>', '#F59E0B')
  },
  sad: {
    label: 'Triste',
    color: '#60A5FA',
    svg: RX('<circle cx="12" cy="12" r="9.4" fill="var(--rx)"/><path d="M8.2 16.4a4.6 4.6 0 0 1 7.6 0" stroke="#1E3A5F" stroke-width="1.7" stroke-linecap="round"/><circle cx="8.8" cy="10.2" r="1.2" fill="#1E3A5F"/><circle cx="15.2" cy="10.2" r="1.2" fill="#1E3A5F"/><path d="M8.4 18.6a1.5 1.5 0 0 0 2.2 1.3l-1.1-3z" fill="#38BDF8"/>', '#60A5FA')
  },
  fire: {
    label: 'Feu',
    color: '#F97316',
    svg: RX('<path d="M12 22a7 7 0 0 0 7-7c0-5.2-4.3-6.2-4.3-9.6 0 0-3.4 1.6-3.4 5.4 0 1.7-1.1 2.2-1.7 1.3C9 11 9 8.8 9 8.8S4 11.5 4 15a7 7 0 0 0 8 7z" fill="var(--rx)"/><path d="M12 22a3.2 3.2 0 0 0 3.2-3.2c0-2.4-2-2.9-2-4.5 0 0-1.6.8-1.6 2.5 0 .8-.5 1-.8.6-.3-.5-.3-1.5-.3-1.5s-2.3 1.3-2.3 2.9A3.2 3.2 0 0 0 12 22z" fill="#FCD34D"/>', '#F97316')
  }
};

export const REACTION_KEYS = Object.keys(REACTIONS);

/* ------------------------------------------------------------
   3. HELPERS
   ------------------------------------------------------------ */

/**
 * icon('home', { size:20, cls:'x', label:'Accueil' })
 * Without a label the icon is aria-hidden, which is correct when
 * the button already has its own accessible name.
 */
export function icon(name, { size = 0, cls = '', label = '', stroke = 0 } = {}) {
  let svg = I[name];
  if (!svg) { console.warn(`[koliya] icône inconnue "${name}"`); return ''; }

  if (size)   svg = svg.replace('<svg', `<svg width="${size}" height="${size}"`);
  if (cls)    svg = svg.replace('<svg', `<svg class="${cls}"`);
  if (stroke) svg = svg.replace('stroke-width="1.8"', `stroke-width="${stroke}"`);
  if (label)  svg = svg.replace('aria-hidden="true"', `role="img" aria-label="${label}"`);

  return svg;
}

/** reactionIcon('love', 22) */
export function reactionIcon(key, size = 22) {
  const r = REACTIONS[key];
  if (!r) return '';
  return r.svg.replace('<svg', `<svg width="${size}" height="${size}"`);
}

export const reactionLabel = key => REACTIONS[key]?.label || key;
export const reactionColor = key => REACTIONS[key]?.color || 'currentColor';

/** Replace an element's contents with an icon. */
export function setIcon(node, name, opts) {
  if (node) node.innerHTML = icon(name, opts);
  return node;
}
