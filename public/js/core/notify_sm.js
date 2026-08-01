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
import { isNative, nativeNotify, nativeNotifyState, requestNativeNotify,
         hasBackgroundSync, syncLastSeen, setSyncLastSeen } from './native_sm.js';

const store = scoped('notify');

/** How long after opening before we explain ourselves. */
const ASK_DELAY = 12000;

let lastSeen = null;       // newest alert already delivered
let pollTimer = 0;
let asked = false;

/* ------------------------------------------------------------
   THE "LAST SEEN" MARKER — one value, two owners

   From APK 1.2 a Java foreground service polls the same
   pending_alerts() while the app is closed. If it kept its own
   marker in SharedPreferences and this file kept another one in
   localStorage, every message would be announced twice: once by the
   service, and again by this page on the next open, replaying from
   its own stale copy.

   So when the bridge is present it OWNS the value and these two
   helpers read and write through it. On the web they fall back to
   localStorage and nothing changes.

   Both are also written on the browser side even in the APK, as a
   cheap backup: if a future build drops the bridge the page still
   has a marker and degrades to "might repeat once" rather than
   "replays every unread notification you ever had".
   ------------------------------------------------------------ */

function readLastSeen() {
  if (hasBackgroundSync()) {
    const shared = syncLastSeen();
    if (shared) return shared;
  }
  return store.get('lastSeen', null);
}

function writeLastSeen(iso) {
  if (!iso) return;
  setSyncLastSeen(iso);          // no-op without the bridge
  store.set('lastSeen', iso);
}

/* ------------------------------------------------------------
   CAPABILITY
   ------------------------------------------------------------ */

export const supported = () =>
  // In the APK the browser Notification API may be missing entirely,
  // but system notifications still work through the bridge. Reporting
  // "unsupported" there silenced everything.
  isNative() || (typeof window !== 'undefined' && 'Notification' in window);

export const permission = () => {
  // THE NOTIFICATION BUG. Inside a WebView Notification.permission
  // stays 'default' forever no matter what Android says, so
  //   if (permission() !== 'default') { ... startWatching() }
  // never ran and the alert poller never started — on a phone whose
  // notifications were plainly enabled. Ask Android, not the browser.
  const n = nativeNotifyState();
  if (n) return n.granted ? 'granted' : (n.canAsk ? 'default' : 'denied');
  return (typeof window !== 'undefined' && 'Notification' in window)
    ? Notification.permission : 'unsupported';
};

export const canNotify = () => {
  // Inside the APK the browser Notification API is irrelevant: what
  // matters is the Android permission. Consulting the web API there
  // would report 'default' forever and silence every alert.
  const n = nativeNotifyState();
  if (n) return n.granted;
  return permission() === 'granted';
};

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
  // The APK must show the real Android dialog: calling
  // Notification.requestPermission() inside a WebView resolves
  // 'denied' without ever asking anyone.
  if (isNative()) {
    const st = nativeNotifyState();
    if (st?.granted) return 'granted';
    return (await requestNativeNotify()) ? 'granted' : 'denied';
  }
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
  if (permission() !== 'default') { startWatching(); return; }
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
export function notify({ title, body = '', tag = 'koliya', icon: img = null,
                         url = null, kind = 'reminder' } = {}) {
  if (!canNotify() || !title) return null;

  // In the APK these are REAL system notifications: they survive the
  // app closing and appear on the lock screen. The web Notification
  // below only lives as long as the tab.
  if (isNative()) {
    nativeNotify({ kind, title, body, route: (url || '').replace(/^#/, '') });
    return null;
  }

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

// A FUNCTION, not a frozen constant: evaluated once at import time
// these labels lock to whichever language loaded first, and a later
// switch never reaches them. Verified in Chrome: the notification
// filters stayed English while the rest of the UI was Arabic.
const kindText = () => ({
  follow:  a => [`${a} ${t('notif.followsYou')}`, t('notif.newFollower')],
  request: a => [`${a} ${t('notif.requests')}`, t('notif.followRequest')],
  message: a => [`${a}`, t('dm.new')],
  like:    a => [`${a} ${t('notif.likedYours')}`, ''],
  comment: (a, txt) => [`${a} ${t('notif.commented')}`, txt || ''],
  mention: (a, txt) => [`${a} ${t('notif.mentioned')}`, txt || '']
});

const ROUTE = {
  follow: '#/notifications', request: '#/notifications',
  message: '#/messages', dm_request: '#/messages', like: '#/notifications',
  comment: '#/notifications', mention: '#/notifications'
};

/**
 * The DM trigger stores a media message as a bracketed marker rather
 * than translated text, because ONE row is read by users in three
 * languages — a French string written at INSERT time would still be
 * French for an Arabic reader. dm_preview() in SQL emits the marker;
 * this turns it back into the reader's own language.
 */
const MEDIA_MARK = {
  '[image]': 'notif.photo',
  '[video]': 'notif.video',
  '[audio]': 'notif.voice',
  '[file]':  'notif.attachment'
};

function mediaLabel(text) {
  const key = MEDIA_MARK[String(text || '').trim()];
  return key ? t(key) : (text || '');
}

/** Ask the database what happened since the last check. */
async function checkAlerts() {
  // NOT `if (!canNotify()) return`.
  //
  // That gate meant the whole alert pipeline was dead unless the student
  // had granted SYSTEM notification permission: no bell count, no in-app
  // banner, no list refresh. Someone who tapped "not now" once — or any
  // WebView, where the permission is always 'default' — saw the bell
  // frozen at whatever it read on boot. Reported as "the notification
  // page isn't showing the numbers when someone likes or follows".
  //
  // The poll now always runs; only the SHADE notification at the bottom
  // is permission-gated, and notify() already no-ops without it.
  if (!me.id) return;
  // Notifying about something already on screen is noise.
  if (!document.hidden && location.hash.startsWith('#/notifications')) return;

  // Re-read the marker rather than trusting the in-memory copy.
  //
  // While the app was closed the Java service kept polling and moved
  // the shared marker forward. Our variable still holds whatever it
  // held when the page was last active, so polling with it would ask
  // the database for rows the service already put in the shade and
  // announce every one of them a second time.
  const since = readLastSeen();
  if (since && (!lastSeen || since > lastSeen)) lastSeen = since;

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
  writeLastSeen(lastSeen);

  // One notification for a single event; a summary for a burst.
  if (rows.length === 1) {
    const r = rows[0];
    const fn = kindText()[r.kind];
    const preview = mediaLabel(r.text);
    const [title, body] = fn ? fn(r.actor_name, preview) : [r.actor_name, preview];
    notify({ title, body, tag: `koliya-${r.kind}-${r.id}`,
             icon: r.actor_avatar, url: ROUTE[r.kind] || '#/notifications' });
  } else {
    notify({
      // Was the hardcoded French "nouvelles notifications" — it stayed
      // French in an Arabic UI.
      title: t('notif.manyNew', { n: rows.length }),
      body: rows.slice(0, 3).map(r => r.actor_name).join(', '),
      tag: 'koliya-digest',
      url: '#/notifications'
    });
  }

  emit('notify:alerts', rows);
}

let watching = false;

export function startWatching() {
  // Same reasoning as checkAlerts(): the poller must run even when the
  // system permission was refused, because it also feeds the bell count
  // and the in-app banner — neither of which needs permission.
  if (watching) return;
  watching = true;
  lastSeen = readLastSeen();

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

  /*
    HOW A NEW MESSAGE IS ANNOUNCED — the Instagram rules.

    The old version started with `if (!canNotify() ...) return`, so with
    system notifications off NOTHING happened: no banner, no toast, no
    sign at all while you were using the app. And it only ever fired
    from messages_sm's beat(), which does not run unless a thread is
    open — so the one case it handled was the one case you did not need.

    Now, in order:
      in that very thread, on screen  -> nothing, you can see it
      elsewhere in the app            -> in-app banner you can tap
      app hidden or closed            -> system notification
    Muted conversations are silent everywhere.
  */
  onEvent('dm:incoming', ({ from, name, text, mediaType, avatar, muted } = {}) => {
    if (muted) return;

    const inThatThread =
      !document.hidden && location.hash.startsWith(`#/messages/${from}`);
    if (inThatThread) return;

    const who = name || t('notif.newMessage');
    // mediaLabel turns the database's "[image]" marker into the
    // reader's own language; a bare text message passes through.
    const body = mediaLabel(text) || (mediaType ? t('notif.attachment') : '');

    // Hidden tab: the shade is the only place the student will see it.
    if (document.hidden) {
      notify({
        title: who, body,
        tag: `koliya-dm-${from}`,
        icon: avatar,
        url: `#/messages/${from}`
      });
      return;
    }

    // Visible, but on another screen: an in-app banner, which works
    // even when the browser permission was never granted.
    toast(body ? `${who}: ${body}` : who, {
      kind: 'info',
      duration: 6000,
      action: { label: t('action.view'), fn: () => { location.hash = `#/messages/${from}`; } }
    });
    emit('notify:inapp', { kind: 'message', from });

    // AND put it in the system shade.
    //
    // You asked for the little white bubble to be "connected with the
    // system notification". The banner alone dies with the toast, so a
    // student who looks away for ten seconds misses it entirely and has
    // nothing to come back to. notify() is a no-op without permission,
    // so this never double-fires where the browser has refused — the
    // banner above is still the fallback there.
    notify({
      title: who, body,
      tag: `koliya-dm-${from}`,
      icon: avatar,
      url: `#/messages/${from}`
    });
  });

  /*
    The same rule for everything else — follows, likes, comments,
    mentions. checkAlerts() only ever produced a system notification, so
    with the app open and the permission missing these were invisible
    until you happened to open the notifications page.
  */
  onEvent('notify:alerts', rows => {
    if (document.hidden || !Array.isArray(rows) || !rows.length) return;
    if (location.hash.startsWith('#/notifications')) return;

    const r = rows[0];
    const fn = kindText()[r.kind];
    const [title, body] = fn
      ? fn(r.actor_name, mediaLabel(r.text))
      : [r.actor_name, mediaLabel(r.text)];

    toast(rows.length > 1 ? t('notif.manyNew', { n: rows.length }) : (body ? `${title} — ${body}` : title), {
      kind: 'info',
      duration: 6000,
      action: {
        label: t('action.view'),
        fn: () => { location.hash = ROUTE[r.kind] || '#/notifications'; }
      }
    });
  });

  // Always: the poller feeds the bell count and the in-app banner too,
  // and those work with no system permission at all.
  startWatching();
  offerNotifications();
}

export default {
  supported, permission, canNotify, askPermission, offerNotifications,
  notify, testNotification, startWatching, stopWatching, initNotify
};
