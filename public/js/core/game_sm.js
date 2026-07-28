/**
 * KOLIYA — game_sm.js
 * ============================================================
 * The loop: quests feed the streak, the streak and activity feed XP,
 * XP decides the leaderboard, and the leaderboard buys you visibility.
 *
 * WHY THIS FILE EXISTS
 * The rules used to be scattered inside hub_sm.js and stored in
 * localStorage, and — the real problem — nothing ever called them.
 * `trackQuest()` was exported and had zero callers, so liking a post
 * did nothing, the streak could only ever go up, and clearing the
 * browser wiped your progress. It was a scoreboard with no game
 * behind it.
 *
 * Now every rule is one call into Postgres (db/06_game_sm.sql), the
 * feature modules fire events, and this file listens. Cheating means
 * beating RLS, not editing a localStorage key.
 *
 * THE ECONOMY  (fast scale: 1000 XP ≈ one month of real use)
 * A full day is worth 35 XP. Thirty days ≈ 1050. So passing 1000
 * means "this person showed up for a month" — which is what makes a
 * four-figure number worth looking at.
 * ============================================================
 */

import { db } from './db_sm.js';
import { me, emit, on as onEvent, scoped } from './store_sm.js';
import { toast } from './ui_sm.js';
import { t } from './i18n_sm.js';
import sfx from './sound_sm.js';

/* ------------------------------------------------------------
   THE NUMBERS
   ------------------------------------------------------------ */

/**
 * Deliberately small. The temptation is to pay 50 for a post because
 * it feels generous, but then a chatty week outruns a loyal month and
 * the leaderboard stops meaning anything. Showing up beats volume:
 * the daily bonus (20) is worth more than any single action.
 */
export const XP = {
  post:          8,
  comment:       3,
  answer:        6,   // answering a question helps someone, so it pays most per action
  story:         4,
  event_join:    3,
  event_create:  6,
  like_received: 1,   // capped daily — see LIKE_CAP
  daily_bonus:  20,   // all three quests done
  streak_day:    7    // paid on top, every day the streak survives
};

/** A post going viral must not be a shortcut past a month of effort. */
export const LIKE_CAP = 10;      // max like_received XP per day

/** ~35 XP on a full day → 1000 in roughly a month. */
export const XP_PER_FULL_DAY = XP.daily_bonus + XP.streak_day + XP.post;

/* ------------------------------------------------------------
   LEVELS
   Kept, as you asked, but rescaled to the new economy. With the old
   curve (80 × lvl^1.35) and the old inflated XP, everyone was level
   20 in a fortnight and the number said nothing.
   ------------------------------------------------------------ */

export const xpForLevel = lvl => Math.round(45 * Math.pow(lvl, 1.42));

export function levelFromXp(xp) {
  let lvl = 1, spent = 0;
  while (spent + xpForLevel(lvl) <= xp && lvl < 200) { spent += xpForLevel(lvl); lvl++; }
  const into = xp - spent;
  const need = xpForLevel(lvl);
  return { level: lvl, into, need, pct: Math.round(into / need * 100) };
}

/* ------------------------------------------------------------
   QUESTS
   The three-a-day set is derived from the date, so everyone on
   campus gets the same challenges and can talk about them. Progress
   is per student and lives in Postgres.
   ------------------------------------------------------------ */

/**
 * Labels are i18n KEYS resolved at render time, not text.
 * A quest stored with a French label would still read French after
 * the student switches to English — the label has to be looked up
 * every time it is drawn, not once when the pool is defined.
 */
export const QUEST_POOL = [
  { id: 'visit',   key: 'quest.visit',   target: 1, icon: 'home' },
  { id: 'post',    key: 'quest.post',    target: 1, icon: 'edit' },
  { id: 'comment', key: 'quest.comment', target: 3, icon: 'comment' },
  { id: 'like',    key: 'quest.like',    target: 5, icon: 'fire' },
  { id: 'answer',  key: 'quest.answer',  target: 1, icon: 'help' },
  { id: 'story',   key: 'quest.story',   target: 1, icon: 'camera' }
];

/** The human label for a quest, in the current language. */
export const questLabel = q => t(q.key || `quest.${q.id}`);

export const todayKey = () => new Date().toISOString().slice(0, 10);

/**
 * Same three for everyone on a given day.
 * 'visit' is always one of them: a day should never be unwinnable
 * for someone who has nothing to post about.
 */
export function questsForDay(key = todayKey()) {
  const pool = QUEST_POOL.filter(q => q.id !== 'visit');
  let seed = [...key].reduce((a, c) => a + c.charCodeAt(0), 0);
  const picked = [];
  while (picked.length < 2 && pool.length) {
    seed = (seed * 9301 + 49297) % 233280;
    picked.push(pool.splice(seed % pool.length, 1)[0]);
  }
  return [QUEST_POOL[0], ...picked];
}

/* ------------------------------------------------------------
   STATE
   ------------------------------------------------------------ */

let quests = questsForDay().map(q => ({ ...q, progress: 0, done: false }));
let streak = { streak: 0, streak_best: 0, freeze_available: true };
let dayComplete = false;
let ready = false;

const local = scoped('game');

export const getQuests = () => quests.map(q => ({ ...q }));
export const getStreak = () => ({ ...streak });
export const isDayComplete = () => dayComplete;
export const gameReady = () => ready;

/* ------------------------------------------------------------
   LOADING
   ------------------------------------------------------------ */

/**
 * Called once after login. Reads today's quests, then resolves the
 * streak — which is where a missed day actually costs you.
 */
export async function initGame() {
  if (!me.id) return null;

  quests = questsForDay().map(q => ({ ...q, progress: 0, done: false }));

  try {
    const rows = await db.rpc('my_quests', {});
    for (const r of rows || []) {
      const q = quests.find(x => x.id === r.quest_id);
      if (q) { q.progress = r.progress; q.done = r.done; }
    }
    dayComplete = quests.every(q => q.done);
  } catch (e) {
    console.warn('[koliya] quêtes indisponibles', e.message);
  }

  await resolveStreak(false);
  ready = true;

  // Opening the app is itself the first quest.
  trackQuest('visit');

  emit('game:ready', { quests: getQuests(), streak: getStreak() });
  return { quests: getQuests(), streak: getStreak() };
}

/**
 * Ask Postgres what the streak is worth today.
 * This is the only place a streak can be lost, and it happens on
 * boot — so you find out the moment you open the app, not silently.
 */
async function resolveStreak(completedToday) {
  try {
    const [row] = await db.rpc('resolve_streak', { p_completed_today: !!completedToday }) || [];
    if (!row) return streak;

    const before = streak.streak;
    streak = {
      streak: row.streak,
      streak_best: row.streak_best,
      freeze_available: row.freeze_available
    };

    if (me.get()) me.set({ ...me.get(), streak: row.streak, streak_best: row.streak_best });

    // Tell the student what happened, once, and only when it matters.
    if (row.broke && row.lost > 0) {
      announceOnce(`broke:${todayKey()}`, () =>
        toast(t('streak.lost', { n: row.lost }),
              { kind: 'err', duration: 9000 }));
    } else if (row.froze) {
      announceOnce(`froze:${todayKey()}`, () => {
        sfx.streakSaved();
        toast(t('streak.frozen'), { kind: 'ok', duration: 8000 });
      });
    }

    if (row.streak !== before) emit('game:streak', getStreak());
    return streak;
  } catch (e) {
    console.warn('[koliya] série indisponible', e.message);
    return streak;
  }
}

/** Never show the same one-off message twice in a day. */
function announceOnce(key, fn) {
  if (local.get(key, false)) return;
  local.set(key, true);
  fn();
}

/* ------------------------------------------------------------
   PROGRESS
   ------------------------------------------------------------ */

/**
 * Advance a quest. Safe to call from anywhere, any number of times:
 * Postgres clamps to the target and ignores a quest that is not in
 * today's set.
 */
export async function trackQuest(id, amount = 1) {
  const q = quests.find(x => x.id === id);
  if (!q || q.done) return null;

  // paint immediately, reconcile with the server after
  const before = q.progress;
  q.progress = Math.min(q.target, q.progress + amount);
  emit('game:quests', getQuests());

  try {
    const [row] = await db.rpc('track_quest', {
      p_quest_id: id, p_target: q.target, p_amount: amount
    }) || [];
    if (!row) return null;

    q.progress = row.progress;
    q.done = row.progress >= row.target;
    emit('game:quests', getQuests());

    if (row.just_done) {
      // The hub owns the presentation; the engine only reports facts.
      emit('game:quest-done', {
        id: q.id,
        label: questLabel(q),
        remaining: quests.filter(x => !x.done).length
      });
    }
    if (row.day_complete && !dayComplete) {
      dayComplete = true;
      await completeDay();
    }
    return row;
  } catch (e) {
    q.progress = before;
    emit('game:quests', getQuests());
    console.warn('[koliya] quête non enregistrée', e.message);
    return null;
  }
}

/** All three done: the streak advances and the day pays out. */
async function completeDay() {
  const [bonus] = await Promise.all([
    awardXp('daily', XP.daily_bonus, 'quest', todayKey()),
    awardXp('streak', XP.streak_day, 'streak', todayKey())
  ]);

  const before = streak.streak;
  await resolveStreak(true);

  emit('game:day-complete', {
    streak: streak.streak,
    grew: streak.streak > before,
    xp: XP.daily_bonus + XP.streak_day
  });
  return bonus;
}

/**
 * Award XP through the database function, which validates the amount
 * and refuses to pay twice for the same thing.
 * `ref` makes the award idempotent — award for post #42 exactly once,
 * however many times this fires.
 */
export async function awardXp(kind, amount, refType = null, refId = null) {
  if (!me.id || !amount) return null;
  try {
    const total = await db.rpc('award_xp', {
      p_kind: kind, p_amount: amount,
      p_ref_type: refType, p_ref_id: refId ? String(refId) : null
    });
    const value = typeof total === 'number' ? total : Number(total);
    if (Number.isFinite(value)) {
      const before = me.get()?.xp || 0;
      me.set({ ...me.get(), xp: value });
      if (value > before) emit('game:xp', { total: value, gained: value - before, kind });
    }
    return value;
  } catch (e) {
    console.warn('[koliya] XP non attribué', e.message);
    return null;
  }
}

/** Today's like_received earnings, so the cap can be enforced. */
async function likeXpToday() {
  try {
    return await db.count('xp_events', {
      user_id: `eq.${me.id}`, kind: 'eq.like_received', day: `eq.${todayKey()}`
    });
  } catch { return LIKE_CAP; }
}

/* ------------------------------------------------------------
   THE WIRING
   This is the part that was missing entirely. Feature modules emit
   plain events; the economy lives here and nowhere else, so changing
   what a comment is worth is a one-line edit.
   ------------------------------------------------------------ */

export function wireGame() {
  onEvent('game:action', async ({ kind, id } = {}) => {
    if (!ready || !me.id) return;

    switch (kind) {
      case 'post':
        await Promise.all([awardXp('post', XP.post, 'post', id), trackQuest('post')]);
        break;

      case 'comment':
        await Promise.all([awardXp('comment', XP.comment, 'comment', id), trackQuest('comment')]);
        break;

      case 'answer':
        await Promise.all([awardXp('answer', XP.answer, 'answer', id), trackQuest('answer')]);
        break;

      case 'story':
        await Promise.all([awardXp('story', XP.story, 'story', id), trackQuest('story')]);
        break;

      case 'like_given':
        // liking costs nothing and pays nothing — it only moves the quest
        await trackQuest('like');
        break;

      case 'like_received': {
        const spent = await likeXpToday();
        if (spent < LIKE_CAP) await awardXp('like_received', XP.like_received, 'post', id);
        break;
      }

      case 'event_join':
        await awardXp('event_join', XP.event_join, 'event', id);
        break;

      case 'event_create':
        await awardXp('event_create', XP.event_create, 'event', id);
        break;
    }
  });

  // a tab left open overnight must not think it is still yesterday
  onEvent('app:visible', () => {
    if (ready && local.get('day', todayKey()) !== todayKey()) {
      local.set('day', todayKey());
      initGame();
    }
  });
  local.set('day', todayKey());
}

/** Convenience for feature modules: `act('post', id)`. */
export const act = (kind, id) => emit('game:action', { kind, id });

/* ------------------------------------------------------------
   LEADERBOARD REWARD — visibility, not fake followers
   ------------------------------------------------------------ */

/**
 * Being top of the leaderboard makes you SEEN: you sort first in
 * "Étudiants à découvrir" and you carry a rank badge on your profile.
 * The followers that follow are real people who chose to follow you.
 *
 * Inventing follow rows would have been easier and would have made
 * the number a lie — a follower who never clicked anything.
 */
export function rankBadge(rank) {
  if (!rank || rank > 10) return null;
  if (rank === 1) return { label: '1ᵉʳ du campus', icon: 'trophy', tone: 'gold' };
  if (rank === 2) return { label: '2ᵉ du campus',  icon: 'trophy', tone: 'silver' };
  if (rank === 3) return { label: '3ᵉ du campus',  icon: 'trophy', tone: 'bronze' };
  return { label: `Top ${rank}`, icon: 'spark', tone: 'top10' };
}

/** Where a student sits in a given scope, or null if outside the top 50. */
export async function myRank(scope = 'faculty') {
  const mine = me.get();
  if (!mine) return null;
  const params = {
    status: 'eq.approved', select: 'id,xp', order: 'xp.desc', limit: 50
  };
  if (scope === 'faculty' && mine.faculty) params.faculty = `eq.${mine.faculty}`;
  try {
    const rows = await db.select('profiles', params);
    const i = rows.findIndex(r => String(r.id) === String(mine.id));
    return i === -1 ? null : i + 1;
  } catch { return null; }
}

export default {
  XP, LIKE_CAP, xpForLevel, levelFromXp, QUEST_POOL, questsForDay,
  initGame, trackQuest, awardXp, wireGame, act,
  getQuests, getStreak, isDayComplete, rankBadge, myRank
};
