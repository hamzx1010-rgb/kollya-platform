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
 * Here the rail folds from ONE place: the ☰ that sits inside the
 * sidebar, on the logo row. Opening a tab folds it too, so the page
 * you just chose gets the width back — Facebook's behaviour.
 * ============================================================
 */

import { $, $$, on, throttle, rafThrottle, env, initials, avatarColor, modKey, esc, safeUrl } from './utils_sm.js';
import { state, setState, on as onEvent, emit, prefs, applyTheme, me } from './store_sm.js';
import { ROUTES, routeTitle, go, back, currentRoute, shortcuts } from './router_sm.js';
import { modal, toast, closeMenu, contextMenu } from './ui_sm.js';
import { icon } from './icons_sm.js';
import { t, lang, setLang, LANGS, applyI18n } from './i18n_sm.js';

/* ------------------------------------------------------------
   1. RAIL  — context-driven, never asked
   ------------------------------------------------------------ */

/**
 * The rail folds the way Facebook's does — by hand, from a ☰ that
 * lives INSIDE the sidebar, and automatically once you commit to a
 * tab so the page you just opened gets the width.
 *
 * The three mechanisms that used to fight each other (a per-route
 * rule, a 2.2s timer and a hover peek) are still gone. There is one
 * source of truth now: `railCollapsed`, changed only by a click.
 *
 * Phones are untouched: under 900px the rail is a bottom bar and the
 * state has no meaning, so it is forced back to 'expanded'.
 */
const RAIL_KEY = 'kl.rail.collapsed';
const DESKTOP = '(min-width: 900px)';

let railCollapsed = (() => {
  try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; }
})();

const isDesktop = () => {
  try { return window.matchMedia?.(DESKTOP)?.matches ?? true; } catch { return true; }
};

function syncRail() {
  const app = $('#app');
  if (!app) return;
  const collapsed = railCollapsed && isDesktop();
  app.dataset.rail = collapsed ? 'collapsed' : 'expanded';

  const btn = $('#btnRailFold');
  if (btn) {
    btn.setAttribute('aria-expanded', String(!collapsed));
    const label = t(collapsed ? 'nav.expand' : 'nav.collapse');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  }

  // Collapsed rows are icons only, so the label has to survive as a
  // tooltip and as the accessible name. A native `title` is used on
  // purpose: the rail scrolls and clips, which would cut a CSS
  // tooltip in half on a 64px strip.
  for (const item of $$('#railNav .nav-item')) {
    const label = item.querySelector('.lbl')?.textContent?.trim();
    if (!label) continue;
    if (collapsed) { item.setAttribute('title', label); item.setAttribute('aria-label', label); }
    else { item.removeAttribute('title'); item.removeAttribute('aria-label'); }
  }
}

/** Fold / unfold by hand. */
function setRail(collapsed) {
  railCollapsed = !!collapsed;
  try { localStorage.setItem(RAIL_KEY, railCollapsed ? '1' : '0'); } catch { /* private mode */ }
  syncRail();
}

export function toggleRail() { setRail(!railCollapsed); }
export const railState = () => (railCollapsed ? 'collapsed' : 'expanded');

/**
 * Wiring: the in-sidebar ☰ toggles, and choosing a tab folds — the
 * page you just asked for is what you want the pixels for. Only a
 * real pointer click folds it, never a programmatic go(), so deep
 * links and boot land expanded unless you folded it yourself.
 */
function wireRailFold() {
  const btn = $('#btnRailFold');
  if (btn) on(btn, 'click', e => { e.preventDefault(); toggleRail(); });

  const nav = $('#railNav');
  if (nav) {
    on(nav, 'click', e => {
      if (!e.target.closest('.nav-item')) return;
      if (!isDesktop()) return;          // phones: the rail is a bottom bar
      setRail(true);
    });
  }

  // Crossing the phone breakpoint changes what the state means.
  try {
    window.matchMedia?.(DESKTOP)?.addEventListener?.('change', syncRail);
  } catch { /* older engines */ }
}

/** Kept for callers and tests that still reference it. */
function wireRailPeek() { wireRailFold(); }

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
   3b. RIGHT RAIL — the discovery sidebar that was built and never
   switched on. useRightRail() existed since the shell was written
   but no route ever called it, so at ≥1180px the feed sat alone in
   the middle of ~200px of empty space each side. Feed and Explore
   now get it filled with people to follow, trends and shortcuts.
   ------------------------------------------------------------ */

const RAIL_ROUTES = new Set(['feed', 'explore']);

function syncRightRail(name) {
  useRightRail(RAIL_ROUTES.has(name));
  if (RAIL_ROUTES.has(name)) renderRightRail().catch(() => {});
}

async function renderRightRail() {
  const rail = $('#rightRail');
  if (!rail) return;
  const { campusApi, profileApi } = await import('./api_sm.js');

  const [people, trends, followStates] = await Promise.all([
    campusApi.searchPeople('').catch(() => []),
    campusApi.trends().catch(() => []),
    profileApi.myFollowStates().catch(() => ({})),
  ]);

  const followLabel = state =>
    state === 'following' ? t('explore.following')
      : state === 'requested' ? t('profile.requestedBtn') : t('explore.follow');

  rail.innerHTML = `
    <div class="rail-block">
      <div class="rail-title">${esc(t('rail.suggestions'))}</div>
      ${people.slice(0, 4).map(u => {
        const st = followStates[String(u.id)];
        const state = st === 'accepted' ? 'following' : st === 'pending' ? 'requested' : 'none';
        return `<a class="rail-person" href="#/profile/${esc(u.username)}">
          <span class="av sm" ${u.avatar_url ? '' : `style="background:${avatarColor(u.id)}"`}>${
            u.avatar_url ? `<img src="${esc(safeUrl(u.avatar_url))}" alt="">` : esc(initials(u.full_name))}</span>
          <span class="grow" style="min-width:0">
            <span class="t-bold truncate" style="display:block;font-size:var(--fs-sm)">${esc(u.full_name)}</span>
            <span class="t-xs t-dim truncate" style="display:block"><span class="handle">@${esc(u.username)}</span></span>
          </span>
          <button class="btn btn-sm ${state === 'none' ? 'btn-primary' : 'btn-outline'}" data-rf="${esc(u.id)}"
                  data-state="${state}" data-private="${u.is_private ? '1' : '0'}">${esc(followLabel(state))}</button>
        </a>`;
      }).join('')}
    </div>
    ${trends.length ? `<div class="rail-block">
      <div class="rail-title">${esc(t('rail.trending'))}</div>
      ${trends.slice(0, 5).map(tr => `<a class="rail-trend" href="#/explore?tag=${esc(tr.tag)}">
        <span class="t-bold">#${esc(tr.tag)}</span>
        <span class="t-xs t-dim">${tr.posts} publication${tr.posts > 1 ? 's' : ''}</span>
      </a>`).join('')}
    </div>` : ''}
    <div class="rail-block">
      <div class="rail-title">${esc(t('rail.shortcuts'))}</div>
      <div class="rail-links">
        ${[['channels', 'hash'], ['events', 'calendar'], ['qa', 'help'], ['saved', 'bookmark'], ['leaderboard', 'chart']]
          .map(([r, ic]) => `<a class="rail-link" href="#/${r}">${icon(ic, { size: 15 })}<span>${esc(routeTitle(r))}</span></a>`).join('')}
      </div>
    </div>`;

  // Follow toggles, same optimistic behaviour as the search rows.
  for (const btn of $$('[data-rf]', rail)) {
    on(btn, 'click', async e => {
      e.preventDefault();
      e.stopPropagation();
      const next = btn.dataset.state === 'none'
        ? (btn.dataset.private === '1' ? 'requested' : 'following') : 'none';
      btn.disabled = true;
      try {
        await profileApi.follow(btn.dataset.rf, next);
        btn.dataset.state = next;
        btn.classList.toggle('btn-primary', next !== 'none');
        btn.classList.toggle('btn-outline', next === 'none');
        btn.textContent = followLabel(next === 'requested' ? 'requested' : next);
      } catch { /* the button just snaps back on next render */ }
      btn.disabled = false;
    });
  }
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
  // rail tooltips are copies of the labels, so they change too
  syncRail();
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

// The message badge used to be written only inside renderConvList(),
// which runs on the Messages screen. Everywhere else it kept whatever
// number it had when you last visited — so a message arriving while you
// read the feed changed nothing on screen at all.
// core/inbox_sm.js polls on every route and emits this.
onEvent('inbox:unread', ({ total }) => {
  setState({ unread: { ...state.unread, messages: total } });
});

/* ------------------------------------------------------------
   6b. NAV DRAWER — the phone hamburger
   The bottom bar has room for five core items, so Marketplace,
   Documents and Classmates are reached from this drawer. Built
   from ROUTES, not from a second list that can drift.
   ------------------------------------------------------------ */

// Notifications is NOT here: it moved to the top bar (#btnNotifsTop),
// so listing it again in the drawer would be a second entry point with
// a second active state for the same route.
const DRAWER_ROUTES = [
  'feed', 'explore', 'messages', 'hub',
  'marketplace', 'channels', 'events', 'documents', 'classmates',
  'qa', 'profile', 'saved', 'leaderboard', 'settings'
];

function renderDrawer() {
  const panel = $('#navDrawerPanel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="nav-drawer-head">
      <span class="rail-logo"><span class="mark">K</span><span class="word">Koliya</span></span>
      <button class="icon-btn nav-drawer-close" id="navDrawerClose" aria-label="${esc(t('action.close'))}">${icon('close', { size: 18 })}</button>
    </div>
    <nav class="nav-drawer-links" aria-label="${esc(t('nav.main'))}">
      ${DRAWER_ROUTES.map(r => `<a class="nav-drawer-link" href="#/${r}" data-drawer="${r}">
        ${icon(ROUTES[r]?.icon || 'compass', { size: 18 })}<span>${esc(routeTitle(r))}</span>
      </a>`).join('')}
    </nav>`;
}

export function openDrawer() {
  const d = $('#navDrawer');
  if (!d) return;
  d.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  const first = d.querySelector('.nav-drawer-close');
  if (first) first.focus();
}

export function closeDrawer() {
  const d = $('#navDrawer');
  if (!d) return;
  d.classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
  ($('#btnMenuTop') || $('#btnMenu'))?.focus();
}

function wireDrawer() {
  // The hamburger moved from the actions cluster into the brand group
  // (#btnMenuTop, next to the wordmark). Accept the old id too so
  // nothing depending on it breaks.
  const buttons = [$('#btnMenuTop'), $('#btnMenu')].filter(Boolean);
  const drawer = $('#navDrawer');
  if (!buttons.length || !drawer) return;
  renderDrawer();

  for (const btn of buttons) {
    on(btn, 'click', () => {
      drawer.classList.contains('open') ? closeDrawer() : openDrawer();
    });
  }
  on($('#navDrawerScrim'), 'click', closeDrawer);
  on($('#navDrawerClose'), 'click', closeDrawer);
  on(drawer, 'click', e => {
    if (e.target.closest('a[href^="#/"]')) closeDrawer();
  });
  onEvent('key:escape', closeDrawer);
}

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
  syncRail();
  wireScroll();
  wireDrawer();

  $('#btnBack')   && on($('#btnBack'), 'click', () => back());
  $('#btnTheme')  && on($('#btnTheme'), 'click', cycleTheme);
  $('#btnHelp')   && on($('#btnHelp'), 'click', showShortcuts);
  $('#btnLang')   && on($('#btnLang'), 'click', openLangMenu);
  syncLangButton();
  $('#btnSearch') && on($('#btnSearch'), 'click', () => emit('key:search'));
  $('#btnCompose')&& on($('#btnCompose'), 'click', () => emit('key:compose'));
  // The phone's Create button. Same event as the sidebar one, so there
  // is one composer and one code path — a second implementation would
  // drift the moment either changed.
  $('#btnComposeTop') && on($('#btnComposeTop'), 'click', () => emit('key:compose'));
  $('#railMe')    && on($('#railMe'), 'click', () => go('profile', me.get()?.username || null));

  onEvent('key:shortcuts', showShortcuts);

  // react to navigation
  onEvent('route:enter', ({ name, arg }) => {
    syncRail();
    syncNav(name);
    syncTopbar(name, arg);
    syncRightRail(name);
    closeMenu();
    closeDrawer();
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
