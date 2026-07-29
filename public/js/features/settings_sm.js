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
import sfx from '../core/sound_sm.js';
import {
  supported as notifSupported, permission as notifPermission,
  askPermission, testNotification
} from '../core/notify_sm.js';
import {
  hasBackgroundSync, backgroundSyncEnabled, setBackgroundSync,
  batteryExempt, requestBatteryExempt, syncStatus, syncNow
} from '../core/native_sm.js';

const THEMES = [
  { id: 'light',  key: 'settings.light',  icon: 'sun' },
  { id: 'dark',   key: 'settings.dark',   icon: 'moon' },
  { id: 'system', key: 'settings.system', icon: 'monitor' }
];

/**
 * BACKGROUND DELIVERY — APK only.
 *
 * Returns '' in a browser, so the website never shows a card about a
 * service it does not have. A tab cannot poll while it is closed and
 * pretending otherwise with a dead toggle would be worse than nothing.
 *
 * When it IS the APK the card is deliberately blunt about the two
 * things that decide whether this actually works on the student's
 * phone: the battery exemption, and (on Xiaomi/Oppo/Vivo) Autostart,
 * which no app can grant itself from code.
 */
function backgroundCard() {
  if (!hasBackgroundSync()) return '';

  const on      = backgroundSyncEnabled();
  const exempt  = batteryExempt();
  const st      = syncStatus() || {};

  // "Never" until the service has actually completed a poll. Showing a
  // plausible-looking time before anything ran is how you end up
  // trusting a feature that never worked.
  const last = st.lastRun
    ? new Date(st.lastRun).toLocaleTimeString(lang() === 'ar' ? 'ar-DZ' : 'fr-FR',
        { hour: '2-digit', minute: '2-digit' })
    : t('bg.never');

  return `
      <section class="set-sec" id="bgSec">
        <div class="set-head">
          <span class="set-ic">${icon('bell', { size: 17 })}</span>
          <div class="grow">
            <div class="set-title">${esc(t('bg.title'))}</div>
            <div class="set-hint">${esc(t('bg.hint'))}</div>
          </div>
          <button class="switch${on ? ' on' : ''}" id="bgToggle"
                  role="switch" aria-checked="${on}"
                  aria-label="${esc(t('bg.title'))}"></button>
        </div>

        ${on && !exempt ? `
          <p class="set-warn">
            ${icon('close', { size: 14 })} ${esc(t('bg.batteryWarn'))}
          </p>
          <div class="set-actions">
            <button class="btn btn-primary" id="bgBattery">
              ${icon('check', { size: 15 })} ${esc(t('bg.allowBattery'))}
            </button>
          </div>` : ''}

        ${on ? `
          <p class="set-hint set-note">${esc(t('bg.oemNote'))}</p>
          <div class="set-actions">
            <button class="btn btn-outline" id="bgTest">
              ${icon('send', { size: 15 })} ${esc(t('bg.test'))}
            </button>
          </div>
          <p class="set-hint set-note" id="bgStatus">
            ${esc(t('bg.lastRun'))}: ${esc(last)}
            · ${esc(t('bg.checks'))}: ${Number(st.runs || 0)}
            · ${esc(t('bg.sent'))}: ${Number(st.posted || 0)}
            ${st.lastError ? ` · ${esc(t('bg.error'))}: ${esc(String(st.lastError))}` : ''}
          </p>` : ''}
      </section>`;
}

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

      ${backgroundCard()}

      <!-- SOUND -->
      <section class="set-sec">
        <div class="set-head">
          <span class="set-ic">${icon('trophy', { size: 17 })}</span>
          <div class="grow">
            <div class="set-title">${esc(t('settings.sound'))}</div>
            <div class="set-hint">${esc(t('settings.soundHint'))}</div>
          </div>
          <button class="switch${prefs.sound ? ' on' : ''}" id="soundToggle"
                  role="switch" aria-checked="${prefs.sound}"
                  aria-label="${esc(t('settings.sound'))}"></button>
        </div>
        <div class="set-actions">
          <button class="btn btn-outline" id="soundTest">
            ${icon('play', { size: 15 })} ${esc(t('settings.soundTest'))}
          </button>
        </div>
      </section>

      <!-- ACCOUNT -->
      <section class="set-sec">
        <div class="set-head">
          <span class="set-ic">${icon('user', { size: 17 })}</span>
          <div class="grow">
            <div class="set-title">${esc(t('settings.account'))}</div>
            <div class="set-hint"><span class="handle">@${esc(u.username || '')}</span>${u.faculty ? ' · ' + esc(u.faculty) : ''}</div>
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

  // BACKGROUND DELIVERY
  on($('#bgToggle'), 'click', () => {
    const next = !backgroundSyncEnabled();
    setBackgroundSync(next);
    // Full re-render, unlike the sound switch: turning it on reveals the
    // battery warning and the status line, which are not in the DOM yet.
    render(host);
  });

  on($('#bgBattery'), 'click', () => {
    requestBatteryExempt();
    // The system dialog is a separate Activity, so the result only
    // exists after we come back. Re-read then, not now.
    const recheck = () => { render(host); window.removeEventListener('koliya:resume', recheck); };
    window.addEventListener('koliya:resume', recheck);
  });

  on($('#bgTest'), 'click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    syncNow();
    // The poll is a network round-trip on a Java thread; give it time
    // to finish before reading the counters back.
    setTimeout(() => { render(host); }, 2500);
  });

  // SOUND — toggling repaints nothing, so update the switch in place
  // rather than re-rendering the whole screen under the cursor.
  on($('#soundToggle'), 'click', e => {
    const btn = e.currentTarget;
    const next = !prefs.sound;
    prefs.sound = next;
    btn.classList.toggle('on', next);
    btn.setAttribute('aria-checked', String(next));
    // Turning it ON should prove it works; turning it off must be silent.
    if (next) sfx.preview();
  });

  on($('#soundTest'), 'click', () => {
    if (!sfx.canPlay()) {
      toast(prefs.sound ? t('settings.soundBlocked') : t('settings.soundOff'), 'err');
      return;
    }
    sfx.preview();
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
