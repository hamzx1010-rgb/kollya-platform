/**
 * KOLIYA — features/hub_sm.js
 * ============================================================
 * Hub: streak, XP, level, daily quests, badges, leaderboard.
 *
 * Progress is derived, never hand-edited. Every number here is
 * computed from what the student actually did, so there is no state
 * to keep in sync and nothing to fake.
 * ============================================================
 */

import {
  $, $$, el, on, esc, compact, initials, avatarColor, clamp, timeAgo
} from '../core/utils_sm.js';
import { me, read, write, scoped, on as onEvent } from '../core/store_sm.js';
import { t } from '../core/i18n_sm.js';
import { questLabel } from '../core/game_sm.js';
import { I, icon } from '../core/icons_sm.js';
import { toast, modal, countUp, skeletonList, emptyState, contextMenu } from '../core/ui_sm.js';
import { route } from '../core/router_sm.js';
import {
  XP, xpForLevel, levelFromXp, getQuests, getStreak, isDayComplete,
  trackQuest, myRank, rankBadge
} from '../core/game_sm.js';

let api = null;
export function useApi(impl) { api = impl; }

const store = scoped('hub');

/* Levels, XP values and quest rules all live in core/game_sm.js now.
   They used to be defined here AND applied nowhere, which is how the
   hub ended up as a scoreboard for a game that was never running. */
export { xpForLevel, levelFromXp, XP, trackQuest };

/* ------------------------------------------------------------
   BADGES  — thresholds, not manual awards
   ------------------------------------------------------------ */

export const BADGES = [
  { id:'first_post', icon:'edit',       name:t('badge.firstPost'), desc:t('badge.firstPostD'),      need:s => s.posts >= 1 },
  { id:'writer',     icon:'edit',       name:t('badge.writer'), desc:t('badge.writerD'),                    need:s => s.posts >= 10 },
  { id:'social',     icon:'message',    name:t('badge.social'), desc:t('badge.socialD'),             need:s => s.comments >= 25 },
  { id:'liked',      icon:'fire',       name:t('badge.liked'), desc:t('badge.likedD'),                need:s => s.likes >= 50 },
  { id:'helper',     icon:'help',       name:t('badge.helper'), desc:t('badge.helperD'),            need:s => s.answers >= 10 },
  { id:'streak7',    icon:'fire',       name:t('badge.week'),          desc:t('badge.weekDesc'),                 need:s => s.streak >= 7 },
  { id:'streak30',   icon:'trophy',     name:t('badge.month'), desc:t('badge.monthD'),                need:s => s.streak >= 30 },
  { id:'popular',    icon:'users',      name:t('badge.popular'), desc:t('badge.popularD'),               need:s => s.followers >= 50 },
  { id:'organizer',  icon:'calendar',   name:t('badge.organizer'), desc:t('badge.organizerD'),                 need:s => s.events >= 3 },
  { id:'scholar',    icon:'graduation', name:t('badge.scholar'), desc:t('badge.scholarD'),             need:s => s.level >= 10 },
  { id:'night_owl',  icon:'moon',       name:t('badge.night'), desc:t('badge.nightD'),               need:s => s.nightPosts >= 1 },
  { id:'archivist',  icon:'bookmark',   name:t('badge.archivist'), desc:t('badge.archivistD'),        need:s => s.saved >= 20 }
];

/* ------------------------------------------------------------
   STATS
   ------------------------------------------------------------ */

/**
 * Cached snapshot of the real counters. `stats()` stays synchronous
 * because a dozen render paths call it inline; `refreshStats()` is
 * what actually talks to Neon, and it repaints when the numbers land.
 */
let statsCache = {
  posts: 0, comments: 0, likes: 0, answers: 0,
  followers: 0, events: 0, saved: 0, nightPosts: 0,
  streak: 0, xp: 0
};

function stats() {
  const mine = me.get() || {};
  const st = getStreak();
  const merged = {
    ...statsCache,
    xp: mine.xp ?? statsCache.xp,
    streak: st.streak || mine.streak || 0,
    streak_best: st.streak_best || mine.streak_best || 0,
    freeze_available: st.freeze_available
  };
  merged.level = levelFromXp(merged.xp).level;
  return merged;
}

export async function refreshStats() {
  if (!api?.stats) return statsCache;
  try {
    statsCache = { ...statsCache, ...(await api.stats()) };
    if ($('#badgeGrid')) renderHub();   // the hub is on screen
  } catch (e) { console.warn('[koliya] stats indisponibles', e.message); }
  return statsCache;
}

export const earnedBadges = s => BADGES.filter(b => b.need(s));

/* ------------------------------------------------------------
   CELEBRATION
   ------------------------------------------------------------ */

function celebrate({ streak, grew, xp }) {
  const host = el('div', { class: 'confetti' });
  const colors = ['#2563EB','#F59E0B','#EC4899','#16A34A','#7C3AED'];
  for (let i = 0; i < 28; i++) {
    host.append(el('i', { style: {
      left: Math.random() * 100 + '%',
      background: colors[i % colors.length],
      animationDelay: (Math.random() * .35) + 's',
      transform: `rotate(${Math.random() * 360}deg)`
    }}));
  }
  document.body.append(host);
  setTimeout(() => host.remove(), 2600);

  modal({
    title: t('hub.dayComplete'),
    body: `<div class="col center g4" style="text-align:center;padding:var(--s4) 0">
        <div class="streak-flame big">${icon('fire', { size: 46 })}</div>
        <div style="font-size:var(--fs-2xl);font-weight:700">${streak} jour${streak > 1 ? 's' : ''}</div>
        <p class="t-dim">+${xp} XP.${grew ? ' ' + t('streak.continues') : ''}
           Revenez demain — une journée manquée la remet à zéro.</p>
      </div>`
  });
}

function unlockBadge(badge) {
  modal({
    title: 'Nouveau badge',
    body: `<div class="col center g4" style="text-align:center;padding:var(--s4) 0">
        <div class="badge-unlock">${icon(badge.icon, { size: 40 })}</div>
        <div style="font-size:var(--fs-xl);font-weight:700">${esc(badge.name)}</div>
        <p class="t-dim">${esc(badge.desc)}</p>
      </div>`
  });
}

/* ------------------------------------------------------------
   RENDER
   ------------------------------------------------------------ */

function heroMarkup(s, lv) {
  return `
  <section class="hub-hero">
    <div class="hub-hero-bg"></div>
    <div class="hub-hero-in">
      <div class="row g4 between wrap">
        <div>
          <div class="t-xs" style="opacity:.8;letter-spacing:.06em;text-transform:uppercase">${t('hub.levelN', { n: lv.level })}</div>
          <div style="font-size:var(--fs-3xl);font-weight:700;line-height:1.1" id="hubXp">0</div>
          <div class="t-sm" style="opacity:.85">${t('hub.xp')}</div>
        </div>
        <div class="streak-block">
          <div class="streak-flame${s.streak ? '' : ' cold'}" style="--n:${clamp(s.streak / 30, .3, 1)}">${icon('fire', { size: 30 })}</div>
          <div>
            <div style="font-size:var(--fs-xl);font-weight:700" id="hubStreak">0</div>
            <div class="t-xs" style="opacity:.85">${t('hub.streakDays')}</div>
            ${s.streak_best > s.streak ? `<div class="t-xs" style="opacity:.6">record ${s.streak_best}</div>` : ''}
          </div>
          <span class="freeze-chip${s.freeze_available ? '' : ' spent'}"
                data-tip="${s.freeze_available
                  ? 'Gel disponible : une journée manquée sera rattrapée automatiquement ce mois-ci'
                  : t('streak.freezeUsed')}">
            ${icon('spark', { size: 12 })} ${s.freeze_available ? t('hub.freezeReady') : t('hub.freezeUsed')}
          </span>
        </div>
      </div>
      <div class="hub-progress">
        <div class="row between t-xs" style="opacity:.85">
          <span>${t('hub.levelN', { n: lv.level })}</span><span>${t('hub.xpOf', { into: lv.into, need: lv.need })}</span>
        </div>
        <div class="bar" style="background:rgba(255,255,255,.25)">
          <div class="bar-fill" id="hubBar" style="width:0;background:#fff"></div>
        </div>
      </div>
    </div>
  </section>`;
}

function renderQuests() {
  const host = $('#questList');
  if (!host) return;
  const quests = getQuests();
  const done = quests.filter(q => q.done).length;

  host.innerHTML = quests.map(q => {
    const pct = Math.round(q.progress / q.target * 100);
    const complete = q.done;
    return `<div class="quest${complete ? ' done' : ''}">
        <span class="quest-ic">${complete ? icon('check', { size: 16 }) : icon(q.icon, { size: 16 })}</span>
        <div class="grow" style="min-width:0">
          <div class="row between">
            <span class="t-sm">${esc(questLabel(q))}</span>
            <span class="t-xs t-dim t-mono">${q.progress}/${q.target}</span>
          </div>
          <div class="bar" style="height:4px;margin-top:5px"><div class="bar-fill" style="width:${pct}%"></div></div>
        </div>
      </div>`;
  }).join('');

  const head = $('#questCount');
  if (head) head.textContent = `${done}/${quests.length}`;
}

function renderBadges(s) {
  const host = $('#badgeGrid');
  if (!host) return;
  const earned = new Set(earnedBadges(s).map(b => b.id));

  host.innerHTML = BADGES.map(b => `
    <button class="badge${earned.has(b.id) ? ' earned' : ''}" data-badge="${b.id}"
            data-tip="${esc(b.desc)}">
      <span class="badge-ic">${icon(b.icon, { size: 22 })}</span>
      <span class="t-xs truncate">${esc(b.name)}</span>
    </button>`).join('');

  const c = $('#badgeCount');
  if (c) c.textContent = `${earned.size}/${BADGES.length}`;

  for (const btn of $$('.badge')) {
    on(btn, 'click', () => {
      const b = BADGES.find(x => x.id === btn.dataset.badge);
      const has = earned.has(b.id);
      modal({
        title: has ? 'Badge obtenu' : t('hub.badgeToUnlock'),
        body: `<div class="col center g3" style="text-align:center;padding:var(--s4) 0">
            <div class="badge-unlock${has ? '' : ' locked'}">${icon(b.icon, { size: 36 })}</div>
            <div style="font-size:var(--fs-lg);font-weight:650">${esc(b.name)}</div>
            <p class="t-dim">${esc(b.desc)}</p>
            ${has ? '<span class="pill on">Obtenu</span>' : '<span class="pill">Pas encore</span>'}
          </div>`
      });
    });
  }
}

/* ------------------------------------------------------------
   LEADERBOARD
   ------------------------------------------------------------ */

let boardRows = [];
let boardScope = 'faculty';

async function refreshBoard() {
  if (!api?.leaderboard) return;
  try {
    boardRows = await api.leaderboard({ scope: boardScope, metric: 'xp' });
  } catch { boardRows = []; }
  if ($('#boardList')) renderBoard();
}

function renderBoard() {
  const host = $('#boardList');
  if (!host) return;

  const mine = me.get();
  let rows = [...boardRows].map(r => ({ ...r, isMe: String(r.id) === String(mine?.id) }));
  rows.sort((a, b) => (b.xp || 0) - (a.xp || 0));

  if (!rows.length) {
    host.innerHTML = `<div class="tg-empty">${icon('trophy', { size: 22 })}<span>Personne pour l'instant</span></div>`;
    return;
  }

  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);

  host.innerHTML = `
    <div class="podium">
      ${[1, 0, 2].map(i => {
        const r = podium[i];
        if (!r) return '<div></div>';
        const place = i + 1;
        return `<div class="podium-slot p${place}${r.isMe ? ' me' : ''}">
            <div class="av lg"${r.avatar_url ? '' : ` style="background:${avatarColor(r.id)}"`}>${
              r.avatar_url ? `<img src="${esc(r.avatar_url)}" alt="">` : esc(initials(r.full_name))}</div>
            <div class="podium-rank">${place}</div>
            <div class="t-sm t-bold truncate">${esc(r.full_name.split(' ')[0])}</div>
            <div class="t-xs t-dim t-mono">${compact(r.xp)} XP</div>
            <div class="podium-bar"></div>
          </div>`;
      }).join('')}
    </div>
    ${rest.map((r, i) => `
      <div class="board-row${r.isMe ? ' me' : ''}">
        <span class="board-rank t-mono">${i + 4}</span>
        <span class="av sm"${r.avatar_url ? '' : ` style="background:${avatarColor(r.id)}"`}>${
          r.avatar_url ? `<img src="${esc(r.avatar_url)}" alt="">` : esc(initials(r.full_name))}</span>
        <div class="grow" style="min-width:0">
          <div class="t-sm t-bold truncate">${esc(r.full_name)}</div>
          <div class="t-xs t-dim">${esc(r.faculty)}</div>
        </div>
        <span class="t-sm t-mono t-bold">${compact(r.xp)}</span>
      </div>`).join('')}`;
}

/**
 * Your standing, stated plainly — and what it buys you.
 * The reward for reaching the top is visibility: you sort first in
 * "Étudiants à découvrir", so real students find and follow you.
 * No invented follower counts.
 */
async function showMyRank() {
  const host = $('#rankStrip');
  if (!host) return;
  const rank = await myRank(boardScope);
  if (!rank) {
    host.innerHTML = `<div class="rank-strip out">
        ${icon('trophy', { size: 15 })}
        <span>Hors du top 50 — publiez et répondez pour y entrer.</span>
      </div>`;
    return;
  }
  const badge = rankBadge(rank);
  host.innerHTML = `<div class="rank-strip${badge ? ' in' : ''}">
      ${icon('trophy', { size: 15 })}
      <span><b>${rank}${rank === 1 ? 'ᵉʳ' : 'ᵉ'}</b> ${boardScope === 'faculty' ? t('hub.ofFaculty') : 'du campus'}</span>
      ${badge ? `<span class="rank-reward">${icon('spark', { size: 12 })} Mis en avant dans « Étudiants à découvrir »</span>` : ''}
    </div>`;
}

/* ------------------------------------------------------------
   VIEW
   ------------------------------------------------------------ */

/* The hub is a view onto game_sm, so it repaints whenever the engine
   says something changed — including from another screen. Liking a
   post in the feed moves the quest bar here without a reload. */
let gameWired = false;

/**
 * Bound once at BOOT, not when the hub opens.
 *
 * The bug: this used to be called inside route('hub'), so liking a
 * post from the feed advanced the quest in memory, emitted
 * 'game:quests' — and nothing was listening, because the hub had
 * never been opened. Progress only appeared after you visited the
 * hub, which read as "the quests are not dynamic".
 *
 * The render calls are guarded by element checks, so wiring early is
 * free when the hub is not on screen.
 */
export function wireGameEvents() {
  if (gameWired) return;
  gameWired = true;
  onEvent('game:quests', () => { if ($('#questList')) renderQuests(); });
  onEvent('game:streak', () => { if ($('#badgeGrid')) renderHub(); });
  onEvent('game:xp',     () => { if ($('#badgeGrid')) renderHub(); });
  onEvent('game:day-complete', payload => celebrate(payload));

  // A quest finishing anywhere in the app is worth saying out loud,
  // even when the hub is closed — that is the feedback loop.
  onEvent('game:quest-done', ({ label, remaining }) => {
    toast(`Défi accompli · ${label}` +
          (remaining ? ` — ${remaining}` : ' ' + t('hub.dayDone')),
          { kind: 'ok', duration: 3500 });
  });
}

/** Repaint the hub from whatever the cache currently holds. */
function renderHub() {
  const s = stats();
  const hero = $('.hub-hero');
  if (hero) hero.outerHTML = heroMarkup(s, levelFromXp(s.xp));
  renderBadges(s);
}

export function initHub(mountFn) {
  route('hub', () => {
    const host = mountFn();
    if (!host) return;
    host.closest('.view')?.classList.remove('full');

    const s = stats();
    const lv = levelFromXp(s.xp);

    host.innerHTML = `
      ${heroMarkup(s, lv)}

      <section class="hub-sec">
        <div class="hub-sec-head">
          <span>${t('hub.quests')}</span>
          <span class="pill" id="questCount">0/3</span>
        </div>
        <div id="questList"></div>
      </section>

      <section class="hub-sec">
        <div class="hub-sec-head">
          <span>${t('hub.badges')}</span>
          <span class="pill" id="badgeCount">0/${BADGES.length}</span>
        </div>
        <div class="badge-grid" id="badgeGrid"></div>
      </section>

      <section class="hub-sec">
        <div class="hub-sec-head">
          <span>${t('hub.leaderboard')}</span>
          <div class="row g1">
            <button class="pill board-scope on" data-scope="faculty">${t('hub.myFaculty')}</button>
            <button class="pill board-scope" data-scope="all">${t('hub.allCampus')}</button>
          </div>
        </div>
        <div id="rankStrip"></div>
        <div id="boardList"></div>
      </section>`;

    wireGameEvents();
    renderQuests();
    renderBadges(s);
    renderBoard();

    // real numbers land a moment later and repaint in place
    refreshStats();
    refreshBoard();
    showMyRank();

    for (const btn of $$('.board-scope')) {
      on(btn, 'click', () => {
        boardScope = btn.dataset.scope;
        refreshBoard();
        showMyRank();
        for (const b of $$('.board-scope')) b.classList.toggle('on', b === btn);
        renderBoard();
      });
    }

    // numbers count up rather than snapping into place
    requestAnimationFrame(() => {
      countUp($('#hubXp'), s.xp);
      countUp($('#hubStreak'), s.streak);
      const bar = $('#hubBar');
      if (bar) setTimeout(() => { bar.style.width = lv.pct + '%'; }, 120);
    });

    // opening the hub counts as showing up
    trackQuest('visit');
  });
}
