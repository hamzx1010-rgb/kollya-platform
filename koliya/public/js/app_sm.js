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
import { initHub } from './features/hub_sm.js';
import { initProfile } from './features/profile_sm.js';
import { initNotifications, refreshNotificationBadge } from './features/notifications_sm.js';
import { initCampus } from './features/campus_sm.js';
import { initLeaderboard } from './features/leaderboard_sm.js';
import { openStories } from './features/stories_sm.js';
import { renderAuth, renderPending } from './features/auth_ui_sm.js';
import { initAuth, signOut } from './core/auth_sm.js';
import { canUseDatabase, missingConfig } from './core/config_sm.js';

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
async function resolveSession() {
  if (!canUseDatabase()) {
    console.info('[koliya] mode aperçu — base de données non configurée:', missingConfig());
    me.set(PREVIEW_USER);
    return 'preview';
  }

  try {
    const state = await initAuth();
    if (state === 'authenticated') return 'authenticated';
    if (state === 'pending') return 'pending';
    return 'anonymous';
  } catch (e) {
    console.error('[koliya] échec de la vérification de session', e);
    return 'anonymous';
  }
}

function showAuthScreen() {
  show('auth');
  renderAuth(async () => {
    const state = await resolveSession();
    if (state === 'pending') { renderPending(handleSignOut); return; }
    if (state === 'anonymous') return;
    enterApp();
  });
}

async function handleSignOut() {
  await signOut();
  location.hash = '';
  showAuthScreen();
}

function enterApp() {
  $('#auth')?.classList.add('hidden');
  show('app');
  initRouter();
  refreshNotificationBadge();
}

/* ------------------------------------------------------------
   3. PLACEHOLDER VIEWS
   Each feature module will replace these as it lands.
   ------------------------------------------------------------ */

const PLACEHOLDERS = {
  settings:      ['settings', 'Réglages',         'Préférences du compte.']
};

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
    toast('La recherche arrive avec le module Explorer', { duration: 2200 });
  });

  // the feed module owns compose; this is the fallback from other routes
  onEvent('key:compose', () => { location.hash = '#/feed'; setTimeout(() => openComposer(), 120); });

  onEvent('route:error', ({ route: r, error }) => {
    console.error('[koliya] view crashed', r, error);
    toast('Cette vue a rencontré une erreur', 'err');
  });
}

/* ------------------------------------------------------------
   5. SERVICE WORKER
   Registering one is easy; the part people skip is telling the user
   when a new version is waiting. Without this they stay on stale
   code until they happen to close every tab.
   ------------------------------------------------------------ */

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

  hydrateIcons();
  initShell();
  registerPlaceholders();
  wireGlobalKeys();

  initMessages(mount);        // real feature modules replace their placeholders
  initFeed(mount);
  initHub(mount);
  initProfile(mount);
  initNotifications(mount);
  initCampus(mount);
  initLeaderboard(mount);

  if (!hasStorage) {
    toast('Stockage indisponible — votre session ne survivra pas au rafraîchissement',
          { kind: 'err', duration: 6000 });
  }

  const state = await resolveSession();

  if (state === 'anonymous') { showAuthScreen(); registerSW(); return; }
  if (state === 'pending')   { show('auth'); renderPending(handleSignOut); registerSW(); return; }

  enterApp();
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
