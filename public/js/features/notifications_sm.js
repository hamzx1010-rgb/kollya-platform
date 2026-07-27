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
import { I, icon, reactionIcon } from '../core/icons_sm.js';
import { toast, emptyState, skeletonList, contextMenu } from '../core/ui_sm.js';
import { route, go } from '../core/router_sm.js';

let api = null;
export function useApi(impl) { api = impl; }

const store = scoped('notif');
let items = [];
let filter = 'all';

const PEOPLE = {
  u2:{ id:'u2', full_name:'Youssef Kader', username:'youssef' },
  u3:{ id:'u3', full_name:'Leila Mansouri', username:'leila' },
  u4:{ id:'u4', full_name:'Omar Kaci', username:'omar.k' },
  u5:{ id:'u5', full_name:'Amina Zerrouki', username:'amina.z' }
};
const person = id => PEOPLE[id] || { id, full_name:'Étudiant', username:'?' };

/* ------------------------------------------------------------
   DATA
   ------------------------------------------------------------ */

function sample() {
  const ago = m => new Date(Date.now() - m * 60000).toISOString();
  return [
    { id:'n1', kind:'like',    actor:'u2', target:'p1', text:'votre publication sur l\'algo', at:ago(8) },
    { id:'n2', kind:'like',    actor:'u3', target:'p1', text:'votre publication sur l\'algo', at:ago(12) },
    { id:'n3', kind:'like',    actor:'u5', target:'p1', text:'votre publication sur l\'algo', at:ago(20) },
    { id:'n4', kind:'comment', actor:'u4', target:'p1', text:'Je te l\'envoie ce soir', at:ago(26) },
    { id:'n5', kind:'follow',  actor:'u5', at:ago(90) },
    { id:'n6', kind:'mention', actor:'u3', target:'p2', text:'@sara.b tu viens à la révision ?', at:ago(150) },
    { id:'n7', kind:'request', actor:'u4', at:ago(220) },
    { id:'n8', kind:'badge',   text:'Une semaine', at:ago(400) },
    { id:'n9', kind:'event',   actor:'u2', text:'Révision Algo — mercredi 14h', at:ago(700) }
  ];
}

async function load() {
  const raw = api?.listNotifications ? await api.listNotifications() : sample();
  return raw.map(n => ({ ...n, read: store.get('read:' + n.id, false) }));
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
    tabindex: '0'
  });

  const faces = g.actors.length
    ? `<span class="av-stack">${g.actors.slice(0, 3).map(a => {
        const u = person(a);
        return `<span class="av sm" style="background:${avatarColor(u.id)}">${esc(initials(u.full_name))}</span>`;
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
      node.dataset.ids.split(',').forEach(id => store.set('read:' + id, true));
      items.forEach(n => { if (node.dataset.ids.includes(n.id)) n.read = true; });
      node.classList.remove('unread');
      updateBadge();
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
      </div>
      <div id="notifList">${skeletonList(5, 'conv')}</div>`;

    for (const b of $$('.sub-tab')) {
      on(b, 'click', () => {
        filter = b.dataset.f;
        for (const x of $$('.sub-tab')) x.classList.toggle('on', x === b);
        render();
      });
    }

    on($('#notifList'), 'click', e => {
      const node = e.target.closest('.notif');
      if (!node) return;

      if (e.target.closest('[data-dismiss]')) {
        node.dataset.ids.split(',').forEach(id => { items = items.filter(n => n.id !== id); });
        node.remove();
        updateBadge();
        return;
      }
      if (e.target.closest('[data-accept]'))  { toast('Demande acceptée', 'ok'); node.remove(); return; }
      if (e.target.closest('[data-decline]')) { toast('Demande refusée'); node.remove(); return; }
      go('feed');
    });

    items = await load();
    render();
  });
}

/** Unread count for the rail badge, without opening the screen. */
export async function refreshNotificationBadge() {
  items = await load();
  updateBadge();
}
