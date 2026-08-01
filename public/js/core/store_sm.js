/**
 * KOLIYA — store_sm.js
 * ============================================================
 * State + persistence + a tiny reactive layer.
 *
 * Fixes the worst bug in the old file:
 *
 *   const onlineStore = (()=>{ const m = new Map(); ... })();
 *
 * That was a Map living in RAM. Every key written to it — including
 * "koliya_sess", the login session — vanished on F5. Students had to
 * log in again after every page refresh.
 *
 * This module uses real localStorage, degrades to memory only when
 * the browser forbids it (private mode, embedded preview), and warns
 * once instead of failing silently.
 * ============================================================
 */

import { uid } from './utils_sm.js';

/* ------------------------------------------------------------
   1. PERSISTENCE BACKEND
   ------------------------------------------------------------ */

const PREFIX = 'kl:';

function probeLocalStorage() {
  try {
    const k = '__kl_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

const HAS_LS = probeLocalStorage();
const memory = new Map();

if (!HAS_LS) {
  console.warn(
    '[koliya] localStorage indisponible — session en mémoire seulement. ' +
    'Elle sera perdue au rafraîchissement.'
  );
}

const backend = HAS_LS ? {
  get:    k => localStorage.getItem(PREFIX + k),
  set:    (k, v) => { try { localStorage.setItem(PREFIX + k, v); } catch (e) { pruneAndRetry(k, v, e); } },
  remove: k => localStorage.removeItem(PREFIX + k),
  keys:   () => Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).map(k => k.slice(PREFIX.length))
} : {
  get:    k => memory.has(k) ? memory.get(k) : null,
  set:    (k, v) => memory.set(k, v),
  remove: k => memory.delete(k),
  keys:   () => [...memory.keys()]
};

/** Quota exceeded: drop cached data, keep session and preferences. */
function pruneAndRetry(key, value, err) {
  console.warn('[koliya] stockage plein, nettoyage du cache…', err?.name);
  for (const k of backend.keys()) {
    if (k.startsWith('cache:') || k.startsWith('draft:')) {
      try { localStorage.removeItem(PREFIX + k); } catch {}
    }
  }
  try { localStorage.setItem(PREFIX + key, value); }
  catch { memory.set(key, value); }
}

/* ------------------------------------------------------------
   2. TYPED READ / WRITE
   ------------------------------------------------------------ */

export function read(key, fallback = null) {
  const raw = backend.get(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); }
  catch { return raw; }            // plain string written by older code
}

export function write(key, value) {
  if (value === undefined || value === null) return remove(key);
  backend.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  return value;
}

export const remove = key => backend.remove(key);

/** Wipe everything except the keys you name. */
export function clearAll(keep = []) {
  const keepSet = new Set(keep);
  for (const k of backend.keys()) if (!keepSet.has(k)) backend.remove(k);
}

/**
 * Namespaced sub-store, so features never collide on key names.
 *
 * THE ACCOUNT-BLEED BUG
 * The prefix used to be just `namespace + ':'` — no account in it. Every
 * signed-in user on the same device therefore shared ONE set of local
 * keys, so liking your own post appeared to happen on every account:
 * the liked marks, seen stories, quest progress, chat prefs and the
 * notify marker were all written to the same place and read back by
 * whoever signed in next.
 *
 * The key now carries the user id, so two accounts on one phone cannot
 * see each other's local state. Signed out, it falls back to `anon`.
 *
 * The id is read at CALL time, not when scoped() runs: every feature
 * calls scoped() at module load, long before sign-in resolves.
 * Capturing it once would pin every store to `anon` for the whole
 * session — the same "frozen at import time" trap that froze the
 * language in thirteen other places.
 */
function currentScopeId() {
  try {
    return (_state.me?.id) || read(KEYS.ME)?.id || read(KEYS.SESSION)?.userId || 'anon';
  } catch {
    return 'anon';
  }
}

export function scoped(namespace) {
  const prefix = () => `${namespace}:${currentScopeId()}:`;
  return {
    get:    (k, f) => read(prefix() + k, f),
    set:    (k, v) => write(prefix() + k, v),
    remove: k => remove(prefix() + k),
    keys:   () => {
      const p = prefix();
      return backend.keys().filter(k => k.startsWith(p)).map(k => k.slice(p.length));
    },
    clear:  () => {
      const p = prefix();
      backend.keys().filter(k => k.startsWith(p)).forEach(backend.remove);
    }
  };
}

/* ------------------------------------------------------------
   3. KEYS  — every persisted name in one place
   The old code had ~25 of these scattered across 4800 lines.
   ------------------------------------------------------------ */

export const KEYS = {
  SESSION:     'session',        // { token, refresh, userId, expiresAt }
  ME:          'me',             // cached profile, for instant first paint
  THEME:       'pref:theme',     // 'system' | 'light' | 'dark'
  LOCALE:      'pref:locale',    // 'fr' | 'ar' | 'en'
  GUIDE_DONE:  'pref:guideDone',
  SOUND:       'pref:sound',     // celebration sounds on/off
  LAST_ROUTE:  'nav:lastRoute',
  DRAFTS:      'draft',          // draft:<chatId>
  CHAT_FOLDER: 'chat:folder',    // chat:folder:<chatId>
  READ_MARK:   'chat:read',      // chat:read:<chatId>
  GIF_RECENT:  'gif:recent',
  GIF_FAV:     'gif:fav',
  EMOJI_FREQ:  'emoji:freq',     // powers "your top reactions first"
  FILTER_LAST: 'editor:lastFilter'
};

/* ------------------------------------------------------------
   4. SESSION
   ------------------------------------------------------------ */

export const session = {
  get()      { return read(KEYS.SESSION); },

  save(data) {
    write(KEYS.SESSION, {
      token:     data.token,
      refresh:   data.refresh ?? null,
      userId:    data.userId,
      expiresAt: data.expiresAt ?? (Date.now() + 3600_000)
    });
    emit('session', data);
    return data;
  },

  clear() {
    remove(KEYS.SESSION);
    remove(KEYS.ME);
    emit('session', null);
  },

  get valid() {
    const s = read(KEYS.SESSION);
    return !!(s?.token && s.expiresAt > Date.now());
  },

  /** True when the token is close enough to expiry to refresh it. */
  get expiringSoon() {
    const s = read(KEYS.SESSION);
    return !!(s?.token && s.expiresAt - Date.now() < 120_000);
  },

  get token()  { return read(KEYS.SESSION)?.token ?? null; },
  get userId() { return read(KEYS.SESSION)?.userId ?? null; }
};

/* ------------------------------------------------------------
   5. REACTIVE STATE  (in-memory, not persisted)
   ------------------------------------------------------------ */

const listeners = new Map();   // event -> Set<fn>

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);   // unsubscribe
}

export function emit(event, payload) {
  listeners.get(event)?.forEach(fn => {
    try { fn(payload); }
    catch (e) { console.error(`[koliya] listener "${event}" a échoué`, e); }
  });
  listeners.get('*')?.forEach(fn => { try { fn(event, payload); } catch {} });
}

const _state = {
  me:            null,
  route:         { name: 'feed', arg: null },
  activeChat:    null,
  unread:        { messages: 0, notifications: 0 },
  online:        navigator.onLine,
  windowFocused: !document.hidden,
  typing:        new Map(),     // userId -> timestamp
  presence:      new Map()      // userId -> lastSeen
};

/** Read-only snapshot. */
export const state = new Proxy(_state, {
  set() {
    console.error('[koliya] state est en lecture seule — utilisez setState()');
    return true;
  }
});

/** Update state and notify only the keys that actually changed. */
export function setState(patch) {
  const changed = [];
  for (const [k, v] of Object.entries(patch)) {
    if (_state[k] === v) continue;
    _state[k] = v;
    changed.push(k);
  }
  for (const k of changed) emit(`state:${k}`, _state[k]);
  if (changed.length) emit('state', { changed, state: _state });
  return _state;
}

/* ------------------------------------------------------------
   6. CURRENT USER
   ------------------------------------------------------------ */

export const me = {
  get()  { return _state.me ?? read(KEYS.ME); },

  set(profile) {
    setState({ me: profile });
    write(KEYS.ME, profile);      // instant paint on next load
    return profile;
  },

  get id()       { return me.get()?.id ?? session.userId; },
  get isAdmin()  { return me.get()?.role === 'admin'; },
  get approved() { return me.get()?.status === 'approved'; }
};

/* ------------------------------------------------------------
   7. PREFERENCES
   ------------------------------------------------------------ */

export const prefs = {
  /** 'system' by default — follow the OS instead of asking the user. */
  get theme() { return read(KEYS.THEME, 'system'); },
  set theme(v) {
    write(KEYS.THEME, v);
    applyTheme();
    emit('theme', v);
  },

  // English is the official language of the app. i18n_sm.initI18n()
  // may still pick the browser's language on a first visit, but the
  // fallback when nothing is known is 'en', not 'fr'.
  get locale() { return read(KEYS.LOCALE, 'en'); },
  set locale(v) {
    write(KEYS.LOCALE, v);
    document.documentElement.lang = v;
    document.documentElement.dir = v === 'ar' ? 'rtl' : 'ltr';
    emit('locale', v);
  },

  get guideDone() { return read(KEYS.GUIDE_DONE, false); },
  set guideDone(v) { write(KEYS.GUIDE_DONE, !!v); },

  /** Celebration sounds. On by default — a reward nobody hears is not
      a reward. sound_sm.js still stays silent for a hidden tab and for
      prefers-reduced-motion. */
  get sound() { return read(KEYS.SOUND, true); },
  set sound(v) { write(KEYS.SOUND, !!v); emit('sound', !!v); }
};

/** Resolve 'system' against the OS and paint it. */
export function applyTheme() {
  const pick = prefs.theme;
  const dark = pick === 'dark' ||
    (pick === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#0F1115' : '#FAFAF9');
  return dark;
}

// follow the OS live, but only while the user hasn't overridden it
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (prefs.theme === 'system') applyTheme();
});

/* ------------------------------------------------------------
   8. DRAFTS  — never lose a half-typed message
   ------------------------------------------------------------ */

const drafts = scoped(KEYS.DRAFTS);

export const draft = {
  get:  chatId => drafts.get(chatId, ''),
  set:  (chatId, text) => text?.trim() ? drafts.set(chatId, text) : drafts.remove(chatId),
  clear: chatId => drafts.remove(chatId),
  all:  () => drafts.keys()
};

/* ------------------------------------------------------------
   9. LEARNED BEHAVIOUR
   The app watches what you use and puts it first.
   ------------------------------------------------------------ */

export const frequency = {
  bump(bucket, value, cap = 40) {
    const key = `${bucket}:freq`;
    const map = read(key, {});
    map[value] = (map[value] || 0) + 1;
    const trimmed = Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, cap);
    write(key, Object.fromEntries(trimmed));
  },

  /** Most-used first — used for reaction order and GIF categories. */
  top(bucket, n = 6) {
    return Object.entries(read(`${bucket}:freq`, {}))
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([v]) => v);
  }
};

export const recent = {
  push(bucket, value, cap = 30) {
    const key = `${bucket}:recent`;
    const list = read(key, []).filter(x => x !== value);
    list.unshift(value);
    write(key, list.slice(0, cap));
  },
  list: (bucket, n = 30) => read(`${bucket}:recent`, []).slice(0, n)
};

/* ------------------------------------------------------------
   10. ENVIRONMENT SIGNALS
   These drive the adaptive poll interval: full speed while you are
   reading a chat, slow while browsing, stopped when the tab is hidden.
   ------------------------------------------------------------ */

addEventListener('online',  () => setState({ online: true }));
addEventListener('offline', () => setState({ online: false }));

document.addEventListener('visibilitychange', () => {
  setState({ windowFocused: !document.hidden });
  emit(document.hidden ? 'app:hidden' : 'app:visible');
});

/** Cross-tab sync: log out in one tab, log out everywhere. */
addEventListener('storage', e => {
  if (!e.key?.startsWith(PREFIX)) return;
  const key = e.key.slice(PREFIX.length);
  if (key === KEYS.SESSION) {
    const s = read(KEYS.SESSION);
    if (!s) { setState({ me: null }); emit('session', null); }
  }
  emit('storage:' + key, read(key));
});

/* ------------------------------------------------------------
   11. BOOT
   ------------------------------------------------------------ */

export function initStore() {
  applyTheme();

  const loc = prefs.locale;
  document.documentElement.lang = loc;
  document.documentElement.dir = loc === 'ar' ? 'rtl' : 'ltr';

  // paint from cache immediately; the network refreshes it after
  const cached = read(KEYS.ME);
  if (cached && session.valid) setState({ me: cached });

  return { hasStorage: HAS_LS, session: session.valid };
}

/** Debug helper: window.__klStore in the console. */
export const debug = {
  keys:  () => backend.keys(),
  dump:  () => Object.fromEntries(backend.keys().map(k => [k, read(k)])),
  size:  () => backend.keys().reduce((n, k) => n + (backend.get(k)?.length || 0), 0),
  state: () => ({ ..._state }),
  events: () => [...listeners.keys()]
};
if (typeof window !== 'undefined') window.__klStore = debug;
