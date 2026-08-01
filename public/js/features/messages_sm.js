/**
 * KOLIYA — features/messages_sm.js
 * ============================================================
 * The conversation screen.
 *
 * Web interaction model (not phone):
 *   hover a bubble   → react / reply / more appear beside it
 *   right-click      → full context menu
 *   Enter            → send        Shift+Enter → newline
 *   ArrowUp          → edit your last message
 *   Ctrl+V           → paste a screenshot straight in
 *   drag & drop      → attach a file
 *   Esc              → cancel reply or edit
 *
 * Visual language kept from the original Koliya: gradient bubbles
 * with a soft coloured shadow, rounded corners, a small tail on the
 * last message of a run.
 * ============================================================
 */

import {
  $, $$, el, on, esc, html, raw, timeAgo, clockTime, dayLabel, sameDay,
  duration, initials, avatarColor, debounce, rafThrottle, imagesFromPaste,
  onVisible, env, uid, safeUrl, cssEscape, richText
} from '../core/utils_sm.js';
import { state, setState, me, draft, scoped, on as onEvent, emit } from '../core/store_sm.js';
import { person, cachePeople } from '../core/people_sm.js';
import { I, icon, reactionIcon, reactionLabel, REACTION_KEYS } from '../core/icons_sm.js';
import {
  toast, contextMenu, reactionPicker, actionBar, lightbox,
  confirmDialog, skeletonList, emptyState, optimistic, closeMenu, modal
} from '../core/ui_sm.js';
import { route, go } from '../core/router_sm.js';
import { t, errorText } from '../core/i18n_sm.js';
import { openGifPicker, closeGifPicker } from './gif_sm.js';
import { attachGestures } from '../core/gestures_sm.js';
import { startRecording, cancelRecording, isRecording, wireVoicePlayers } from './voice_sm.js';
import { openImageEditor } from './editor_sm.js';

/* ------------------------------------------------------------
   STATE
   ------------------------------------------------------------ */

let convs = [];          // conversation list
let msgs = [];           // messages in the open thread
let peer = null;         // who we are talking to
let replyTo = null;      // message being replied to
let editing = null;      // message being edited
let atBottom = true;
let pendingFiles = [];
let selectedId = null;     // message whose toolbar is open
let infoOpen = true;       // right-hand info panel — open by default
let folder = 'all';        // active chat folder
let folders = {};          // peerId -> folder name

/* THE THREE TOP-LEVEL SECTIONS.
   'dm' | 'channels' | 'events'. Not folders: a folder filters `convs`,
   which only ever holds rows from the `messages` table, so no folder
   could show a channel however it was named. */
let section = 'dm';
let groupChats = [];       // my_group_chats() — channels AND events
let customFolders = [];    // names created by this student
let requests = [];         // conversations waiting for a decision
let showingRequests = false;

/* Injected by db_sm.js once the keys arrive. Until then the screen
   runs on sample data so the interaction can be built and reviewed. */
let api = null;
let detachThreadGestures = null;
export function useApi(impl) { api = impl; }

/* ------------------------------------------------------------
   DATA ACCESS  — every call goes to Neon, nothing is invented here
   ------------------------------------------------------------ */

async function loadConversations() {
  if (!api?.listConversations) return [];
  const rows = await api.listConversations();
  cachePeople(rows.map(r => r.peer));
  return rows;
}

async function loadThread(peerId) {
  if (!api?.listMessages) return [];
  return api.listMessages(peerId);
}

async function sendMessage(payload) {
  if (!api?.sendMessage) throw new Error(t('db.notConnected'));
  return api.sendMessage(payload);
}

async function persistReaction(msgId, key) {
  if (!api?.react) throw new Error(t('db.notConnected'));
  return api.react(msgId, key);
}

/* ------------------------------------------------------------
   NEAR-LIVE UPDATES

   Your original app used Supabase Realtime — a real WebSocket:
       .on('postgres_changes', { event:'INSERT', table:'messages' })
   Neon's Data API has no equivalent. There is no socket to open.

   So this is the honest best approximation, and I am naming it
   plainly rather than calling it "instant":

     · your own message appears immediately (optimistic), then is
       confirmed by the row the database returns
     · the open thread asks only for messages NEWER than the last one
       it has — a tiny query, not a reload of the conversation
     · 1.5s while you are looking, 15s when the tab is hidden
     · your other tabs update through BroadcastChannel with no
       network call at all
   ------------------------------------------------------------ */

const FAST_MS = 1500;
const SLOW_MS = 15000;

let pollTimer = 0;
let pollBusy = false;
let bc = null;

/** Cross-tab sync: sending in one tab updates the others for free. */
function channel() {
  if (bc !== null) return bc;
  try { bc = new BroadcastChannel('koliya-dm'); }
  catch { bc = false; }              // Safari private mode, older webviews
  if (bc) {
    bc.onmessage = e => {
      const { type, peerId } = e.data || {};
      if (type === 'sent' && peer && String(peerId) === String(peer.id)) beat(true);
      if (type === 'sent') renderConvList();
    };
  }
  return bc;
}

const announce = (type, peerId) => { try { channel()?.postMessage({ type, peerId }); } catch {} };

/** One refresh cycle. Only asks for what it does not already have. */
async function beat(force = false) {
  if (pollBusy || !peer || !api?.listMessages) return;
  if (document.hidden && !force) return;
  pollBusy = true;

  try {
    const since = msgs.length ? msgs[msgs.length - 1].created_at : null;
    const incoming = api.listNewMessages
      ? await api.listNewMessages(peer.id, since)
      : await api.listMessages(peer.id);

    if (incoming?.length) {
      const known = new Set(msgs.map(m => String(m.id)));
      const fresh = incoming.filter(m => !known.has(String(m.id)));

      if (fresh.length) {
        const body = $('#threadBody');
        const stick = body ? nearBottom(body) : true;
        msgs.push(...fresh);
        renderThread({ keepScroll: !stick });

        if (stick) {
          scrollToBottom(true);
          showNewBelow(0);
        } else {
          // Reading history: do NOT move them. Offer the jump instead.
          const theirsCount = fresh.filter(m => String(m.sender_id) !== String(me.id)).length;
          showNewBelow(unseenBelow + theirsCount);
        }

        // A message that arrived while you are reading is read.
        const theirs = fresh.filter(m => String(m.sender_id) !== String(me.id));
        if (theirs.length && !document.hidden) {
          for (const m of theirs) api.markRead?.(m.id);
        }
        if (theirs.length) {
          pingArrival();
          renderConvList();
          // Let notify_sm decide whether this deserves a browser
          // notification — it knows the permission and the route.
          const last = theirs[theirs.length - 1];
          emit('dm:incoming', {
            from: peer.id,
            name: peer.full_name,
            text: last.text || mediaLabel(last.media_type),
            avatar: peer.avatar_url,
            muted: folderOf(peer.id) === 'muted' || getChatPref(peer.id).muted
          });
        }
      }
    }

    // Read receipts and reactions change existing rows, so refresh the
    // tail of the thread periodically rather than on every beat.
    if (force || Math.random() < 0.25) await refreshTail();

    const typing = await api.isTyping?.(peer.id);
    showTyping(!!typing);
  } catch { /* a failed beat is not worth a toast */ }
  finally { pollBusy = false; }
}

/**
 * Re-read the tail so ticks, edits and reactions stay true.
 *
 * THE FLICKER YOU SAW: this used to call renderThread(), which wipes
 * innerHTML and rebuilds every bubble. Running that every few
 * seconds — because someone's read receipt landed — made the whole
 * conversation blink, lose text selection, and close any open menu.
 *
 * Now each change is applied to the ONE element that changed. The
 * thread is only rebuilt when a message is added or removed, which
 * is a structural change the user is expecting anyway.
 */
async function refreshTail() {
  if (!peer || !msgs.length) return;
  const tail = await api.listMessages(peer.id).catch(() => null);
  if (!tail) return;

  const byId = new Map(tail.map(m => [String(m.id), m]));
  let structural = false;

  msgs = msgs.map(m => {
    const fresh = byId.get(String(m.id));
    if (!fresh) return m;

    const tickChanged = fresh.seen_at !== m.seen_at;
    const rxChanged   = JSON.stringify(fresh.reactions || {}) !== JSON.stringify(m.reactions || {});
    const textChanged = fresh.text !== m.text;
    if (!tickChanged && !rxChanged && !textChanged) return m;

    const merged = { ...m, ...fresh };
    // surgical: touch only what moved
    if (tickChanged) patchTicks(merged);
    if (rxChanged)   repaintBubble(merged);
    if (textChanged) patchText(merged);
    return merged;
  });

  // A message appearing or vanishing changes the layout, so that one
  // does need a rebuild — but it is rare and visible on purpose.
  const alive = msgs.filter(m => m._pending || byId.has(String(m.id)));
  if (alive.length !== msgs.length) { msgs = alive; structural = true; }
  if (structural) renderThread({ keepScroll: !atBottom });
}

/** Swap the delivery tick without touching the bubble. */
function patchTicks(m) {
  const row = $(`#threadBody .bubble-row[data-id="${cssEscape(m.id)}"]`);
  const meta = row?.querySelector('.bubble-meta');
  if (!meta || String(m.sender_id) !== String(me.id)) return;
  const tick = meta.querySelector('.tick');
  if (!tick) return;
  const wantRead = !!m.seen_at;
  if (tick.classList.contains('read') === wantRead) return;
  tick.classList.toggle('read', wantRead);
  tick.innerHTML = wantRead ? I.tickDouble : I.tick;
}

/** Replace only the text node of an edited message. */
function patchText(m) {
  const row = $(`#threadBody .bubble-row[data-id="${cssEscape(m.id)}"]`);
  const span = row?.querySelector('.bub-text');
  if (!span) return;
  span.textContent = m.text || '';
  const meta = row.querySelector('.bubble-meta');
  if (m.edited_at && meta && !meta.querySelector('.edited-mark')) {
    meta.insertAdjacentHTML('afterbegin',
      `<span class="edited-mark t-xs" style="opacity:.7">${esc(t('dm.editedMark'))}</span>`);
  }
}

/** A soft chime for an arriving message, muted if you muted the chat. */
function pingArrival() {
  if (!peer || folderOf(peer.id) === 'muted') return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.start(); osc.stop(ctx.currentTime + 0.2);
    setTimeout(() => ctx.close(), 400);
  } catch {}
}

function startPolling() {
  stopPolling();
  channel();
  pollTimer = setInterval(beat, document.hidden ? SLOW_MS : FAST_MS);
  // Node keeps the process alive for a pending interval; browsers do
  // not care. Harmless either way, and it stops a headless test from
  // hanging for the length of the timer.
  pollTimer?.unref?.();
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = 0;
  try { bc && bc.close?.(); } catch {}
  bc = null;
}

/** Switch cadence when the tab is hidden, instead of hammering Neon. */
function retune() {
  if (!peer) return;
  stopPolling();
  pollTimer = setInterval(beat, document.hidden ? SLOW_MS : FAST_MS);
  pollTimer?.unref?.();
  if (!document.hidden) beat(true);
}

function showTyping(on) {
  const body = $('#threadBody');
  if (!body) return;
  const node = $('#typingRow');
  if (on && !node) {
    body.insertAdjacentHTML('beforeend',
      `<div class="bubble-row" id="typingRow"><div class="av sm" style="background:${avatarColor(peer.id)}">${esc(initials(peer.full_name))}</div>
       <div class="typing"><i></i><i></i><i></i></div></div>`);
    if (atBottom) scrollToBottom(false);
  } else if (!on && node) node.remove();
}

/* ------------------------------------------------------------
   CHAT chatFolders()
   The same set your original app had — all · pinned · unread ·
   study · muted · archived — with one difference: it lived in
   localStorage there, so clearing the browser wiped it and your
   phone disagreed with your laptop. Now it is a table.
   ------------------------------------------------------------ */

// A FUNCTION, not a frozen constant: evaluated once at import time
// these labels lock to whichever language loaded first, and a later
// switch never reaches them. Verified in Chrome: the notification
// filters stayed English while the rest of the UI was Arabic.
const chatFolders = () => ([
  { id: 'all',      label: 'Tous',     icon: 'message'  },
  { id: 'requests', label: 'Requests', icon: 'inbox'    },
  { id: 'unread',   label: 'Non lus',  icon: 'inbox'    },
  { id: 'pinned',   label: t('dm.pinnedFolder'), icon: 'pin'      },
  { id: 'study',    label: 'Études',   icon: 'graduation' },
  { id: 'muted',    label: 'Muets',    icon: 'mute'     },
  { id: 'archived', label: t('dm.archivedFolder'), icon: 'bookmark' },
  // Whatever this student made. `custom: true` so the strip can offer
  // Delete on them and not on the built-ins.
  ...customFolders.map(n => ({ id: n, label: n, icon: 'bookmark', custom: true }))
]);

const folderOf = peerId => folders[String(peerId)] || 'all';

/** Which conversations belong in the open folder. */
function inFolder(c) {
  const f = folderOf(c.peer.id);
  if (folder === 'all')    return f !== 'archived';   // archive is out of the way
  if (folder === 'unread') return c.unread > 0 && f !== 'archived';
  return f === folder;
}

/* The three sections. Channels and Events are rendered ONLY when the
   student is actually in one — "if he's not, there is no need to make
   it visible". my_group_chats() returns [] for somebody who has joined
   nothing, so this collapses to a single Messages tab, which is what
   the screen looked like before. */
function sectionBar() {
  const chans  = groupChats.filter(g => g.kind === 'channel');
  const events = groupChats.filter(g => g.kind === 'event');
  const secs = [{ id: 'dm', label: t('dm.section.messages'), icon: 'message',
                  n: convs.reduce((a, c) => a + (c.unread || 0), 0) }];
  if (chans.length)  secs.push({ id: 'channels', label: t('dm.section.channels'),
                                 icon: 'hash', n: chans.length });
  if (events.length) secs.push({ id: 'events', label: t('dm.section.events'),
                                 icon: 'calendar', n: events.length });

  // One section and nothing else to switch to is not a choice; drawing
  // a single tab is chrome for its own sake.
  if (secs.length === 1) return '';

  return `<div class="chat-sections" id="chatSections" role="tablist">
    ${secs.map(s => `<button class="chat-section${s.id === section ? ' on' : ''}"
        data-section="${s.id}" role="tab" aria-selected="${s.id === section}"
        aria-label="${esc(s.label)}">
      ${icon(s.icon, { size: 15 })}<span class="cs-label">${esc(s.label)}</span>
      ${s.n ? `<span class="cf-count">${s.n}</span>` : ''}
    </button>`).join('')}
  </div>`;
}

function folderBar() {
  // Folders belong to the Messages section. A channel is not filed in
  // "Pinned" or "Muted" — those act on `convs`, which holds DMs only.
  if (section !== 'dm') return '';
  return `<div class="chat-folders" id="chatFolders">
    ${chatFolders().map(f => {
      const n = f.id === 'all'
        ? convs.filter(c => folderOf(c.peer.id) !== 'archived').length
        : f.id === 'requests'
          ? requests.length
        : f.id === 'unread'
          ? convs.filter(c => c.unread > 0 && folderOf(c.peer.id) !== 'archived').length
          : convs.filter(c => folderOf(c.peer.id) === f.id).length;
      // A CUSTOM folder's label is the name the student typed. Running
      // it through t('dm.folder.' + id) looked up a key that cannot
      // exist and rendered the literal string "dm.folder.Projet PFE"
      // on the strip. Caught by the raw-key sweep in v16.test.mjs.
      const label = f.custom      ? f.label
                  : f.id === 'requests' ? t('dm.requests')
                  : t('dm.folder.' + f.id);
      return `<button class="chat-folder${f.id === folder ? ' on' : ''}${f.id === 'requests' && n ? ' has-requests' : ''}"
                      data-folder="${f.id}" data-tip="${esc(label)}" aria-label="${esc(label)}">
          ${icon(f.icon, { size: 14 })}
          <span class="cf-label">${esc(label)}</span>
          ${n ? `<span class="cf-count">${n}</span>` : ''}
        </button>`;
    }).join('')}
    <button class="chat-folder cf-add" id="cfAdd"
            data-tip="${esc(t('dm.newFolder'))}" aria-label="${esc(t('dm.newFolder'))}">
      ${icon('plus', { size: 14 })}
    </button>
  </div>`;
}

/* Create a folder. Named here rather than inline so the empty-state
   button can call the same thing. */
async function promptNewFolder() {
  const input = el('input', { class: 'input', maxlength: '24',
                              placeholder: t('dm.folderNamePh') });
  const box = el('div', { class: 'col g3' },
    el('div', { class: 't-sm t-dim' }, t('dm.newFolderWhy')), input);

  // modal() takes `footer`, NOT an `actions` array — I wrote `actions`
  // first and it silently rendered a dialog with no buttons at all,
  // because the option is simply ignored. Checked against
  // campus_sm.js openChannelComposer(), which is the same shape.
  const foot = el('div', { class: 'row g2' });
  const m = modal({ title: t('dm.newFolder'), body: box, footer: foot });

  const submit = async () => {
    const name = (input.value || '').trim();
    if (!name) { input.focus(); return; }
    try {
      const ok = await api.createFolder(name);
      if (!ok) { toast(t('dm.folderNameTaken'), 'err'); return; }
      customFolders = await api.listCustomFolders();
      folder = name;
      m.close();
      paintConvList();
      toast(t('dm.folderCreated', { folder: name }), 'ok');
    } catch (err) { toast(errorText(err), 'err'); }
  };

  foot.append(
    el('button', { class: 'btn btn-ghost', onclick: () => m.close() }, t('action.cancel')),
    el('button', { class: 'btn btn-primary', onclick: submit }, t('action.create'))
  );
  on(input, 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  setTimeout(() => input.focus(), 50);
}

function wireFolders() {
  const secBar = $('#chatSections');
  if (secBar) {
    on(secBar, 'click', e => {
      const btn = e.target.closest('[data-section]');
      if (!btn) return;
      section = btn.dataset.section;
      paintConvList();
    });
  }

  const bar = $('#chatFolders');
  if (!bar) return;
  on(bar, 'click', e => {
    if (e.target.closest('#cfAdd')) { promptNewFolder(); return; }

    const btn = e.target.closest('[data-folder]');
    if (!btn) return;
    folder = btn.dataset.folder;
    paintConvList();
  });

  // Right-click a folder you made to delete it. Built-ins have no
  // menu — there is nothing to do to them.
  on(bar, 'contextmenu', e => {
    const btn = e.target.closest('[data-folder]');
    if (!btn) return;
    const name = btn.dataset.folder;
    if (!customFolders.includes(name)) return;
    e.preventDefault();
    contextMenu(e, [
      { title: name },
      { label: t('dm.deleteFolder'), icon: I.trash, danger: true, onClick: async () => {
          try {
            await api.deleteFolder(name);
            customFolders = customFolders.filter(x => x !== name);
            // Anything filed here is unfiled, not deleted.
            for (const k of Object.keys(folders)) if (folders[k] === name) delete folders[k];
            if (folder === name) folder = 'all';
            paintConvList();
            toast(t('dm.folderDeleted'), 'ok');
          } catch (err) { toast(errorText(err), 'err'); }
        } }
    ]);
  });
}

/** Right-click a conversation to file it. */
function convMenu(e, c) {
  e.preventDefault();
  const current = folderOf(c.peer.id);
  contextMenu(e, [
    { title: c.peer.full_name },
    // WAS `FOLDERS` — a bare identifier that does not exist anywhere in
    // this file (the array was renamed to the chatFolders() function).
    // Right-clicking a conversation therefore threw
    // "FOLDERS is not defined" and NO context menu opened at all, which
    // is why filing a chat by right-click never worked. Caught by
    // grepping for the identifier, not by any test.
    ...chatFolders().filter(f => f.id !== 'unread' && f.id !== 'requests').map(f => ({
      label: f.id === 'all' ? t('menu.removeFolder') : `Déplacer vers ${f.label}`,
      icon: I[f.icon] || I.message,
      kbd: current === f.id ? '✓' : '',
      onClick: async () => {
        const before = folders[String(c.peer.id)];
        if (f.id === 'all') delete folders[String(c.peer.id)];
        else folders[String(c.peer.id)] = f.id;
        paintConvList();
        try {
          await api.setFolder(c.peer.id, f.id);
          toast(f.id === 'all' ? t('toast.removedFolder') : t('dm.movedTo', { folder: f.label }), 'ok');
        } catch {
          if (before) folders[String(c.peer.id)] = before;
          else delete folders[String(c.peer.id)];
          paintConvList();
          toast(t('toast.moveFailed'), 'err');
        }
      }
    })),
    { sep: true },
    { label: 'Ouvrir le profil', icon: I.user,
      onClick: () => { location.hash = `#/profile/${c.peer.username}`; } }
  ]);
}

/* ------------------------------------------------------------
   CONVERSATION LIST
   ------------------------------------------------------------ */

function convRow(c) {
  const p = c.peer;
  const isOpen = peer?.id === p.id;
  const last = c.last;
  const preview = last
    ? (last.sender_id === me.id ? t('dm.you') : '') +
      (last.media_type ? mediaLabel(last.media_type) : last.text)
    : t('dm.newConversation');

  const f = folderOf(p.id);
  const node = el('button', {
    class: 'conv' + (isOpen ? ' on' : '') + (c.unread ? ' unread' : '') +
           (f === 'pinned' ? ' pinned' : '') + (f === 'muted' ? ' muted' : ''),
    'data-peer': p.id,
    onclick: () => openThread(p.id),
    oncontextmenu: e => convMenu(e, c)
  });

  const av = p.avatar_url
    ? el('div', { class: 'av', 'data-online': String(!!isOnline(p)),
                  html: `<img src="${esc(safeUrl(p.avatar_url))}" alt="">` })
    : el('div', { class: 'av', 'data-online': String(!!isOnline(p)),
                  style: { background: avatarColor(p.id) } }, initials(p.full_name));

  node.append(av, el('div', { class: 'conv-body' },
    el('div', { class: 'conv-top' },
      el('span', { class: 'conv-name truncate' }, p.full_name),
      f === 'pinned' ? el('span', { class: 'conv-mark', html: icon('pin', { size: 12 }) }) : null,
      f === 'muted'  ? el('span', { class: 'conv-mark', html: icon('mute', { size: 12 }) }) : null,
      el('span', { class: 'conv-time' }, last ? timeAgo(last.created_at) : '')
    ),
    el('div', { class: 'row g2' },
      el('span', { class: 'conv-last truncate grow' }, preview),
      c.unread ? el('span', { class: 'count' }, String(c.unread)) : null
    )
  ));
  return node;
}

/** "Online" = seen in the last two minutes, from profiles.last_seen. */
function isOnline(p) {
  if (!p?.last_seen) return false;
  return Date.now() - new Date(p.last_seen).getTime() < 120000;
}

/**
 * The parameter used to be called `t`, which SHADOWED the translation
 * function imported at the top of this file. A later bulk edit then
 * rewrote the strings inside, producing `t('feed.photo')` where `t`
 * was the media-type string — so every attachment label rendered as
 * `undefined`. Renamed to `kind`; the shadow is why it happened.
 */
const mediaLabel = kind => ({
  image: t('dm.photo'), video: t('dm.video'),
  audio: t('dm.voice'), file:  t('dm.file')
}[kind] || t('dm.attachment'));

async function renderConvList({ quiet = false } = {}) {
  const box = $('#convScroll');
  if (!box) return;
  // quiet: a background refresh from the inbox poller. Showing skeletons
  // every five seconds would make the list flicker while you read it, so
  // only the first paint (or an explicit reload) gets them.
  if (!quiet || !box.querySelector('.conv')) box.innerHTML = skeletonList(5, 'conv');

  try {
    // .catch on each: a database that has not had
    // 15_follow_notify_sm.sql applied yet has no my_group_chats(), and
    // ONE missing RPC must not blank the entire conversation list.
    // Without this the screen showed "error loading" and no DMs at all.
    const [rows, f, reqs, groups, custom] = await Promise.all([
      loadConversations(),
      api?.listFolders  ? api.listFolders()  : Promise.resolve({}),
      api?.listRequests ? api.listRequests() : Promise.resolve([]),
      api?.myGroupChats ? api.myGroupChats().catch(() => []) : Promise.resolve([]),
      api?.listCustomFolders ? api.listCustomFolders().catch(() => []) : Promise.resolve([])
    ]);
    convs = rows;
    folders = f || {};
    requests = reqs || [];
    groupChats = groups || [];
    customFolders = custom || [];

    // The tab I am standing in just disappeared (left the last channel).
    if (section === 'channels' && !groupChats.some(g => g.kind === 'channel')) section = 'dm';
    if (section === 'events'   && !groupChats.some(g => g.kind === 'event'))   section = 'dm';
  } catch (err) {
    box.innerHTML = '';
    box.append(emptyState({
      icon: I.message,
      title: t('error.loading'),
      text: errorText(err),
      action: { label: t('action.retry'), onClick: () => renderConvList() }
    }));
    return;
  }

  paintConvList();

  // Feed the rail badge. Nothing was setting the messages half of
  // `unread`, so the sidebar counter could only ever show
  // notifications.
  const totalUnread = convs.reduce((n, c) => n + (c.unread || 0), 0);
  setState({ unread: { ...state.unread, messages: totalUnread } });
}

/** Narrow panel, no thread chosen: the list is the screen. */
function showPickAConversation() {
  const body = $('#threadBody');
  const head = $('#threadHead');
  if (head) head.innerHTML = '';
  $('#composerWrap')?.classList.add('hidden');
  if (!body) return;
  body.innerHTML = '';
  body.append(emptyState({
    icon: I.message,
    title: t('dm.pickTitle'),
    text: t('dm.pickText')
  }));
}

/** Nothing to open: say so in the thread pane, not with a blank box. */
function showNoConversations() {
  const body = $('#threadBody');
  const head = $('#threadHead');
  if (head) head.innerHTML = '';
  if (!body) return;
  body.innerHTML = '';
  body.append(emptyState({
    icon: I.message,
    title: t('dm.empty.title'),
    text: t('dm.empty.text'),
    action: { label: t('dm.new'), onClick: () => openNewConversation() }
  }));
  $('#composerWrap')?.classList.add('hidden');
}

/* ------------------------------------------------------------
   MESSAGE REQUESTS
   A stranger's first messages wait here instead of interrupting the
   inbox. Accepting moves the conversation across; declining is
   silent — the sender is never told, which is the point.
   ------------------------------------------------------------ */

function requestCard(r) {
  const p = r.peer;
  return `<article class="req" data-peer="${esc(p.id)}">
      <div class="req-top">
        ${p.avatar_url
          ? `<span class="av"><img src="${esc(safeUrl(p.avatar_url))}" alt=""></span>`
          : `<span class="av" style="background:${avatarColor(p.id)}">${esc(initials(p.full_name))}</span>`}
        <div class="grow" style="min-width:0">
          <div class="t-sm t-bold truncate">${esc(p.full_name)}</div>
          <div class="t-xs t-dim truncate"><span class="handle">@${esc(p.username)}</span>${p.faculty ? ' · ' + esc(p.faculty) : ''}</div>
          ${r.mutuals > 0
            ? `<div class="t-xs req-mutual">${icon('users', { size: 11 })} ${t('dm.mutuals', { n: r.mutuals })}</div>`
            : ''}
        </div>
        <span class="t-xs t-dim">${timeAgo(r.at)}</span>
      </div>

      <p class="req-preview">${esc(truncateReq(r.preview || '', 140))}</p>
      ${r.count > 1 ? `<div class="t-xs t-dim2">${t('dm.andMore', { n: r.count - 1 })}</div>` : ''}

      <div class="req-actions">
        <button class="btn btn-primary btn-sm" data-accept>${esc(t('dm.accept'))}</button>
        <button class="btn btn-outline btn-sm" data-decline>${esc(t('dm.decline'))}</button>
        <button class="icon-btn sm" data-open aria-label="${esc(t('dm.readIt'))}"
                data-tip="${esc(t('dm.readIt'))}">${I.chevron}</button>
      </div>
    </article>`;
}

const truncateReq = (v, n) => (v.length > n ? v.slice(0, n - 1) + '…' : v);

function paintRequests() {
  const box = $('#convScroll');
  if (!box) return;
  box.innerHTML = '';

  if (!requests.length) {
    box.append(emptyState({
      icon: I.inbox,
      title: t('dm.noRequests'),
      text: t('dm.noRequestsText')
    }));
    return;
  }

  box.insertAdjacentHTML('beforeend',
    `<div class="req-note">${icon('lock', { size: 13 })} ${esc(t('dm.requestNote'))}</div>` +
    requests.map(requestCard).join(''));

  on(box, 'click', async e => {
    const card = e.target.closest('.req');
    if (!card) return;
    const peerId = card.dataset.peer;
    const req = requests.find(r => String(r.peer.id) === String(peerId));
    if (!req) return;

    if (e.target.closest('[data-accept]')) {
      requests = requests.filter(r => String(r.peer.id) !== String(peerId));
      paintRequests();
      try {
        await api.acceptRequest(peerId);
        toast(t('dm.accepted', { name: req.peer.full_name }), 'ok');
        folder = 'all';
        await renderConvList();
        openThread(peerId);
      } catch { requests.push(req); paintRequests(); toast(errorText(new Error()), 'err'); }
      return;
    }

    if (e.target.closest('[data-decline]')) {
      requests = requests.filter(r => String(r.peer.id) !== String(peerId));
      paintRequests();
      // No confirmation dialog: declining is reversible in effect
      // (they can be accepted later from the profile) and asking
      // twice makes an unwanted message feel like a bigger event
      // than it is.
      try { await api.declineRequest(peerId); toast(t('dm.declined'), { duration: 2200 }); }
      catch { requests.push(req); paintRequests(); }
      return;
    }

    // Reading a request does NOT accept it.
    openThread(peerId, { asRequest: true });
  }, { once: true });
}

/** Repaint from memory — no network, so folders switch instantly. */
/** One row in the Channels or Events list. */
function groupRow(g) {
  const isOpen = group && group.kind === g.kind && String(group.id) === String(g.id);
  const node = el('button', {
    class: 'conv' + (isOpen ? ' on' : ''),
    'data-group': `${g.kind}-${g.id}`,
    onclick: () => openGroupThread(g.kind, String(g.id))
  });

  node.append(
    el('div', { class: 'av', style: { background: 'var(--brand)' },
                html: icon(g.kind === 'event' ? 'calendar' : 'hash', { size: 16 }) }),
    el('div', { class: 'conv-body' },
      el('div', { class: 'conv-top' },
        el('span', { class: 'conv-name truncate' }, g.name || ''),
        g.is_private ? el('span', { class: 'conv-mark', html: icon('lock', { size: 12 }) }) : null,
        el('span', { class: 'conv-time' }, g.last_at ? timeAgo(g.last_at) : '')
      ),
      el('div', { class: 'row g2' },
        el('span', { class: 'conv-last truncate grow' },
          // "1 members" — the app has no plural machinery, and this
          // was visible in the very first screenshot of the Channels
          // list. Arabic needs a different word entirely, so the
          // singular is its own key rather than a stripped "s".
          g.last_text || (Number(g.members) === 1
            ? t('dm.groupMember1')
            : t('dm.groupMembers', { n: g.members || 0 }))),
        // Your rank in the channel, so "why can't I post here" has a
        // visible answer before you try.
        g.role && g.role !== 'member'
          ? el('span', { class: 'pill xs' }, t('channels.role.' + g.role))
          : null
      )
    )
  );
  return node;
}

/** Channels / Events. Separate from the DM list: nothing here is a peer. */
function paintGroupList() {
  const box = $('#convScroll');
  if (!box) return;
  box.innerHTML = '';

  const want = section === 'channels' ? 'channel' : 'event';
  const rows = groupChats.filter(g => g.kind === want);

  if (!rows.length) {
    // Reachable only in the instant between leaving your last channel
    // and the tab disappearing.
    box.append(emptyState({
      icon: want === 'event' ? I.calendar : I.hash,
      title: t(want === 'event' ? 'dm.noEvents' : 'dm.noChannels'),
      text: t(want === 'event' ? 'dm.noEventsWhy' : 'dm.noChannelsWhy'),
      action: { label: t('nav.campus'), onClick: () => go('campus') }
    }));
    return;
  }

  const frag = document.createDocumentFragment();
  rows.forEach(g => frag.append(groupRow(g)));
  box.append(frag);
}

function paintConvList() {
  const box = $('#convScroll');
  if (!box) return;

  // The section bar sits ABOVE the folder strip and is redrawn with it,
  // because switching sections changes which folders exist.
  const secBar = $('#chatSections');
  if (secBar) secBar.outerHTML = sectionBar() || '<div id="chatSections" hidden></div>';
  else box.insertAdjacentHTML('beforebegin', sectionBar());

  const bar = $('#chatFolders');
  if (bar) bar.outerHTML = folderBar() || '<div id="chatFolders" hidden></div>';
  else box.insertAdjacentHTML('beforebegin', folderBar());
  wireFolders();

  if (section !== 'dm') { showingRequests = false; paintGroupList(); return; }

  if (folder === 'requests') { showingRequests = true; paintRequests(); return; }
  showingRequests = false;

  const visible = convs.filter(inFolder).sort((a, b) => {
    // pinned first, then most recent
    const pa = folderOf(a.peer.id) === 'pinned' ? 1 : 0;
    const pb = folderOf(b.peer.id) === 'pinned' ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return new Date(b.last?.created_at || 0) - new Date(a.last?.created_at || 0);
  });

  box.innerHTML = '';

  if (!visible.length) {
    const f = chatFolders().find(x => x.id === folder);
    box.append(emptyState({
      icon: I.message,
      title: folder === 'all' ? t('dm.empty.title') : `Rien dans « ${f?.label || folder} »`,
      text: folder === 'all'
        ? t('empty.startChatting')
        : 'Clic droit sur une conversation pour la classer ici.',
      action: folder === 'all'
        ? { label: t('dm.new'), onClick: () => openNewConversation() }
        : { label: 'Voir tout', onClick: () => { folder = 'all'; paintConvList(); } }
    }));
    return;
  }

  const frag = document.createDocumentFragment();
  visible.forEach(c => frag.append(convRow(c)));
  box.append(frag);
}

/* ------------------------------------------------------------
   BUBBLES
   ------------------------------------------------------------ */

function bubbleContent(m) {
  const parts = [];

  if (m.reply_to) {
    const src = msgs.find(x => x.id === m.reply_to);
    parts.push(`<button class="reply-quote" data-jump="${esc(m.reply_to)}">
        ${esc(src ? (src.text || mediaLabel(src.media_type)) : t('toast.msgDeleted'))}
      </button>`);
  }

  if (m.media_type === 'image') {
    parts.push(`<div class="media media-zoom" data-zoom="${esc(safeUrl(m.media_url))}">
        <img src="${esc(safeUrl(m.media_url))}" alt="" loading="lazy">
      </div>`);
  } else if (m.media_type === 'video') {
    parts.push(`<div class="media"><video src="${esc(safeUrl(m.media_url))}" controls preload="metadata"></video></div>`);
  } else if (m.media_type === 'audio') {
    parts.push(voiceMarkup(m));
  } else if (m.media_type === 'file') {
    parts.push(`<a class="row g2" href="${esc(safeUrl(m.media_url))}" download>
        ${icon('paperclip', { size: 16 })}<span class="truncate">${esc(m.media_name || t('dm.file'))}</span>
      </a>`);
  }

  if (m.text) parts.push(`<span class="bub-text">${esc(m.text)}</span>`);
  return parts.join('');
}

/** Voice note with a real waveform you can scrub. */
function voiceMarkup(m) {
  const bars = (m.waveform && m.waveform.length ? m.waveform : defaultWave()).map(h =>
    `<i style="--h:${Math.max(12, Math.round(h * 100))}%"></i>`).join('');
  return `<div class="voice" data-audio="${esc(safeUrl(m.media_url))}">
      <button class="icon-btn sm voice-play" aria-label="Lire">${I.play}</button>
      <div class="voice-wave" role="slider" aria-label="Position" tabindex="0">${bars}</div>
      <span class="voice-time">${duration(m.media_duration || 0)}</span>
      <button class="voice-speed" aria-label="Vitesse">1×</button>
    </div>`;
}
const defaultWave = () => Array.from({ length: 32 }, (_, i) =>
  0.25 + Math.abs(Math.sin(i * 0.7)) * 0.65);

function reactionChips(m) {
  const counts = {};
  for (const key of Object.values(m.reactions || {})) counts[key] = (counts[key] || 0) + 1;
  const keys = Object.keys(counts);
  if (!keys.length) return '';
  const mine = m.reactions?.[me.id];
  return `<div class="rx-chips">` + keys.map(k =>
    `<button class="rx-chip${mine === k ? ' mine' : ''}" data-rx="${k}" data-tip="${esc(reactionLabel(k))}" aria-label="${esc(reactionLabel(k))}">
       ${reactionIcon(k, 15)}${counts[k] > 1 ? ' ' + counts[k] : ''}
     </button>`).join('') + `</div>`;
}

function bubbleRow(m, prev, next) {
  const mine = m.sender_id === me.id;
  const sameSender = prev && prev.sender_id === m.sender_id &&
    (new Date(m.created_at) - new Date(prev.created_at)) < 5 * 60000;
  const lastOfGroup = !next || next.sender_id !== m.sender_id ||
    (new Date(next.created_at) - new Date(m.created_at)) >= 5 * 60000;

  const row = el('div', {
    class: `bubble-row hover-host${mine ? ' me' : ''}${sameSender ? ' same' : ''}${lastOfGroup ? ' last-of-group' : ''}`,
    'data-id': m.id
  });

  const who = mine ? (me.get() || {}) : (peer || {});
  const av = who.avatar_url
    ? el('div', { class: 'av sm', html: `<img src="${esc(safeUrl(who.avatar_url))}" alt="">` })
    : el('div', { class: 'av sm', style: { background: avatarColor(m.sender_id) } },
         initials(who.full_name || ''));

  const bub = el('div', { class: 'bubble', html: bubbleContent(m) });

  bub.append(el('div', { class: 'bubble-meta', html:
    `<span>${clockTime(m.created_at)}</span>` +
    (m.edited_at ? `<span class="t-xs" style="opacity:.7"> ${esc(t('dm.editedMark'))}</span>` : '') +
    (mine ? (m._pending
      ? `<span class="tick pending" data-tip="Envoi…">${icon('clock', { size: 13 })}</span>`
      : m.seen_at
        ? `<span class="tick read">${I.tickDouble}</span>`
        : `<span class="tick">${I.tick}</span>`) : '')
  }));

  const chips = reactionChips(m);
  if (chips) bub.insertAdjacentHTML('beforeend', chips);

  // hover tools — the web replacement for long-press
  actionBar(row, [
    { icon: I.smile, tip: t('menu.react'), onClick: e => openReactions(e.currentTarget, m) },
    { icon: I.reply, tip: t('action.reply'), onClick: () => startReply(m) },
    { icon: I.moreH, tip: t('action.more'), onClick: e => msgMenu(e, m) }
  ], { side: mine ? 'left' : 'right' });

  on(row, 'contextmenu', e => msgMenu(e, m));
  row.append(av, bub);
  return row;
}

/* ------------------------------------------------------------
   THREAD RENDER
   ------------------------------------------------------------ */

function renderThread({ keepScroll = false } = {}) {
  const body = $('#threadBody');
  if (!body) return;
  const prevTop = body.scrollTop;

  body.innerHTML = '';
  if (!msgs.length) {
    body.append(emptyState({
      icon: I.message,
      title: 'Dites bonjour',
      text: t('dm.noMessages', { name: peer?.full_name || '' })
    }));
    return;
  }

  const frag = document.createDocumentFragment();
  msgs.forEach((m, i) => {
    const prev = msgs[i - 1], next = msgs[i + 1];
    if (!prev || !sameDay(prev.created_at, m.created_at)) {
      frag.append(el('div', { class: 'day-sep blur-bar' }, dayLabel(m.created_at)));
    }
    frag.append(bubbleRow(m, prev, next));
  });
  body.append(frag);

  // A social app opens at the NEWEST message, never the first one.
  // `keepScroll` is what protects someone reading history from being
  // dragged to the bottom by an arriving message.
  if (keepScroll) body.scrollTop = prevTop;
  else scrollToBottom(false);
  markVisibleAsRead();
  wireVoicePlayers(body);
  if (infoOpen) renderInfoPanel();
}

/**
 * Pin to the newest message.
 *
 * `scrollHeight` is only correct once the browser has laid the
 * bubbles out, and images change the height again when they decode.
 * A single scrollTo therefore lands short and the last message sits
 * half off screen — which looked like "the chat won't stay put".
 * So: set it now, again after layout, and again after any image in
 * the thread finishes loading.
 */
function scrollToBottom(smooth = true) {
  const body = $('#threadBody');
  if (!body) return;
  const jump = () => body.scrollTo({
    top: body.scrollHeight,
    behavior: smooth && !env.reducedMotion ? 'smooth' : 'auto'
  });

  jump();
  requestAnimationFrame(jump);                 // after layout
  setTimeout(jump, 60);                        // after fonts settle

  // images resize the thread when they decode
  for (const img of body.querySelectorAll('img')) {
    if (img.complete) continue;
    img.addEventListener('load', () => { if (atBottom) jump(); }, { once: true });
  }
}

/** True when the reader is close enough to the end to follow along. */
function nearBottom(body, slack = 120) {
  return body.scrollHeight - body.scrollTop - body.clientHeight < slack;
}

/** Count of messages that arrived while the reader was scrolled up. */
let unseenBelow = 0;

function showNewBelow(n) {
  unseenBelow = n;
  const btn = $('#toBottom');
  if (!btn) return;
  btn.classList.toggle('show', n > 0 || !atBottom);
  btn.dataset.count = n > 0 ? String(n) : '';
  btn.setAttribute('aria-label', n > 0
    ? `${n} nouveau${n > 1 ? 'x' : ''} message${n > 1 ? 's' : ''}`
    : 'Aller en bas');
}

/**
 * A message counts as read when it is actually on screen — not when
 * the conversation is opened. Opening a thread and never scrolling
 * down should not mark the backlog as read.
 */
function markVisibleAsRead() {
  for (const row of $$('#threadBody .bubble-row:not(.me)')) {
    if (row.dataset.seen) continue;
    onVisible(row, () => {
      row.dataset.seen = '1';
      api?.markRead?.(row.dataset.id);
    }, { threshold: 0.9 });
  }
}

/* ------------------------------------------------------------
   SELECTION
   One click arms a message and shows its toolbar; clicking it again,
   clicking elsewhere, or pressing Escape puts it away.
   ------------------------------------------------------------ */

function selectMessage(id) {
  if (selectedId === id) { clearSelection(); return; }
  clearSelection();
  selectedId = id;
  const row = $(`#threadBody .bubble-row[data-id="${cssEscape(id)}"]`);
  row?.classList.add('is-active');
}

function clearSelection() {
  if (!selectedId) return;
  $(`#threadBody .bubble-row[data-id="${cssEscape(selectedId)}"]`)?.classList.remove('is-active');
  selectedId = null;
}

/* ------------------------------------------------------------
   REACTIONS
   ------------------------------------------------------------ */

function openReactions(anchor, m) {
  reactionPicker(anchor, {
    current: m.reactions?.[me.id] || null,
    onPick: key => applyReaction(m, key)
  });
}

function applyReaction(m, key) {
  const before = { ...(m.reactions || {}) };
  optimistic(
    () => {
      m.reactions ||= {};
      if (key) m.reactions[me.id] = key;
      else delete m.reactions[me.id];
      repaintBubble(m);          // only this bubble, not the whole thread
    },
    () => { m.reactions = before; repaintBubble(m); },
    () => persistReaction(m.id, key),
    t('toast.reactionFailed')
  );
}

/**
 * The original code called showChat() after every reaction, redrawing
 * the entire conversation — a flash plus lost scroll position.
 * Here only the affected bubble is touched.
 */
function repaintBubble(m) {
  const row = $(`#threadBody .bubble-row[data-id="${cssEscape(m.id)}"]`);
  if (!row) return;
  const bub = row.querySelector('.bubble');
  const old = bub.querySelector('.rx-chips');
  const next = reactionChips(m);
  if (old) old.remove();
  if (next) bub.insertAdjacentHTML('beforeend', next);
}

/* ------------------------------------------------------------
   INFO PANEL  (Telegram-style)
   Profile, shared media, files and links for the open conversation.
   Slides in beside the thread rather than covering it, so you can
   keep reading while you browse what was shared.
   ------------------------------------------------------------ */

// A FUNCTION, not a frozen constant: evaluated once at import time
// these labels lock to whichever language loaded first, and a later
// switch never reaches them. Verified in Chrome: the notification
// filters stayed English while the rest of the UI was Arabic.
const chatThemes = () => ([
  { id: 'default', label: t('dm.themeDefault'),  bg: 'var(--surface-2)',                      grad: 'var(--grad)' },
  { id: 'dz',      label: 'Algérie', bg: 'linear-gradient(160deg,#E8F5EE,#F7FBF8)', grad: 'linear-gradient(135deg,#006233,#00A651)' },
  { id: 'sunset',  label: 'Coucher', bg: 'linear-gradient(160deg,#FFF3E8,#FFF9F4)', grad: 'linear-gradient(135deg,#F97316,#EC4899)' },
  { id: 'ocean',   label: t('dm.themeOcean'),   bg: 'linear-gradient(160deg,#E9F4FF,#F6FAFF)', grad: 'linear-gradient(135deg,#0EA5E9,#6366F1)' },
  { id: 'night',   label: 'Nuit',    bg: 'linear-gradient(160deg,#12161C,#0C0F14)', grad: 'linear-gradient(135deg,#4F46E5,#7C3AED)' }
]);

const chatPrefs = scoped('chat');
const prefKey = id => `${id}`;
const getChatPref = (id) => chatPrefs.get(prefKey(id), { theme: 'default', nickname: '', muted: false });
const setChatPref = (id, patch) => chatPrefs.set(prefKey(id), { ...getChatPref(id), ...patch });

function sharedMedia() { return msgs.filter(m => m.media_type === 'image' || m.media_type === 'video'); }
function sharedFiles() { return msgs.filter(m => m.media_type === 'file'); }
function sharedVoice() { return msgs.filter(m => m.media_type === 'audio'); }
function sharedLinks() {
  const re = /https?:\/\/[^\s]+/g;
  return msgs.flatMap(m => (m.text?.match(re) || []).map(url => ({ ...m, _url: url })));
}

const sectionTitle = (label, extra = '') =>
  `<div class="tg-title">${esc(label)}${extra ? `<span class="tg-title-x">${extra}</span>` : ''}</div>`;

function applyChatTheme(id) {
  const th = chatThemes().find(t => t.id === id) || chatThemes()[0];
  const body = $('#threadBody');
  if (!body) return;
  body.style.background = th.id === 'default' ? '' : th.bg;
  body.style.setProperty('--bubble-grad', th.grad);
}

function renderInfoPanel() {
  const panel = $('#infoPanel');
  if (!panel || !peer) return;

  const pref   = getChatPref(peer.id);
  const media  = sharedMedia();
  const files  = sharedFiles();
  const links  = sharedLinks();
  const voice  = sharedVoice();

  panel.innerHTML = `
    <header class="info-head blur-bar">
      <button class="icon-btn" id="infoClose" aria-label="${esc(t('action.close'))}" data-tip="${esc(t('a11y.escape'))}">${I.close}</button>
      <span class="t-bold grow">Infos</span>
      <button class="icon-btn" id="infoMore" aria-label="${esc(t('action.more'))}">${I.moreH}</button>
    </header>

    <div class="info-scroll">

      <!-- hero -->
      <div class="tg-hero">
        <div class="av xl" style="background:${avatarColor(peer.id)}">${esc(initials(peer.full_name))}</div>
        <div class="tg-hero-name">${esc(pref.nickname || peer.full_name)}</div>
        ${pref.nickname ? `<div class="t-xs t-dim2">${esc(peer.full_name)}</div>` : ''}
        <div class="t-sm t-dim">${peer.online ? t('dm.online') : t('dm.offline')}</div>
        <div class="tg-actions">
          <button class="tg-action" id="aProfile" data-tip="Profil" aria-label="Profil">${I.user}</button>
          <button class="tg-action${pref.muted ? ' on' : ''}" id="aMute" data-tip="${pref.muted ? t('dm.unmuteShort') : t('dm.muteShort')}" aria-label="${pref.muted ? t('dm.unmuteShort') : t('dm.muteShort')}">${I.mute}</button>
          <button class="tg-action" id="aSearch" data-tip="${esc(t('action.search'))}" aria-label="${esc(t('action.search'))}">${I.search}</button>
          <button class="tg-action accent" id="aMessage" data-tip="Écrire" aria-label="Écrire">${I.message}</button>
        </div>
      </div>

      <!-- identity -->
      <section class="tg-sec">
        ${sectionTitle(t('dm.info'))}
        <div class="tg-row"><span class="tg-ic">${icon('user', { size: 16 })}</span>
          <div class="grow"><div class="t-sm handle">@${esc(peer.username || '')}</div>
          <div class="t-xs t-dim">Nom d'utilisateur</div></div>
          <button class="icon-btn sm" id="copyUser" data-tip="${esc(t('action.copy'))}" aria-label="${esc(t('action.copy'))}">${I.copy}</button>
        </div>
        ${peer.faculty ? `<div class="tg-row"><span class="tg-ic">${icon('graduation', { size: 16 })}</span>
          <div class="grow"><div class="t-sm">${esc(peer.faculty)}</div>
          <div class="t-xs t-dim">Faculté</div></div></div>` : ''}
        ${peer.bio ? `<div class="tg-row"><span class="tg-ic">${icon('help', { size: 16 })}</span>
          <div class="grow"><div class="t-sm">${esc(peer.bio)}</div>
          <div class="t-xs t-dim">Bio</div></div></div>` : ''}
      </section>

      <!-- nickname -->
      <section class="tg-sec">
        ${sectionTitle(t('dm.nickname'), t('dm.onlyYou'))}
        <input class="input" id="nickInput" placeholder="${esc(t('dm.nickPh'))}" value="${esc(pref.nickname || '')}">
      </section>

      <!-- themes -->
      <section class="tg-sec">
        ${sectionTitle(t('dm.chatTheme'))}
        <div class="tg-themes">
          ${chatThemes().map(t => `
            <button class="tg-theme${t.id === pref.theme ? ' on' : ''}" data-theme="${t.id}">
              <span class="tg-theme-chip" style="background:${t.bg}">
                <span class="tg-theme-bub" style="background:${t.grad}"></span>
              </span>
              <span class="t-xs">${t.label}</span>
            </button>`).join('')}
        </div>
      </section>

      <!-- shared media -->
      <section class="tg-sec">
        ${sectionTitle(`Médias partagés${media.length ? ' · ' + media.length : ''}`,
                       media.length > 6 ? '<button class="tg-all" id="allMedia">Tout voir</button>' : '')}
        ${media.length
          ? `<div class="info-grid">${media.slice(0, 6).map(m =>
              `<button class="info-tile" data-zoom="${esc(safeUrl(m.media_url))}">
                 <img src="${esc(safeUrl(m.media_url))}" alt="" loading="lazy">
                 ${m.media_type === 'video' ? `<span class="info-tile-play">${icon('play', { size: 15 })}</span>` : ''}
               </button>`).join('')}</div>`
          : `<div class="tg-empty">${icon('image', { size: 22 })}<span>${t('dm.noMedia')}</span></div>`}
      </section>

      <!-- files -->
      <section class="tg-sec">
        ${sectionTitle(`${t('dm.files')}${files.length ? ' · ' + files.length : ''}`)}
        ${files.length
          ? files.map(m => `<a class="tg-row" href="${esc(safeUrl(m.media_url))}" download>
              <span class="tg-ic">${icon('paperclip', { size: 16 })}</span>
              <div class="grow" style="min-width:0">
                <div class="t-sm truncate">${esc(m.media_name || t('dm.file'))}</div>
                <div class="t-xs t-dim">${timeAgo(m.created_at)}</div>
              </div>
              <span class="tg-ic">${icon('download', { size: 15 })}</span></a>`).join('')
          : `<div class="tg-empty">${icon('paperclip', { size: 22 })}<span>${t('dm.noFiles')}</span></div>`}
      </section>

      <!-- links -->
      <section class="tg-sec">
        ${sectionTitle(`Liens${links.length ? ' · ' + links.length : ''}`)}
        ${links.length
          ? links.map(m => `<a class="tg-row" href="${esc(safeUrl(m._url))}" target="_blank" rel="noopener noreferrer">
              <span class="tg-ic">${icon('link', { size: 16 })}</span>
              <div class="grow" style="min-width:0">
                <div class="t-sm truncate">${esc(m._url.replace(/^https?:\/\//, ''))}</div>
                <div class="t-xs t-dim">${timeAgo(m.created_at)}</div>
              </div></a>`).join('')
          : `<div class="tg-empty">${icon('link', { size: 22 })}<span>${t('dm.noLinks')}</span></div>`}
      </section>

      <!-- voice -->
      ${voice.length ? `<section class="tg-sec">
        ${sectionTitle(`Messages vocaux · ${voice.length}`)}
        ${voice.map(m => `<div class="tg-row">
            <span class="tg-ic">${icon('mic', { size: 16 })}</span>
            <div class="grow"><div class="t-sm">Message vocal</div>
            <div class="t-xs t-dim">${duration(m.media_duration || 0)} · ${timeAgo(m.created_at)}</div></div>
            <button class="icon-btn sm" aria-label="${esc(t('action.play'))}">${I.play}</button></div>`).join('')}
      </section>` : ''}

      <!-- settings, moved out of the header menu -->
      <section class="tg-sec">
        ${sectionTitle(t('dm.settings'))}
        <button class="tg-row tg-btn" id="optMute">
          <span class="tg-ic">${icon('mute', { size: 16 })}</span>
          <span class="grow t-sm" style="text-align:start">${pref.muted ? t('dm.unmuteNotif') : 'Couper les notifications'}</span>
          <span class="switch${pref.muted ? ' on' : ''}"></span>
        </button>
        <button class="tg-row tg-btn" id="optExport">
          <span class="tg-ic">${icon('download', { size: 16 })}</span>
          <span class="grow t-sm" style="text-align:start">Exporter la conversation</span>
        </button>
      </section>

      <!-- danger -->
      <section class="tg-sec tg-danger">
        <button class="tg-row tg-btn" id="optClear">
          <span class="tg-ic">${icon('eyeOff', { size: 16 })}</span>
          <span class="grow t-sm" style="text-align:start">Vider la conversation</span>
        </button>
        <button class="tg-row tg-btn" id="optDelete">
          <span class="tg-ic">${icon('trash', { size: 16 })}</span>
          <span class="grow t-sm" style="text-align:start">${t('dm.deleteConv')}</span>
        </button>
        <button class="tg-row tg-btn" id="optBlock">
          <span class="tg-ic">${icon('block', { size: 16 })}</span>
          <span class="grow t-sm" style="text-align:start">${esc(t('dm.blockUser', { name: peer.full_name }))}</span>
        </button>
        <button class="tg-row tg-btn" id="optReport">
          <span class="tg-ic">${icon('flag', { size: 16 })}</span>
          <span class="grow t-sm" style="text-align:start">${t('action.report')}</span>
        </button>
      </section>
    </div>`;

  wireInfoPanel(pref);
}

function wireInfoPanel(pref) {
  on($('#infoClose'), 'click', () => toggleInfo(false));
  on($('#aProfile'), 'click', () => location.hash = `#/profile/${peer.username}`);
  on($('#aMessage'), 'click', () => { toggleInfo(false); $('#composerInput')?.focus(); });
  on($('#aSearch'), 'click', () => openThreadSearch());

  const toggleMute = () => {
    const next = !getChatPref(peer.id).muted;
    setChatPref(peer.id, { muted: next });
    toast(next ? t('toast.notifMuted') : t('toast.notifUnmuted'), 'ok');
    renderInfoPanel();
    refreshHead();
  };
  on($('#aMute'), 'click', toggleMute);
  on($('#optMute'), 'click', toggleMute);

  on($('#copyUser'), 'click', async () => {
    const { copyText } = await import('../core/utils_sm.js');
    toast(await copyText('@' + peer.username) ? t('action.copied') : t('toast.copyFailed'), 'ok');
  });

  const nick = $('#nickInput');
  if (nick) {
    on(nick, 'change', () => {
      setChatPref(peer.id, { nickname: nick.value.trim() });
      renderInfoPanel();
      renderConvList();
      refreshHead();
    });
  }

  for (const btn of $$('.tg-theme')) {
    on(btn, 'click', () => {
      const id = btn.dataset.theme;
      setChatPref(peer.id, { theme: id });
      applyChatTheme(id);
      for (const b of $$('.tg-theme')) b.classList.toggle('on', b === btn);
    });
  }

  const grid = $('#infoPanel .info-grid');
  if (grid) on(grid, 'click', e => {
    const tile = e.target.closest('[data-zoom]');
    if (!tile) return;
    const all = sharedMedia().map(m => safeUrl(m.media_url));
    lightbox(all, all.indexOf(tile.dataset.zoom));
  });
  on($('#allMedia'), 'click', () => {
    const all = sharedMedia().map(m => safeUrl(m.media_url));
    if (all.length) lightbox(all, 0);
  });

  on($('#optExport'), 'click', exportThread);

  on($('#optClear'), 'click', async () => {
    if (!await confirmDialog({
      title: 'Vider la conversation ?',
      message: t('confirm.clearConv'),
      confirmLabel: 'Vider', danger: true
    })) return;
    try {
      await api.clearThread(peer.id);
      msgs = [];
      renderThread();
      renderConvList();
      toast(t('toast.convCleared'), 'ok');
    } catch { toast(t('toast.clearFailed'), 'err'); }
  });

  on($('#optDelete'), 'click', async () => {
    if (!await confirmDialog({
      title: t('dm.deleteConvQ'),
      message: `La conversation avec ${peer.full_name} sera supprimée définitivement.`,
      confirmLabel: t('action.delete'), danger: true
    })) return;
    toggleInfo(false);
    $('#dm')?.removeAttribute('data-open');
    toast(t('toast.convDeleted'), 'ok');
    renderConvList();
  });

  on($('#optBlock'), 'click', async () => {
    if (!await confirmDialog({
      title: t('dm.blockQ', { name: peer.full_name }),
      message: t('confirm.blockBody'),
      confirmLabel: t('action.block'), danger: true
    })) return;
    try {
      const { profileApi } = await import('../core/api_sm.js');
      await profileApi.block(peer.id);
      toast(t('toast.userBlocked'), 'ok');
    } catch { toast(t('toast.blockFailed'), 'err'); }
  });

  on($('#optReport'), 'click', async () => {
    try {
      const { profileApi } = await import('../core/api_sm.js');
      await profileApi.report('user', peer.id, t('report.fromChat'));
      toast(t('toast.reportSentAdmin'), 'ok');
    } catch { toast(t('toast.reportFailed'), 'err'); }
  });

  on($('#infoMore'), 'click', e => contextMenu(e, [
    { label: t('menu.viewProfile'), icon: I.user, onClick: () => location.hash = `#/profile/${peer.username}` },
    { label: 'Exporter',       icon: I.download, onClick: exportThread },
    { sep: true },
    { label: t('dm.deleteConvItem'), icon: I.trash, danger: true, onClick: () => $('#optDelete')?.click() }
  ]));
}


/* ------------------------------------------------------------
   SEARCH IN CONVERSATION
   ------------------------------------------------------------ */

function openThreadSearch() {
  const input = el('input', { class: 'input', placeholder: 'Rechercher dans la conversation…' });
  const results = el('div', { class: 'col g2', style: 'max-height:46vh;overflow:auto' });

  const run = debounce(async () => {
    const q = input.value.trim();
    if (!q) { results.innerHTML = `<div class="tg-empty">${icon('search',{size:22})}<span>Tapez pour chercher</span></div>`; return; }

    // Search the loaded thread first — instant — then ask the database
    // for anything older that is not in memory.
    const local = msgs.filter(m => (m.text || '').toLowerCase().includes(q.toLowerCase()));
    let rows = local;
    try {
      const remote = await api.searchInThread(peer.id, q);
      const seen = new Set(local.map(m => String(m.id)));
      rows = [...local, ...remote.filter(r => !seen.has(String(r.id)))];
    } catch { /* the local hits are still useful */ }

    results.innerHTML = rows.length
      ? rows.slice(0, 40).map(m => `
          <button class="tg-row" data-goto="${esc(m.id)}" style="text-align:start">
            <span class="tg-ic">${icon(m.sender_id === me.id ? 'send' : 'message', { size: 15 })}</span>
            <div class="grow" style="min-width:0">
              <div class="t-sm truncate">${highlight(m.text || mediaLabel(m.media_type), q)}</div>
              <div class="t-xs t-dim">${dayLabel(m.created_at)} · ${clockTime(m.created_at)}</div>
            </div>
          </button>`).join('')
      : `<div class="tg-empty">${icon('search',{size:22})}<span>Aucun résultat pour « ${esc(q)} »</span></div>`;
  }, 220);

  on(input, 'input', run);
  const m = modal({ title: t('action.search'), body: el('div', { class: 'col g3' }, input, results) });

  on(results, 'click', e => {
    const btn = e.target.closest('[data-goto]');
    if (!btn) return;
    m.close();
    jumpTo(btn.dataset.goto);
  });

  run();
  setTimeout(() => input.focus(), 80);
}

const highlight = (text, q) => {
  const t = esc(String(text || ''));
  if (!q) return t;
  const safe = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return t.replace(new RegExp(safe, 'ig'), hit => `<mark>${hit}</mark>`);
};

/* ------------------------------------------------------------
   EXPORT
   A plain text transcript, downloaded locally. No server involved,
   so nothing about a private conversation leaves the machine.
   ------------------------------------------------------------ */

function exportThread() {
  if (!msgs.length) { toast(t('toast.nothingExport')); return; }
  const mine = me.get();
  const lines = [
    `Conversation Koliya — ${mine?.full_name || 'moi'} et ${peer.full_name}`,
    `Exportée le ${new Date().toLocaleString('fr')}`,
    `${msgs.length} message${msgs.length > 1 ? 's' : ''}`,
    ''.padEnd(56, '-'),
    ''
  ];

  let lastDay = '';
  for (const m of msgs) {
    const day = dayLabel(m.created_at);
    if (day !== lastDay) { lines.push('', `— ${day} —`, ''); lastDay = day; }
    const who = m.sender_id === mine?.id ? (mine?.full_name || 'Moi') : peer.full_name;
    const what = m.media_type ? `[${mediaLabel(m.media_type)}]${m.text ? ' ' + m.text : ''}` : m.text;
    lines.push(`${clockTime(m.created_at)}  ${who}: ${what}`);
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `koliya-${peer.username || peer.id}.txt` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(t('toast.convExported'), 'ok');
}

/* ------------------------------------------------------------
   FORWARD
   ------------------------------------------------------------ */

async function forwardMessage(m) {
  const search = el('input', { class: 'input', placeholder: t('compose.toWhom') });
  const list = el('div', { class: 'col g2', style: 'max-height:44vh;overflow:auto' });
  let people = [];

  const draw = () => {
    list.innerHTML = people.length
      ? people.map(u => `
          <button class="tg-row" data-to="${esc(u.id)}" style="text-align:start">
            ${u.avatar_url
              ? `<span class="av sm"><img src="${esc(safeUrl(u.avatar_url))}" alt=""></span>`
              : `<span class="av sm" style="background:${avatarColor(u.id)}">${esc(initials(u.full_name))}</span>`}
            <div class="grow" style="min-width:0"><div class="t-sm t-bold truncate">${esc(u.full_name)}</div>
            <div class="t-xs t-dim handle">@${esc(u.username)}</div></div>
          </button>`).join('')
      : `<div class="tg-empty">${icon('user',{size:22})}<span>Personne trouvée</span></div>`;
  };

  const refresh = debounce(async () => {
    people = await api.contacts(search.value.trim()).catch(() => []);
    draw();
  }, 200);

  on(search, 'input', refresh);
  list.innerHTML = skeletonList(3, 'conv');
  const dlg = modal({ title: t('dm.forward'), body: el('div', { class: 'col g3' }, search, list) });

  on(list, 'click', async e => {
    const btn = e.target.closest('[data-to]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await api.sendMessage({
        receiver_id: btn.dataset.to,
        text: m.text || '',
        media_url: m.media_url && !m.media_url.startsWith('blob:') ? m.media_url : null,
        media_type: m.media_type || null,
        media_name: m.media_name || null
      });
      dlg.close();
      toast(t('toast.msgForwarded'), 'ok');
      renderConvList();
    } catch { btn.disabled = false; toast(t('toast.forwardFailed'), 'err'); }
  });

  refresh();
  setTimeout(() => search.focus(), 80);
}

/* ------------------------------------------------------------
   NEW CONVERSATION
   ------------------------------------------------------------ */

/* ------------------------------------------------------------
   NEW CONVERSATION
   The previous version loaded through a 200ms debounce and ended in
   `.catch(() => [])`, so a failed query and an empty campus looked
   identical: a skeleton that never resolved, or "Aucun étudiant"
   with no reason. It now loads immediately and reports what happened.
   ------------------------------------------------------------ */

function contactRow(u) {
  const tag = u.i_follow && u.follows_me ? 'Vous vous suivez'
            : u.i_follow               ? 'Vous le suivez'
            : u.follows_me             ? 'Vous suit'
            : u.is_private             ? t('profile.privateAccount') : '';
  return `<button class="tg-row contact-row" data-to="${esc(u.id)}" style="text-align:start">
      ${u.avatar_url
        ? `<span class="av sm"><img src="${esc(safeUrl(u.avatar_url))}" alt=""></span>`
        : `<span class="av sm" style="background:${avatarColor(u.id)}">${esc(initials(u.full_name))}</span>`}
      <div class="grow" style="min-width:0">
        <div class="row g2" style="flex-wrap:wrap">
          <span class="t-sm t-bold truncate">${esc(u.full_name)}</span>
          ${u.is_private ? `<span class="tg-ic" data-tip="${esc(t('profile.privateChip'))}">${icon('lock', { size: 12 })}</span>` : ''}
        </div>
        <div class="t-xs t-dim"><span class="handle">@${esc(u.username)}</span>${u.faculty ? ' · ' + esc(u.faculty) : ''}</div>
      </div>
      ${tag ? `<span class="pill" style="height:20px">${esc(tag)}</span>` : ''}
    </button>`;
}

export async function openNewConversation(prefill = '') {
  const search = el('input', { class: 'input', placeholder: 'Nom ou @pseudo…', value: prefill });
  const list = el('div', { class: 'col g2 contact-list' });

  const load = async q => {
    list.innerHTML = skeletonList(4, 'conv');
    try {
      const people = await api.contacts(q);
      if (!people.length) {
        list.innerHTML = `<div class="tg-empty">${icon('user', { size: 22 })}
          <span>${q ? `Aucun étudiant pour « ${esc(q)} »` : t('empty.noContacts')}</span></div>`;
        return;
      }
      list.innerHTML = people.map(contactRow).join('');
    } catch (err) {
      // Say what actually went wrong. Silence here is what made this
      // button look dead.
      list.innerHTML = `<div class="tg-empty failed">
          ${icon('close', { size: 22 })}
          <span>${esc(err?.status === 401
            ? t('error.session')
            : (errorText(err)))}</span>
          <button class="btn btn-outline btn-sm" id="contactRetry">Réessayer</button>
        </div>`;
      on($('#contactRetry'), 'click', () => load(search.value.trim()));
    }
  };

  const debounced = debounce(() => load(search.value.trim()), 220);
  on(search, 'input', debounced);

  const dlg = modal({
    title: t('dm.new'),
    body: el('div', { class: 'col g3' }, search, list)
  });

  on(list, 'click', e => {
    const btn = e.target.closest('[data-to]');
    if (!btn) return;
    dlg.close();
    openThread(btn.dataset.to);
  });

  await load(prefill);              // immediate, not debounced
  setTimeout(() => search.focus(), 80);
}

/**
 * Open a conversation with someone from anywhere in the app.
 *
 * If messages already exist the thread opens on them. If not, the
 * conversation is created in the UI immediately — an empty thread
 * with a composer ready — and the first message the student sends
 * is what actually writes the row. No empty database rows for
 * conversations that never happened.
 */
export async function openConversationWith(userId, hint = null) {
  if (!userId) return;
  if (hint) cachePeople([{ id: userId, ...hint }]);

  go('messages', userId);

  // If the route was already on /messages the router will not
  // re-run, so open the thread directly.
  await new Promise(r => setTimeout(r, 0));
  if ($('#dm')) await openThread(userId);
}

/** Backwards-compatible alias. */
export const messageUser = openConversationWith;

/** Redraw just the header after a nickname or mute change. */
function refreshHead() {
  if (!peer) return;
  const pref = getChatPref(peer.id);
  const nameNode = $('#threadHead .t-bold');
  if (nameNode) nameNode.textContent = pref.nickname || peer.full_name;
  const head = $('#threadHead');
  const existing = head?.querySelector('.head-muted');
  if (pref.muted && !existing && head) {
    head.insertAdjacentHTML('beforeend',
      `<span class="head-muted" data-tip="${esc(t('toast.notifMuted'))}">${icon('mute', { size: 15 })}</span>`);
  } else if (!pref.muted && existing) existing.remove();
}

/**
 * Release everything this screen holds: the poll timer, the
 * cross-tab channel and the open peer. Called when the route
 * changes, and available to tests so they can exit.
 */
export function teardownMessages() {
  stopPolling();
  peer = null;
  msgs = [];
  selectedId = null;
}

export function toggleInfo(force) {
  infoOpen = force === undefined ? !infoOpen : force;
  $('#dm')?.classList.toggle('info-open', infoOpen);
  $('#threadHead')?.classList.toggle('is-open', infoOpen);
  $('#threadHead')?.setAttribute('aria-expanded', String(infoOpen));
  if (infoOpen) renderInfoPanel();
}

/* ------------------------------------------------------------
   MESSAGE MENU  (right-click / ⋯)
   ------------------------------------------------------------ */

function msgMenu(e, m) {
  const mine = m.sender_id === me.id;
  contextMenu(e, [
    { title: t('action.message') },
    { label: t('action.reply'),  icon: I.reply,   kbd: 'R', onClick: () => startReply(m) },
    { label: t('menu.react'),    icon: I.smile,   onClick: () => openReactions(e.target, m) },
    { label: t('action.copy'),    icon: I.copy,    kbd: 'C', onClick: () => copyMsg(m) },
    { label: t('dm.forward'), icon: I.forward, onClick: () => forwardMessage(m) },
    mine ? { label: t('action.edit'), icon: I.edit, onClick: () => startEdit(m) } : null,
    { sep: true },
    mine
      ? { label: t('action.delete'), icon: I.trash, danger: true, onClick: () => removeMsg(m) }
      : { label: t('action.report'),  icon: I.flag,  danger: true, onClick: () => toast(t('toast.reportSent'), 'ok') }
  ]);
}

async function copyMsg(m) {
  const { copyText } = await import('../core/utils_sm.js');
  const okCopy = await copyText(m.text || m.media_url || '');
  toast(okCopy ? t('action.copied') : t('toast.copyFailed'), okCopy ? 'ok' : 'err');
}

async function removeMsg(m) {
  if (!await confirmDialog({
    title: t('confirm.deleteMsg'),
    message: t('confirm.deleteMsgBody'),
    confirmLabel: t('action.delete'), danger: true
  })) return;
  const keep = msgs;
  msgs = msgs.filter(x => x.id !== m.id);
  renderThread({ keepScroll: true });
  try {
    await api.deleteMessage(m.id);
    toast(t('toast.msgDeleted'), 'ok');
    renderConvList();
  } catch {
    msgs = keep;
    renderThread({ keepScroll: true });
    toast(t('toast.deleteFailed'), 'err');
  }
}

/* ------------------------------------------------------------
   REPLY & EDIT
   ------------------------------------------------------------ */

function startReply(m) {
  replyTo = m; editing = null;
  showContextBar(t('dm.replyTo'), m.text || mediaLabel(m.media_type), I.reply);
  $('#composerInput')?.focus();
}

function startEdit(m) {
  editing = m; replyTo = null;
  const input = $('#composerInput');
  if (input) { input.value = m.text || ''; input.focus(); autoGrow(input); syncSendState(); }
  showContextBar(t('dm.editing'), m.text || '', I.edit);
}

function showContextBar(label, text, ic) {
  const bar = $('#composerContext');
  if (!bar) return;
  bar.innerHTML = `
    <span class="ctx-icon">${ic}</span>
    <div class="grow" style="min-width:0">
      <div class="t-xs t-dim">${esc(label)}</div>
      <div class="t-sm truncate">${esc(text)}</div>
    </div>
    <button class="icon-btn sm" id="ctxCancel" aria-label="Annuler">${I.close}</button>`;
  bar.classList.remove('hidden');
  on($('#ctxCancel'), 'click', cancelContext);
}

function cancelContext() {
  replyTo = null;
  if (editing) {
    const input = $('#composerInput');
    if (input) { input.value = ''; autoGrow(input); syncSendState(); }
    editing = null;
  }
  $('#composerContext')?.classList.add('hidden');
}

/* ------------------------------------------------------------
   COMPOSER
   ------------------------------------------------------------ */

function autoGrow(input) {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 132) + 'px';
  publishComposerHeight();
}

/**
 * Publish the composer's real height as --composer-h.
 *
 * The info panel is an absolute overlay below 1400px and has to stop
 * where the composer starts. A hardcoded 64px would be wrong the
 * moment the textarea grows to a second line (it goes up to 132px), so
 * the actual measured height is written to the DM element and the CSS
 * reads it. Measured, not assumed.
 */
function publishComposerHeight() {
  const wrap = $('#composerWrap');
  const dm = $('.dm');
  if (!wrap || !dm) return;
  const h = wrap.classList.contains('hidden') ? 0 : Math.round(wrap.getBoundingClientRect().height);
  dm.style.setProperty('--composer-h', h + 'px');
}

/** Keep --composer-h honest even when the height changes for reasons
    other than typing: attachments, the request bar, a font swap. */
function watchComposerHeight() {
  const wrap = $('#composerWrap');
  if (!wrap || wrap.dataset.observed === '1') return;
  wrap.dataset.observed = '1';
  try {
    new ResizeObserver(publishComposerHeight).observe(wrap);
  } catch { /* no ResizeObserver: the initial measurement still applies */ }
  publishComposerHeight();
}

function syncSendState() {
  const input = $('#composerInput');
  const composer = $('#composer');
  if (!input || !composer) return;
  const hasText = input.value.trim().length > 0 || pendingFiles.length > 0;
  composer.dataset.hasText = String(hasText);
  // Send stays a send button and simply greys out when there is
  // nothing to send. One control, one meaning.
  const send = $('#btnSend');
  if (send) send.disabled = !hasText;
}

async function doSend() {
  const input = $('#composerInput');
  const text = input.value.trim();
  if (!text && !pendingFiles.length) return;

  if (editing) {
    const before = editing.text;
    const target = editing;
    target.text = text;
    editing = null;
    input.value = ''; autoGrow(input); syncSendState();
    cancelContext();
    renderThread({ keepScroll: true });
    try { await api.editMessage(target.id, text); }
    catch { target.text = before; renderThread({ keepScroll: true }); toast(t('toast.editFailed'), 'err'); }
    return;
  }

  const files = pendingFiles.splice(0);
  const replyId = replyTo?.id || null;

  input.value = ''; autoGrow(input); syncSendState();
  cancelContext();
  renderAttachStrip();
  draft.clear(peer.id);

  // Attachments go first, each as its own message, then the text.
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const isLast = i === files.length - 1;
    await sendOne({
      receiver_id: peer.id,
      text: isLast ? text : '',
      reply_to: i === 0 ? replyId : null,
      file: f,
      media_name: f.name
    }, f.type?.startsWith('image/') ? 'image' : 'file');
  }

  if (!files.length && text) {
    await sendOne({ receiver_id: peer.id, text, reply_to: replyId });
  }
}

/**
 * Paint a placeholder, write to Neon, then swap in the saved row.
 * The placeholder carries `_pending` so the bubble can show a clock
 * instead of a tick — and if the write fails it is removed with a
 * message, never left behind pretending to have been sent.
 */
async function sendOne(payload, mediaType = null) {
  const temp = {
    id: uid('tmp'),
    sender_id: me.id,
    receiver_id: payload.receiver_id,
    text: payload.text || '',
    reply_to: payload.reply_to || null,
    media_type: mediaType,
    media_url: payload.file && mediaType === 'image' ? URL.createObjectURL(payload.file) : null,
    media_name: payload.media_name || null,
    created_at: new Date().toISOString(),
    reactions: {},
    _pending: true
  };
  msgs.push(temp);
  renderThread();

  try {
    const saved = await sendMessage(payload);
    const i = msgs.findIndex(m => m.id === temp.id);
    if (i > -1) {
      if (temp.media_url?.startsWith('blob:')) URL.revokeObjectURL(temp.media_url);
      msgs[i] = { ...saved, reactions: saved.reactions || {} };
    }
    renderThread();
    renderConvList();
    announce('sent', payload.receiver_id);   // update my other tabs
    return saved;
  } catch (err) {
    msgs = msgs.filter(m => m.id !== temp.id);
    renderThread();
    toast(err?.message?.includes('trop lourd')
      ? err.message
      : t('toast.msgFailed'), 'err');
    return null;
  }
}

async function sendGif(gif) {
  await sendOne({
    receiver_id: peer.id, text: '',
    media_url: gif.url, media_type: 'image', media_name: gif.alt || 'GIF'
  }, 'image');
}

async function sendVoice(clip) {
  // The recording is stored in Postgres as a data: URL, same as any
  // other media. A blob: URL would have died on the next refresh —
  // that is exactly why voice notes "disappeared" before.
  await sendOne({
    receiver_id: peer.id, text: '',
    file: clip.blob,
    media_type: 'audio',
    media_name: 'vocal.webm',
    media_duration: clip.seconds,
    waveform: clip.waveform
  }, 'audio');
}

function wireComposer() {
  const input = $('#composerInput');
  const composer = $('#composer');
  if (!input) return;

  // IDEMPOTENT.
  // The composer markup is rendered once with the messages screen, but
  // openThread() calls this on EVERY thread you open, and accept-request
  // calls it again. addEventListener does not de-duplicate distinct
  // arrow functions, so the handlers stacked up: verified over CDP with
  // DOMDebugger.getEventListeners, #btnGif had 3 click listeners, two of
  // them this function's. Two handlers meant openGifPicker() ran twice
  // per click — the second call hit its own `if (panel) close()` toggle,
  // so the picker opened and shut in the same tick and the button looked
  // completely dead. Same latent double-fire on send, mic and emoji.
  if (composer?.dataset.wired === '1') {
    // still refresh the per-peer bits that legitimately change
    //
    // `peer` is NULL in a group chat — openGroupThread() sets it to null
    // on purpose, to stop the DM poller. wireGroupComposer() calls this
    // function to get the send button enabled, so on the SECOND group
    // chat opened in a session (the first sets wired='1') this line threw
    //     TypeError: Cannot read properties of null (reading 'id')
    // out of renderGroupHeader(), leaving the header half-drawn and the
    // composer unwired. A draft belongs to a conversation; a group has no
    // peer to key one by, so there is simply nothing to restore.
    if (peer) {
      const saved = draft.get(peer.id);
      input.value = saved || '';
    }
    autoGrow(input);
    syncSendState();
    return;
  }
  if (composer) composer.dataset.wired = '1';

  // restore an unfinished message
  //
  // peer is null in a GROUP chat (a channel or an event has no single
  // peer), and draft.get(null.id) threw, which left the send button
  // permanently disabled — nothing could be posted to a group at all.
  const saved = peer ? draft.get(peer.id) : null;
  if (saved) { input.value = saved; autoGrow(input); }
  syncSendState();

  on(input, 'input', () => {
    autoGrow(input);
    syncSendState();
    saveDraft();
    // No typing indicator in a group: there is no single peer to tell,
    // and peer.id threw here when a channel chat was open.
    if (peer) api?.setTyping?.(peer.id);
  });

  on(input, 'keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); return; }
    if (e.key === 'Escape') { cancelContext(); return; }
    // ArrowUp on an empty box edits your last message — a habit from
    // Slack and Discord that desktop users reach for instinctively.
    if (e.key === 'ArrowUp' && !input.value.trim()) {
      const last = [...msgs].reverse().find(m => m.sender_id === me.id && !m.media_type);
      if (last) { e.preventDefault(); startEdit(last); }
    }
  });

  // Ctrl+V of a screenshot — essential on the web, absent before
  on(input, 'paste', e => {
    const images = imagesFromPaste(e);
    if (!images.length) return;
    e.preventDefault();
    attachFiles(images);
  });

  on($('#btnSend'), 'click', doSend);

  on($('#btnMic'), 'click', () => startRecording($('#composerWrap'), {
    onSend: clip => sendVoice(clip),
    onCancel: () => {}
  }));

  // The "+" tray. On a phone GIF/file/emoji do not fit on the row, so
  // they are hidden until this is pressed — hidden, not removed: the
  // first attempt used display:none with no way to bring them back,
  // which is why sending a GIF was impossible in the APK.
  on($('#btnMore'), 'click', e => {
    const c = $('#composer');
    const open = c.classList.toggle('tools-open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });

  on($('#btnGif'), 'click', e => openGifPicker(e.currentTarget, gif => sendGif(gif)));
  on($('#btnPhoto'), 'click', () => $('#imgPick')?.click());
  on($('#btnFile'), 'click', () => $('#filePick')?.click());
  on($('#imgPick'), 'change', e => { attachFiles([...e.target.files]); e.target.value = ''; });
  on($('#filePick'), 'change', e => { attachFiles([...e.target.files]); e.target.value = ''; });
  on($('#btnEmoji'), 'click', e =>
    reactionPicker(e.currentTarget, { onPick: k => { if (k) { input.value += reactionLabel(k); input.focus(); syncSendState(); } } }));
}

const saveDraft = debounce(() => {
  const input = $('#composerInput');
  if (input && peer) draft.set(peer.id, input.value);
}, 400);

/* ------------------------------------------------------------
   ATTACHMENTS
   ------------------------------------------------------------ */

async function attachFiles(files) {
  // Images get one pass through the editor before they are queued.
  // Cropping and filtering after the fact is far more annoying.
  for (const f of files) {
    if (f.type?.startsWith('image/')) {
      const edited = await openImageEditor(f, 'dm');
      if (edited) pendingFiles.push(new File([edited], f.name || 'image.jpg', { type: 'image/jpeg' }));
      // a cancelled edit simply drops that file
    } else {
      pendingFiles.push(f);
    }
  }
  renderAttachStrip();
}

function renderAttachStrip() {
  const strip = $('#attachStrip');
  if (!strip) return;
  strip.classList.toggle('hidden', !pendingFiles.length);
  strip.innerHTML = pendingFiles.map((f, i) => `
    <div class="attach">
      ${f.type.startsWith('image/')
        ? `<img src="${URL.createObjectURL(f)}" alt="">`
        : `<div class="attach-file">${icon('paperclip', { size: 18 })}</div>`}
      <button class="attach-x" data-i="${i}" aria-label="Retirer">${I.close}</button>
    </div>`).join('');

  for (const btn of strip.querySelectorAll('.attach-x')) {
    on(btn, 'click', () => {
      pendingFiles.splice(Number(btn.dataset.i), 1);
      renderAttachStrip();
    });
  }
  syncSendState();
}

function wireDropZone() {
  const thread = $('#thread');
  if (!thread) return;
  let depth = 0;

  on(thread, 'dragenter', e => { e.preventDefault(); depth++; thread.classList.add('dragging'); });
  on(thread, 'dragover', e => e.preventDefault());
  on(thread, 'dragleave', () => { if (--depth <= 0) thread.classList.remove('dragging'); });
  on(thread, 'drop', e => {
    e.preventDefault(); depth = 0;
    thread.classList.remove('dragging');
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) attachFiles(files);
  });
}

/* ------------------------------------------------------------
   THREAD EVENTS
   ------------------------------------------------------------ */

function wireThreadEvents() {
  const body = $('#threadBody');
  if (!body) return;

  // TOUCH GESTURES.
  // A mouse already has the hover toolbar and the right-click menu for
  // these three actions; a finger has nothing. attachGestures() no-ops
  // on a fine pointer, so the desktop behaviour is untouched.
  detachThreadGestures?.();
  detachThreadGestures = attachGestures(body, '.bubble-row', {
    onHold: el => {
      const m = msgs.find(x => String(x.id) === String(el.dataset.id));
      if (m) openReactions(el.querySelector('.bubble') || el, m);
    },
    onSwipe: el => {
      const m = msgs.find(x => String(x.id) === String(el.dataset.id));
      if (m) startReply(m);
    },
    onDoubleTap: el => {
      const m = msgs.find(x => String(x.id) === String(el.dataset.id));
      if (m) applyReaction(m, m.reactions?.[me.id] === 'love' ? null : 'love');
    }
  });

  // Escape unwinds transient state first. The info panel is part of
  // the layout now rather than an overlay, so it is the last thing to
  // go — and only on narrow screens where it covers the thread.
  onEvent('key:escape', () => {
    if (selectedId) { clearSelection(); return; }
    if (replyTo || editing) { cancelContext(); return; }
    if (infoOpen && innerWidth < 1280) toggleInfo(false);
  });

  on(body, 'click', e => {
    // a click inside the toolbar or on interactive content must not
    // toggle the selection out from under the user
    const inTools = e.target.closest('.action-bar, .rx-chip, .reply-quote, [data-zoom], .voice, a, video');

    const chip = e.target.closest('.rx-chip');
    if (chip) {
      const m = msgs.find(x => x.id === chip.closest('.bubble-row').dataset.id);
      if (m) applyReaction(m, m.reactions?.[me.id] === chip.dataset.rx ? null : chip.dataset.rx);
      return;
    }
    const jump = e.target.closest('[data-jump]');
    if (jump) { jumpTo(jump.dataset.jump); return; }
    const zoom = e.target.closest('[data-zoom]');
    if (zoom) { lightbox([zoom.dataset.zoom]); return; }

    const row = e.target.closest('.bubble-row');
    if (row && !inTools) { selectMessage(row.dataset.id); return; }
    if (!row) clearSelection();
  });

  // show "scroll to bottom" only when it would actually help
  on(body, 'scroll', rafThrottle(() => {
    const near = nearBottom(body);
    atBottom = near;
    if (near && unseenBelow) showNewBelow(0);   // caught up
    else $('#toBottom')?.classList.toggle('show', !near);
  }), { passive: true });

  on($('#toBottom'), 'click', () => {
    scrollToBottom(true);
    showNewBelow(0);
    atBottom = true;
  });
}

function jumpTo(id) {
  const row = $(`#threadBody .bubble-row[data-id="${cssEscape(id)}"]`);
  if (!row) { toast(t('toast.msgNotFound')); return; }
  row.scrollIntoView({ block: 'center', behavior: env.reducedMotion ? 'auto' : 'smooth' });
  const bub = row.querySelector('.bubble');
  bub.classList.remove('flash');
  void bub.offsetWidth;        // restart the animation
  bub.classList.add('flash');
}

/* ------------------------------------------------------------
   OPEN A THREAD
   ------------------------------------------------------------ */

/* ============================================================
   GROUP CHATS — channels and events
   ============================================================
   One screen for both, reusing the thread markup. The differences are
   only in who may post and what the header says, so a separate screen
   would be the same code twice with two sets of bugs.

   Everything below trusts the DATABASE for permission:
   14_groups_sm.sql refuses an insert from a member of an admins-only
   channel, and refuses a read from a non-member. The UI hides what it
   can, but hiding is not enforcing.
   ============================================================ */

let group = null;        // { kind, id, info } while a group chat is open
let groupTimer = 0;

function stopGroupPoll() {
  if (groupTimer) clearInterval(groupTimer);
  groupTimer = 0;
}

export async function openGroupThread(kind, id) {
  peer = null;                       // not a person: stop the DM poller
  stopPolling();
  group = { kind, id, info: null };

  setState({ activeChat: `${kind}-${id}` });
  $('#dm')?.setAttribute('data-open', 'thread');
  for (const n of $$('.conv')) n.classList.remove('on');

  const body = $('#threadBody');
  if (body) body.innerHTML = skeletonList(4);

  let info = { role: 'none', canPost: false, kind };
  try {
    info = await api.groupInfo(kind === 'event' ? { eventId: id } : { channelId: id });
  } catch { /* fall through: no post box, and the list will show why */ }
  group.info = info;

  try {
    group.name = await api.groupName?.(kind, id) || '';
  } catch { group.name = ''; }

  renderGroupHeader();
  await renderGroupMessages();

  // Same cadence as a DM thread. A group is chattier, not slower.
  stopGroupPoll();
  groupTimer = setInterval(() => { if (!document.hidden) renderGroupMessages({ append: true }); }, 4000);
  groupTimer?.unref?.();
}

/* The chat's name, cached on the group object.
   NOT read out of campus_sm's arrays: those are module-private, and
   reaching into another screen's state means the title is wrong
   whenever that screen has not been visited yet. */
function groupTitle() {
  if (!group) return '';
  return group.name || t(group.kind === 'event' ? 'events.chat' : 'channels.chat');
}

function renderGroupHeader() {
  const head = $('#threadHead');
  if (!head || !group) return;
  const admin = group.info?.role === 'owner' || group.info?.role === 'admin';
  const manageKey = group.kind === 'event' ? 'events.manage' : 'channels.manage';

  head.innerHTML = `
    <button class="icon-btn thread-back" id="threadBack" aria-label="${esc(t('action.back'))}">${I.arrowLeft}</button>
    <div class="av sm" style="background:var(--brand)">${icon(group.kind === 'event' ? 'calendar' : 'hash', { size: 16 })}</div>
    <div class="grow" style="min-width:0">
      <div class="t-bold truncate">${esc(groupTitle())}</div>
      <div class="presence">${esc(t(group.kind === 'event' ? 'events.chatSub' : 'channels.chatSub'))}</div>
    </div>
    ${admin ? `<button class="icon-btn" id="grpAdmin" data-tip="${esc(t(manageKey))}"
                aria-label="${esc(t(manageKey))}">${icon('settings', { size: 16 })}</button>` : ''}`;

  on($('#threadBack'), 'click', () => { stopGroupPoll(); group = null; go('messages'); });
  if (admin) on($('#grpAdmin'), 'click', () => openGroupAdmin());

  // WHEN THE PERMISSION CHECK FAILED, SHOW THE COMPOSER.
  //
  // `ok:false` means the RPC did not answer — a 401 mid token-refresh,
  // a dropped request — NOT that posting is forbidden. The old code
  // could not tell those apart (`.catch(() => false)`) and so told the
  // OWNER of a public channel "Only moderators can post here" after the
  // tab had been sitting idle. Measured in Chrome: fail one
  // can_post_group call and the bar appears on a channel you own.
  //
  // If we genuinely cannot tell, let the student type and let the
  // DATABASE refuse — RLS is the real gate, and it does not guess.
  const mayPost = group.info?.ok === false ? true : !!group.info?.canPost;

  const wrap = $('#composerWrap');
  if (wrap) {
    wrap.classList.toggle('hidden', !mayPost);
    if (mayPost) wireGroupComposer();
  }
  $('#readOnlyBar')?.remove();
  if (!mayPost) {
    const thread = $('#thread');
    const bar = el('div', { class: 'request-bar', id: 'readOnlyBar' },
      el('div', { class: 'rb-text' },
        el('div', { class: 't-sm t-bold' }, t('channels.readOnly')),
        el('div', { class: 't-xs t-dim' }, t('channels.readOnlyWhy'))));
    // A way OUT of the read-only state for the person who can change
    // it. Before, an owner who somehow saw this bar had no recourse.
    if (group.info?.isOwner) {
      bar.append(el('button', { class: 'btn btn-outline btn-sm',
        onclick: () => openGroupAdmin() }, t(manageKey)));
    }
    thread?.append(bar);
  }
}

async function renderGroupMessages({ append = false } = {}) {
  if (!group) return;
  const body = $('#threadBody');
  if (!body) return;

  const target = group.kind === 'event' ? { eventId: group.id } : { channelId: group.id };
  let rows = [];
  try {
    rows = await api.groupMessages(target);
  } catch {
    body.innerHTML = '';
    body.append(emptyState({ icon: I.lock, title: t('channels.noAccess'), text: t('channels.noAccessWhy') }));
    return;
  }

  // The welcome row the trigger writes has no text; it exists only so
  // the chat is not an empty table.
  const real = rows.filter(r => (r.text || '').trim() || r.media_url);
  const sig = real.map(r => r.id).join(',');
  if (append && body.dataset.sig === sig) return;   // nothing new: do not repaint
  body.dataset.sig = sig;

  if (!real.length) {
    body.innerHTML = '';
    body.append(emptyState({ icon: I.message, title: t('channels.chatEmpty'), text: t('channels.chatEmptyWhy') }));
    return;
  }

  const stick = nearBottom(body);
  body.innerHTML = real.map(r => {
    const a = person(r.sender_id);
    const mine = String(r.sender_id) === String(me.id);
    return `<div class="bubble-row${mine ? ' me' : ''}">
      ${mine ? '' : `<span class="av xs" style="background:${avatarColor(a.id)}">${esc(initials(a.full_name))}</span>`}
      <div class="bubble${mine ? ' me' : ''}">
        ${mine ? '' : `<div class="t-xs t-bold" style="color:var(--brand-on-tint)">${esc(a.full_name)}</div>`}
        ${r.media_url ? `<div class="media"><img src="${esc(safeUrl(r.media_url))}" alt=""></div>` : ''}
        ${r.text ? `<div>${richText(r.text)}</div>` : ''}
        <span class="bubble-time">${timeAgo(r.created_at)}</span>
      </div>
    </div>`;
  }).join('');
  if (stick) scrollToBottom(true);
}

let groupComposerWired = false;
function wireGroupComposer() {
  // Reuse the DM composer's own wiring first: it owns the auto-grow,
  // the character state and — the part that mattered — enabling the
  // send button when there is text. Without this the button stayed
  // disabled and nothing could be sent to a group at all. It is
  // idempotent by design, so calling it here is free.
  wireComposer();

  if (groupComposerWired) return;
  const btn = $('#btnSend');
  const input = $('#composerInput');
  if (!btn || !input) return;
  groupComposerWired = true;

  const sendGroup = async e => {
    // Only while a group chat is open. The DM composer owns these same
    // elements, so without this guard a normal message would be sent
    // twice — once by each handler.
    if (!group) return;
    e.preventDefault();
    e.stopImmediatePropagation();

    const text = (input.value || '').trim();
    if (!text) return;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));   // resets the send button

    const target = group.kind === 'event' ? { eventId: group.id } : { channelId: group.id };
    try {
      await api.sendGroupMessage(target, { text });
      await renderGroupMessages();
    } catch (err) {
      input.value = text;                 // never lose what they typed
      toast(errorText(err), 'err');
    }
  };

  // Capture phase so this runs BEFORE the DM handler and can stop it.
  btn.addEventListener('click', sendGroup, true);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) sendGroup(e);
  }, true);
}

/* ------------------------------------------------------------
   CHANNEL ADMIN — the Telegram-style controls.
   Owner and admins only; the buttons are hidden otherwise AND the
   database refuses the calls, so hiding is convenience, not security.
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   GROUP SETTINGS PANEL

   Rewritten. The old one:
     * worked for CHANNELS ONLY — an event organiser had no panel at
       all, so there was no way to appoint anybody to an event
     * called api.channelMembers / setChannelRole directly, which do
       not exist for events
     * was a flat wall of rows with no sections and no explanation of
       what "admins only" actually does
     * had a private checkbox that never showed its CURRENT value: it
       rendered unchecked every time, so opening the panel on a private
       channel and pressing Save quietly made it public

   Now one panel for both, in sections, with the live state filled in.
   ------------------------------------------------------------ */
async function openGroupAdmin() {
  if (!group) return;
  const target = group.kind === 'event'
    ? { eventId: group.id } : { channelId: group.id };

  const box = el('div', { class: 'gs' });
  box.innerHTML = skeletonList(3, 'conv');
  // "Manage channel" on an EVENT — caught by looking at the screenshot,
  // not by a test. The panel is shared; the wording must not be.
  const m = modal({
    title: t(group.kind === 'event' ? 'events.manage' : 'channels.manage'),
    body: box
  });

  let members = [], requests = [];
  const load = async () => {
    [members, requests] = await Promise.all([
      api.groupMembers(target).catch(() => []),
      group.kind === 'channel'
        ? api.channelRequests(group.id).catch(() => [])
        : Promise.resolve([])
    ]);
  };

  try { await load(); }
  catch (err) {
    box.innerHTML = '';
    box.append(emptyState({ icon: I.inbox, title: t('error.loading'), text: errorText(err) }));
    return;
  }

  const isOwner = !!group.info?.isOwner || group.info?.role === 'owner';

  const draw = () => {
    const policy  = group.info?.postPolicy || 'all';
    const priv    = !!group.info?.isPrivate;
    const admins  = members.filter(x => x.role === 'owner' || x.role === 'admin').length;

    box.innerHTML = `
      <div class="gs-head">
        <div class="gs-icon">${icon(group.kind === 'event' ? 'calendar' : 'hash', { size: 20 })}</div>
        <div style="min-width:0">
          <div class="t-bold truncate">${esc(groupTitle())}</div>
          <div class="t-xs t-dim">${esc(t('channels.memberList'))} ${members.length} ·
            ${esc(t('channels.modCount', { n: admins }))}</div>
        </div>
      </div>

      ${isOwner ? `
      <section class="gs-sec">
        <div class="gs-sec-t">${esc(t('channels.whoCanPost'))}</div>
        <div class="gs-opts" id="policySeg">
          <button class="gs-opt${policy === 'all' ? ' on' : ''}" data-policy="all">
            <span class="gs-opt-i">${icon('users', { size: 16 })}</span>
            <span class="grow">
              <span class="gs-opt-t">${esc(t('channels.everyone'))}</span>
              <span class="gs-opt-d">${esc(t('channels.everyoneWhy'))}</span>
            </span>
            <span class="gs-tick">${I.check}</span>
          </button>
          <button class="gs-opt${policy === 'admins' ? ' on' : ''}" data-policy="admins">
            <span class="gs-opt-i">${icon('shield', { size: 16 })}</span>
            <span class="grow">
              <span class="gs-opt-t">${esc(t('group.modsOnly'))}</span>
              <span class="gs-opt-d">${esc(t('channels.adminsOnlyWhy'))}</span>
            </span>
            <span class="gs-tick">${I.check}</span>
          </button>
        </div>
      </section>

      ${group.kind === 'channel' ? `
      <section class="gs-sec">
        <div class="gs-sec-t">${esc(t('channels.access'))}</div>
        <label class="gs-row" for="chPrivate">
          <span class="gs-opt-i">${icon('lock', { size: 16 })}</span>
          <span class="grow">
            <span class="gs-opt-t">${esc(t('channels.private'))}</span>
            <span class="gs-opt-d">${esc(t('channels.privateWhy'))}</span>
          </span>
          <span class="switch${priv ? ' on' : ''}" id="chPrivate" role="switch"
                tabindex="0" aria-checked="${priv}"></span>
        </label>
      </section>` : ''}` : ''}

      ${requests.length ? `
      <section class="gs-sec">
        <div class="gs-sec-t">${esc(t('channels.requests'))} · ${requests.length}</div>
        ${requests.map(r => `<div class="gs-person">
          <span class="av sm" style="background:${avatarColor(r.id)}">${esc(initials(r.full_name))}</span>
          <div class="grow" style="min-width:0">
            <div class="t-sm t-bold truncate">${esc(r.full_name)}</div>
          </div>
          <button class="btn btn-primary btn-sm" data-accept="${esc(r.id)}">${esc(t('dm.accept'))}</button>
          <button class="btn btn-ghost btn-sm" data-decline="${esc(r.id)}">${esc(t('dm.decline'))}</button>
        </div>`).join('')}
      </section>` : ''}

      <section class="gs-sec">
        <div class="gs-sec-t">${esc(t('channels.memberList'))} · ${members.length}</div>
        <div class="gs-people">
          ${members.map(u => `<div class="gs-person">
            ${u.avatar_url
              ? `<span class="av sm"><img src="${esc(safeUrl(u.avatar_url))}" alt=""></span>`
              : `<span class="av sm" style="background:${avatarColor(u.id)}">${esc(initials(u.full_name))}</span>`}
            <div class="grow" style="min-width:0">
              <div class="t-sm t-bold truncate">${esc(u.full_name)}</div>
              <div class="t-xs t-dim truncate">
                <span class="gs-rank ${esc(u.role)}">${esc(t('channels.role.' + u.role))}</span>
                ${u.username ? ' · @' + esc(u.username) : ''}
              </div>
            </div>
            ${isOwner && u.role !== 'owner'
              ? `<button class="btn ${u.role === 'admin' ? 'btn-ghost' : 'btn-outline'} btn-sm"
                         data-role="${esc(u.id)}" data-next="${u.role === 'admin' ? 'member' : 'admin'}">
                   ${esc(t(u.role === 'admin' ? 'group.demote' : 'group.promote'))}</button>`
              : ''}
          </div>`).join('')}
        </div>
        ${isOwner ? `<div class="set-hint">${esc(t('channels.promoteWhy'))}</div>` : ''}
      </section>`;
  };
  draw();

  /* Re-read permissions and repaint the thread: changing the policy can
     take away my own composer, and the header must agree with the DB. */
  const refresh = async () => {
    group.info = await api.groupInfo(target);
    await load();
    renderGroupHeader();
    draw();
  };

  on(box, 'click', async e => {
    const pol = e.target.closest('[data-policy]');
    if (pol) {
      const want = pol.dataset.policy;
      const before = group.info?.postPolicy;
      if (want === before) return;
      try {
        await api.setGroupPolicy(target, want);
        await refresh();
        toast(t('toast.saved'), 'ok');
      } catch (err) { toast(errorText(err), 'err'); }
      return;
    }

    const acc = e.target.closest('[data-accept]');
    const dec = e.target.closest('[data-decline]');
    if (acc || dec) {
      const id = (acc || dec).dataset.accept || dec.dataset.decline;
      try {
        await api.respondChannelRequest(group.id, id, !!acc);
        requests = requests.filter(r => String(r.id) !== String(id));
        if (acc) members = await api.groupMembers(target);
        draw();
      } catch (err) { toast(errorText(err), 'err'); }
      return;
    }

    const rl = e.target.closest('[data-role]');
    if (rl) {
      rl.disabled = true;
      try {
        const ok = await api.setGroupRole(target, rl.dataset.role, rl.dataset.next);
        // The RPC returns false when the database refuses — reporting
        // success on a `false` would be a lie the UI tells itself.
        if ((Array.isArray(ok) ? ok[0] : ok) === false) {
          toast(t('channels.roleRefused'), 'err');
        } else {
          toast(rl.dataset.next === 'admin'
            ? t('channels.promoted') : t('channels.demoted'), 'ok');
        }
        members = await api.groupMembers(target);
        draw();
      } catch (err) { rl.disabled = false; toast(errorText(err), 'err'); }
    }
  });

  const priv = box.querySelector('#chPrivate');
  if (priv) on(priv, 'click', async () => {
    const next = !priv.classList.contains('on');
    priv.classList.toggle('on', next);
    priv.setAttribute('aria-checked', String(next));
    try {
      await api.updateChannelSettings(group.id, { isPrivate: next });
      if (group.info) group.info.isPrivate = next;
      toast(t('toast.saved'), 'ok');
    } catch (err) {
      priv.classList.toggle('on', !next);
      priv.setAttribute('aria-checked', String(!next));
      toast(errorText(err), 'err');
    }
  });
}

export async function openThread(peerId, { asRequest = false } = {}) {
  // Leaving a group chat for a person: stop the group poller, or two
  // pollers write into the same #threadBody.
  stopGroupPoll();
  group = null;

  // A peer with no history yet is legitimate — it is exactly what
  // "start a conversation" means. person() falls back to the cache
  // that openConversationWith() just seeded, so the header shows a
  // real name rather than "Étudiant".
  peer = convs.find(c => String(c.peer.id) === String(peerId))?.peer || person(peerId);
  const isNewConversation = !convs.some(c => String(c.peer.id) === String(peerId));

  setState({ activeChat: peerId });
  $('#dm')?.setAttribute('data-open', 'thread');

  for (const n of $$('.conv')) n.classList.toggle('on', n.dataset.peer === peerId);

  const head = $('#threadHead');
  if (head) {
    const pref = getChatPref(peer.id);
    head.innerHTML = `
      <button class="icon-btn thread-back" id="threadBack" aria-label="${esc(t('action.back'))}">${I.arrowLeft}</button>
      <div class="av sm" style="background:${avatarColor(peer.id)}" data-online="${!!peer.online}">${esc(initials(peer.full_name))}</div>
      <div class="grow" style="min-width:0">
        <div class="t-bold truncate">${esc(pref.nickname || peer.full_name)}</div>
        <div class="presence">${peer.online ? t('dm.online') : t('dm.offline')}</div>
      </div>
      ${pref.muted ? `<span class="head-muted" data-tip="${esc(t('toast.notifMuted'))}">${icon('mute', { size: 15 })}</span>` : ''}`;

    // The whole header bar is the target, exactly like Telegram:
    // click anywhere on it to open the conversation info.
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.setAttribute('aria-label', t('dm.infoAria'));
    head.classList.add('is-clickable');

    on(head, 'click', e => {
      if (e.target.closest('#threadBack')) return;   // back arrow keeps its own job
      toggleInfo();
    });
    on(head, 'keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleInfo(); }
    });
    on($('#threadBack'), 'click', e => { e.stopPropagation(); $('#dm')?.removeAttribute('data-open'); });
  }

  clearSelection();
  $('#threadBody').innerHTML = skeletonList(4);
  try {
    msgs = await loadThread(peerId);
  } catch (err) {
    msgs = [];
    $('#threadBody').innerHTML = '';
    $('#threadBody').append(emptyState({
      icon: I.message, title: 'Conversation indisponible',
      text: errorText(err),
      action: { label: t('action.retry'), onClick: () => openThread(peerId) }
    }));
    return;
  }
  renderThread();
  applyChatTheme(getChatPref(peerId).theme);

  // Show the new conversation in the list right away, so it does not
  // look like the click did nothing.
  if (isNewConversation && peer?.id) {
    convs = [{ peer, last: null, unread: 0 }, ...convs];
    paintConvList();
  }

  // Land on the newest message immediately. Animating through 200
  // messages is motion for its own sake — you want to see the end.
  atBottom = true;
  unseenBelow = 0;
  scrollToBottom(false);

  // The panel is part of the conversation view, not a thing you hunt
  // for in a menu — it opens with the thread on wide screens.
  // 1400, not 1280. layout_sm.css only gives the info panel its own
  // grid column at >=1400px; below that it is an ABSOLUTE overlay.
  // Auto-opening it at 1280 therefore covered the conversation — and,
  // measured in Chrome at 1360px, 46% of the composer including the
  // Send button. Auto-open only where there is a real column for it.
  if (innerWidth >= 1400) toggleInfo(true);
  else if (infoOpen) renderInfoPanel();

  // A request is readable but not repliable until it is accepted:
  // replying IS accepting, and that decision should be explicit.
  const pending = asRequest || requests.some(r => String(r.peer.id) === String(peerId));
  if (pending) {
    $('#composerWrap')?.classList.add('hidden');
    showRequestBar(peerId);
  } else {
    $('#requestBar')?.remove();
    $('#composerWrap')?.classList.remove('hidden');
    wireComposer();
  }
  watchComposerHeight();
  startPolling();
}

/** The accept / decline strip shown in place of the composer. */
function showRequestBar(peerId) {
  $('#requestBar')?.remove();
  const thread = $('#thread');
  if (!thread) return;
  const who = person(peerId);

  const bar = el('div', { class: 'request-bar', id: 'requestBar' });
  bar.innerHTML = `
    <div class="rb-text">
      <div class="t-sm t-bold">${esc(t('dm.wantsToMessage', { name: who.full_name }))}</div>
      <div class="t-xs t-dim">${esc(t('dm.acceptToReply'))}</div>
    </div>
    <div class="rb-actions">
      <button class="btn btn-outline btn-sm" id="rbDecline">${esc(t('dm.decline'))}</button>
      <button class="btn btn-primary btn-sm" id="rbAccept">${esc(t('dm.accept'))}</button>
    </div>`;
  thread.append(bar);

  on($('#rbAccept'), 'click', async () => {
    try {
      await api.acceptRequest(peerId);
      requests = requests.filter(r => String(r.peer.id) !== String(peerId));
      bar.remove();
      $('#composerWrap')?.classList.remove('hidden');
      wireComposer();
      toast(t('dm.accepted', { name: who.full_name }), 'ok');
      renderConvList();
    } catch { toast(t('toast.actionFailed'), 'err'); }
  });

  on($('#rbDecline'), 'click', async () => {
    try {
      await api.declineRequest(peerId);
      requests = requests.filter(r => String(r.peer.id) !== String(peerId));
      toast(t('dm.declined'), { duration: 2200 });
      $('#dm')?.removeAttribute('data-open');
      renderConvList();
    } catch { toast(t('toast.actionFailed'), 'err'); }
  });
}

/* ------------------------------------------------------------
   VIEW
   ------------------------------------------------------------ */

function markup() {
  return `
  <div class="dm" id="dm">
    <section class="dm-list">
      <div class="dm-list-head row g2">
        <div class="grow" style="position:relative">
          <span class="input-icon">${icon('search', { size: 16 })}</span>
          <input class="input has-icon" id="convSearch" placeholder="${esc(t('dm.search'))}" aria-label="${esc(t('dm.searchConv'))}">
        </div>
        <button class="icon-btn" id="btnNewConv" data-tip="${esc(t('dm.new'))}" aria-label="${esc(t('dm.new'))}">${I.plus}</button>
      </div>
      <div class="dm-list-scroll" id="convScroll"></div>
    </section>

    <section class="thread" id="thread">
      <div class="drop-zone">${icon('image', { size: 28 })} Déposez pour envoyer</div>
      <header class="thread-head blur-bar" id="threadHead"></header>
      <div class="thread-body" id="threadBody"></div>
      <button class="to-bottom" id="toBottom" aria-label="Aller en bas">${I.arrowDown}</button>

      <div id="composerWrap" class="hidden">
        <div class="composer-context hidden" id="composerContext"></div>
        <div class="attach-strip hidden" id="attachStrip"></div>
        <div class="composer" id="composer" data-has-text="false">
          <button class="icon-btn" id="btnPhoto" data-tip="${esc(t('feed.photo'))}" aria-label="${esc(t('feed.photo'))}">${I.image}</button>
          <button class="icon-btn" id="btnMore" data-tip="${esc(t('dm.moreTools'))}"
                  aria-label="${esc(t('dm.moreTools'))}" aria-expanded="false">${I.plus}</button>
          <button class="icon-btn" id="btnGif" data-tip="GIF" aria-label="GIF">${I.gif}</button>
          <button class="icon-btn" id="btnFile" data-tip="${esc(t('dm.file'))}" aria-label="${esc(t('dm.file'))}">${I.paperclip}</button>
          <button class="icon-btn" id="btnEmoji" data-tip="Emoji" aria-label="Emoji">${I.smile}</button>
          <input type="file" id="filePick" hidden multiple>
          <input type="file" id="imgPick" hidden multiple accept="image/*">
          <textarea class="composer-input" id="composerInput" rows="1"
                    placeholder="${esc(t('dm.placeholder'))}" aria-label="${esc(t('dm.placeholder'))}"></textarea>
          <button class="icon-btn" id="btnMic" data-tip="${esc(t('dm.voice'))}" aria-label="${esc(t('dm.voice'))}">${I.mic}</button>
          <button class="icon-btn send-btn" id="btnSend" data-tip="${esc(t('action.send'))}" aria-label="${esc(t('action.send'))}" disabled>${I.send}</button>
        </div>
      </div>
    </section>

    <aside class="info-panel" id="infoPanel" aria-label="${esc(t('dm.infoAria'))}"></aside>
  </div>`;
}

export function initMessages(mountFn) {

  // THE LIST NOW REPAINTS BY ITSELF.
  //
  // Before, renderConvList() only ran from inside this route handler and
  // from beat() — and beat() bails out when no thread is open. So a
  // message that arrived while you sat on the conversation list did not
  // show up until you navigated away and came back.
  //
  // core/inbox_sm.js polls every 5s on EVERY route and emits this when
  // anything changed. Guarded by the element check, so it costs nothing
  // when Messages is not on screen.
  onEvent('inbox:changed', () => {
    if ($('#convScroll')) renderConvList({ quiet: true });
  });

  route('messages', async (arg) => {
    const host = mountFn();
    if (!host) return;
    host.closest('.view')?.classList.add('full');
    host.innerHTML = markup();

    wireThreadEvents();
    wireDropZone();

    on($('#btnNewConv'), 'click', openNewConversation);

    on($('#convSearch'), 'input', debounce(e => {
      const q = e.target.value.trim().toLowerCase();
      for (const n of $$('.conv')) {
        const name = n.querySelector('.conv-name')?.textContent.toLowerCase() || '';
        n.style.display = !q || name.includes(q) ? '' : 'none';
      }
    }, 160));

    await renderConvList();

    // OPEN A CONVERSATION IMMEDIATELY.
    // Before this, landing on /messages rendered the shell and
    // stopped — an empty grey panel until you happened to click a
    // row. No messaging app does that. Pick, in order: the one asked
    // for in the URL, the one you had open last, then the most
    // recent conversation.
    // WHAT CLICKING "Messages" DOES
    //
    // Instagram: the nav takes you to the LIST. On a wide screen the
    // list and the open thread live side by side, so the thread stays
    // put; on a narrow one the list is the whole screen and the
    // thread is a level deeper.
    //
    // With no argument we still open the most relevant conversation
    // on a wide screen — an empty right-hand pane is dead space —
    // but never on a narrow one, where it would hide the list you
    // just asked for.
    // Measure the PANEL, not the window: in a split screen the window
    // may be narrow while this panel is wide, or the reverse.
    //
    // `clientWidth` is 0 before the first layout pass (and always in
    // jsdom), and `0 || innerWidth` would silently fall back to the
    // window — taking the wide path on a phone. Treat an unmeasurable
    // panel as narrow: showing the list is always safe, opening a
    // thread over it is not.
    const measured = $('#dm')?.clientWidth ?? 0;
    const panelWide = measured > 720;

    if (arg) {
      // `event-12` / `channel-7` open a GROUP chat; anything else is a
      // person. One route and one screen for all three, because they
      // are the same screen — a second messages page would drift.
      const g = /^(event|channel)-(.+)$/.exec(arg);
      if (g) { await openGroupThread(g[1], g[2]); return; }
      await openThread(arg);
      return;
    }

    $('#dm')?.removeAttribute('data-open');     // show the list

    if (!panelWide) { showPickAConversation(); return; }

    const wanted =
      (convs.some(c => String(c.peer.id) === String(state.activeChat)) ? state.activeChat : null)
      || convs[0]?.peer?.id;

    if (wanted) await openThread(wanted);
    else showNoConversations();
  });

  // Leaving the screen must stop the poll; a chat that keeps querying
  // Neon from a route you closed is a bill, not a feature.
  onEvent('route:enter', ({ route: r } = {}) => {
    if (r !== 'messages') teardownMessages();
  });
  on(document, 'visibilitychange', retune);
}

/* koliya-patch-applied: V16_SECTION_STATE */

/* koliya-patch-applied: V16_CUSTOM_FOLDERS */

/* koliya-patch-applied: V16_SECTION_BAR */

/* koliya-patch-applied: V16_ADD_FOLDER_BTN */

/* koliya-patch-applied: V16_WIRE_SECTIONS */

/* koliya-patch-applied: V16_PAINT_GROUPS */

/* koliya-patch-applied: V16_LOAD_GROUPS */

/* koliya-patch-applied: V16_FOLDERS_UNDEFINED */
