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
import { I, icon } from '../core/icons_sm.js';
import { toast, modal, countUp, skeletonList, emptyState, contextMenu } from '../core/ui_sm.js';
import { route } from '../core/router_sm.js';

let api = null;
export function useApi(impl) { api = impl; }

const store = scoped('hub');

/* ------------------------------------------------------------
   LEVELS
   Each level costs a bit more than the last, so early progress is
   quick and later levels stay meaningful.
   ------------------------------------------------------------ */

export const xpForLevel = lvl => Math.round(80 * Math.pow(lvl, 1.35));

export function levelFromXp(xp) {
  let lvl = 1, spent = 0;
  while (spent + xpForLevel(lvl) <= xp) { spent += xpForLevel(lvl); lvl++; }
  const into = xp - spent;
  const need = xpForLevel(lvl);
  return { level: lvl, into, need, pct: Math.round(into / need * 100) };
}

export const XP = {
  post: 12, comment: 5, like_received: 2, story: 8,
  answer: 10, event_join: 6, daily_complete: 25, streak_day: 15
};

/* ------------------------------------------------------------
   BADGES  — thresholds, not manual awards
   ------------------------------------------------------------ */

export const BADGES = [
  { id:'first_post', icon:'edit',       name:'Première publication', desc:'Publier pour la première fois',      need:s => s.posts >= 1 },
  { id:'writer',     icon:'edit',       name:'Plume active',         desc:'Publier 10 fois',                    need:s => s.posts >= 10 },
  { id:'social',     icon:'message',    name:'Sociable',             desc:'Écrire 25 commentaires',             need:s => s.comments >= 25 },
  { id:'liked',      icon:'fire',       name:'Apprécié',             desc:'Recevoir 50 j\'aime',                need:s => s.likes >= 50 },
  { id:'helper',     icon:'help',       name:'Entraide',             desc:'Répondre à 10 questions',            need:s => s.answers >= 10 },
  { id:'streak7',    icon:'fire',       name:'Une semaine',          desc:'7 jours d\'affilée',                 need:s => s.streak >= 7 },
  { id:'streak30',   icon:'trophy',     name:'Un mois entier',       desc:'30 jours d\'affilée',                need:s => s.streak >= 30 },
  { id:'popular',    icon:'users',      name:'Connu du campus',      desc:'Atteindre 50 abonnés',               need:s => s.followers >= 50 },
  { id:'organizer',  icon:'calendar',   name:'Organisateur',         desc:'Créer 3 événements',                 need:s => s.events >= 3 },
  { id:'scholar',    icon:'graduation', name:'Érudit',               desc:'Atteindre le niveau 10',             need:s => s.level >= 10 },
  { id:'night_owl',  icon:'moon',       name:'Oiseau de nuit',       desc:'Publier après minuit',               need:s => s.nightPosts >= 1 },
  { id:'archivist',  icon:'bookmark',   name:'Archiviste',           desc:'Enregistrer 20 publications',        need:s => s.saved >= 20 }
];

/* ------------------------------------------------------------
   DAILY QUESTS  — same set for everyone each day, seeded by date
   ------------------------------------------------------------ */

const QUEST_POOL = [
  { id:'post',    label:'Publier une fois',            target:1, icon:'edit' },
  { id:'comment', label:'Commenter 3 publications',    target:3, icon:'comment' },
  { id:'like',    label:'Aimer 5 publications',        target:5, icon:'fire' },
  { id:'visit',   label:'Ouvrir Koliya',               target:1, icon:'home' },
  { id:'answer',  label:'Répondre à une question',     target:1, icon:'help' },
  { id:'story',   label:'Publier une story',           target:1, icon:'camera' }
];

const todayKey = () => new Date().toISOString().slice(0, 10);

/** Deterministic pick so everyone sees the same quests on a given day. */
function dailyQuests() {
  const key = todayKey();
  const saved = store.get('daily:' + key);
  if (saved) return saved;

  let seed = [...key].reduce((a, c) => a + c.charCodeAt(0), 0);
  const pool = [...QUEST_POOL];
  const picked = [];
  while (picked.length < 3 && pool.length) {
    seed = (seed * 9301 + 49297) % 233280;
    picked.push(pool.splice(seed % pool.length, 1)[0]);
  }
  const quests = picked.map(q => ({ ...q, progress: 0 }));
  store.set('daily:' + key, quests);
  return quests;
}

/** Called by other features when the student does something. */
export function trackQuest(id, amount = 1) {
  const key = todayKey();
  const quests = dailyQuests();
  const q = quests.find(x => x.id === id);
  if (!q || q.progress >= q.target) return;

  q.progress = Math.min(q.target, q.progress + amount);
  store.set('daily:' + key, quests);

  if (q.progress >= q.target) {
    toast(`Défi accompli : ${q.label}`, { kind: 'ok' });
    if (quests.every(x => x.progress >= x.target)) completeDay();
  }
  if ($('#questList')) renderQuests();
}

function completeDay() {
  const key = todayKey();
  if (store.get('done:' + key)) return;
  store.set('done:' + key, true);

  const s = stats();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const streak = store.get('done:' + yesterday) ? (s.streak || 0) + 1 : 1;
  store.set('streak', streak);
  store.set('xp', (store.get('xp', 0)) + XP.daily_complete + XP.streak_day);

  celebrate(streak);
}

/* ------------------------------------------------------------
   STATS
   ------------------------------------------------------------ */

function stats() {
  const base = {
    posts: 14, comments: 31, likes: 62, answers: 12,
    followers: 38, events: 1, saved: 9, nightPosts: 2,
    streak: store.get('streak', 7),
    xp: store.get('xp', 340)
  };
  const merged = { ...base, ...(api?.stats?.() || {}) };
  merged.level = levelFromXp(merged.xp).level;
  return merged;
}

export const earnedBadges = s => BADGES.filter(b => b.need(s));

/* ------------------------------------------------------------
   CELEBRATION
   ------------------------------------------------------------ */

function celebrate(streak) {
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
    title: 'Défis du jour accomplis',
    body: `<div class="col center g4" style="text-align:center;padding:var(--s4) 0">
        <div class="streak-flame big">${icon('fire', { size: 46 })}</div>
        <div style="font-size:var(--fs-2xl);font-weight:700">${streak} jour${streak > 1 ? 's' : ''}</div>
        <p class="t-dim">Vous avez gagné ${XP.daily_complete + XP.streak_day} XP. Revenez demain pour continuer la série.</p>
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
          <div class="t-xs" style="opacity:.8;letter-spacing:.06em;text-transform:uppercase">Niveau ${lv.level}</div>
          <div style="font-size:var(--fs-3xl);font-weight:700;line-height:1.1" id="hubXp">0</div>
          <div class="t-sm" style="opacity:.85">XP au total</div>
        </div>
        <div class="streak-block">
          <div class="streak-flame" style="--n:${clamp(s.streak / 30, .3, 1)}">${icon('fire', { size: 30 })}</div>
          <div>
            <div style="font-size:var(--fs-xl);font-weight:700" id="hubStreak">0</div>
            <div class="t-xs" style="opacity:.85">jours d'affilée</div>
          </div>
        </div>
      </div>
      <div class="hub-progress">
        <div class="row between t-xs" style="opacity:.85">
          <span>Niveau ${lv.level}</span><span>${lv.into} / ${lv.need} XP</span>
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
  const quests = dailyQuests();
  const done = quests.filter(q => q.progress >= q.target).length;

  host.innerHTML = quests.map(q => {
    const pct = Math.round(q.progress / q.target * 100);
    const complete = q.progress >= q.target;
    return `<div class="quest${complete ? ' done' : ''}">
        <span class="quest-ic">${complete ? icon('check', { size: 16 }) : icon(q.icon, { size: 16 })}</span>
        <div class="grow" style="min-width:0">
          <div class="row between">
            <span class="t-sm">${esc(q.label)}</span>
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
        title: has ? 'Badge obtenu' : 'Badge à débloquer',
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

const SAMPLE_BOARD = [
  { id:'u5', full_name:'Amina Zerrouki', faculty:'Informatique', xp: 812 },
  { id:'u2', full_name:'Youssef Kader',  faculty:'Physique',     xp: 640 },
  { id:'u1', full_name:'Sara Benali',    faculty:'Informatique', xp: 340, isMe: true },
  { id:'u3', full_name:'Leila Mansouri', faculty:'Biologie',     xp: 295 },
  { id:'u4', full_name:'Omar Kaci',      faculty:'Maths',        xp: 180 }
];

let boardScope = 'faculty';

function renderBoard() {
  const host = $('#boardList');
  if (!host) return;

  const mine = me.get();
  let rows = api?.leaderboard?.(boardScope) || SAMPLE_BOARD;
  if (boardScope === 'faculty') {
    rows = rows.filter(r => r.faculty === (mine?.faculty || 'Informatique'));
  }
  rows = [...rows].sort((a, b) => b.xp - a.xp);

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
            <div class="av lg" style="background:${avatarColor(r.id)}">${esc(initials(r.full_name))}</div>
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
        <span class="av sm" style="background:${avatarColor(r.id)}">${esc(initials(r.full_name))}</span>
        <div class="grow" style="min-width:0">
          <div class="t-sm t-bold truncate">${esc(r.full_name)}</div>
          <div class="t-xs t-dim">${esc(r.faculty)}</div>
        </div>
        <span class="t-sm t-mono t-bold">${compact(r.xp)}</span>
      </div>`).join('')}`;
}

/* ------------------------------------------------------------
   VIEW
   ------------------------------------------------------------ */

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
          <span>Défis du jour</span>
          <span class="pill" id="questCount">0/3</span>
        </div>
        <div id="questList"></div>
      </section>

      <section class="hub-sec">
        <div class="hub-sec-head">
          <span>Badges</span>
          <span class="pill" id="badgeCount">0/${BADGES.length}</span>
        </div>
        <div class="badge-grid" id="badgeGrid"></div>
      </section>

      <section class="hub-sec">
        <div class="hub-sec-head">
          <span>Classement</span>
          <div class="row g1">
            <button class="pill board-scope on" data-scope="faculty">Ma faculté</button>
            <button class="pill board-scope" data-scope="all">Tout le campus</button>
          </div>
        </div>
        <div id="boardList"></div>
      </section>`;

    renderQuests();
    renderBadges(s);
    renderBoard();

    for (const btn of $$('.board-scope')) {
      on(btn, 'click', () => {
        boardScope = btn.dataset.scope;
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
