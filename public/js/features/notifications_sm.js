/**
 * KOLIYA — features/notifications_sm.js
 * ============================================================
 * Notifications, grouped.
 *
 * Five people liking one post is one event, not five rows. The old
 * app listed each separately and the list became unreadable within a
 * day. Here identical actions on the same target collapse into a
 * single line with overlapping faces.
 *
 * Rows mark themselves read once they have actually been on screen.
 * ============================================================
 */

import {
  $, $$, el, on, esc, timeAgo, initials, avatarColor, truncate, onVisible
} from '../core/utils_sm.js';
import { me, setState, state, scoped } from '../core/store_sm.js';
import { person, cachePeople } from '../core/people_sm.js';
import { safeUrl } from '../core/utils_sm.js';
import { I, icon, reactionIcon } from '../core/icons_sm.js';
import { toast, emptyState, skeletonList, contextMenu } from '../core/ui_sm.js';
import { route, go } from '../core/router_sm.js';

let api = null;
export function useApi(impl) { api = impl; }

const store = scoped('notif');
let items = [];
let filter = 'all';

/* ------------------------------------------------------------
   DATA
   Read state lives in the database (notifications.read_at), not in
   localStorage — otherwise a notification you read on your laptop is
   still bold on your phone.
   ------------------------------------------------------------ */

async function load() {
  if (!api?.listNotifications) return [];
  try { return await api.listNotifications(); }
  catch (e) { console.warn('[koliya] notifications indisponibles', e.message); return []; }
}

/* ------------------------------------------------------------
   GROUPING
   ------------------------------------------------------------ */

/** Same kind + same target within 6 hours becomes one row. */
function group(list) {
  const WINDOW = 6 * 3600 * 1000;
  const out = [];

  for (const n of list) {
    const mergeable = n.kind === 'like' || n.kind === 'follow';
    const hit = mergeable && out.find(g =>
      g.kind === n.kind &&
      g.target === n.target &&
      Math.abs(new Date(g.at) - new Date(n.at)) < WINDOW);

    if (hit) {
      hit.actors.push(n.actor);
      hit.ids.push(n.id);
      hit.read = hit.read && n.read;
      if (new Date(n.at) > new Date(hit.at)) hit.at = n.at;
    } else {
      out.push({ ...n, actors: n.actor ? [n.actor] : [], ids: [n.id] });
    }
  }
  return out.sort((a, b) => new Date(b.at) - new Date(a.at));
}

const KIND = {
  like:    { icon:'fire',     tint:'like',   verb:g => `${names(g)} ${g.actors.length > 1 ? 'ont aimé' : 'a aimé'}` },
  comment: { icon:'comment',  tint:'brand',  verb:g => `${names(g)} a commenté` },
  follow:  { icon:'users',    tint:'ok',     verb:g => `${names(g)} ${g.actors.length > 1 ? 'vous suivent' : 'vous suit'}` },
  mention: { icon:'hash',     tint:'brand',  verb:g => `${names(g)} vous a mentionné` },
  request: { icon:'user',     tint:'warn',   verb:g => `${names(g)} demande à vous suivre` },
  badge:   { icon:'trophy',   tint:'warn',   verb:() => 'Nouveau badge débloqué' },
  event:   { icon:'calendar', tint:'brand',  verb:g => `${names(g)} a créé un événement` }
};

function names(g) {
  if (!g.actors.length) return '';
  const first = person(g.actors[0]).full_name;
  if (g.actors.length === 1) return esc(first);
  if (g.actors.length === 2) return `${esc(first)} et ${esc(person(g.actors[1]).full_name.split(' ')[0])}`;
  return `${esc(first)} et ${g.actors.length - 1} autres`;
}

/* ------------------------------------------------------------
   RENDER
   ------------------------------------------------------------ */

function row(g) {
  const meta = KIND[g.kind] || KIND.like;
  const node = el('div', {
    class: 'notif' + (g.read ? '' : ' unread'),
    'data-ids': g.ids.join(','),
    'data-kind': g.kind,
    'data-actor': g.actors[0] || '',
    'data-target': g.target ?? '',
    tabindex: '0'
  });

  const faces = g.actors.length
    ? `<span class="av-stack">${g.actors.slice(0, 3).map(a => {
        const u = person(a);
        return u.avatar_url
          ? `<span class="av sm"><img src="${esc(safeUrl(u.avatar_url))}" alt=""></span>`
          : `<span class="av sm" style="background:${avatarColor(u.id)}">${esc(initials(u.full_name))}</span>`;
      }).join('')}</span>`
    : `<span class="av sm" style="background:var(--surface-2);color:var(--text-2)">${icon(meta.icon, { size: 15 })}</span>`;

  node.innerHTML = `
    ${faces}
    <span class="notif-kind ${meta.tint}">${g.kind === 'like' ? reactionIcon('love', 13) : icon(meta.icon, { size: 13 })}</span>
    <div class="grow" style="min-width:0">
      <div class="t-sm"><b>${meta.verb(g)}</b>${g.text ? ' — ' + esc(truncate(g.text, 60)) : ''}</div>
      <div class="t-xs t-dim">${timeAgo(g.at)}</div>
    </div>
    ${g.kind === 'request' ? `<div class="row g1">
        <button class="btn btn-primary btn-sm" data-accept>Accepter</button>
        <button class="btn btn-ghost btn-sm" data-decline>Refuser</button>
      </div>` : ''}
    <button class="icon-btn sm notif-x hover-reveal" data-dismiss aria-label="Supprimer">${I.close}</button>`;

  node.classList.add('hover-host', 'hover-on-hover');
  return node;
}

function render() {
  const host = $('#notifList');
  if (!host) return;

  let list = items;
  if (filter === 'mentions') list = items.filter(n => n.kind === 'mention');
  if (filter === 'follows')  list = items.filter(n => n.kind === 'follow' || n.kind === 'request');

  const groups = group(list);

  if (!groups.length) {
    host.innerHTML = '';
    host.append(emptyState({
      icon: I.bell,
      title: 'Rien de neuf',
      text: 'Les réactions, mentions et demandes apparaîtront ici.'
    }));
    updateBadge();
    return;
  }

  host.innerHTML = '';
  const frag = document.createDocumentFragment();
  groups.forEach(g => frag.append(row(g)));
  host.append(frag);

  // read when actually seen, not when the page opens
  for (const node of $$('#notifList .notif.unread')) {
    onVisible(node, () => {
      const ids = node.dataset.ids.split(',').filter(Boolean);
      items.forEach(n => { if (ids.includes(String(n.id))) n.read = true; });
      node.classList.remove('unread');
      updateBadge();
      // persist, so it stays read on the next device you open
      api?.markRead?.(ids).catch(() => {});
    }, { threshold: 0.9 });
  }
  updateBadge();
}

function updateBadge() {
  const unread = items.filter(n => !n.read).length;
  setState({ unread: { ...state.unread, notifications: unread } });
}

/* ------------------------------------------------------------
   VIEW
   ------------------------------------------------------------ */

const FILTERS = [
  { id:'all',      label:'Tout' },
  { id:'mentions', label:'Mentions' },
  { id:'follows',  label:'Abonnements' }
];

export function initNotifications(mountFn) {
  route('notifications', async () => {
    const host = mountFn();
    if (!host) return;
    host.closest('.view')?.classList.remove('full');

    host.innerHTML = `
      <div class="sub-tabs blur-bar">
        ${FILTERS.map(f => `<button class="sub-tab${f.id === filter ? ' on' : ''}" data-f="${f.id}">${f.label}</button>`).join('')}
        <button class="sub-tab" id="notifAllRead" style="margin-inline-start:auto">${icon('check', { size: 14 })} Tout marquer lu</button>
      </div>
      <div id="notifList">${skeletonList(5, 'conv')}</div>`;

    on($('#notifAllRead'), 'click', async () => {
      items = items.map(n => ({ ...n, read: true }));
      render();
      try { await api.markAllRead(); toast('Tout marqué comme lu', 'ok'); }
      catch { toast('Action échouée', 'err'); }
    });

    for (const b of $$('.sub-tab[data-f]')) {
      on(b, 'click', () => {
        filter = b.dataset.f;
        for (const x of $$('.sub-tab[data-f]')) x.classList.toggle('on', x === b);
        render();
      });
    }

    on($('#notifList'), 'click', async e => {
      const node = e.target.closest('.notif');
      if (!node) return;

      const ids = (node.dataset.ids || '').split(',').filter(Boolean);

      if (e.target.closest('[data-dismiss]')) {
        const keep = items;
        items = items.filter(n => !ids.includes(String(n.id)));
        node.remove();
        updateBadge();
        try { await api.dismiss(ids); }
        catch { items = keep; render(); toast('Suppression échouée', 'err'); }
        return;
      }

      const accept = e.target.closest('[data-accept]');
      const decline = e.target.closest('[data-decline]');
      if (accept || decline) {
        const actor = node.dataset.actor;
        node.remove();
        try {
          await api.respondToRequest(actor, !!accept);
          await api.dismiss(ids);
          toast(accept ? 'Demande acceptée' : 'Demande refusée', accept ? 'ok' : undefined);
        } catch { render(); toast('Action échouée', 'err'); }
        return;
      }

      // opening a notification marks it read, then goes where it points
      if (ids.length) { api.markRead(ids).catch(() => {}); }
      items = items.map(n => (ids.includes(String(n.id)) ? { ...n, read: true } : n));
      updateBadge();

      const target = node.dataset.target;
      const actor = node.dataset.actor;
      if (node.dataset.kind === 'follow' || node.dataset.kind === 'request') {
        const u = person(actor);
        if (u.username) { go('profile', u.username); return; }
      }
      go('feed');
    });

    items = await load();
    render();
  });
}

/** Unread count for the rail badge, without opening the screen. */
export async function refreshNotificationBadge() {
  // A count query, not the whole list: the badge runs on every boot
  // and after every route change, so it has to be cheap.
  //
  // `unread` is an OBJECT — { messages, notifications }. Writing a
  // bare number here (which is what the previous version did) made
  // shell_sm.js compute `undefined + undefined` and the bell went
  // permanently blank. One shape, everywhere.
  if (!api?.unreadCount) {
    items = await load();
    updateBadge();
    return state.unread.notifications;
  }

  const n = await api.unreadCount().catch(err => {
    console.warn('[koliya] compteur de notifications indisponible', err.message);
    return null;
  });
  if (n === null) return state.unread.notifications;

  setState({ unread: { ...state.unread, notifications: n } });
  return n;
}
