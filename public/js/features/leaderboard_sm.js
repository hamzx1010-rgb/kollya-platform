/**
 * KOLIYA — features/leaderboard_sm.js
 * ============================================================
 * Full-page ranking: podium, filters, your own position.
 *
 * Two things this gets right that a naive list does not:
 *
 *   1. Your row is always reachable. If you rank 214th, the list
 *      still shows you pinned at the bottom with a "jump to me"
 *      button — a leaderboard you cannot find yourself in is just
 *      a wall of other people's names.
 *
 *   2. Ranking ties share a place. Two students on 400 XP are both
 *      3rd, and the next is 5th — not 3rd and 4th.
 * ============================================================
 */

import {
  $, $$, el, on, esc, compact, initials, avatarColor, debounce, env
} from '../core/utils_sm.js';
import { me, scoped } from '../core/store_sm.js';
import { t } from '../core/i18n_sm.js';
import { I, icon } from '../core/icons_sm.js';
import { toast, emptyState, skeletonList, countUp } from '../core/ui_sm.js';
import { route, go } from '../core/router_sm.js';
import { levelFromXp } from './hub_sm.js';

let api = null;
export function useApi(impl) { api = impl; }

const store = scoped('board');
let scope  = store.get('scope', 'faculty');   // faculty | all
let metric = store.get('metric', 'xp');       // xp | streak
let rows   = [];

/* ------------------------------------------------------------
   DATA
   ------------------------------------------------------------ */

async function load() {
  const list = api?.leaderboard ? await api.leaderboard({ scope, metric }) : [];
  const mine = me.get();

  // The faculty filter is applied by the query, so nothing is thrown
  // away here — a client-side filter would silently truncate the
  // page-size-50 result set.
  let out = list.map(r => ({ ...r, isMe: String(r.id) === String(mine?.id) }));
  out.sort((a, b) => (b[metric] || 0) - (a[metric] || 0));

  // dense ranking: equal scores share a place
  let place = 0, prev = null;
  out.forEach((r, i) => {
    if (r[metric] !== prev) { place = i + 1; prev = r[metric]; }
    r.rank = place;
  });
  return out;
}

/* ------------------------------------------------------------
   RENDER
   ------------------------------------------------------------ */

const value = r => metric === 'xp' ? `${compact(r.xp)} XP` : `${r.streak} j`;

function podium(top) {
  // visual order puts 1st in the middle, on the tallest step
  return `<div class="lb-podium">
    ${[1, 0, 2].map(i => {
      const r = top[i];
      if (!r) return '<div></div>';
      const place = i + 1;
      const lv = levelFromXp(r.xp || 0);
      return `<button class="lb-slot p${place}${r.isMe ? ' me' : ''}" data-user="${esc(r.username || '')}">
          ${place === 1 ? `<span class="lb-crown">${icon('trophy', { size: 18 })}</span>` : ''}
          <span class="av lg"${r.avatar_url ? '' : ` style="background:${avatarColor(r.id)}"`}>${
            r.avatar_url ? `<img src="${esc(r.avatar_url)}" alt="">` : esc(initials(r.full_name))}</span>
          <span class="lb-medal">${place}</span>
          <span class="t-sm t-bold truncate">${esc((r.full_name || '').split(' ')[0])}</span>
          <span class="t-xs t-dim t-mono">${value(r)}</span>
          <span class="t-xs t-dim2">Niv. ${lv.level}</span>
          <span class="lb-step"></span>
        </button>`;
    }).join('')}
  </div>`;
}

function row(r) {
  const lv = levelFromXp(r.xp || 0);
  return `<button class="lb-row${r.isMe ? ' me' : ''}" data-user="${esc(r.username || '')}" data-rank="${r.rank}">
      <span class="lb-rank t-mono">${r.rank}</span>
      <span class="av sm"${r.avatar_url ? '' : ` style="background:${avatarColor(r.id)}"`}>${
        r.avatar_url ? `<img src="${esc(r.avatar_url)}" alt="">` : esc(initials(r.full_name))}</span>
      <span class="grow" style="min-width:0;text-align:start">
        <span class="t-sm t-bold truncate" style="display:block">${esc(r.full_name)}${r.isMe ? ' <span class="pill" style="height:18px">vous</span>' : ''}</span>
        <span class="t-xs t-dim">${esc(r.faculty || '')} · Niv. ${lv.level}</span>
      </span>
      ${metric === 'streak' ? `<span class="lb-flame">${icon('fire', { size: 14 })}</span>` : ''}
      <span class="t-sm t-mono t-bold">${value(r)}</span>
    </button>`;
}

function render() {
  const host = $('#lbList');
  if (!host) return;

  if (!rows.length) {
    host.innerHTML = '';
    host.append(emptyState({
      icon: I.trophy,
      title: 'Classement vide',
      text: scope === 'faculty'
        ? 'Personne dans votre faculté pour l\'instant.'
        : t('empty.postToAppear')
    }));
    $('#lbMine')?.classList.add('hidden');
    return;
  }

  const top  = rows.slice(0, 3);
  const rest = rows.slice(3);

  host.innerHTML = podium(top) + (rest.length
    ? `<div class="lb-rows">${rest.map(row).join('')}</div>`
    : '');

  // Pin your own row when you are outside the visible top.
  const mine = rows.find(r => r.isMe);
  const bar = $('#lbMine');
  if (mine && bar) {
    bar.classList.remove('hidden');
    bar.innerHTML = `
      <span class="lb-rank t-mono">${mine.rank}</span>
      <span class="av sm" style="background:${avatarColor(mine.id)}">${esc(initials(mine.full_name))}</span>
      <span class="grow" style="min-width:0;text-align:start">
        <span class="t-sm t-bold">Votre position</span>
        <span class="t-xs t-dim">${mine.rank === 1 ? t('hub.leading') : `${mine.rank - 1} devant vous`}</span>
      </span>
      <span class="t-sm t-mono t-bold">${value(mine)}</span>
      <button class="btn btn-ghost btn-sm" id="lbJump">Voir</button>`;
    on($('#lbJump'), 'click', () => {
      const node = $$('.lb-row.me, .lb-slot.me')[0];
      node?.scrollIntoView({ block: 'center', behavior: env.reducedMotion ? 'auto' : 'smooth' });
      node?.classList.add('flash');
      setTimeout(() => node?.classList.remove('flash'), 1200);
    });
  } else if (bar) {
    bar.classList.add('hidden');
  }

  on(host, 'click', e => {
    const b = e.target.closest('[data-user]');
    if (b?.dataset.user) go('profile', b.dataset.user);
  }, { once: true });
}

/* ------------------------------------------------------------
   VIEW
   ------------------------------------------------------------ */

export function initLeaderboard(mountFn) {
  route('leaderboard', async () => {
    const host = mountFn();
    if (!host) return;
    host.closest('.view')?.classList.remove('full');

    host.innerHTML = `
      <div class="lb-head">
        <div class="lb-title">
          <span class="lb-title-ic">${icon('trophy', { size: 20 })}</span>
          <div>
            <div class="t-bold" style="font-size:var(--fs-lg)">Classement</div>
            <div class="t-xs t-dim">Mis à jour en continu</div>
          </div>
        </div>
        <div class="lb-filters">
          <div class="row g1">
            <button class="pill lb-scope${scope === 'faculty' ? ' on' : ''}" data-scope="faculty">Ma faculté</button>
            <button class="pill lb-scope${scope === 'all' ? ' on' : ''}" data-scope="all">Tout le campus</button>
          </div>
          <div class="row g1">
            <button class="pill lb-metric${metric === 'xp' ? ' on' : ''}" data-metric="xp">XP</button>
            <button class="pill lb-metric${metric === 'streak' ? ' on' : ''}" data-metric="streak">Séries</button>
          </div>
        </div>
      </div>
      <div id="lbList">${skeletonList(5, 'conv')}</div>
      <div class="lb-mine blur-bar hidden" id="lbMine"></div>`;

    for (const b of $$('.lb-scope')) {
      on(b, 'click', async () => {
        scope = b.dataset.scope; store.set('scope', scope);
        for (const x of $$('.lb-scope')) x.classList.toggle('on', x === b);
        rows = await load(); render();
      });
    }
    for (const b of $$('.lb-metric')) {
      on(b, 'click', async () => {
        metric = b.dataset.metric; store.set('metric', metric);
        for (const x of $$('.lb-metric')) x.classList.toggle('on', x === b);
        rows = await load(); render();
      });
    }

    rows = await load();
    render();
  });
}
