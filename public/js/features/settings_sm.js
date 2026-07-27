/**
 * KOLIYA — features/settings_sm.js
 * ============================================================
 * Language, appearance, notifications, account.
 *
 * This screen used to be a placeholder that said "module en cours de
 * construction". It now holds the three things a student actually
 * changes — and the notification test button you asked for, which
 * reports honestly instead of claiming success.
 * ============================================================
 */

import { $, $$, el, on, esc } from '../core/utils_sm.js';
import { me, prefs, applyTheme, on as onEvent } from '../core/store_sm.js';
import { I, icon } from '../core/icons_sm.js';
import { toast, modal, confirmDialog } from '../core/ui_sm.js';
import { route } from '../core/router_sm.js';
import { t, lang, setLang, LANGS } from '../core/i18n_sm.js';
import {
  supported as notifSupported, permission as notifPermission,
  askPermission, testNotification
} from '../core/notify_sm.js';

const THEMES = [
  { id: 'light',  key: 'settings.light',  icon: 'sun' },
  { id: 'dark',   key: 'settings.dark',   icon: 'moon' },
  { id: 'system', key: 'settings.system', icon: 'monitor' }
];

/** Colour and wording for whatever the browser currently allows. */
function permissionState() {
  if (!notifSupported()) {
    return { tone: 'off',     label: t('notif.unsupported') };
  }
  switch (notifPermission()) {
    case 'granted': return { tone: 'ok',   label: t('settings.status.granted') };
    case 'denied':  return { tone: 'bad',  label: t('settings.status.denied') };
    default:        return { tone: 'warn', label: t('settings.status.default') };
  }
}

function render(host) {
  const u = me.get() || {};
  const perm = permissionState();

  host.innerHTML = `
    <div class="settings">

      <!-- LANGUAGE -->
      <section class="set-sec">
        <div class="set-head">
          <span class="set-ic">${icon('globe', { size: 17 })}</span>
          <div class="grow">
            <div class="set-title">${esc(t('settings.language'))}</div>
            <div class="set-hint">${esc(t('settings.languageHint'))}</div>
          </div>
        </div>
        <div class="lang-grid" id="langGrid">
          ${LANGS.map(l => `
            <button class="lang-card${l.id === lang() ? ' on' : ''}" data-lang="${l.id}">
              <span class="lang-badge">${esc(l.flag)}</span>
              <span class="lang-native">${esc(l.native)}</span>
              <span class="lang-en">${esc(l.label)}</span>
              ${l.id === lang() ? `<span class="lang-check">${icon('check', { size: 14 })}</span>` : ''}
            </button>`).join('')}
        </div>
      </section>

      <!-- APPEARANCE -->
      <section class="set-sec">
        <div class="set-head">
          <span class="set-ic">${icon('sun', { size: 17 })}</span>
          <div class="grow">
            <div class="set-title">${esc(t('settings.appearance'))}</div>
            <div class="set-hint">${esc(t('settings.theme'))}</div>
          </div>
        </div>
        <div class="seg" id="themeSeg">
          ${THEMES.map(th => `
            <button class="seg-btn${th.id === prefs.theme ? ' on' : ''}" data-theme="${th.id}">
              ${icon(th.icon, { size: 15 })} ${esc(t(th.key))}
            </button>`).join('')}
        </div>
      </section>

      <!-- NOTIFICATIONS -->
      <section class="set-sec">
        <div class="set-head">
          <span class="set-ic">${icon('bell', { size: 17 })}</span>
          <div class="grow">
            <div class="set-title">${esc(t('settings.notifications'))}</div>
            <div class="set-hint">${esc(t('settings.notifHint'))}</div>
          </div>
          <span class="perm-chip ${perm.tone}" id="permChip">${esc(perm.label)}</span>
        </div>

        <div class="set-actions">
          ${notifPermission() === 'default'
            ? `<button class="btn btn-primary" id="notifEnable">
                 ${icon('bell', { size: 15 })} ${esc(t('notif.enableBtn'))}
               </button>` : ''}
          <button class="btn btn-outline" id="notifTest">
            ${icon('send', { size: 15 })} ${esc(t('notif.test'))}
          </button>
        </div>

        ${notifPermission() === 'denied'
          ? `<p class="set-warn">${icon('close', { size: 14 })} ${esc(t('notif.blocked'))}</p>` : ''}
      </section>

      <!-- ACCOUNT -->
      <section class="set-sec">
        <div class="set-head">
          <span class="set-ic">${icon('user', { size: 17 })}</span>
          <div class="grow">
            <div class="set-title">${esc(t('settings.account'))}</div>
            <div class="set-hint">@${esc(u.username || '')}${u.faculty ? ' · ' + esc(u.faculty) : ''}</div>
          </div>
        </div>
        <div class="set-actions">
          <a class="btn btn-outline" href="#/profile/${esc(u.username || '')}">
            ${icon('edit', { size: 15 })} ${esc(t('profile.edit'))}
          </a>
          <button class="btn btn-ghost danger" id="signOut">
            ${icon('logout', { size: 15 })} ${esc(t('settings.signOut'))}
          </button>
        </div>
      </section>

    </div>`;

  wire(host);
}

function wire(host) {
  // language
  on($('#langGrid'), 'click', e => {
    const btn = e.target.closest('[data-lang]');
    if (!btn) return;
    setLang(btn.dataset.lang);
    render(host);                      // repaint in the new language
    toast(t('profile.updated'), { kind: 'ok', duration: 1600 });
  });

  // theme
  on($('#themeSeg'), 'click', e => {
    const btn = e.target.closest('[data-theme]');
    if (!btn) return;
    prefs.theme = btn.dataset.theme;
    applyTheme();
    for (const b of $$('#themeSeg .seg-btn')) b.classList.toggle('on', b === btn);
  });

  // notifications
  on($('#notifEnable'), 'click', async () => {
    await askPermission({ force: true });
    render(host);
  });

  // THE TEST BUTTON — says what actually happened, including failure
  on($('#notifTest'), 'click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await testNotification(); }
    finally { btn.disabled = false; render(host); }
  });

  on($('#signOut'), 'click', async () => {
    if (!await confirmDialog({
      title: t('settings.signOut'), message: '',
      confirmLabel: t('settings.signOut'), danger: true
    })) return;
    const { signOut } = await import('../core/auth_sm.js');
    await signOut();
    location.hash = '';
    location.reload();
  });
}

export function initSettings(mountFn) {
  route('settings', () => {
    const host = mountFn();
    if (!host) return;
    host.closest('.view')?.classList.remove('full');
    render(host);
  });

  // repaint if the language changes from the top-bar switcher
  onEvent('i18n:changed', () => {
    const host = $('.settings')?.parentElement;
    if (host) render(host);
  });
}
