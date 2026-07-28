/**
 * KOLIYA — notify_sm.js
 * ============================================================
 * Browser notifications for new messages and new followers.
 *
 * WHEN THE PERMISSION IS ASKED
 * You asked for it on open, so that is what this does — but not in
 * the first second. A `Notification.requestPermission()` fired
 * during page load is the single most-denied prompt on the web:
 * people reflexively click Block, and a blocked permission can only
 * be undone in browser settings, which nobody does.
 *
 * So: a short delay, an in-app explanation card first, and the real
 * browser prompt only after the student says yes. One refusal is
 * remembered and never asked again.
 *
 * WHAT IS NOT HERE
 * No push subscription, no VAPID keys, no server. Notifications fire
 * from the page while it is open, which is what Neon can actually
 * support today. Calling it "push" would be a lie — real push needs
 * a push service and a worker that receives events with the tab
 * closed.
 * ============================================================
 */

import { me, scoped, on as onEvent, emit } from './store_sm.js';
import { db } from './db_sm.js';
import { toast } from './ui_sm.js';
import { t } from './i18n_sm.js';
import { icon } from './icons_sm.js';
import { safeUrl } from './utils_sm.js';

const store = scoped('notify');

/** How long after opening before we explain ourselves. */
const ASK_DELAY = 12000;

let lastSeen = null;       // newest alert already delivered
let pollTimer = 0;
let asked = false;

/* ------------------------------------------------------------
   CAPABILITY
   ------------------------------------------------------------ */

export const supported = () =>
  typeof window !== 'undefined' && 'Notification' in window;

export const permission = () => (supported() ? Notification.permission : 'unsupported');

export const canNotify = () => permission() === 'granted';

/** True once the student has told us no, in app or in the browser. */
const refused = () => store.get('refused', false) || permission() === 'denied';

/* ------------------------------------------------------------
   ASKING
   ------------------------------------------------------------ */

/**
 * Explain first, then ask. Returns the final permission string.
 * The in-app card costs one click but converts far better than the
 * raw prompt, and a "not now" here is recoverable — a browser
 * "Block" is not.
 */
export async function askPermission({ force = false } = {}) {
  if (!supported()) {
    toast(t('notif.unsupported2'), { kind: 'err' });
    return 'unsupported';
  }
  if (permission() === 'granted') return 'granted';
  if (permission() === 'denied') {
    if (force) {
      toast(t('notif.blockedLong'), { kind: 'err', duration: 8000 });
    }
    return 'denied';
  }
  if (!force && refused()) return 'default';

  const result = await Notification.requestPermission();
  store.set('asked', true);

  if (result === 'granted') {
    store.remove('refused');
    notify({
      title: t('notif.enabled'),
      body: t('notif.enabledBody'),
      tag: 'koliya-welcome'
    });
    startWatching();
  } else {
    store.set('refused', true);
  }
  emit('notify:permission', result);
  return result;
}

/**
 * The in-app card. Shown once, ~12s after the app opens, only if the
 * student has never answered. Asking during boot is how you get a
 * permanent Block.
 */
export function offerNotifications() {
  if (!supported() || asked) return;
  if (permission() !== 'default') { if (canNotify()) startWatching(); return; }
  if (store.get('offered', false)) return;

  asked = true;
  setTimeout(() => {
    if (permission() !== 'default') return;
    store.set('offered', true);

    toast(t('notif.enable'), {
      duration: 20000,
      action: { label: t('notif.enableBtn'), fn: () => askPermission({ force: true }) }
    });
  }, ASK_DELAY);
}

/* ------------------------------------------------------------
   SHOWING
   ------------------------------------------------------------ */

/**
 * Show one notification. Silent no-op without permission, so callers
 * never need to check first.
 */
export function notify({ title, body = '', tag = 'koliya', icon: img = null, url = null } = {}) {
  if (!canNotify() || !title) return null;

  try {
    const n = new Notification(title, {
      body,
      tag,                       // same tag replaces, never stacks
      icon: safeUrl(img) || '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      lang: document.documentElement.lang || 'fr',
      dir: document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr'
    });

    n.onclick = () => {
      window.focus();
      if (url) location.hash = url;
      n.close();
    };
    // Nobody wants a notification sitting there ten minutes later.
    setTimeout(() => { try { n.close(); } catch {} }, 12000);
    return n;
  } catch (e) {
    console.warn('[koliya] notification refusée', e.message);
    return null;
  }
}

/** The test button you asked for. Reports honestly what happened. */
export async function testNotification() {
  if (!supported()) {
    toast(t('notif.unsupported2'), { kind: 'err' });
    return false;
  }
  if (permission() === 'denied') {
    toast(t('notif.blockedLong'), { kind: 'err', duration: 9000 });
    return false;
  }
  if (permission() === 'default') {
    const r = await askPermission({ force: true });
    if (r !== 'granted') { toast(t('notif.permDenied'), { kind: 'err' }); return false; }
  }

  const n = notify({
    title: t('notif.testTitle'),
    body: t('notif.testBody'),
    tag: 'koliya-test'
  });

  if (n) toast(t('notif.sent'), { kind: 'ok' });
  else toast(t('error.generic'), { kind: 'err' });
  return !!n;
}

/* ------------------------------------------------------------
   WATCHING FOR SOMETHING TO ANNOUNCE
   ------------------------------------------------------------ */

const KIND_TEXT = {
  follow:  a => [`${a} ${t('notif.followsYou')}`, t('notif.newFollower')],
  request: a => [`${a} ${t('notif.requests')}`, t('notif.followRequest')],
  message: a => [`${a}`, t('dm.new')],
  like:    a => [`${a} ${t('notif.likedYours')}`, ''],
  comment: (a, txt) => [`${a} ${t('notif.commented')}`, txt || ''],
  mention: (a, txt) => [`${a} ${t('notif.mentioned')}`, txt || '']
};

const ROUTE = {
  follow: '#/notifications', request: '#/notifications',
  message: '#/messages', like: '#/notifications',
  comment: '#/notifications', mention: '#/notifications'
};

/** Ask the database what happened since the last check. */
async function checkAlerts() {
  if (!canNotify() || !me.id) return;
  // Notifying about something already on screen is noise.
  if (!document.hidden && location.hash.startsWith('#/notifications')) return;

  let rows = [];
  try {
    rows = await db.rpc('pending_alerts', { p_since: lastSeen }) || [];
  } catch (e) {
    // pending_alerts lives in 08_fixes_sm.sql; a missing function is
    // a migration problem, not a reason to keep retrying loudly.
    if (/does not exist|404/i.test(e.message || '')) { stopWatching(); }
    return;
  }
  if (!rows.length) return;

  lastSeen = rows[0].created_at;
  store.set('lastSeen', lastSeen);

  // One notification for a single event; a summary for a burst.
  if (rows.length === 1) {
    const r = rows[0];
    const fn = KIND_TEXT[r.kind];
    const [title, body] = fn ? fn(r.actor_name, r.text) : [r.actor_name, r.text || ''];
    notify({ title, body, tag: `koliya-${r.kind}-${r.id}`,
             icon: r.actor_avatar, url: ROUTE[r.kind] || '#/notifications' });
  } else {
    notify({
      title: `${rows.length} nouvelles notifications`,
      body: rows.slice(0, 3).map(r => r.actor_name).join(', '),
      tag: 'koliya-digest',
      url: '#/notifications'
    });
  }

  emit('notify:alerts', rows);
}

let watching = false;

export function startWatching() {
  if (watching || !canNotify()) return;
  watching = true;
  lastSeen = store.get('lastSeen', null);

  // Slower than the chat poller: an alert a few seconds late is fine,
  // and this runs for the whole session.
  const tick = () => { if (!document.hidden || true) checkAlerts(); };
  pollTimer = setInterval(tick, 20000);
  pollTimer?.unref?.();
  setTimeout(tick, 3000);
}

export function stopWatching() {
  watching = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = 0;
}

/* ------------------------------------------------------------
   LOCAL EVENTS
   A message arriving in a chat you are not looking at should also
   ring, without waiting for the 20s alert poll.
   ------------------------------------------------------------ */

export function initNotify() {
  if (!supported()) return;

  onEvent('dm:incoming', ({ from, name, text, avatar, muted } = {}) => {
    if (!canNotify() || muted) return;
    // If you are looking at that very conversation, you already know.
    if (!document.hidden && location.hash.startsWith(`#/messages/${from}`)) return;
    notify({
      title: name || 'Nouveau message',
      body: text || t('notif.attachment'),
      tag: `koliya-dm-${from}`,
      icon: avatar,
      url: `#/messages/${from}`
    });
  });

  if (canNotify()) startWatching();
  offerNotifications();
}

export default {
  supported, permission, canNotify, askPermission, offerNotifications,
  notify, testNotification, startWatching, stopWatching, initNotify
};
