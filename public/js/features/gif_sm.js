/**
 * KOLIYA — features/gif_sm.js
 * ============================================================
 * GIF and sticker picker.
 *
 * Web-specific behaviour that matters here:
 *   the grid shows a still frame and only animates the tile under
 *   the cursor. Twenty looping GIFs at once burn CPU and battery and
 *   make the panel feel chaotic; one moving tile reads as a preview.
 *
 * Categories and recents are learned from use (store.frequency),
 * so the row you actually reach for drifts to the front.
 * ============================================================
 */

import { $, $$, el, on, esc, debounce, safeUrl } from '../core/utils_sm.js';
import { frequency, recent } from '../core/store_sm.js';
import { I, icon } from '../core/icons_sm.js';
import { toast } from '../core/ui_sm.js';

/* ------------------------------------------------------------
   SOURCE
   Swapped for a real provider (Tenor/Giphy) once a key exists;
   until then a curated static set keeps the UI honest.
   ------------------------------------------------------------ */

let provider = null;
export function useGifProvider(impl) { provider = impl; }

const CATEGORIES = [
  { id: 'recent',   label: 'Récents',  icon: 'clock' },
  { id: 'reaction', label: 'Réactions' },
  { id: 'study',    label: 'Études' },
  { id: 'happy',    label: 'Joie' },
  { id: 'tired',    label: 'Fatigue' },
  { id: 'thanks',   label: 'Merci' }
];

/* Static placeholders: solid-colour data URIs so nothing 404s and the
   layout is real. Replaced wholesale by the provider. */
const PALETTE = ['#2563EB','#7C3AED','#DB2777','#EA580C','#16A34A','#0891B2','#DC2626','#CA8A04'];

/**
 * Placeholder tiles, drawn to a canvas and exported as a real PNG.
 *
 * These used to be `data:image/svg+xml`, which is why GIFs sent in a
 * chat arrived blank: safeUrl() blocks SVG on purpose — an SVG can
 * contain <script>, so accepting one as "an image" would let any
 * user post executable markup into someone else's page.
 *
 * The right fix is not to weaken the guard, it is to stop shipping
 * SVG as user media. A canvas PNG looks identical and is inert.
 */
const tileCache = new Map();

function tile(label, i) {
  const key = `${label}|${i}`;
  if (tileCache.has(key)) return tileCache.get(key);

  let url;
  try {
    const c = document.createElement('canvas');
    c.width = 240; c.height = 180;
    const x = c.getContext('2d');
    const bg = PALETTE[i % PALETTE.length];

    const grad = x.createLinearGradient(0, 0, 240, 180);
    grad.addColorStop(0, bg);
    grad.addColorStop(1, shade(bg, -28));
    x.fillStyle = grad;
    x.fillRect(0, 0, 240, 180);

    x.fillStyle = 'rgba(255,255,255,.13)';
    x.beginPath(); x.arc(212, 156, 60, 0, Math.PI * 2); x.fill();

    x.fillStyle = '#fff';
    x.font = '600 22px Inter, system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(String(label).slice(0, 14), 120, 92);

    url = c.toDataURL('image/png');
  } catch {
    // 1×1 transparent GIF: never blank, never broken
    url = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  }
  tileCache.set(key, url);
  return url;
}

/** Darken a hex colour for the gradient stop. */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = v => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amount);
  const g = clamp(((n >> 8) & 0xff) + amount);
  const b = clamp((n & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const SAMPLE = {
  reaction: ['Bravo','Wow','Non','Oui','Hmm','LOL'],
  study:    ['Réviser','Examen','Notes','Biblio','TD','Concentré'],
  happy:    ['Yes!','Content','Danse','Fête','Rire','Top'],
  tired:    ['Fatigué','Dodo','Café','Lundi','Aide','Zzz'],
  thanks:   ['Merci','Gentil','Cœur','Bisous','Top','Génial']
};

async function fetchGifs(category, query) {
  if (provider?.search) return provider.search({ category, query });
  if (query) {
    return Array.from({ length: 9 }, (_, i) => ({
      id: `q${i}`, url: tile(query, i), preview: tile(query, i), alt: query
    }));
  }
  if (category === 'recent') {
    return recent.list('gif', 12).map((url, i) => ({ id: `r${i}`, url, preview: url, alt: 'GIF' }));
  }
  const labels = SAMPLE[category] || SAMPLE.reaction;
  return labels.map((label, i) => ({
    id: `${category}-${i}`, url: tile(label, i), preview: tile(label, i), alt: label
  }));
}

/* ------------------------------------------------------------
   PICKER
   ------------------------------------------------------------ */

let panel = null;
let activeCat = 'reaction';

export function openGifPicker(anchor, onPick) {
  if (panel) { closeGifPicker(); return; }

  // most-used category first — the app learns your habits
  const learned = frequency.top('gifcat', 2);
  const cats = [...CATEGORIES].sort((a, b) => {
    const ai = learned.indexOf(a.id), bi = learned.indexOf(b.id);
    if (a.id === 'recent') return -1;
    if (b.id === 'recent') return 1;
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  panel = el('div', { class: 'gif-panel blur-menu', role: 'dialog', 'aria-label': 'Choisir un GIF' });
  panel.innerHTML = `
    <div class="gif-head">
      <div class="gif-search">
        <span class="input-icon">${icon('search', { size: 15 })}</span>
        <input class="input has-icon" id="gifQuery" placeholder="Rechercher un GIF…" autocomplete="off">
      </div>
      <button class="icon-btn sm" id="gifClose" aria-label="Fermer">${I.close}</button>
    </div>
    <div class="gif-cats" id="gifCats">
      ${cats.map(c => `<button class="pill gif-cat${c.id === activeCat ? ' on' : ''}" data-cat="${c.id}">
          ${c.icon ? icon(c.icon, { size: 13 }) : ''}${c.label}</button>`).join('')}
    </div>
    <div class="gif-grid" id="gifGrid"></div>`;

  document.body.append(panel);
  place(panel, anchor);

  on($('#gifClose'), 'click', closeGifPicker);

  for (const btn of $$('.gif-cat')) {
    on(btn, 'click', () => {
      activeCat = btn.dataset.cat;
      frequency.bump('gifcat', activeCat);
      for (const b of $$('.gif-cat')) b.classList.toggle('on', b === btn);
      load('');
    });
  }

  const q = $('#gifQuery');
  on(q, 'input', debounce(() => load(q.value.trim()), 260));
  q.focus();

  on(panel, 'click', e => {
    const t = e.target.closest('.gif-tile');
    if (!t) return;
    const url = t.dataset.url;
    recent.push('gif', url);
    onPick?.({ url, alt: t.dataset.alt });
    closeGifPicker();
  });

  // hovering a tile swaps the still for the animated file
  on(panel, 'mouseover', e => {
    const t = e.target.closest('.gif-tile');
    if (!t || t.dataset.playing) return;
    t.dataset.playing = '1';
    const img = t.querySelector('img');
    if (img && t.dataset.url !== img.src) img.src = t.dataset.url;
  });
  on(panel, 'mouseout', e => {
    const t = e.target.closest('.gif-tile');
    if (!t) return;
    delete t.dataset.playing;
    const img = t.querySelector('img');
    if (img && t.dataset.preview) img.src = t.dataset.preview;
  });

  const offOutside = on(document, 'pointerdown', e => {
    if (!panel?.contains(e.target) && !anchor.contains(e.target)) closeGifPicker();
  }, true);
  const offEsc = on(document, 'keydown', e => { if (e.key === 'Escape') closeGifPicker(); });
  panel._cleanup = () => { offOutside(); offEsc(); };

  load('');
  return panel;

  async function load(query) {
    const grid = $('#gifGrid');
    grid.innerHTML = `<div class="gif-skel"></div>`.repeat(9);
    let items = [];
    try { items = await fetchGifs(activeCat, query); }
    catch { toast('Impossible de charger les GIF', 'err'); }

    if (!items.length) {
      grid.innerHTML = `<div class="tg-empty" style="grid-column:1/-1">
          ${icon('gif', { size: 24 })}<span>${activeCat === 'recent' ? 'Aucun GIF récent' : 'Aucun résultat'}</span>
        </div>`;
      return;
    }
    grid.innerHTML = items.map(g => `
      <button class="gif-tile" data-url="${esc(safeUrl(g.url))}" data-preview="${esc(safeUrl(g.preview))}"
              data-alt="${esc(g.alt || 'GIF')}" title="${esc(g.alt || '')}">
        <img src="${esc(safeUrl(g.preview))}" alt="${esc(g.alt || 'GIF')}" loading="lazy">
      </button>`).join('');
  }
}

export function closeGifPicker() {
  if (!panel) return;
  panel._cleanup?.();
  panel.remove();
  panel = null;
}

function place(node, anchor) {
  const a = anchor.getBoundingClientRect();
  const r = node.getBoundingClientRect();
  const pad = 8;
  const top = a.top - r.height - pad > pad ? a.top - r.height - pad : a.bottom + pad;
  node.style.position = 'fixed';
  node.style.top = Math.max(pad, top) + 'px';
  node.style.left = Math.min(Math.max(pad, a.left), innerWidth - r.width - pad) + 'px';
}
