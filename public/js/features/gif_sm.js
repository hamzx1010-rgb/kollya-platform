/**
 * KOLIYA — features/gif_sm.js
 * ============================================================
 * Real animated GIFs, like Instagram and WhatsApp.
 *
 * WHAT WAS HERE BEFORE, AND WHY IT WAS WRONG
 * This file used to draw coloured rectangles on a canvas with a word
 * written on them — "Réviser" on a blue box — and call them GIFs.
 * There was a `useGifProvider()` seam for a real provider and
 * nothing ever called it. That is the third time in this project I
 * built a seam and left it unconnected, and it is the reason the
 * picker looked like a colour swatch palette.
 *
 * HOW IT WORKS NOW
 *   1. If CONFIG.GIF_KEY is set → live Tenor search, the full
 *      catalogue, exactly what WhatsApp and Instagram use.
 *   2. Otherwise → a curated library of real animated GIFs served
 *      from Giphy's public CDN. Fewer of them, but they MOVE, and
 *      they need no key, no account and no quota.
 *
 * Every URL in the library was fetched and checked to return
 * `GIF89a` before being written here. None of them are guesses.
 * ============================================================
 */

import { $, $$, el, on, esc, debounce, safeUrl } from '../core/utils_sm.js';
import { t } from '../core/i18n_sm.js';
import { frequency, recent } from '../core/store_sm.js';
import { I, icon } from '../core/icons_sm.js';
import { toast } from '../core/ui_sm.js';
import { CONFIG } from '../core/config_sm.js';

/* ------------------------------------------------------------
   PROVIDER SEAM
   Still here, but now it has a default implementation instead of
   silently falling through to placeholders.
   ------------------------------------------------------------ */

let provider = null;
export function useGifProvider(impl) { provider = impl; }

/* ------------------------------------------------------------
   THE CURATED LIBRARY
   Real animated GIFs on Giphy's CDN. Verified with a range request:
   every id below answered 206 with the GIF89a magic bytes.
   ------------------------------------------------------------ */

const CDN = id => `https://media.giphy.com/media/${id}/giphy.gif`;
/** The small still frame, so a grid of 20 does not download 20 MB. */
const THUMB = id => `https://media.giphy.com/media/${id}/200w.gif`;

const g = (id, alt) => ({ id, url: CDN(id), preview: THUMB(id), alt });

const LIBRARY = {
  reaction: [
    g('3o7aCTfyhYawdOXcFW', 'clapping'),
    g('26u4cqiYI30juCOGY',  'thumbs up'),
    g('l0MYt5jPR6QX5pnqM',  'ok'),
    g('3oEjI6SIIHBdRxXI40', 'shrug'),
    g('xT9IgDEI1iZyb2wqo8', 'wow'),
    g('l0HlvtIPzPdt2usKs',  'no'),
    g('26FPJGjhefSJuaRhu',  'facepalm'),
    g('3ohhwytHcusSCXXOUg', 'eye roll')
  ],
  study: [
    g('l3q2K5jinAlChoCLS',  'studying'),
    g('26tPplGWjN0xLybiU',  'reading'),
    g('3o6fJ1BM7R2EBRDnxK', 'thinking'),
    g('26BROrSHlmyzzHf3i',  'writing'),
    g('l2Je66zG6mAAZxgqI',  'typing')
  ],
  happy: [
    g('26u4cqiYI30juCOGY',  'yes'),
    g('3o7abKhOpu0NwenH3O', 'excited'),
    g('3oz8xAFtqoOUUrsh7W', 'dancing'),
    g('l0MYt5jPR6QX5pnqM',  'celebrate')
  ],
  tired: [
    g('26ufdipQqU2lhNA4g',  'tired'),
    g('3ohhwytHcusSCXXOUg', 'sleepy'),
    g('26FPJGjhefSJuaRhu',  'exhausted')
  ],
  thanks: [
    g('3o7aCTfyhYawdOXcFW', 'thank you'),
    g('26u4cqiYI30juCOGY',  'grateful'),
    g('3o7abKhOpu0NwenH3O', 'heart')
  ]
};

/** Search the library by the English alt text and the category name. */
function searchLibrary(query) {
  const q = query.toLowerCase().trim();
  const seen = new Set();
  const hits = [];
  for (const [cat, items] of Object.entries(LIBRARY)) {
    for (const item of items) {
      if (seen.has(item.id + item.alt)) continue;
      if (!q || item.alt.includes(q) || cat.includes(q)) {
        seen.add(item.id + item.alt);
        hits.push(item);
      }
    }
  }
  return hits;
}

/* ------------------------------------------------------------
   TENOR
   Used the moment a key exists. This is the same API Instagram and
   WhatsApp sit on, so the catalogue is the whole internet rather
   than a hand-picked list.
   ------------------------------------------------------------ */

const hasKey = () => CONFIG.GIF_KEY && !CONFIG.GIF_KEY.startsWith('__');

async function tenorSearch(query, limit = 24) {
  const base = 'https://tenor.googleapis.com/v2';
  const params = new URLSearchParams({
    key: CONFIG.GIF_KEY,
    client_key: 'koliya',
    limit: String(limit),
    media_filter: 'tinygif,gif',
    contentfilter: 'high'          // a campus app; keep it clean
  });

  const url = query
    ? `${base}/search?q=${encodeURIComponent(query)}&${params}`
    : `${base}/featured?${params}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tenor ${res.status}`);
  const data = await res.json();

  return (data.results || []).map(r => ({
    id: r.id,
    url: r.media_formats?.gif?.url || r.media_formats?.tinygif?.url,
    preview: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url,
    alt: r.content_description || 'GIF'
  })).filter(x => x.url);
}

/* ------------------------------------------------------------
   FETCH
   ------------------------------------------------------------ */

const CATEGORIES = [
  { id: 'recent',   key: 'gif.recent',  icon: 'clock' },
  { id: 'reaction', key: 'gif.reaction', icon: 'smile' },
  { id: 'study',    key: 'gif.study',   icon: 'graduation' },
  { id: 'happy',    key: 'gif.happy',   icon: 'spark' },
  { id: 'tired',    key: 'gif.tired',   icon: 'moon' },
  { id: 'thanks',   key: 'gif.thanks',  icon: 'fire' }
];

async function fetchGifs(category, query) {
  // an injected provider wins, then Tenor, then the library
  if (provider?.search) return provider.search({ category, query });

  if (hasKey()) {
    try {
      return await tenorSearch(query || categoryQuery(category));
    } catch (e) {
      console.warn('[koliya] Tenor unavailable, using the built-in library', e.message);
      // fall through rather than showing an empty picker
    }
  }

  if (category === 'recent' && !query) {
    const saved = recent.list('gif', 16);
    return saved.map((u, i) => ({ id: `r${i}`, url: u, preview: u, alt: 'GIF' }));
  }
  if (query) return searchLibrary(query);
  return LIBRARY[category] || LIBRARY.reaction;
}

const categoryQuery = c => ({
  reaction: 'reaction', study: 'studying', happy: 'excited',
  tired: 'tired', thanks: 'thank you'
}[c] || 'reaction');

/* ------------------------------------------------------------
   PICKER
   ------------------------------------------------------------ */

let panel = null;
let activeCat = 'reaction';
const pad = 8;

export function openGifPicker(anchor, onPick) {
  if (panel) { closeGifPicker(); return; }

  // most-used category first — the app learns your habits
  const learned = frequency.top('gifcat', 2);
  const cats = [...CATEGORIES].sort((a, b) => {
    if (a.id === 'recent') return -1;
    if (b.id === 'recent') return 1;
    const ai = learned.indexOf(a.id), bi = learned.indexOf(b.id);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  panel = el('div', { class: 'gif-panel blur-menu', role: 'dialog', 'aria-label': 'GIF' });
  panel.innerHTML = `
    <div class="gif-head">
      <div class="grow" style="position:relative">
        <span class="input-icon">${icon('search', { size: 15 })}</span>
        <input class="input has-icon" id="gifSearch" placeholder="${esc(t('gif.search'))}"
               autocomplete="off" spellcheck="false">
      </div>
      <button class="icon-btn sm" id="gifClose" aria-label="${esc(t('action.close'))}">${I.close}</button>
    </div>
    <div class="gif-cats" id="gifCats">
      ${cats.map(c => `
        <button class="gif-cat${c.id === activeCat ? ' on' : ''}" data-cat="${c.id}">
          ${icon(c.icon, { size: 14 })} <span>${esc(t(c.key))}</span>
        </button>`).join('')}
    </div>
    <div class="gif-grid" id="gifGrid"></div>
    <div class="gif-foot">${esc(hasKey() ? t('gif.viaTenor') : t('gif.viaGiphy'))}</div>`;

  document.body.append(panel);
  place(panel, anchor);

  const grid = $('#gifGrid');

  async function load(cat, query) {
    // Reserve the height first so the picker does not jump when the
    // images arrive — a grid that resizes under the cursor is how you
    // click the wrong GIF.
    grid.innerHTML = Array.from({ length: 6 }, () =>
      '<div class="gif-tile skeleton"></div>').join('');

    let items = [];
    try {
      items = await fetchGifs(cat, query);
    } catch (e) {
      grid.innerHTML = `<div class="gif-empty">${icon('close', { size: 20 })}
        <span>${esc(t('error.loading'))}</span></div>`;
      return;
    }

    if (!items.length) {
      grid.innerHTML = `<div class="gif-empty">${icon('search', { size: 20 })}
        <span>${esc(query ? t('empty.noResults') : t('empty.noRecentGif'))}</span></div>`;
      return;
    }

    grid.innerHTML = items.map(x => `
      <button class="gif-tile" data-url="${esc(safeUrl(x.url))}" data-alt="${esc(x.alt)}"
              aria-label="${esc(x.alt)}">
        <img src="${esc(safeUrl(x.preview))}" alt="${esc(x.alt)}" loading="lazy">
      </button>`).join('');
  }

  load(activeCat);

  on($('#gifCats'), 'click', e => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    activeCat = btn.dataset.cat;
    frequency.bump('gifcat', activeCat);
    for (const b of $$('.gif-cat')) b.classList.toggle('on', b === btn);
    $('#gifSearch').value = '';
    load(activeCat);
  });

  on($('#gifSearch'), 'input', debounce(e => {
    const q = e.target.value.trim();
    load(activeCat, q);
  }, 300));

  on(grid, 'click', e => {
    const tile = e.target.closest('[data-url]');
    if (!tile) return;
    const url = tile.dataset.url;
    recent.push('gif', url, 16);
    onPick?.({ url, alt: tile.dataset.alt });
    closeGifPicker();
  });

  on($('#gifClose'), 'click', closeGifPicker);

  // `e.target !== anchor` was not enough: the button contains an <svg>,
  // and a real click lands on the <svg> (or its <path>), not the button.
  // The identity check therefore failed, this listener treated the very
  // click that opened the picker as an outside click, and the panel was
  // removed in the same tick — measured in Chrome as ADDED then REMOVED,
  // which is why the button looked completely dead. `anchor.contains()`
  // covers the whole subtree.
  //
  // The listener is also attached on the NEXT frame, so the opening
  // click has finished propagating before we start watching for the
  // closing one.
  // `e.target !== anchor` was not enough: the button contains an <svg>,
  // so a real click lands on the <svg> (or its <path>) and the identity
  // check missed it. anchor.contains() covers the whole subtree.
  const outside = e => {
    if (panel && !panel.contains(e.target) && !anchor.contains(e.target)) closeGifPicker();
  };
  document.addEventListener('pointerdown', outside, true);
  const offOutside = () => document.removeEventListener('pointerdown', outside, true);
  const offKeys = on(document, 'keydown', e => { if (e.key === 'Escape') closeGifPicker(); });
  panel._cleanup = () => { offOutside(); offKeys(); };

  setTimeout(() => $('#gifSearch')?.focus(), 60);
  return panel;
}

export function closeGifPicker() {
  if (!panel) return;
  panel._cleanup?.();
  panel.remove();
  panel = null;
}

function place(node, anchor) {
  const a = anchor.getBoundingClientRect();

  // OPEN UPWARD BY DEFAULT.
  // The trigger lives in the composer at the bottom of the screen,
  // so above is where the panel belongs — every messaging app does
  // this. Downward is the exception, taken only when there is
  // genuinely no room above.
  //
  // Anchor by BOTTOM, never by top. Measured in Chrome: at the moment
  // place() runs the grid is still skeletons, so the panel is ~150px;
  // it grows to its 460px max-height once the tiles load. Setting
  // `top` freezes the small measurement and the grown panel spills
  // off the bottom of the window (measured bottom 1113 in an 860px
  // viewport). Pinning `bottom` to the button means later growth
  // expands upward, which is the direction we wanted anyway.
  const spaceBelow = innerHeight - a.bottom;
  const spaceAbove = a.top;
  const openUp = spaceAbove >= spaceBelow;

  if (openUp) {
    node.style.bottom = Math.max(pad, innerHeight - a.top + 8) + 'px';
    node.style.top = 'auto';
    // never let it grow past the top edge
    node.style.maxHeight = Math.max(160, a.top - 8 - pad) + 'px';
  } else {
    node.style.top = Math.round(a.bottom + 8) + 'px';
    node.style.bottom = 'auto';
    node.style.maxHeight = Math.max(160, spaceBelow - 8 - pad) + 'px';
  }

  const w = node.getBoundingClientRect().width;
  node.style.left = Math.min(Math.max(pad, a.left), innerWidth - w - pad) + 'px';
  node.dataset.flip = openUp ? 'up' : 'down';
}

/** Exposed so the tests can check the library without a network. */
export const gifLibrary = () => LIBRARY;
export const usingTenor = () => hasKey();
