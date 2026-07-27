/**
 * KOLIYA — utils_sm.js
 * ============================================================
 * Shared helpers. No app logic, no DOM ownership, no state.
 * Every other module imports from here.
 *
 * Replaces from the old single file:
 *   esc, esc2, escLocal, escH, escHub, escP, escF, escX, escD, escM
 *   → ten identical copies, now one function.
 * ============================================================
 */

/* ------------------------------------------------------------
   1. ESCAPING  — the only XSS defence in the app
   ------------------------------------------------------------ */

const ESC_MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };

/** Escape text before putting it in innerHTML. */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC_MAP[c]);
}

/** Escape a value used inside an HTML attribute. */
export function escAttr(s) {
  return esc(s).replace(/`/g, '&#96;');
}

/**
 * Tagged template that escapes every interpolation automatically.
 *   html`<div>${userInput}</div>`   ← safe by default
 * Use raw(x) to opt out for trusted markup you built yourself.
 */
export function html(strings, ...values) {
  return strings.reduce((out, str, i) => {
    if (i === 0) return str;
    const v = values[i - 1];
    const safe = (v && v.__raw !== undefined) ? v.__raw
               : Array.isArray(v) ? v.join('')
               : esc(v);
    return out + safe + str;
  }, '');
}
export const raw = (s) => ({ __raw: s == null ? '' : String(s) });

/* ------------------------------------------------------------
   2. DOM
   ------------------------------------------------------------ */

/**
 * Escape a value for use inside a CSS attribute selector.
 * CSS.escape is missing in older Safari and some Android webviews,
 * so we fall back rather than throw.
 */
export function cssEscape(value) {
  const s = String(value ?? '');
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return s.replace(/["\\\]\[#.:>+~*^$|()=%\s]/g, '\\$&');
}

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Create an element in one call. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class')      node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function')
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html')  node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/**
 * addEventListener that returns its own cleanup function.
 * Prevents the listener leaks the old code had on every re-render.
 */
export function on(target, type, handler, opts) {
  // Tolerate a missing node. A single absent optional element should
  // never abort the render that is still wiring the rest of a panel.
  if (!target?.addEventListener) return () => {};
  target.addEventListener(type, handler, opts);
  return () => target.removeEventListener(type, handler, opts);
}

/** Run a callback once the element is actually visible on screen. */
export function onVisible(node, cb, { threshold = 0.5, once = true } = {}) {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      cb(e.target);
      if (once) io.unobserve(e.target);
    }
  }, { threshold });
  io.observe(node);
  return () => io.disconnect();
}

/* ------------------------------------------------------------
   3. TIME
   ------------------------------------------------------------ */

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

/** "now" · "5m" · "3h" · "2d" · "12 Mar" */
export function timeAgo(ts, locale = 'fr') {
  const t = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
  const d = Date.now() - t;
  if (d < MIN)        return locale === 'ar' ? 'الآن' : 'now';
  if (d < HOUR)       return Math.floor(d / MIN) + 'm';
  if (d < DAY)        return Math.floor(d / HOUR) + 'h';
  if (d < DAY * 7)    return Math.floor(d / DAY) + 'd';
  return new Date(t).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/** "14:32" */
export function clockTime(ts, locale = 'fr') {
  return new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** "Aujourd'hui" · "Hier" · "lundi" · "12 mars 2026" — for chat date separators */
export function dayLabel(ts, locale = 'fr') {
  const d = new Date(ts), now = new Date();
  const strip = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (strip(now) - strip(d)) / DAY;
  if (diff === 0) return locale === 'ar' ? 'اليوم' : "Aujourd'hui";
  if (diff === 1) return locale === 'ar' ? 'أمس'  : 'Hier';
  if (diff < 7)   return d.toLocaleDateString(locale, { weekday: 'long' });
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

export const sameDay = (a, b) =>
  new Date(a).toDateString() === new Date(b).toDateString();

/** 95 → "1:35" — for voice notes and video */
export function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/* ------------------------------------------------------------
   4. FORMATTING
   ------------------------------------------------------------ */

/** 1500 → "1.5K" · 2_400_000 → "2.4M" */
export function compact(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '') + 'K';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

/** 1536000 → "1.5 Mo" */
export function fileSize(bytes) {
  if (!bytes) return '0 o';
  const u = ['o', 'Ko', 'Mo', 'Go'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), u.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}

export function truncate(s, max = 120) {
  s = String(s ?? '');
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

/** Initials for the fallback avatar: "Sara Benali" → "SB" */
export function initials(name) {
  return String(name || '?')
    .trim().split(/\s+/).slice(0, 2)
    .map(w => w[0] || '').join('').toUpperCase() || '?';
}

const AVATAR_COLORS = [
  '#2563EB','#7C3AED','#DB2777','#EA580C',
  '#16A34A','#0891B2','#DC2626','#9333EA'
];
/** Same user always gets the same colour. */
export function avatarColor(id) {
  const s = String(id ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/* ------------------------------------------------------------
   5. RICH TEXT  — links, #tags, @mentions
   Returns escaped HTML. Never feed it unescaped input.
   ------------------------------------------------------------ */

const URL_RE     = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]])/g;
const MENTION_RE = /(^|[\s(])@([a-zA-Z0-9._]{2,30})/g;
const TAG_RE     = /(^|[\s(])#([\p{L}\p{N}_]{2,40})/gu;

export function richText(text) {
  let out = esc(text);
  out = out.replace(URL_RE, u =>
    `<a class="rt-link" href="${escAttr(u)}" target="_blank" rel="noopener noreferrer">${esc(truncate(u.replace(/^https?:\/\//, ''), 40))}</a>`);
  out = out.replace(MENTION_RE, (_m, pre, name) =>
    `${pre}<button class="rt-mention" data-user="${escAttr(name)}">@${esc(name)}</button>`);
  out = out.replace(TAG_RE, (_m, pre, tag) =>
    `${pre}<button class="rt-tag" data-tag="${escAttr(tag)}">#${esc(tag)}</button>`);
  return out;
}

/* ------------------------------------------------------------
   6. TIMING
   ------------------------------------------------------------ */

/** Wait for the pause — for search inputs. */
export function debounce(fn, ms = 250) {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/** At most once per interval — for scroll and resize. */
export function throttle(fn, ms = 100) {
  let last = 0, timer = null;
  return (...a) => {
    const now = Date.now(), gap = now - last;
    if (gap >= ms) { last = now; fn(...a); }
    else if (!timer) {
      timer = setTimeout(() => { last = Date.now(); timer = null; fn(...a); }, ms - gap);
    }
  };
}

/** One call per animation frame — for anything that moves. */
export function rafThrottle(fn) {
  let queued = false, args;
  return (...a) => {
    args = a;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...args); });
  };
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------
   7. IDS & MISC
   ------------------------------------------------------------ */

export function uid(prefix = 'id') {
  if (crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable key for a DM pair, whoever opened it. */
export const pairKey = (a, b) => [a, b].sort().join('__');

export const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

export function groupBy(arr, keyFn) {
  const out = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

export const unique = (arr, keyFn = x => x) => {
  const seen = new Set();
  return arr.filter(x => {
    const k = keyFn(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/* ------------------------------------------------------------
   8. ENVIRONMENT
   ------------------------------------------------------------ */

export const env = {
  /** True on a real mouse device. Hover-based UI only makes sense here. */
  get hasMouse()      { return matchMedia('(hover: hover) and (pointer: fine)').matches; },
  get touch()         { return matchMedia('(pointer: coarse)').matches; },
  get narrow()        { return innerWidth < 900; },
  get prefersDark()   { return matchMedia('(prefers-color-scheme: dark)').matches; },
  get reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; },
  get online()        { return navigator.onLine; },
  get hidden()        { return document.hidden; },
  get isMac()         { return /Mac|iPhone|iPad/.test(navigator.platform); }
};

/** "Ctrl" on Windows/Linux, "⌘" on Mac — for shortcut hints. */
export const modKey = () => env.isMac ? '⌘' : 'Ctrl';

/* ------------------------------------------------------------
   9. CLIPBOARD
   ------------------------------------------------------------ */

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Firefox without permission, or a non-secure origin
    const ta = el('textarea', {
      value: text,
      style: { position: 'fixed', top: '-1000px', opacity: '0' }
    });
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand?.('copy') ?? false;
    ta.remove();
    return ok;
  }
}

/** Pull image files out of a paste event — Ctrl+V of a screenshot. */
export function imagesFromPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return [];
  return Array.from(items)
    .filter(i => i.kind === 'file' && i.type.startsWith('image/'))
    .map(i => i.getAsFile())
    .filter(Boolean);
}

/* ------------------------------------------------------------
   10. SAFETY
   ------------------------------------------------------------ */

/**
 * The rule of this project: base64 never enters the database.
 * Media goes to R2 and only the https URL is stored.
 */
export function assertNotBase64(value, field = 'value') {
  if (typeof value === 'string' && value.startsWith('data:')) {
    throw new Error(
      `[koliya] refus d'enregistrer du base64 dans "${field}". ` +
      `Utilisez uploadMedia() puis stockez l'URL retournée.`
    );
  }
  return value;
}

/**
 * Never let a bad URL become an XSS vector via href/src.
 *
 * `data:` MUST be allowed here. Media now lives inside Postgres as
 * data: URLs (media_sm.js + db/05_upgrade_sm.sql), so blocking the
 * scheme blanked every avatar, banner, story and chat photo in the
 * app — 44 render sites, all silently empty. That was the single
 * worst bug in this project and it was one missing word.
 *
 * What must still be refused is anything that can EXECUTE:
 *   javascript:  ·  vbscript:  ·  data:text/html  ·  data:image/svg+xml
 *
 * SVG is excluded deliberately even though it is an image: an SVG
 * can carry <script>, so a "profile picture" would be code.
 */
const SAFE_DATA = /^data:(image\/(png|jpe?g|gif|webp|avif|bmp)|video\/(mp4|webm|ogg)|audio\/(mpeg|mp3|ogg|wav|webm|mp4|aac))[;,]/i;

export function safeUrl(url) {
  const s = String(url ?? '').trim();
  if (!s) return '';
  if (/^(https?:|blob:|\/)/i.test(s)) return s;
  if (SAFE_DATA.test(s)) return s;
  return '';
}

/** True when a value is renderable media. Used by the guards. */
export const isRenderableMedia = v => !!safeUrl(v);
