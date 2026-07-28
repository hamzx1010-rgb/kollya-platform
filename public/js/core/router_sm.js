/**
 * KOLIYA — router_sm.js
 * ============================================================
 * Hash routing + back/forward + web keyboard navigation.
 *
 * The old code had `go("feed")` with a manual navStack array and no
 * URL involvement at all: the browser Back button did nothing, and
 * no screen could be linked or bookmarked. On a web app that is a
 * real defect, not a detail.
 * ============================================================
 */

import { $, on, env, modKey } from './utils_sm.js';
import { emit, setState, state, write, read, KEYS } from './store_sm.js';

/* ------------------------------------------------------------
   1. ROUTE TABLE
   ------------------------------------------------------------ */

/**
 * Titles are i18n KEYS, not text. They are resolved through t() at
 * render time, so switching language relabels the whole app without
 * a reload — and a route added later cannot forget to be translated.
 */
import { t } from './i18n_sm.js';

export const ROUTES = {
  feed:          { title: 'nav.home',          nav: true,  icon: 'home' },
  explore:       { title: 'nav.explore',       nav: true,  icon: 'compass' },
  messages:      { title: 'nav.messages',      nav: true,  icon: 'message' },
  notifications: { title: 'nav.notifications', nav: true,  icon: 'bell' },
  hub:           { title: 'nav.hub',           nav: true,  icon: 'trophy' },
  channels:      { title: 'nav.channels',      nav: true,  icon: 'hash' },
  events:        { title: 'nav.events',        nav: true,  icon: 'calendar' },
  qa:            { title: 'nav.qa',            nav: true,  icon: 'help' },
  profile:       { title: 'nav.profile',       nav: true,  icon: 'user' },
  saved:         { title: 'nav.saved',         nav: false, icon: 'bookmark' },
  leaderboard:   { title: 'nav.leaderboard',   nav: false, icon: 'chart' },
  settings:      { title: 'nav.settings',      nav: false, icon: 'settings' },
  post:          { title: 'feed.post',         nav: false },
  channel:       { title: 'nav.channels',      nav: false },
  auth:          { title: 'auth.signIn',       nav: false, public: true }
};

/** The human label for a route, in the current language. */
export const routeTitle = name => t(ROUTES[name]?.title || name);

const DEFAULT_ROUTE = 'feed';

/* ------------------------------------------------------------
   2. PARSE / BUILD
   ------------------------------------------------------------ */

/** "#/messages/u_42?tab=media" -> { name, arg, query } */
export function parseHash(hash = location.hash) {
  const raw = String(hash).replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const [name = '', arg = null] = path.split('/');
  return {
    name:  ROUTES[name] ? name : DEFAULT_ROUTE,
    arg:   arg ? decodeURIComponent(arg) : null,
    query: Object.fromEntries(new URLSearchParams(qs || ''))
  };
}

export function buildHash(name, arg, query) {
  let h = '#/' + name;
  if (arg) h += '/' + encodeURIComponent(arg);
  const qs = new URLSearchParams(query || {}).toString();
  return qs ? `${h}?${qs}` : h;
}

/* ------------------------------------------------------------
   3. NAVIGATION
   ------------------------------------------------------------ */

const handlers = new Map();      // routeName -> render(arg, query)
const guards   = [];             // fn(to, from) -> false | string
let current    = { name: null, arg: null, query: {} };
let navigating = false;

/** Register the renderer for a route. */
export function route(name, renderFn) {
  handlers.set(name, renderFn);
  return () => handlers.delete(name);
}

/** Block or redirect navigation (used for auth and approval status). */
export function guard(fn) {
  guards.push(fn);
  return () => {
    const i = guards.indexOf(fn);
    if (i > -1) guards.splice(i, 1);
  };
}

/** Navigate. Adds a history entry unless replace:true. */
export function go(name, arg = null, { query, replace = false } = {}) {
  const target = { name, arg, query: query || {} };

  for (const g of guards) {
    const verdict = g(target, current);
    if (verdict === false) return false;
    if (typeof verdict === 'string') return go(verdict, null, { replace: true });
  }

  const hash = buildHash(name, arg, query);
  if (hash === location.hash) { render(target); return true; }

  navigating = true;
  if (replace) history.replaceState({ ...target }, '', hash);
  else         history.pushState({ ...target }, '', hash);
  navigating = false;

  render(target);
  return true;
}

export const replace = (name, arg, opts = {}) => go(name, arg, { ...opts, replace: true });
export const back    = () => history.length > 1 ? history.back() : go(DEFAULT_ROUTE, null, { replace: true });

/* ------------------------------------------------------------
   4. RENDER
   ------------------------------------------------------------ */

function render(target) {
  const prev = current;
  current = target;

  setState({ route: { name: target.name, arg: target.arg } });
  write(KEYS.LAST_ROUTE, { name: target.name, arg: target.arg });

  const meta = ROUTES[target.name] || {};
  // meta.title is an i18n KEY, so the tab title follows the language
  document.title = meta.title ? `${t(meta.title)} — Koliya` : 'Koliya';

  // direction hint so the view can slide the right way
  const dir = navDirection(prev.name, target.name);
  document.documentElement.dataset.navDir = dir;

  emit('route:leave', prev);

  const handler = handlers.get(target.name);
  if (handler) {
    try {
      handler(target.arg, target.query, prev);
    } catch (e) {
      console.error(`[koliya] échec du rendu "${target.name}"`, e);
      emit('route:error', { route: target, error: e });
    }
  } else {
    // A view may not be registered yet (lazy feature module, or a
    // route still being built). The chrome must still update, otherwise
    // the rail, nav highlight and title freeze on the previous screen.
    console.warn(`[koliya] aucune vue pour "${target.name}"`);
    emit('route:missing', target);
  }

  emit('route:enter', target);

  // a fresh view starts at the top, a restored one keeps its place
  const main = $('#main');
  if (main && prev.name !== target.name) main.scrollTop = 0;
}

const NAV_ORDER = Object.keys(ROUTES);
function navDirection(from, to) {
  if (!from) return 'none';
  const a = NAV_ORDER.indexOf(from), b = NAV_ORDER.indexOf(to);
  return a === b ? 'none' : (b > a ? 'forward' : 'back');
}

/* ------------------------------------------------------------
   5. HISTORY
   ------------------------------------------------------------ */

addEventListener('popstate', () => {
  if (navigating) return;
  render(parseHash());
});

addEventListener('hashchange', () => {
  if (navigating) return;
  const next = parseHash();
  if (next.name !== current.name || next.arg !== current.arg) render(next);
});

/* ------------------------------------------------------------
   6. KEYBOARD  — web-native navigation
   ------------------------------------------------------------ */

/** True while the user is typing, so shortcuts never steal keystrokes. */
function isTyping(e) {
  const t = e.target;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

// "G then H" — the two-key pattern from Gmail and GitHub
const GOTO = {
  h: 'feed',  e: 'explore', m: 'messages', n: 'notifications',
  u: 'hub',   c: 'channels', v: 'events',  q: 'qa',
  p: 'profile', s: 'saved',  l: 'leaderboard'
};
let gPending = false, gTimer = null;

export const SHORTCUTS = [
  { keys: `${modKey()}+K`, label: 'Recherche rapide' },
  { keys: `${modKey()}+/`, label: 'Afficher les raccourcis' },
  { keys: 'G puis H',      label: 'Accueil' },
  { keys: 'G puis M',      label: 'Messages' },
  { keys: 'G puis P',      label: 'Profil' },
  { keys: 'G puis N',      label: 'Notifications' },
  { keys: 'N',             label: 'Nouvelle publication' },
  { keys: 'J / K',         label: t('a11y.nextPrevPost') },
  { keys: 'L',             label: 'Aimer la publication sélectionnée' },
  { keys: t('a11y.escape'),         label: 'Fermer' },
  { keys: 'Alt+←',         label: 'Retour' }
];

function onKey(e) {
  // Escape works even inside inputs
  if (e.key === 'Escape') { emit('key:escape', e); return; }
  if (isTyping(e)) return;

  const mod = env.isMac ? e.metaKey : e.ctrlKey;

  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); emit('key:search'); return; }
  if (mod && e.key === '/')               { e.preventDefault(); emit('key:shortcuts'); return; }
  if (e.altKey && e.key === 'ArrowLeft')  { e.preventDefault(); back(); return; }
  if (mod || e.altKey) return;

  const k = e.key.toLowerCase();

  if (gPending) {
    clearTimeout(gTimer);
    gPending = false;
    const dest = GOTO[k];
    if (dest) { e.preventDefault(); go(dest); }
    return;
  }
  if (k === 'g') {
    gPending = true;
    gTimer = setTimeout(() => { gPending = false; }, 1200);
    return;
  }

  // single-key actions, forwarded to whichever view is listening
  if (k === 'n') { e.preventDefault(); emit('key:compose'); }
  else if (k === 'j') { e.preventDefault(); emit('key:next'); }
  else if (k === 'k') { e.preventDefault(); emit('key:prev'); }
  else if (k === 'l') { e.preventDefault(); emit('key:like'); }
  else if (k === '?') { e.preventDefault(); emit('key:shortcuts'); }
}

/* ------------------------------------------------------------
   7. LINK INTERCEPTION
   Any <a href="#/..."> or [data-route] navigates without reload.
   ------------------------------------------------------------ */

function onClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;

  const link = e.target.closest('a[href^="#/"], [data-route]');
  if (!link) return;

  e.preventDefault();
  if (link.dataset.route) {
    go(link.dataset.route, link.dataset.arg || null);
  } else {
    const { name, arg, query } = parseHash(link.getAttribute('href'));
    go(name, arg, { query });
  }
}

/* ------------------------------------------------------------
   8. SCROLL MEMORY
   Going back to the feed should land where you left it.
   ------------------------------------------------------------ */

const scrollMemory = new Map();

export function rememberScroll(key, top) { scrollMemory.set(key, top); }
export function restoreScroll(key, node) {
  const top = scrollMemory.get(key);
  if (top != null && node) requestAnimationFrame(() => { node.scrollTop = top; });
}

/* ------------------------------------------------------------
   9. BOOT
   ------------------------------------------------------------ */

export function initRouter({ start } = {}) {
  on(document, 'keydown', onKey);
  on(document, 'click', onClick);

  const initial = location.hash ? parseHash() : null;

  if (initial && initial.name !== DEFAULT_ROUTE) {
    history.replaceState({ ...initial }, '', location.hash);
    render(initial);
  } else if (start) {
    go(start, null, { replace: true });
  } else {
    const last = read(KEYS.LAST_ROUTE);
    const name = (last?.name && ROUTES[last.name]) ? last.name : DEFAULT_ROUTE;
    go(name, last?.arg ?? null, { replace: true });
  }

  return current;
}

/**
 * Re-render the CURRENT screen when the language changes.
 *
 * Translating strings is only half the job: the screen already on
 * display was built with the old language and will not change until
 * something repaints it. Re-running the active view is what makes
 * the switch feel instant instead of "working after you navigate".
 */
on(window, 'koliya:i18n', () => render({ ...current }));

export const currentRoute = () => ({ ...current });
export const isRoute = (name) => current.name === name;
