/**
 * KOLIYA — features/profile_sm.js
 * ============================================================
 * Profile: cover, identity, stats, tabs, badges, follow state.
 *
 * The cover shrinks and blurs as you scroll and the name moves into
 * the top bar — so the header stops wasting space once you are
 * reading, without a control asking you to collapse it.
 * ============================================================
 */

import {
  $, $$, el, on, esc, richText, timeAgo, compact, initials, avatarColor,
  rafThrottle, clamp, env, copyText, cssEscape
} from '../core/utils_sm.js';
import { me, on as onEvent } from '../core/store_sm.js';
import { I, icon } from '../core/icons_sm.js';
import {
  toast, modal, contextMenu, confirmDialog, lightbox,
  skeletonList, emptyState, countUp, optimistic
} from '../core/ui_sm.js';
import { route, go } from '../core/router_sm.js';
import { BADGES, earnedBadges, levelFromXp } from './hub_sm.js';
import { openImageEditor } from './editor_sm.js';

let api = null;
export function useApi(impl) { api = impl; }

let viewing = null;
let activeTab = 'posts';

/* ------------------------------------------------------------
   SAMPLE
   ------------------------------------------------------------ */

const PEOPLE = {
  'sara.b':  { id:'u1', username:'sara.b', full_name:'Sara Benali', faculty:'Informatique',
               bio:'Étudiante en L3 informatique. J\'aime les algos et le café ☕',
               xp:340, streak:7, followers:38, following:52, posts:14, isMe:true },
  'youssef': { id:'u2', username:'youssef', full_name:'Youssef Kader', faculty:'Physique',
               bio:'Physique fondamentale · toujours partant pour une révision de groupe',
               xp:640, streak:12, followers:64, following:41, posts:23, followState:'none' },
  'leila':   { id:'u3', username:'leila', full_name:'Leila Mansouri', faculty:'Biologie',
               bio:'Labo, terrain, répéter.', private:true,
               xp:295, streak:3, followers:22, following:30, posts:9, followState:'requested' }
};

const SAMPLE_POSTS = uid => ([
  { id:'pp1', text:'Petite victoire : le TP compile enfin du premier coup.', likes:['u2','u3'], comments:[{}], created_at:new Date(Date.now()-3*3600000).toISOString() },
  { id:'pp2', text:'Quelqu\'un pour réviser #algo demain à la biblio ?', likes:['u5'], comments:[{},{}], created_at:new Date(Date.now()-26*3600000).toISOString(),
    image_url:'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=700&q=70' },
  { id:'pp3', text:'Les notes du semestre sont sorties. Bon courage à tous 💪', likes:[], comments:[], created_at:new Date(Date.now()-72*3600000).toISOString() }
]);

async function loadProfile(username) {
  if (api?.getProfile) return api.getProfile(username);
  const mine = me.get();
  if (!username || username === mine?.username) {
    return { ...PEOPLE['sara.b'], ...mine, isMe: true };
  }
  return PEOPLE[username] || null;
}

/* ------------------------------------------------------------
   HEADER
   ------------------------------------------------------------ */

function headerMarkup(u) {
  const lv = levelFromXp(u.xp || 0);
  const badges = earnedBadges({ ...u, level: lv.level, likes: 0, comments: 0, answers: 0, events: 0, saved: 0, nightPosts: 0 });

  return `
  <div class="pf-cover" id="pfCover">
    <div class="pf-cover-img" style="background:${coverFor(u)}"></div>
    ${u.isMe ? `<button class="icon-btn pf-cover-edit" id="pfCoverEdit" data-tip="Changer la couverture">${I.camera}</button>` : ''}
  </div>

  <div class="pf-head">
    <div class="pf-avatar-wrap">
      <div class="av-ring" style="--pct:${lv.pct}" data-tip="Niveau ${lv.level} · ${lv.into}/${lv.need} XP">
        <div class="av xl" style="background:${avatarColor(u.id)}" id="pfAvatar">${esc(initials(u.full_name))}</div>
      </div>
      ${u.isMe ? `<button class="icon-btn pf-avatar-edit" id="pfAvatarEdit" data-tip="Changer la photo">${I.camera}</button>` : ''}
      <span class="pf-level">Niv. ${lv.level}</span>
    </div>

    <div class="pf-actions">
      ${u.isMe
        ? `<button class="btn btn-outline" id="pfEdit">${icon('edit',{size:16})} Modifier le profil</button>
           <button class="icon-btn" id="pfSettings" data-tip="Réglages">${I.settings}</button>`
        : `<button class="btn ${u.followState === 'following' ? 'btn-outline btn-follow' : 'btn-primary'}"
                   id="pfFollow" data-state="${u.followState || 'none'}">
             ${followLabel(u.followState)}
           </button>
           <button class="icon-btn" id="pfMessage" data-tip="Message">${I.message}</button>
           <button class="icon-btn" id="pfMore" data-tip="Plus">${I.moreH}</button>`}
    </div>
  </div>

  <div class="pf-identity">
    <div class="row g2" style="align-items:center;flex-wrap:wrap">
      <h2 style="font-size:var(--fs-xl)">${esc(u.full_name)}</h2>
      ${u.private ? `<span class="pill">${icon('lock',{size:12})} Privé</span>` : ''}
      ${u.role === 'admin' ? '<span class="pill on">Admin</span>' : ''}
    </div>
    <div class="t-sm t-dim">@${esc(u.username)} · ${esc(u.faculty || '')}</div>
    ${u.bio ? `<p class="pf-bio">${richText(u.bio)}</p>` : ''}

    <div class="pf-stats">
      <button class="pf-stat" data-stat="posts"><b id="stPosts">0</b><span>publications</span></button>
      <button class="pf-stat" data-stat="followers"><b id="stFollowers">0</b><span>abonnés</span></button>
      <button class="pf-stat" data-stat="following"><b id="stFollowing">0</b><span>abonnements</span></button>
      <div class="pf-stat"><b class="row g1" style="color:var(--streak)">${icon('fire',{size:15})} ${u.streak || 0}</b><span>série</span></div>
    </div>

    ${badges.length ? `<div class="pf-badges">
      ${badges.slice(0, 6).map(b => `<span class="pf-badge" data-tip="${esc(b.name)} — ${esc(b.desc)}">${icon(b.icon,{size:15})}</span>`).join('')}
      ${badges.length > 6 ? `<button class="pill" id="pfAllBadges">+${badges.length - 6}</button>` : ''}
    </div>` : ''}
  </div>`;
}

const followLabel = s =>
  s === 'following' ? '<span class="lbl-following">Abonné</span><span class="lbl-unfollow">Se désabonner</span>'
  : s === 'requested' ? 'Demande envoyée'
  : 'Suivre';

function coverFor(u) {
  const c = avatarColor(u.id);
  return `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 45%, #7C5BE8))`;
}

/* ------------------------------------------------------------
   TABS
   ------------------------------------------------------------ */

const TABS = [
  { id:'posts', label:'Publications', icon:'edit' },
  { id:'media', label:'Médias',       icon:'image' },
  { id:'likes', label:'J\'aime',      icon:'fire' }
];

function renderTabBody(u) {
  const host = $('#pfBody');
  if (!host) return;

  if (u.private && !u.isMe && u.followState !== 'following') {
    host.innerHTML = '';
    host.append(emptyState({
      icon: I.lock,
      title: 'Ce compte est privé',
      text: `Suivez ${u.full_name} pour voir ses publications.`
    }));
    return;
  }

  const posts = SAMPLE_POSTS(u.id);

  if (activeTab === 'media') {
    const media = posts.filter(p => p.image_url);
    host.innerHTML = media.length
      ? `<div class="pf-grid">${media.map(p =>
          `<button class="pf-tile" data-zoom="${esc(p.image_url)}"><img src="${esc(p.image_url)}" alt="" loading="lazy"></button>`).join('')}</div>`
      : '';
    if (!media.length) host.append(emptyState({ icon: I.image, title: 'Aucun média', text: 'Les photos partagées apparaîtront ici.' }));
    return;
  }

  if (activeTab === 'likes') {
    host.innerHTML = '';
    host.append(emptyState({ icon: I.fire, title: 'Rien pour l\'instant', text: 'Les publications aimées apparaîtront ici.' }));
    return;
  }

  host.innerHTML = posts.map(p => `
    <article class="post" data-id="${p.id}">
      <div class="post-head">
        <div class="av" style="background:${avatarColor(u.id)}">${esc(initials(u.full_name))}</div>
        <div class="grow" style="min-width:0">
          <div class="row g2"><span class="post-name">${esc(u.full_name)}</span>
          <span class="post-handle">@${esc(u.username)}</span>
          <span class="post-handle">·</span><span class="post-time">${timeAgo(p.created_at)}</span></div>
        </div>
      </div>
      <div class="post-text">${richText(p.text)}</div>
      ${p.image_url ? `<div class="post-media media-zoom" data-zoom="${esc(p.image_url)}">
          <img src="${esc(p.image_url)}" alt="" loading="lazy"></div>` : ''}
      <div class="post-actions">
        <button class="act"><span>${icon('fire',{size:17})}</span><span class="c">${p.likes.length || ''}</span></button>
        <button class="act">${I.comment}<span class="c">${p.comments.length || ''}</span></button>
        <button class="act">${I.share}</button>
      </div>
    </article>`).join('');
}

/* ------------------------------------------------------------
   SCROLL — cover shrinks, name rises into the bar
   ------------------------------------------------------------ */

function wireScroll(u) {
  const view = $('#view') || $('.view');
  const cover = $('#pfCover');
  const title = $('#topbarTitle');
  if (!view || !cover) return;

  const original = title?.textContent;

  const onScroll = rafThrottle(() => {
    const y = view.scrollTop;
    const p = clamp(y / 160, 0, 1);
    cover.style.setProperty('--shrink', String(p));
    if (title) title.textContent = p > .7 ? u.full_name : original;
  });
  on(view, 'scroll', onScroll, { passive: true });
}

/* ------------------------------------------------------------
   ACTIONS
   ------------------------------------------------------------ */

function wireActions(u) {
  const follow = $('#pfFollow');
  if (follow) {
    on(follow, 'click', () => {
      const state = follow.dataset.state;
      const next = state === 'following' ? 'none'
                 : u.private ? 'requested' : 'following';
      optimistic(
        () => {
          follow.dataset.state = next;
          follow.className = 'btn ' + (next === 'following' ? 'btn-outline btn-follow' : next === 'requested' ? 'btn-outline' : 'btn-primary');
          follow.innerHTML = followLabel(next);
          u.followState = next;
          const f = $('#stFollowers');
          if (f) f.textContent = compact((u.followers || 0) + (next === 'following' ? 1 : 0));
          if (next === 'requested') toast('Demande envoyée', 'ok');
          renderTabBody(u);
        },
        () => { follow.dataset.state = state; follow.innerHTML = followLabel(state); u.followState = state; },
        () => api?.follow?.(u.id, next) ?? Promise.resolve()
      );
    });
  }

  on($('#pfMessage'), 'click', () => go('messages', u.id));
  on($('#pfEdit'), 'click', () => openEditProfile(u));
  on($('#pfSettings'), 'click', () => go('settings'));

  on($('#pfMore'), 'click', e => contextMenu(e, [
    { title: esc(u.full_name) },
    { label: 'Copier le lien', icon: I.link,
      onClick: async () => toast(await copyText(`${location.origin}/#/profile/${u.username}`) ? 'Lien copié' : 'Échec', 'ok') },
    { label: 'Couper les notifications', icon: I.mute, onClick: () => toast('Notifications coupées', 'ok') },
    { sep: true },
    { label: 'Bloquer', icon: I.block, danger: true, onClick: async () => {
        if (await confirmDialog({ title: `Bloquer ${u.full_name} ?`, message: 'Cette personne ne pourra plus vous contacter.', confirmLabel: 'Bloquer', danger: true }))
          toast('Utilisateur bloqué', 'ok');
      } },
    { label: 'Signaler', icon: I.flag, danger: true, onClick: () => toast('Signalement envoyé', 'ok') }
  ]));

  // avatar & cover
  const pick = el('input', { type: 'file', accept: 'image/*', hidden: true });
  document.body.append(pick);
  let target = 'avatar';
  on($('#pfAvatarEdit'), 'click', () => { target = 'avatar'; pick.click(); });
  on($('#pfCoverEdit'), 'click', () => { target = 'banner'; pick.click(); });
  on(pick, 'change', async e => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    const out = await openImageEditor(f, target === 'avatar' ? 'avatar' : 'post');
    if (!out) return;
    const url = URL.createObjectURL(out);
    if (target === 'avatar') {
      const av = $('#pfAvatar');
      if (av) av.innerHTML = `<img src="${url}" alt="">`;
    } else {
      const c = $('.pf-cover-img');
      if (c) c.style.background = `url(${url}) center/cover`;
    }
    toast('Photo mise à jour', 'ok');
  });

  for (const b of $$('.pf-stat[data-stat]')) {
    on(b, 'click', () => {
      const kind = b.dataset.stat;
      if (kind === 'posts') { activeTab = 'posts'; syncTabs(u); return; }
      openPeopleList(kind === 'followers' ? 'Abonnés' : 'Abonnements');
    });
  }

  on($('#pfAllBadges'), 'click', () => go('hub'));

  on($('#pfBody'), 'click', e => {
    const z = e.target.closest('[data-zoom]');
    if (z) lightbox([z.dataset.zoom]);
  });
}

function openPeopleList(title) {
  const rows = Object.values(PEOPLE).slice(0, 3);
  modal({
    title,
    body: `<div class="col g3">${rows.map(u => `
      <div class="row g3">
        <span class="av sm" style="background:${avatarColor(u.id)}">${esc(initials(u.full_name))}</span>
        <div class="grow"><div class="t-sm t-bold">${esc(u.full_name)}</div>
        <div class="t-xs t-dim">${esc(u.faculty)}</div></div>
        <button class="btn btn-outline btn-sm">Voir</button>
      </div>`).join('')}</div>`
  });
}

function openEditProfile(u) {
  const name = el('input', { class: 'input', value: u.full_name });
  const bio  = el('textarea', { class: 'textarea', rows: '3', value: u.bio || '' });
  const priv = el('div', { class: 'switch' + (u.private ? ' on' : '') });
  on(priv, 'click', () => priv.classList.toggle('on'));

  const foot = el('div', { class: 'row g2' });
  const m = modal({
    title: 'Modifier le profil',
    body: el('div', { class: 'col g4' },
      el('div', { class: 'field' }, el('label', { class: 'label' }, 'Nom complet'), name),
      el('div', { class: 'field' }, el('label', { class: 'label' }, 'Bio'), bio),
      el('div', { class: 'row between' },
        el('div', {},
          el('div', { class: 't-sm t-bold' }, 'Compte privé'),
          el('div', { class: 't-xs t-dim' }, 'Seuls vos abonnés voient vos publications')),
        priv)
    ),
    footer: foot
  });
  foot.append(
    el('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Annuler'),
    el('button', { class: 'btn btn-primary', onclick: () => {
      u.full_name = name.value.trim() || u.full_name;
      u.bio = bio.value.trim();
      u.private = priv.classList.contains('on');
      me.set({ ...me.get(), full_name: u.full_name, bio: u.bio });
      m.close();
      toast('Profil mis à jour', 'ok');
      render(u);
    }}, 'Enregistrer')
  );
}

/* ------------------------------------------------------------
   RENDER
   ------------------------------------------------------------ */

function syncTabs(u) {
  for (const b of $$('.pf-tab')) b.classList.toggle('on', b.dataset.tab === activeTab);
  renderTabBody(u);
}

function render(u) {
  const host = $('#pfRoot');
  if (!host) return;

  host.innerHTML = `
    ${headerMarkup(u)}
    <div class="sub-tabs blur-bar pf-tabs">
      ${TABS.map(t => `<button class="sub-tab pf-tab${t.id === activeTab ? ' on' : ''}" data-tab="${t.id}">
        ${icon(t.icon, { size: 15 })} ${t.label}</button>`).join('')}
    </div>
    <div id="pfBody"></div>`;

  renderTabBody(u);
  wireActions(u);
  wireScroll(u);

  for (const b of $$('.pf-tab')) {
    on(b, 'click', () => { activeTab = b.dataset.tab; syncTabs(u); });
  }

  requestAnimationFrame(() => {
    countUp($('#stPosts'), u.posts || 0);
    countUp($('#stFollowers'), u.followers || 0);
    countUp($('#stFollowing'), u.following || 0);
  });
}

export function initProfile(mountFn) {
  route('profile', async (username) => {
    const host = mountFn();
    if (!host) return;
    host.closest('.view')?.classList.remove('full');
    host.innerHTML = `<div id="pfRoot">${skeletonList(3)}</div>`;

    const u = await loadProfile(username);
    if (!u) {
      const root = $('#pfRoot');
      root.innerHTML = '';
      root.append(emptyState({
        icon: I.user, title: 'Profil introuvable',
        text: `Aucun étudiant nommé @${esc(username || '')}.`,
        action: { label: 'Retour au fil', onClick: () => go('feed') }
      }));
      return;
    }
    viewing = u;
    activeTab = 'posts';
    render(u);
  });
}
