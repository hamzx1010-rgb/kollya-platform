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
  onVisible, env, uid, safeUrl, cssEscape
} from '../core/utils_sm.js';
import { state, setState, me, draft, scoped, on as onEvent, emit } from '../core/store_sm.js';
import { person, cachePeople } from '../core/people_sm.js';
import { I, icon, reactionIcon, reactionLabel, REACTION_KEYS } from '../core/icons_sm.js';
import {
  toast, contextMenu, reactionPicker, actionBar, lightbox,
  confirmDialog, skeletonList, emptyState, optimistic, closeMenu
} from '../core/ui_sm.js';
import { route } from '../core/router_sm.js';
import { openGifPicker, closeGifPicker } from './gif_sm.js';
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

/* Injected by db_sm.js once the keys arrive. Until then the screen
   runs on sample data so the interaction can be built and reviewed. */
let api = null;
export function useApi(impl) { api = impl; }

/* ------------------------------------------------------------
   DATA ACCESS  — every call goes to Neon, nothing is invented here
   ------------------------------------------------------------ */

let pollTimer = 0;

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
  if (!api?.sendMessage) throw new Error('Base de données non connectée');
  return api.sendMessage(payload);
}

async function persistReaction(msgId, key) {
  if (!api?.react) throw new Error('Base de données non connectée');
  return api.react(msgId, key);
}

/**
 * Neon has no realtime channel, so the open conversation is polled.
 * Slower when the tab is hidden, stopped when it is closed — a chat
 * app that keeps hammering a database in a background tab is how you
 * burn a free tier in a week.
 */
function startPolling() {
  stopPolling();
  const beat = async () => {
    if (document.hidden || !peer || !api?.listMessages) return;
    try {
      const fresh = await api.listMessages(peer.id);
      // only repaint when something actually changed
      const changed = fresh.length !== msgs.length ||
        fresh.some((m, i) => String(m.id) !== String(msgs[i]?.id) || m.seen_at !== msgs[i]?.seen_at);
      if (changed) {
        const stick = atBottom;
        msgs = fresh;
        renderThread({ keepScroll: !stick });
      }
      const typing = await api.isTyping?.(peer.id);
      showTyping(!!typing);
    } catch { /* a failed poll is not worth a toast */ }
  };
  pollTimer = setInterval(beat, document.hidden ? 20000 : 5000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = 0;
}

function showTyping(on) {
  const body = $('#threadBody');
  if (!body) return;
  let node = $('#typingRow');
  if (on && !node) {
    body.insertAdjacentHTML('beforeend',
      `<div class="bubble-row" id="typingRow"><div class="av sm" style="background:${avatarColor(peer.id)}">${esc(initials(peer.full_name))}</div>
       <div class="typing"><i></i><i></i><i></i></div></div>`);
    if (atBottom) scrollToBottom(false);
  } else if (!on && node) node.remove();
}

/* ------------------------------------------------------------
   CONVERSATION LIST
   ------------------------------------------------------------ */

function convRow(c) {
  const p = c.peer;
  const isOpen = peer?.id === p.id;
  const last = c.last;
  const preview = last
    ? (last.sender_id === me.id ? 'Vous : ' : '') +
      (last.media_type ? mediaLabel(last.media_type) : last.text)
    : 'Nouvelle conversation';

  const node = el('button', {
    class: 'conv' + (isOpen ? ' on' : '') + (c.unread ? ' unread' : ''),
    'data-peer': p.id,
    onclick: () => openThread(p.id)
  });

  const av = p.avatar_url
    ? el('div', { class: 'av', 'data-online': String(!!isOnline(p)),
                  html: `<img src="${esc(safeUrl(p.avatar_url))}" alt="">` })
    : el('div', { class: 'av', 'data-online': String(!!isOnline(p)),
                  style: { background: avatarColor(p.id) } }, initials(p.full_name));

  node.append(av, el('div', { class: 'conv-body' },
    el('div', { class: 'conv-top' },
      el('span', { class: 'conv-name truncate' }, p.full_name),
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

const mediaLabel = t => ({
  image: 'Photo', video: 'Vidéo', audio: 'Message vocal', file: 'Fichier'
}[t] || 'Pièce jointe');

async function renderConvList() {
  const box = $('#convScroll');
  if (!box) return;
  box.innerHTML = skeletonList(5, 'conv');
  try {
    convs = await loadConversations();
  } catch (err) {
    box.innerHTML = '';
    box.append(emptyState({
      icon: I.message,
      title: 'Chargement impossible',
      text: err?.status === 401 ? 'Session expirée — reconnectez-vous.' : (err?.message || ''),
      action: { label: 'Réessayer', onClick: () => renderConvList() }
    }));
    return;
  }

  if (!convs.length) {
    box.innerHTML = '';
    box.append(emptyState({
      icon: I.message,
      title: 'Aucune conversation',
      text: 'Commencez à discuter avec les étudiants de votre faculté.',
      action: { label: 'Nouveau message', onClick: openNewConversation }
    }));
    return;
  }
  box.innerHTML = '';
  const frag = document.createDocumentFragment();
  convs.forEach(c => frag.append(convRow(c)));
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
        ${esc(src ? (src.text || mediaLabel(src.media_type)) : 'Message supprimé')}
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
        ${icon('paperclip', { size: 16 })}<span class="truncate">${esc(m.media_name || 'Fichier')}</span>
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
    `<button class="rx-chip${mine === k ? ' mine' : ''}" data-rx="${k}" data-tip="${esc(reactionLabel(k))}">
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
    (m.edited_at ? '<span class="t-xs" style="opacity:.7"> modifié</span>' : '') +
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
    { icon: I.smile, tip: 'Réagir', onClick: e => openReactions(e.currentTarget, m) },
    { icon: I.reply, tip: 'Répondre', onClick: () => startReply(m) },
    { icon: I.moreH, tip: 'Plus', onClick: e => msgMenu(e, m) }
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
      text: `Aucun message avec ${peer?.full_name || ''} pour l'instant.`
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

  if (keepScroll) body.scrollTop = prevTop;
  else scrollToBottom(false);
  markVisibleAsRead();
  wireVoicePlayers(body);
  if (infoOpen) renderInfoPanel();
}

function scrollToBottom(smooth = true) {
  const body = $('#threadBody');
  if (!body) return;
  body.scrollTo({ top: body.scrollHeight, behavior: smooth && !env.reducedMotion ? 'smooth' : 'auto' });
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
    'Réaction non enregistrée'
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

const CHAT_THEMES = [
  { id: 'default', label: 'Défaut',  bg: 'var(--surface-2)',                      grad: 'var(--grad)' },
  { id: 'dz',      label: 'Algérie', bg: 'linear-gradient(160deg,#E8F5EE,#F7FBF8)', grad: 'linear-gradient(135deg,#006233,#00A651)' },
  { id: 'sunset',  label: 'Coucher', bg: 'linear-gradient(160deg,#FFF3E8,#FFF9F4)', grad: 'linear-gradient(135deg,#F97316,#EC4899)' },
  { id: 'ocean',   label: 'Océan',   bg: 'linear-gradient(160deg,#E9F4FF,#F6FAFF)', grad: 'linear-gradient(135deg,#0EA5E9,#6366F1)' },
  { id: 'night',   label: 'Nuit',    bg: 'linear-gradient(160deg,#12161C,#0C0F14)', grad: 'linear-gradient(135deg,#4F46E5,#7C3AED)' }
];

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
  const th = CHAT_THEMES.find(t => t.id === id) || CHAT_THEMES[0];
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
      <button class="icon-btn" id="infoClose" aria-label="Fermer" data-tip="Échap">${I.close}</button>
      <span class="t-bold grow">Infos</span>
      <button class="icon-btn" id="infoMore" aria-label="Plus">${I.moreH}</button>
    </header>

    <div class="info-scroll">

      <!-- hero -->
      <div class="tg-hero">
        <div class="av xl" style="background:${avatarColor(peer.id)}">${esc(initials(peer.full_name))}</div>
        <div class="tg-hero-name">${esc(pref.nickname || peer.full_name)}</div>
        ${pref.nickname ? `<div class="t-xs t-dim2">${esc(peer.full_name)}</div>` : ''}
        <div class="t-sm t-dim">${peer.online ? 'En ligne' : 'Vu récemment'}</div>
        <div class="tg-actions">
          <button class="tg-action" id="aProfile" data-tip="Profil">${I.user}</button>
          <button class="tg-action${pref.muted ? ' on' : ''}" id="aMute" data-tip="${pref.muted ? 'Réactiver' : 'Couper le son'}">${I.mute}</button>
          <button class="tg-action" id="aSearch" data-tip="Rechercher">${I.search}</button>
          <button class="tg-action accent" id="aMessage" data-tip="Écrire">${I.message}</button>
        </div>
      </div>

      <!-- identity -->
      <section class="tg-sec">
        ${sectionTitle('Infos')}
        <div class="tg-row"><span class="tg-ic">${icon('user', { size: 16 })}</span>
          <div class="grow"><div class="t-sm">@${esc(peer.username || '')}</div>
          <div class="t-xs t-dim">Nom d'utilisateur</div></div>
          <button class="icon-btn sm" id="copyUser" data-tip="Copier">${I.copy}</button>
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
        ${sectionTitle('Surnom', 'Vous seul le voyez')}
        <input class="input" id="nickInput" placeholder="Ajouter un surnom…" value="${esc(pref.nickname || '')}">
      </section>

      <!-- themes -->
      <section class="tg-sec">
        ${sectionTitle('Thème de la conversation')}
        <div class="tg-themes">
          ${CHAT_THEMES.map(t => `
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
          : `<div class="tg-empty">${icon('image', { size: 22 })}<span>Aucun média</span></div>`}
      </section>

      <!-- files -->
      <section class="tg-sec">
        ${sectionTitle(`Fichiers${files.length ? ' · ' + files.length : ''}`)}
        ${files.length
          ? files.map(m => `<a class="tg-row" href="${esc(safeUrl(m.media_url))}" download>
              <span class="tg-ic">${icon('paperclip', { size: 16 })}</span>
              <div class="grow" style="min-width:0">
                <div class="t-sm truncate">${esc(m.media_name || 'Fichier')}</div>
                <div class="t-xs t-dim">${timeAgo(m.created_at)}</div>
              </div>
              <span class="tg-ic">${icon('download', { size: 15 })}</span></a>`).join('')
          : `<div class="tg-empty">${icon('paperclip', { size: 22 })}<span>Aucun fichier</span></div>`}
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
          : `<div class="tg-empty">${icon('link', { size: 22 })}<span>Aucun lien</span></div>`}
      </section>

      <!-- voice -->
      ${voice.length ? `<section class="tg-sec">
        ${sectionTitle(`Messages vocaux · ${voice.length}`)}
        ${voice.map(m => `<div class="tg-row">
            <span class="tg-ic">${icon('mic', { size: 16 })}</span>
            <div class="grow"><div class="t-sm">Message vocal</div>
            <div class="t-xs t-dim">${duration(m.media_duration || 0)} · ${timeAgo(m.created_at)}</div></div>
            <button class="icon-btn sm">${I.play}</button></div>`).join('')}
      </section>` : ''}

      <!-- settings, moved out of the header menu -->
      <section class="tg-sec">
        ${sectionTitle('Paramètres')}
        <button class="tg-row tg-btn" id="optMute">
          <span class="tg-ic">${icon('mute', { size: 16 })}</span>
          <span class="grow t-sm" style="text-align:start">${pref.muted ? 'Réactiver les notifications' : 'Couper les notifications'}</span>
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
          <span class="grow t-sm" style="text-align:start">Supprimer la conversation</span>
        </button>
        <button class="tg-row tg-btn" id="optBlock">
          <span class="tg-ic">${icon('block', { size: 16 })}</span>
          <span class="grow t-sm" style="text-align:start">Bloquer ${esc(peer.full_name)}</span>
        </button>
        <button class="tg-row tg-btn" id="optReport">
          <span class="tg-ic">${icon('flag', { size: 16 })}</span>
          <span class="grow t-sm" style="text-align:start">Signaler</span>
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
    toast(next ? 'Notifications coupées' : 'Notifications réactivées', 'ok');
    renderInfoPanel();
    refreshHead();
  };
  on($('#aMute'), 'click', toggleMute);
  on($('#optMute'), 'click', toggleMute);

  on($('#copyUser'), 'click', async () => {
    const { copyText } = await import('../core/utils_sm.js');
    toast(await copyText('@' + peer.username) ? 'Copié' : 'Copie impossible', 'ok');
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
      message: 'Tous les messages seront retirés de votre côté.',
      confirmLabel: 'Vider', danger: true
    })) return;
    try {
      await api.clearThread(peer.id);
      msgs = [];
      renderThread();
      renderConvList();
      toast('Conversation vidée', 'ok');
    } catch { toast('Impossible de vider la conversation', 'err'); }
  });

  on($('#optDelete'), 'click', async () => {
    if (!await confirmDialog({
      title: 'Supprimer la conversation ?',
      message: `La conversation avec ${peer.full_name} sera supprimée définitivement.`,
      confirmLabel: 'Supprimer', danger: true
    })) return;
    toggleInfo(false);
    $('#dm')?.removeAttribute('data-open');
    toast('Conversation supprimée', 'ok');
    renderConvList();
  });

  on($('#optBlock'), 'click', async () => {
    if (!await confirmDialog({
      title: `Bloquer ${peer.full_name} ?`,
      message: 'Cette personne ne pourra plus vous écrire.',
      confirmLabel: 'Bloquer', danger: true
    })) return;
    try {
      const { profileApi } = await import('../core/api_sm.js');
      await profileApi.block(peer.id);
      toast('Utilisateur bloqué', 'ok');
    } catch { toast('Blocage échoué', 'err'); }
  });

  on($('#optReport'), 'click', async () => {
    try {
      const { profileApi } = await import('../core/api_sm.js');
      await profileApi.report('user', peer.id, 'Signalé depuis la conversation');
      toast('Signalement envoyé aux administrateurs', 'ok');
    } catch { toast('Signalement échoué', 'err'); }
  });

  on($('#infoMore'), 'click', e => contextMenu(e, [
    { label: 'Voir le profil', icon: I.user, onClick: () => location.hash = `#/profile/${peer.username}` },
    { label: 'Exporter',       icon: I.download, onClick: exportThread },
    { sep: true },
    { label: 'Supprimer la conversation', icon: I.trash, danger: true, onClick: () => $('#optDelete')?.click() }
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
  const m = modal({ title: 'Rechercher', body: el('div', { class: 'col g3' }, input, results) });

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
  if (!msgs.length) { toast('Rien à exporter'); return; }
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
  toast('Conversation exportée', 'ok');
}

/* ------------------------------------------------------------
   FORWARD
   ------------------------------------------------------------ */

async function forwardMessage(m) {
  const search = el('input', { class: 'input', placeholder: 'À qui ?' });
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
            <div class="t-xs t-dim">@${esc(u.username)}</div></div>
          </button>`).join('')
      : `<div class="tg-empty">${icon('user',{size:22})}<span>Personne trouvée</span></div>`;
  };

  const refresh = debounce(async () => {
    people = await api.contacts(search.value.trim()).catch(() => []);
    draw();
  }, 200);

  on(search, 'input', refresh);
  list.innerHTML = skeletonList(3, 'conv');
  const dlg = modal({ title: 'Transférer', body: el('div', { class: 'col g3' }, search, list) });

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
      toast('Message transféré', 'ok');
      renderConvList();
    } catch { btn.disabled = false; toast('Transfert échoué', 'err'); }
  });

  refresh();
  setTimeout(() => search.focus(), 80);
}

/* ------------------------------------------------------------
   NEW CONVERSATION
   ------------------------------------------------------------ */

async function openNewConversation() {
  const search = el('input', { class: 'input', placeholder: 'Nom ou @pseudo…' });
  const list = el('div', { class: 'col g2', style: 'max-height:46vh;overflow:auto' });

  const refresh = debounce(async () => {
    const people = await api.contacts(search.value.trim()).catch(() => []);
    list.innerHTML = people.length
      ? people.map(u => `
          <button class="tg-row" data-to="${esc(u.id)}" style="text-align:start">
            ${u.avatar_url
              ? `<span class="av sm"><img src="${esc(safeUrl(u.avatar_url))}" alt=""></span>`
              : `<span class="av sm" style="background:${avatarColor(u.id)}">${esc(initials(u.full_name))}</span>`}
            <div class="grow" style="min-width:0"><div class="t-sm t-bold truncate">${esc(u.full_name)}</div>
            <div class="t-xs t-dim">@${esc(u.username)} · ${esc(u.faculty || '')}</div></div>
          </button>`).join('')
      : `<div class="tg-empty">${icon('user',{size:22})}<span>Aucun étudiant trouvé</span></div>`;
  }, 200);

  on(search, 'input', refresh);
  list.innerHTML = skeletonList(4, 'conv');
  const dlg = modal({ title: 'Nouveau message', body: el('div', { class: 'col g3' }, search, list) });

  on(list, 'click', e => {
    const btn = e.target.closest('[data-to]');
    if (!btn) return;
    dlg.close();
    openThread(btn.dataset.to);
  });

  refresh();
  setTimeout(() => search.focus(), 80);
}

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
      `<span class="head-muted" data-tip="Notifications coupées">${icon('mute', { size: 15 })}</span>`);
  } else if (!pref.muted && existing) existing.remove();
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
    { title: 'Message' },
    { label: 'Répondre',  icon: I.reply,   kbd: 'R', onClick: () => startReply(m) },
    { label: 'Réagir',    icon: I.smile,   onClick: () => openReactions(e.target, m) },
    { label: 'Copier',    icon: I.copy,    kbd: 'C', onClick: () => copyMsg(m) },
    { label: 'Transférer', icon: I.forward, onClick: () => forwardMessage(m) },
    mine ? { label: 'Modifier', icon: I.edit, onClick: () => startEdit(m) } : null,
    { sep: true },
    mine
      ? { label: 'Supprimer', icon: I.trash, danger: true, onClick: () => removeMsg(m) }
      : { label: 'Signaler',  icon: I.flag,  danger: true, onClick: () => toast('Signalement envoyé', 'ok') }
  ]);
}

async function copyMsg(m) {
  const { copyText } = await import('../core/utils_sm.js');
  const okCopy = await copyText(m.text || m.media_url || '');
  toast(okCopy ? 'Copié' : 'Copie impossible', okCopy ? 'ok' : 'err');
}

async function removeMsg(m) {
  if (!await confirmDialog({
    title: 'Supprimer ce message ?',
    message: 'Il sera retiré pour tout le monde.',
    confirmLabel: 'Supprimer', danger: true
  })) return;
  const keep = msgs;
  msgs = msgs.filter(x => x.id !== m.id);
  renderThread({ keepScroll: true });
  try {
    await api.deleteMessage(m.id);
    toast('Message supprimé', 'ok');
    renderConvList();
  } catch {
    msgs = keep;
    renderThread({ keepScroll: true });
    toast('Suppression échouée', 'err');
  }
}

/* ------------------------------------------------------------
   REPLY & EDIT
   ------------------------------------------------------------ */

function startReply(m) {
  replyTo = m; editing = null;
  showContextBar('Réponse à', m.text || mediaLabel(m.media_type), I.reply);
  $('#composerInput')?.focus();
}

function startEdit(m) {
  editing = m; replyTo = null;
  const input = $('#composerInput');
  if (input) { input.value = m.text || ''; input.focus(); autoGrow(input); syncSendState(); }
  showContextBar('Modification', m.text || '', I.edit);
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
    catch { target.text = before; renderThread({ keepScroll: true }); toast('Modification non enregistrée', 'err'); }
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
    return saved;
  } catch (err) {
    msgs = msgs.filter(m => m.id !== temp.id);
    renderThread();
    toast(err?.message?.includes('trop lourd')
      ? err.message
      : 'Message non envoyé — rien n\'a été enregistré', 'err');
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

  // restore an unfinished message
  const saved = draft.get(peer.id);
  if (saved) { input.value = saved; autoGrow(input); }
  syncSendState();

  on(input, 'input', () => {
    autoGrow(input);
    syncSendState();
    saveDraft();
    api?.setTyping?.(peer.id);
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
    const near = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
    atBottom = near;
    $('#toBottom')?.classList.toggle('show', !near);
  }), { passive: true });

  on($('#toBottom'), 'click', () => scrollToBottom(true));
}

function jumpTo(id) {
  const row = $(`#threadBody .bubble-row[data-id="${cssEscape(id)}"]`);
  if (!row) { toast('Message introuvable'); return; }
  row.scrollIntoView({ block: 'center', behavior: env.reducedMotion ? 'auto' : 'smooth' });
  const bub = row.querySelector('.bubble');
  bub.classList.remove('flash');
  void bub.offsetWidth;        // restart the animation
  bub.classList.add('flash');
}

/* ------------------------------------------------------------
   OPEN A THREAD
   ------------------------------------------------------------ */

export async function openThread(peerId) {
  peer = convs.find(c => String(c.peer.id) === String(peerId))?.peer || person(peerId);

  setState({ activeChat: peerId });
  $('#dm')?.setAttribute('data-open', 'thread');

  for (const n of $$('.conv')) n.classList.toggle('on', n.dataset.peer === peerId);

  const head = $('#threadHead');
  if (head) {
    const pref = getChatPref(peer.id);
    head.innerHTML = `
      <button class="icon-btn thread-back" id="threadBack" aria-label="Retour">${I.arrowLeft}</button>
      <div class="av sm" style="background:${avatarColor(peer.id)}" data-online="${!!peer.online}">${esc(initials(peer.full_name))}</div>
      <div class="grow" style="min-width:0">
        <div class="t-bold truncate">${esc(pref.nickname || peer.full_name)}</div>
        <div class="presence">${peer.online ? 'En ligne' : 'Vu récemment'}</div>
      </div>
      ${pref.muted ? `<span class="head-muted" data-tip="Notifications coupées">${icon('mute', { size: 15 })}</span>` : ''}`;

    // The whole header bar is the target, exactly like Telegram:
    // click anywhere on it to open the conversation info.
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.setAttribute('aria-label', 'Infos sur la conversation');
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
      text: err?.message || 'Réessayez dans un instant.',
      action: { label: 'Réessayer', onClick: () => openThread(peerId) }
    }));
    return;
  }
  renderThread();
  applyChatTheme(getChatPref(peerId).theme);

  // The panel is part of the conversation view, not a thing you hunt
  // for in a menu — it opens with the thread on wide screens.
  if (innerWidth >= 1280) toggleInfo(true);
  else if (infoOpen) renderInfoPanel();

  $('#composerWrap')?.classList.remove('hidden');
  wireComposer();
  startPolling();
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
          <input class="input has-icon" id="convSearch" placeholder="Rechercher…" aria-label="Rechercher une conversation">
        </div>
        <button class="icon-btn" id="btnNewConv" data-tip="Nouveau message">${I.plus}</button>
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
          <button class="icon-btn" id="btnPhoto" data-tip="Photo">${I.image}</button>
          <button class="icon-btn" id="btnGif" data-tip="GIF">${I.gif}</button>
          <button class="icon-btn" id="btnFile" data-tip="Fichier">${I.paperclip}</button>
          <button class="icon-btn" id="btnEmoji" data-tip="Emoji">${I.smile}</button>
          <input type="file" id="filePick" hidden multiple>
          <input type="file" id="imgPick" hidden multiple accept="image/*">
          <textarea class="composer-input" id="composerInput" rows="1"
                    placeholder="Écrivez un message…" aria-label="Message"></textarea>
          <button class="icon-btn" id="btnMic" data-tip="Message vocal" aria-label="Enregistrer un message vocal">${I.mic}</button>
          <button class="icon-btn send-btn" id="btnSend" data-tip="Envoyer" aria-label="Envoyer" disabled>${I.send}</button>
        </div>
      </div>
    </section>

    <aside class="info-panel" id="infoPanel" aria-label="Infos sur la conversation"></aside>
  </div>`;
}

export function initMessages(mountFn) {
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
    if (arg) openThread(arg);
  });

  // Leaving the screen must stop the poll; a chat that keeps querying
  // Neon from a route you closed is a bill, not a feature.
  onEvent('route:enter', ({ route: r } = {}) => {
    if (r !== 'messages') { stopPolling(); peer = null; }
  });
  on(document, 'visibilitychange', () => { if (peer) startPolling(); });
}
