/**
 * KOLIYA — shell_sm.js
 * ============================================================
 * The app frame: rail state, topbar, scroll behaviour, shortcuts.
 *
 * Design rule enforced here:
 *   the interface decides for itself.
 *
 * Old code (line 3556):
 *   b.innerHTML = 'Fold panel';
 *   b.onclick = () => body.classList.toggle('side-folded');
 * That asked the student a question they never wanted to answer.
 *
 * Here the rail collapses because you opened a conversation, and
 * expands because your mouse arrived. No button exists.
 * ============================================================
 */

import { $, $$, on, throttle, rafThrottle, env, initials, avatarColor, modKey } from './utils_sm.js';
import { state, setState, on as onEvent, emit, prefs, applyTheme, me } from './store_sm.js';
import { ROUTES, go, back, currentRoute, shortcuts } from './router_sm.js';
import { modal, toast, closeMenu, contextMenu } from './ui_sm.js';
import { t, lang, setLang, LANGS, applyI18n } from './i18n_sm.js';

/* ------------------------------------------------------------
   1. RAIL  — context-driven, never asked
   ------------------------------------------------------------ */

/**
 * The rail is always expanded.
 *
 * Three mechanisms used to decide its width — a per-route rule, a
 * 2.2s auto-fold timer, and a hover "peek" that floated it over the
 * content. They contradicted each other mid-transition, which is why
 * the icons looked crushed and the panel felt like it was fighting
 * you. Reconciling three sources of truth for one number was the
 * wrong fix; removing the feature is the right one.
 */
function syncRail() {
  const app = $('#app');
  if (app) app.dataset.rail = 'expanded';
}

/** Kept as a no-op: callers and tests still reference it. */
function wireRailPeek() {}

/* ------------------------------------------------------------
   2. ACTIVE NAV ITEM
   ------------------------------------------------------------ */

function syncNav(routeName) {
  for (const a of $$('[data-nav]')) {
    const on_ = a.dataset.nav === routeName;
    a.classList.toggle('on', on_);
    if (on_) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

/* ------------------------------------------------------------
   3. TOPBAR
   ------------------------------------------------------------ */

function syncTopbar(routeName, arg) {
  const meta = ROUTES[routeName] || {};
  const title = $('#topbarTitle');
  if (title) title.textContent = meta.title ? t(meta.title) : 'Koliya';

  // the back arrow exists only when going back means something
  const app = $('#app');
  if (app) app.dataset.canBack = String(!!arg || !meta.nav);
}

/* ------------------------------------------------------------
   4. SCROLL BEHAVIOUR
   Sub-tabs slide away while reading and return on scroll-up.
   ------------------------------------------------------------ */

function wireScroll() {
  const view = $('#view');
  if (!view) return;

  let lastY = 0;

  const handler = rafThrottle(() => {
    const y = view.scrollTop;
    const tabs = view.querySelector('.sub-tabs');

    if (tabs) {
      const goingDown = y > lastY && y > 80;
      tabs.classList.toggle('hide', goingDown);
    }

    // shadow under the topbar once content passes beneath it
    $('#main')?.classList.toggle('scrolled', y > 4);

    lastY = y;
    emit('view:scroll', { top: y, atBottom: y + view.clientHeight >= view.scrollHeight - 40 });
  });

  on(view, 'scroll', handler, { passive: true });
}

/* ------------------------------------------------------------
   5. IDENTITY IN THE RAIL
   ------------------------------------------------------------ */

export function renderMe() {
  const u = me.get();
  const av = $('#myAvatar'), nm = $('#myName'), hd = $('#myHandle');
  if (!u || !av) return;

  if (u.avatar_url) {
    av.innerHTML = `<img src="${u.avatar_url}" alt="">`;
  } else {
    av.textContent = initials(u.full_name || u.username);
    av.style.background = avatarColor(u.id);
  }
  if (nm) nm.textContent = u.full_name || u.username || '—';
  if (hd) { hd.textContent = u.username ? '@' + u.username : '—'; hd.classList.add('handle'); }
}

/* ------------------------------------------------------------
   6. BADGES
   ------------------------------------------------------------ */

/* ------------------------------------------------------------
   LANGUAGE
   Top-right, next to the theme toggle. A menu rather than a cycle:
   three options is one too many to guess by clicking.
   ------------------------------------------------------------ */

function syncLangButton() {
  const node = $('#langCode');
  if (!node) return;
  const l = LANGS.find(x => x.id === lang());
  node.textContent = l ? l.flag : 'EN';
  $('#btnLang')?.setAttribute('aria-label', t('settings.language'));
  $('#btnLang')?.setAttribute('data-tip', t('settings.language'));
}

function openLangMenu(e) {
  contextMenu(e, [
    { title: t('settings.language') },
    ...LANGS.map(l => ({
      label: l.native,
      kbd: l.id === lang() ? '✓' : '',
      onClick: () => { setLang(l.id); syncLangButton(); }
    }))
  ]);
}

// The whole shell relabels itself when the language changes; no reload.
onEvent('i18n:changed', () => {
  syncLangButton();
  applyI18n(document);
  // Nav labels and the page title come from ROUTES, so re-run the
  // two syncs that read them. No reload — the whole point of keeping
  // the strings in memory.
  const r = currentRoute();
  syncNav(r?.name);
  syncTopbar(r?.name, r?.arg);
  renderMe();
  emit('route:relabel');
});

export function setBadge(which, n) {
  const node = $(which === 'messages' ? '#badgeMessages' : '#badgeNotifs');
  if (!node) return;
  node.textContent = n > 99 ? '99+' : String(n);
  node.classList.toggle('hidden', !n);

  const total = state.unread.messages + state.unread.notifications;
  document.title = total ? `(${total}) Koliya` : 'Koliya';
}

onEvent('state:unread', u => {
  setBadge('messages', u.messages);
  setBadge('notifications', u.notifications);
});

/* ------------------------------------------------------------
   7. SHORTCUTS SHEET
   ------------------------------------------------------------ */

export function showShortcuts() {
  const rows = shortcuts().map(s => `
    <div class="row between" style="padding:var(--s2) 0">
      <span class="t-sm">${s.label}</span>
      <span class="row g1">${
        s.keys.split(' ').map(k =>
          /^(puis|then|\/|\+)$/i.test(k) ? `<span class="t-xs t-dim2">${k}</span>` : `<span class="kbd">${k}</span>`
        ).join('')
      }</span>
    </div>`).join('');

  modal({
    title: 'Raccourcis clavier',
    body: `<div>${rows}</div>
           <p class="t-xs t-dim2" style="margin-top:var(--s4)">
             Les raccourcis sont ignorés pendant la saisie de texte.
           </p>`
  });
}

/* ------------------------------------------------------------
   8. THEME BUTTON
   Follows the OS by default; the button is an override, not the
   first question we ask.
   ------------------------------------------------------------ */

function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(prefs.theme) + 1) % order.length];
  prefs.theme = next;
  toast(
    next === 'system' ? t('theme.system')
    : next === 'dark' ? t('theme.dark')
    : t('theme.light'),
    { duration: 1600 }
  );
}

/* ------------------------------------------------------------
   9. BOOT
   ------------------------------------------------------------ */

export function initShell() {
  applyTheme();
  wireRailPeek();
  wireScroll();

  $('#btnBack')   && on($('#btnBack'), 'click', () => back());
  $('#btnTheme')  && on($('#btnTheme'), 'click', cycleTheme);
  $('#btnHelp')   && on($('#btnHelp'), 'click', showShortcuts);
  $('#btnLang')   && on($('#btnLang'), 'click', openLangMenu);
  syncLangButton();
  $('#btnSearch') && on($('#btnSearch'), 'click', () => emit('key:search'));
  $('#btnCompose')&& on($('#btnCompose'), 'click', () => emit('key:compose'));
  $('#railMe')    && on($('#railMe'), 'click', () => go('profile', me.get()?.username || null));

  onEvent('key:shortcuts', showShortcuts);

  // react to navigation
  onEvent('route:enter', ({ name, arg }) => {
    syncRail();
    syncNav(name);
    syncTopbar(name, arg);
    closeMenu();
  });

  // the rail rule changes when crossing the mobile breakpoint

  // offline banner — the app should say so rather than silently fail
  let offlineToast = null;
  onEvent('state:online', online => {
    if (!online) {
      offlineToast = toast(t('toast.offlineQueue'),
                           { kind: 'err', duration: 999999 });
    } else {
      offlineToast?.();
      offlineToast = null;
      toast(t('toast.backOnline'), { kind: 'ok', duration: 1800 });
    }
  });

  onEvent('state:me', renderMe);

  return { show, hide };
}

/* ------------------------------------------------------------
   10. SCREEN SWITCHING
   ------------------------------------------------------------ */

export function show(which) {
  const map = { boot: '#boot', auth: '#auth', app: '#app' };
  for (const [k, sel] of Object.entries(map)) {
    $(sel)?.classList.toggle('hidden', k !== which);
  }
  if (which === 'app') renderMe();
}
export const hide = which => $({ boot: '#boot', auth: '#auth', app: '#app' }[which])?.classList.add('hidden');

/** Where feature modules paint themselves. */
export const mount = () => $('#viewInner');
export const mountFull = () => {
  const v = $('#view');
  v?.classList.add('full');
  return $('#viewInner');
};
export const mountNormal = () => {
  const v = $('#view');
  v?.classList.remove('full');
  return $('#viewInner');
};
export const rightRail = () => $('#rightRail');

/** Turn the right rail on only for routes that fill it. */
export function useRightRail(enabled) {
  $('#app')?.classList.toggle('has-rail', !!enabled);
}
