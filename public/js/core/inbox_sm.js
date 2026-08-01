/**
 * KOLIYA — core/inbox_sm.js
 * ============================================================
 * THE APP-WIDE INBOX POLLER.
 *
 * WHY THIS FILE EXISTS
 * messages_sm.js has its own poller, but its very first line is:
 *
 *     if (pollBusy || !peer || !api?.listMessages) return;
 *
 * `peer` is the person whose thread is OPEN. With no thread open it is
 * null and the poller returns without asking the server anything. Worse,
 * startPolling() is only ever called from openThread(), and
 * teardownMessages() stops it when you leave the route. So:
 *
 *     inside a conversation ....... polls every 1.5s
 *     on the conversation list .... nothing (peer is null)
 *     anywhere else in the app .... nothing (timer not running)
 *
 * That is the reported bug exactly: a message only showed up if you were
 * already inside that conversation, and the list did not update until
 * you left the page and came back.
 *
 * This poller is deliberately NOT tied to any screen. It starts once at
 * sign-in and keeps running whatever route you are on, so a message
 * lands in the list, the badge and the notification shade while you are
 * reading the feed.
 *
 * WHAT IT IS NOT
 * Not push. Neon has no realtime channel, so something has to ask. The
 * interval adapts instead of hammering:
 *
 *     visible ....... 5s
 *     hidden ....... 20s
 *
 * The 1.5s thread poller in messages_sm.js stays for live conversation;
 * this one is the safety net around it.
 * ============================================================
 */

import { me, emit, on as onEvent } from './store_sm.js';

let api = null;
export function useApi(impl) { api = impl; }

const FAST_MS = 5000;    // app on screen
const SLOW_MS = 20000;   // tab hidden or phone asleep

let timer = 0;
let busy = false;
let running = false;

/**
 * peerId -> the created_at of the newest message we have already
 * reported. Prevents re-announcing the same message every 5 seconds.
 */
const seen = new Map();

/** Newest conversation snapshot, so any screen can read it cheaply. */
let convs = [];
export const inboxConversations = () => convs.slice();

/** Total unread across every conversation — what the tab badge shows. */
export const inboxUnread = () =>
  convs.reduce((n, c) => n + (Number(c.unread) || 0), 0);

/* ------------------------------------------------------------
   THE POLL
   ------------------------------------------------------------ */

async function tick() {
  if (busy || !me.id || !api?.listConversations) return;
  busy = true;

  try {
    const rows = await api.listConversations();
    if (!Array.isArray(rows)) return;

    const fresh = [];

    for (const c of rows) {
      const peerId = String(c.peer?.id ?? c.peer_id ?? '');
      if (!peerId) continue;

      const stamp = c.last?.created_at || c.last_at || null;
      const prev = seen.get(peerId);

      // First sight of a conversation: record where it is and say
      // nothing. Otherwise every conversation you have ever had would
      // fire a notification the moment you sign in.
      if (prev === undefined) { seen.set(peerId, stamp); continue; }

      // Only a message FROM them counts. Your own reply from another
      // device moves the timestamp too, and announcing that is noise.
      const mine = String(c.last?.sender_id ?? '') === String(me.id);

      if (stamp && stamp !== prev && !mine) {
        seen.set(peerId, stamp);
        fresh.push(c);
      } else if (stamp !== prev) {
        seen.set(peerId, stamp);
      }
    }

    const before = JSON.stringify(convs.map(c => [c.peer?.id, c.unread, c.last?.created_at]));
    convs = rows;
    const after = JSON.stringify(convs.map(c => [c.peer?.id, c.unread, c.last?.created_at]));

    // Anything at all changed: let the conversation list repaint even
    // though it did not ask. This is what makes a new message appear in
    // the list without pressing Messages again.
    if (before !== after) emit('inbox:changed', { convs });

    // Badge, always — the number must be right even with nothing new.
    emit('inbox:unread', { total: inboxUnread() });

    for (const c of fresh) {
      // notify_sm decides whether this becomes a system notification,
      // an in-app toast, or nothing at all (you are in that thread).
      emit('dm:incoming', {
        from: String(c.peer?.id ?? ''),
        name: c.peer?.full_name || '',
        text: c.last?.text || '',
        mediaType: c.last?.media_type || null,
        avatar: c.peer?.avatar_url || null,
        muted: !!c.muted
      });
    }
  } catch {
    // A failed poll is not worth a toast; the next one is 5s away.
  } finally {
    busy = false;
  }
}

/* ------------------------------------------------------------
   LIFECYCLE
   ------------------------------------------------------------ */

function schedule() {
  if (timer) clearInterval(timer);
  timer = setInterval(tick, document.hidden ? SLOW_MS : FAST_MS);
  // Node keeps the process alive for a pending interval; browsers do
  // not care. Stops a headless test hanging for the interval's length.
  timer?.unref?.();
}

export function startInbox() {
  if (running || !me.id) return;
  running = true;

  // Seed the map BEFORE the first announce-capable tick, so signing in
  // does not replay every conversation you already know about.
  tick().finally(schedule);

  document.addEventListener('visibilitychange', onVisibility);
}

export function stopInbox() {
  running = false;
  if (timer) clearInterval(timer);
  timer = 0;
  seen.clear();
  convs = [];
  document.removeEventListener('visibilitychange', onVisibility);
}

function onVisibility() {
  if (!running) return;
  schedule();
  // Coming back to the app should feel instant, not "in five seconds".
  if (!document.hidden) tick();
}

/**
 * Poll right now. Used after sending a message and when the Android
 * screen turns on, so the list is correct the moment you look at it.
 */
export function pokeInbox() {
  if (running) tick();
}

export function initInbox() {
  // Sending updates the thread immediately; this keeps the LIST and the
  // badge in step without waiting up to five seconds.
  onEvent('dm:sent', () => pokeInbox());
  onEvent('koliya:resume', () => pokeInbox());
  if (typeof window !== 'undefined') {
    window.addEventListener('koliya:resume', () => pokeInbox());
  }
}

export default {
  useApi, initInbox, startInbox, stopInbox, pokeInbox,
  inboxConversations, inboxUnread
};
