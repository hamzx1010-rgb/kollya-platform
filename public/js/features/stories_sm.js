/**
 * KOLIYA — features/stories_sm.js
 * ============================================================
 * Story ring, viewer and composer — all backed by Neon.
 *
 * Three decisions worth naming:
 *   - the timer is derived from how much there is to read, not a
 *     flat 5 seconds for everyone
 *   - hovering pauses it. On the web, a cursor resting on a story
 *     means the person is reading, so advancing would be rude
 *   - an image that fails to load says so. The previous build showed
 *     "Chargement" forever because the URLs pointed at an external
 *     host; stories now live in the database, and a broken one is
 *     reported instead of hidden.
 * ============================================================
 */

import {
  $, $$, el, on, esc, initials, avatarColor, timeAgo, clamp, env, safeUrl, uid
} from '../core/utils_sm.js';
import { me, scoped } from '../core/store_sm.js';
import { t } from '../core/i18n_sm.js';
import { person } from '../core/people_sm.js';
import { act } from '../core/game_sm.js';
import { I, icon, reactionIcon, REACTION_KEYS, reactionLabel } from '../core/icons_sm.js';
import { toast, modal, confirmDialog } from '../core/ui_sm.js';
import { openImageEditor } from './editor_sm.js';

const seenStore = scoped('story');
const BASE_MS = 4200;
const PER_CHAR = 45;      // extra time per character of caption
const MAX_MS = 12000;

let api = null;
export function useApi(impl) { api = impl; }

/* ------------------------------------------------------------
   DATA
   ------------------------------------------------------------ */

/**
 * Groups of active stories, newest last within each group.
 * Returns [] rather than throwing: an empty ring is a fine answer,
 * a crashed feed is not.
 */
export async function loadStories() {
  if (!api?.listStories) return [];
  let groups = [];
  try {
    groups = await api.listStories();
  } catch (e) {
    console.warn('[koliya] stories indisponibles', e.message);
    return [];
  }
  return (groups || []).map(g => ({
    ...g,
    user: g.user || person(g.user_id),
    seen: g.items.every(i => seenStore.get(String(i.id), false))
  }));
}

export const markSeen = id => {
  seenStore.set(String(id), true);
  api?.markSeen?.(id);
};

/** Reading time scales with the caption. */
const durationFor = item =>
  clamp(BASE_MS + (item.text?.length || 0) * PER_CHAR, BASE_MS, MAX_MS);

/* ------------------------------------------------------------
   COMPOSER
   The "Création de story bientôt" placeholder, implemented.
   ------------------------------------------------------------ */

export async function openStoryComposer() {
  const pick = el('input', { type: 'file', accept: 'image/*', hidden: true });
  document.body.append(pick);

  const file = await new Promise(resolve => {
    on(pick, 'change', () => resolve(pick.files?.[0] || null), { once: true });
    // cancelling the OS dialog fires no event, so a focus return with
    // no file selected resolves null instead of hanging forever
    on(window, 'focus', () => setTimeout(() => resolve(pick.files?.[0] || null), 400), { once: true });
    pick.click();
  });
  pick.remove();
  if (!file) return null;

  // 9:16 is suggested because that is what a story is
  const edited = await openImageEditor(file, 'story');
  if (!edited) return null;

  const caption = el('input', { class: 'input', placeholder: 'Légende (facultatif)…', maxlength: '140' });
  const previewUrl = URL.createObjectURL(edited);
  const foot = el('div', { class: 'row g2' });

  return new Promise(resolve => {
    let settled = false;
    const done = v => { if (settled) return; settled = true; URL.revokeObjectURL(previewUrl); resolve(v); };

    const m = modal({
      title: 'Nouvelle story',
      body: el('div', { class: 'col g3' },
        el('div', { class: 'story-preview', html: `<img src="${previewUrl}" alt="">` }),
        caption,
        el('div', { class: 't-xs t-dim' }, 'Visible 24 heures par les étudiants approuvés.')),
      footer: foot,
      onClose: () => done(null)
    });

    foot.append(
      el('button', { class: 'btn btn-ghost', onclick: () => { m.close(); done(null); } }, 'Annuler'),
      el('button', { class: 'btn btn-primary', onclick: async e => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Publication…';
        try {
          const row = await api.createStory({ file: edited, text: caption.value.trim() });
          act('story', row?.id);
          m.close();
          toast('Story publiée — visible 24 h', 'ok');
          done(row);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Publier';
          toast(err?.message || 'Story non publiée', 'err');
        }
      }}, 'Publier')
    );

    setTimeout(() => caption.focus(), 80);
  });
}

/* ------------------------------------------------------------
   VIEWER
   ------------------------------------------------------------ */

let viewer = null;

export async function openStories(startUserId) {
  if (viewer) return;
  const groups = await loadStories();
  if (!groups.length) {
    toast('Aucune story pour le moment', {
      action: { label: 'En créer une', fn: () => openStoryComposer() }
    });
    return;
  }

  // begin at the named group, else at the first unseen one
  let gi = startUserId
    ? Math.max(0, groups.findIndex(g => String(g.user_id) === String(startUserId)))
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
    const u = g.user || person(g.user_id);
    const isMine = String(g.user_id) === String(me.id);

    bars.innerHTML = g.items.map((_, i) =>
      `<i><span style="width:${i < ii ? '100%' : '0%'}"></span></i>`).join('');

    head.innerHTML = `
      ${u.avatar_url
        ? `<span class="av sm"><img src="${esc(safeUrl(u.avatar_url))}" alt=""></span>`
        : `<span class="av sm" style="background:${avatarColor(u.id)}">${esc(initials(u.full_name))}</span>`}
      <div class="grow" style="min-width:0">
        <div class="t-sm t-bold truncate">${esc(u.full_name)}</div>
        <div class="t-xs" style="opacity:.75">${timeAgo(item.created_at)}</div>
      </div>
      ${isMine ? `<button class="icon-btn sv-viewers" id="svViewers" aria-label="Vues">${I.user}</button>
                  <button class="icon-btn sv-del" id="svDelete" aria-label="Supprimer">${I.trash}</button>` : ''}`;

    // A story that cannot load says so, instead of a black rectangle
    // with a spinner that never resolves.
    media.innerHTML = `
      <div class="sv-loading">${icon('image', { size: 26 })}<span>Chargement…</span></div>
      <img src="${esc(safeUrl(item.media_url))}" alt="" style="opacity:0">
      ${item.text ? `<div class="sv-caption">${esc(item.text)}</div>` : ''}`;

    const img = media.querySelector('img');
    const spinner = media.querySelector('.sv-loading');
    on(img, 'load', () => { img.style.opacity = '1'; spinner?.remove(); });
    on(img, 'error', () => {
      spinner.innerHTML = `${icon('eyeOff', { size: 26 })}<span>Image indisponible</span>`;
      spinner.classList.add('failed');
    });
    if (img.complete && img.naturalWidth) { img.style.opacity = '1'; spinner?.remove(); }

    on($('#svDelete'), 'click', async () => {
      pause(true);
      const ok = await confirmDialog({
        title: 'Supprimer cette story ?', message: 'Elle disparaîtra immédiatement.',
        confirmLabel: t('action.delete'), danger: true
      });
      if (!ok) { pause(false); return; }
      try {
        await api.deleteStory(item.id);
        g.items.splice(ii, 1);
        if (!g.items.length) {
          groups.splice(gi, 1);
          if (!groups.length) { close(); return; }
          gi = Math.min(gi, groups.length - 1);
        }
        ii = 0;
        toast('Story supprimée', 'ok');
        paint();
      } catch { toast('Suppression échouée', 'err'); pause(false); }
    });

    on($('#svViewers'), 'click', async () => {
      pause(true);
      const list = await api.viewers(item.id).catch(() => []);
      modal({
        title: `Vues · ${list.length}`,
        body: list.length
          ? `<div class="col g3">${list.map(v => `
              <div class="row g3">
                ${v.user.avatar_url
                  ? `<span class="av sm"><img src="${esc(safeUrl(v.user.avatar_url))}" alt=""></span>`
                  : `<span class="av sm" style="background:${avatarColor(v.user_id)}">${esc(initials(v.user.full_name))}</span>`}
                <div class="grow"><div class="t-sm t-bold">${esc(v.user.full_name)}</div>
                <div class="t-xs t-dim">${timeAgo(v.viewed_at)}</div></div>
              </div>`).join('')}</div>`
          : `<div class="tg-empty">${icon('user', { size: 22 })}<span>Personne pour l'instant</span></div>`,
        onClose: () => pause(false)
      });
    });

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

  on(root.querySelector('.sv-nav.next'), 'click', next);
  on(root.querySelector('.sv-nav.prev'), 'click', prev);
  on(root.querySelector('.sv-close'), 'click', close);

  // hovering the stage means "I am reading" — hold the timer
  const stage = root.querySelector('.sv-stage');
  on(stage, 'mouseenter', () => pause(true));
  on(stage, 'mouseleave', () => pause(false));

  /** A story reply is a normal DM, which is what it always was. */
  async function sendReply(text) {
    const g = groups[gi];
    if (!text.trim()) return;
    if (String(g.user_id) === String(me.id)) { toast('C\'est votre propre story'); return; }
    try {
      await api.reply(g.user_id, text.trim());
      toast(`Réponse envoyée à ${g.user.full_name}`, 'ok');
    } catch { toast('Réponse non envoyée', 'err'); }
  }

  const reply = $('#svReply');
  on(reply, 'focus', () => pause(true));
  on(reply, 'blur', () => pause(false));
  on(reply, 'keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && reply.value.trim()) {
      sendReply(reply.value);
      reply.value = '';
      reply.blur();
    }
  });
  on($('#svSend'), 'click', () => {
    if (!reply.value.trim()) return;
    sendReply(reply.value);
    reply.value = '';
  });

  on($('#svReacts'), 'click', e => {
    const b = e.target.closest('.sv-react');
    if (!b) return;
    b.classList.add('burst');
    setTimeout(() => b.classList.remove('burst'), 500);
    sendReply(reactionLabel(b.dataset.k));
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
