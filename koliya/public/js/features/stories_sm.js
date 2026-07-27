/**
 * KOLIYA — features/stories_sm.js
 * ============================================================
 * Story viewer.
 *
 * Two decisions worth naming:
 *   - the timer is derived from how much there is to read, not a
 *     flat 5 seconds for everyone
 *   - hovering pauses it. On the web, a cursor resting on a story
 *     means the person is reading, so advancing would be rude.
 * ============================================================
 */

import { $, $$, el, on, esc, initials, avatarColor, timeAgo, clamp, env } from '../core/utils_sm.js';
import { me, scoped } from '../core/store_sm.js';
import { I, icon, reactionIcon, REACTION_KEYS, reactionLabel } from '../core/icons_sm.js';
import { toast } from '../core/ui_sm.js';

const seenStore = scoped('story');
const BASE_MS = 4200;
const PER_CHAR = 45;      // extra time per character of caption
const MAX_MS = 12000;

let api = null;
export function useApi(impl) { api = impl; }

/* ------------------------------------------------------------
   SAMPLE
   ------------------------------------------------------------ */

const PEOPLE = {
  u2: { id:'u2', username:'youssef', full_name:'Youssef Kader' },
  u3: { id:'u3', username:'leila',   full_name:'Leila Mansouri' },
  u5: { id:'u5', username:'amina.z', full_name:'Amina Zerrouki' }
};

const SAMPLE = [
  { user_id:'u2', items:[
    { id:'s1a', media_url:'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=800&q=70',
      text:'Amphi plein ce matin', created_at:new Date(Date.now()-2*3600000).toISOString() },
    { id:'s1b', media_url:'https://images.unsplash.com/photo-1509062522246-3755977927d7?w=800&q=70',
      text:'Révision jusqu\'à la fermeture de la biblio. Courage à tous ceux qui préparent les partiels de la semaine prochaine.',
      created_at:new Date(Date.now()-1*3600000).toISOString() }
  ]},
  { user_id:'u3', items:[
    { id:'s2a', media_url:'https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?w=800&q=70',
      text:'Le labo', created_at:new Date(Date.now()-5*3600000).toISOString() }
  ]},
  { user_id:'u5', items:[
    { id:'s3a', media_url:'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&q=70',
      text:'', created_at:new Date(Date.now()-9*3600000).toISOString() }
  ]}
];

export async function loadStories() {
  const groups = api?.listStories ? await api.listStories() : SAMPLE;
  return groups.map(g => ({
    ...g,
    user: PEOPLE[g.user_id] || { id:g.user_id, full_name:'Étudiant', username:'?' },
    seen: g.items.every(i => seenStore.get(i.id, false))
  }));
}

export const markSeen = id => seenStore.set(id, true);

/** Reading time scales with the caption. */
const durationFor = item =>
  clamp(BASE_MS + (item.text?.length || 0) * PER_CHAR, BASE_MS, MAX_MS);

/* ------------------------------------------------------------
   VIEWER
   ------------------------------------------------------------ */

let viewer = null;

export async function openStories(startUserId) {
  if (viewer) return;
  const groups = await loadStories();
  if (!groups.length) { toast('Aucune story pour le moment'); return; }

  // begin at the first unseen group unless one was named
  let gi = startUserId
    ? Math.max(0, groups.findIndex(g => g.user_id === startUserId))
    : Math.max(0, groups.findIndex(g => !g.seen));
  let ii = 0;
  let raf = 0, startedAt = 0, elapsed = 0, paused = false;

  const root = el('div', { class: 'sv', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
  root.innerHTML = `
    <button class="sv-close icon-btn" aria-label="Fermer">${I.close}</button>
    <button class="sv-nav prev" aria-label="Précédent"><span>${I.chevron}</span></button>
    <button class="sv-nav next" aria-label="Suivant"><span>${I.chevron}</span></button>
    <div class="sv-stage">
      <div class="sv-bars" id="svBars"></div>
      <header class="sv-head" id="svHead"></header>
      <div class="sv-media" id="svMedia"></div>
      <footer class="sv-foot">
        <div class="sv-reacts" id="svReacts"></div>
        <div class="sv-reply">
          <input class="input" id="svReply" placeholder="Répondre…" aria-label="Répondre à la story">
          <button class="icon-btn btn-primary" id="svSend" aria-label="Envoyer">${I.send}</button>
        </div>
      </footer>
    </div>`;
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  root.focus();

  const bars = $('#svBars'), head = $('#svHead'), media = $('#svMedia');

  $('#svReacts').innerHTML = REACTION_KEYS.map(k =>
    `<button class="sv-react" data-k="${k}" data-tip="${esc(reactionLabel(k))}">${reactionIcon(k, 24)}</button>`).join('');

  function paint() {
    const g = groups[gi], item = g.items[ii];

    bars.innerHTML = g.items.map((_, i) =>
      `<i><span style="width:${i < ii ? '100%' : '0%'}"></span></i>`).join('');

    head.innerHTML = `
      <span class="av sm" style="background:${avatarColor(g.user.id)}">${esc(initials(g.user.full_name))}</span>
      <div class="grow" style="min-width:0">
        <div class="t-sm t-bold truncate">${esc(g.user.full_name)}</div>
        <div class="t-xs" style="opacity:.75">${timeAgo(item.created_at)}</div>
      </div>`;

    media.innerHTML = `
      <img src="${esc(item.media_url)}" alt="">
      ${item.text ? `<div class="sv-caption">${esc(item.text)}</div>` : ''}`;

    markSeen(item.id);
    restart();
  }

  function restart() {
    cancelAnimationFrame(raf);
    elapsed = 0;
    startedAt = performance.now();
    tick();
  }

  function tick() {
    const total = durationFor(groups[gi].items[ii]);
    const step = now => {
      if (paused) { startedAt = now - elapsed; raf = requestAnimationFrame(step); return; }
      elapsed = now - startedAt;
      const p = clamp(elapsed / total, 0, 1);
      const bar = bars.children[ii]?.firstElementChild;
      if (bar) bar.style.width = (p * 100) + '%';
      if (p >= 1) { next(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function next() {
    const g = groups[gi];
    if (ii + 1 < g.items.length) { ii++; paint(); return; }
    if (gi + 1 < groups.length) { gi++; ii = 0; paint(); return; }
    close();
  }

  function prev() {
    if (ii > 0) { ii--; paint(); return; }
    if (gi > 0) { gi--; ii = groups[gi].items.length - 1; paint(); return; }
    restart();
  }

  const pause = v => { paused = v; root.classList.toggle('paused', v); };

  on($('.sv-next') || root.querySelector('.sv-nav.next'), 'click', next);
  on(root.querySelector('.sv-nav.prev'), 'click', prev);
  on(root.querySelector('.sv-close'), 'click', close);

  // hovering the stage means "I am reading" — hold the timer
  const stage = root.querySelector('.sv-stage');
  on(stage, 'mouseenter', () => pause(true));
  on(stage, 'mouseleave', () => pause(false));

  // typing a reply must not let the story run away
  const reply = $('#svReply');
  on(reply, 'focus', () => pause(true));
  on(reply, 'blur', () => pause(false));
  on(reply, 'keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && reply.value.trim()) {
      toast('Réponse envoyée', 'ok');
      reply.value = '';
      reply.blur();
    }
  });
  on($('#svSend'), 'click', () => {
    if (!reply.value.trim()) return;
    toast('Réponse envoyée', 'ok');
    reply.value = '';
  });

  on($('#svReacts'), 'click', e => {
    const b = e.target.closest('.sv-react');
    if (!b) return;
    b.classList.add('burst');
    setTimeout(() => b.classList.remove('burst'), 500);
    toast(`${reactionLabel(b.dataset.k)} envoyé`, { duration: 1400 });
  });

  const offKeys = on(document, 'keydown', e => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft') prev();
    if (e.key === ' ') { e.preventDefault(); pause(!paused); }
  });

  function close() {
    cancelAnimationFrame(raf);
    offKeys();
    root.remove();
    document.body.style.overflow = '';
    viewer = null;
  }

  viewer = { close, next, prev };
  paint();
  return viewer;
}

export const isStoryOpen = () => !!viewer;
