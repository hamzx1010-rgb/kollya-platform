/**
 * KOLIYA — app_sm.js
 * ============================================================
 * Entry point. Boots the store, hydrates icons, starts the router
 * and the shell, then hands control to feature modules.
 *
 * Feature modules (feed, messages, stories…) register themselves
 * with route() and are loaded lazily, so the first paint stays fast.
 * ============================================================
 */

import { $, $$ } from './core/utils_sm.js';
import { initStore, session, me, emit, on as onEvent } from './core/store_sm.js';
import { initRouter, route, guard, go } from './core/router_sm.js';
import { initShell, show, mount } from './core/shell_sm.js';
import { toast, modal } from './core/ui_sm.js';
import { icon, I } from './core/icons_sm.js';
import { initMessages } from './features/messages_sm.js';
import { initFeed, openComposer } from './features/feed_sm.js';
import { initHub, wireGameEvents } from './features/hub_sm.js';
import { initProfile } from './features/profile_sm.js';
import { initNotifications, refreshNotificationBadge } from './features/notifications_sm.js';
import { initCampus } from './features/campus_sm.js';
import { initLeaderboard } from './features/leaderboard_sm.js';
import { initSettings } from './features/settings_sm.js';
import { openStories } from './features/stories_sm.js';
import { renderAuth, renderPending } from './features/auth_ui_sm.js';
import { initAuth, signOut } from './core/auth_sm.js';
import { canUseDatabase, missingConfig } from './core/config_sm.js';
import { connectApi } from './core/api_sm.js';
import { initI18n, applyI18n, t } from './core/i18n_sm.js';
import { initGame, wireGame } from './core/game_sm.js';
import { initNotify } from './core/notify_sm.js';
import { cachePeople } from './core/people_sm.js';

/* ------------------------------------------------------------
   1. ICON HYDRATION
   index_sm.html ships <i data-icon="home"></i> placeholders instead
   of inline SVG, so the markup stays readable and every icon comes
   from one source of truth.
   ------------------------------------------------------------ */

export function hydrateIcons(root = document) {
  for (const node of root.querySelectorAll('[data-icon]:empty')) {
    const name = node.dataset.icon;
    const size = node.dataset.iconSize ? Number(node.dataset.iconSize) : 0;
    node.innerHTML = icon(name, { size });
  }
}

/* ------------------------------------------------------------
   2. AUTH GATE
   Until auth_sm.js exists (waiting on Neon keys), the app runs in
   a local preview mode so the UI can be built and reviewed.
   ------------------------------------------------------------ */

const PREVIEW_USER = {
  id: 'preview-user',
  username: 'sara.b',
  full_name: 'Sara Benali',
  faculty: 'Informatique',
  student_card: 'CS-042',
  role: 'student',
  status: 'approved',
  avatar_url: null,
  xp: 340,
  streak: 7
};

/**
 * Decide what the visitor sees.
 * With Neon configured this is a real session check; without it the
 * app falls back to sample data so the UI can still be reviewed.
 */
/** Reject after `ms` so a stalled request can never hang the boot. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms))
  ]);
}

async function resolveSession() {
  if (!canUseDatabase()) {
    console.info('[koliya] mode aperçu — base de données non configurée:', missingConfig());
    me.set(PREVIEW_USER);
    return 'preview';
  }


  try {
    // A boot screen that never resolves is worse than a login screen
    // shown too early: the student can still act on the second one.
    // Eight seconds is generous for a cold Neon compute.
    const state = await withTimeout(initAuth(), 8000, 'auth');
    if (state === 'authenticated') return 'authenticated';
    if (state === 'pending') return 'pending';
    return 'anonymous';
  } catch (e) {
    console.error('[koliya] échec de la vérification de session:', e.message);
    bootProblem = e.message;
    return 'anonymous';
  }
}

let bootProblem = null;

function showAuthScreen() {
  bootDone();
  show('auth');
  if (bootProblem) {
    toast(/timeout/i.test(bootProblem) ? t('boot.slowServer') : t('boot.hardFail'),
          { kind: 'err', duration: 5000 });
    bootProblem = null;
  }
  renderAuth(async () => {
    const state = await resolveSession();
    if (state === 'pending') { renderPending(handleSignOut); return; }
    if (state === 'anonymous') return;
    await enterApp();
  });
}

async function handleSignOut() {
  await signOut();
  location.hash = '';
  showAuthScreen();
}

function bootDone() {
  // window.dispatchEvent, not the bare global: `dispatchEvent` alone is
  // undefined in some module scopes and throws, which would kill boot
  // and leave the spinner turning forever.
  try { window.dispatchEvent(new Event('koliya:ready')); } catch {}
}

async function enterApp() {
  bootDone();
  $('#auth')?.classList.add('hidden');
  show('app');

  // THE call that was missing. Until this runs, every feature module
  // is holding an `api` of null and falls back to nothing. It has to
  // happen before the first route renders, or the feed paints an
  // empty state a fraction of a second before the data arrives.
  try {
    await connectApi();
    cachePeople(me.get());
  } catch (err) {
    console.error('[koliya] connexion API échouée', err);
    toast(t('boot.noDatabase'), { kind: 'err', duration: 8000 });
  }

  // The game engine listens for 'game:action' events, so it must be
  // wired before the first screen can fire one.
  wireGame();
  wireGameEvents();     // listeners live for the whole session, not just on /hub
  initGame().catch(err => console.warn('[koliya] jeu non initialisé', err.message));

  initRouter();
  refreshNotificationBadge();

  // Explains itself first, asks the browser second — see notify_sm.
  initNotify();
}

/* ------------------------------------------------------------
   3. PLACEHOLDER VIEWS
   Each feature module will replace these as it lands.
   ------------------------------------------------------------ */

// Every screen now has a real module; nothing is a placeholder.
const PLACEHOLDERS = {};

function registerPlaceholders() {
  for (const [name, [ic, title, text]] of Object.entries(PLACEHOLDERS)) {
    route(name, () => {
      const host = mount();
      if (!host) return;
      host.innerHTML = `
        <div class="empty">
          <div class="empty-art">${icon(ic, { size: 34 })}</div>
          <div class="empty-title">${title}</div>
          <div class="empty-text">${text}</div>
          <span class="pill">Module en cours de construction</span>
        </div>`;
    });
  }
}

/* ------------------------------------------------------------
   4. GLOBAL SHORTCUT WIRING
   ------------------------------------------------------------ */

function wireGlobalKeys() {
  onEvent('key:search', () => {
    go('explore');
  });

  // the feed module owns compose; this is the fallback from other routes
  onEvent('key:compose', () => { location.hash = '#/feed'; setTimeout(() => openComposer(), 120); });

  onEvent('route:error', ({ route: r, error }) => {
    console.error('[koliya] view crashed', r, error);
    toast(t('error.generic'), 'err');
  });
}

/* ------------------------------------------------------------
   5. SERVICE WORKER
   Registering one is easy; the part people skip is telling the user
   when a new version is waiting. Without this they stay on stale
   code until they happen to close every tab.
   ------------------------------------------------------------ */

/** Rolling past midnight with the tab open must re-read the day. */
function wireVisibility() {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) emit('app:visible');
  });
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  addEventListener('load', async () => {
    let reg;
    try {
      reg = await navigator.serviceWorker.register('sw_sm.js');
    } catch (err) {
      console.warn('[koliya] service worker non enregistré', err.message);
      return;
    }

    // A new worker is installing — offer the update once it is ready.
    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      if (!incoming) return;
      incoming.addEventListener('statechange', () => {
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Une nouvelle version est disponible', {
            duration: 20000,
            action: {
              label: 'Actualiser',
              fn: () => {
                incoming.postMessage({ type: 'SKIP_WAITING' });
              }
            }
          });
        }
      });
    });

    // The new worker took over: reload once, and only once.
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });

    // Notification click asked us to go somewhere.
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'NAVIGATE' && e.data.url) {
        const hash = e.data.url.split('#')[1];
        if (hash) location.hash = '#' + hash;
      }
    });
  });
}

/** Called on logout so cached media cannot outlive the session. */
export function purgeCaches() {
  navigator.serviceWorker?.controller?.postMessage({ type: 'PURGE' });
}

/* ------------------------------------------------------------
   6. BOOT
   ------------------------------------------------------------ */

async function boot() {
  const { hasStorage } = initStore();

  // Language before the first paint, or the shell renders in one
  // language and relabels itself a frame later.
  initI18n();

  hydrateIcons();
  applyI18n();
  initShell();
  registerPlaceholders();
  wireGlobalKeys();
  wireVisibility();

  initMessages(mount);        // real feature modules replace their placeholders
  initFeed(mount);
  initHub(mount);
  initProfile(mount);
  initNotifications(mount);
  initCampus(mount);
  initLeaderboard(mount);
  initSettings(mount);

  if (!hasStorage) {
    toast(t('store.noStorage'), { kind: 'err', duration: 6000 });
  }

  const state = await resolveSession();

  if (state === 'anonymous') { showAuthScreen(); registerSW(); return; }
  if (state === 'pending')   { bootDone(); show('auth'); renderPending(handleSignOut); registerSW(); return; }

  await enterApp();
  registerSW();

  onEvent('route:enter', () => hydrateIcons());
  console.info('[koliya] prêt');
}

boot().catch(err => {
  console.error('[koliya] échec du démarrage', err);
  const boot = $('#boot');
  if (boot) {
    boot.innerHTML = `
      <div class="empty">
        <div class="empty-art">${I.close}</div>
        <div class="empty-title">Échec du démarrage</div>
        <div class="empty-text">${err.message}</div>
      </div>`;
  }
});
