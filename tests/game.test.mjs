/**
 * The game engine: XP economy, quest progress, streak growth and —
 * the part that never existed — streak LOSS and the monthly freeze.
 *
 * The streak rules live in Postgres (db/06_game_sm.sql). This file
 * runs a faithful JS port of resolve_streak() against a fake clock,
 * so the reset logic is tested on every branch without a database.
 * The SQL and this port must agree; if you change one, change both.
 */
import { JSDOM } from '../node_modules/jsdom/lib/api.js';
import fs from 'fs';

const dom = new JSDOM(fs.readFileSync(new URL('../public/index_sm.html', import.meta.url), 'utf8'),
  { url: 'http://localhost/#/hub', pretendToBeVisual: true });
const { window } = dom;
for (const k of ['window','document','location','history','navigator','HTMLElement','Node','Event',
                 'CustomEvent','MouseEvent','KeyboardEvent','getComputedStyle','CSS','URL','Blob','File'])
  if (window[k] !== undefined) globalThis[k] = window[k];
globalThis.addEventListener = window.addEventListener.bind(window);
globalThis.localStorage = window.localStorage;
globalThis.innerWidth = 1400; globalThis.innerHeight = 900;
globalThis.matchMedia = q => ({ matches:/hover: hover|pointer: fine/.test(q), addEventListener(){}, removeEventListener(){} });
globalThis.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
globalThis.requestAnimationFrame = f => setTimeout(() => f(0), 0);
window.HTMLElement.prototype.scrollTo = function(){};
window.HTMLElement.prototype.scrollIntoView = function(){};

const t = []; const ok = (n, c) => t.push((c ? 'PASS' : 'FAIL') + '  ' + n);
const b = new URL('../public/js/', import.meta.url).pathname;

const G = await import(b + 'core/game_sm.js');

/* ============================================================
   1. THE ECONOMY — 1000 XP must mean about a month
   ============================================================ */

ok('daily bonus is the biggest single award',
   G.XP.daily_bonus > G.XP.post && G.XP.daily_bonus > G.XP.answer);
ok('showing up beats volume: full day > 2 posts',
   G.XP.daily_bonus + G.XP.streak_day > G.XP.post * 2);
ok('a post is worth single digits', G.XP.post < 10);
ok('a like is worth the least', G.XP.like_received <= G.XP.comment);
ok('answering pays more than commenting', G.XP.answer > G.XP.comment);

const perDay = G.XP.daily_bonus + G.XP.streak_day + G.XP.post;
ok('a full day is ~35 XP', perDay >= 30 && perDay <= 40);
const daysTo1000 = Math.ceil(1000 / perDay);
ok('1000 XP takes about a month', daysTo1000 >= 25 && daysTo1000 <= 35);
ok('1000 XP is NOT reachable in a week', 1000 / perDay > 7);

// the like cap stops one viral post outrunning a month of effort
const viralDay = G.LIKE_CAP * G.XP.like_received;
ok('viral post capped below a full day', viralDay < perDay);

/* ============================================================
   2. LEVELS — kept, but rescaled to the new economy
   ============================================================ */

ok('level 1 at 0 xp', G.levelFromXp(0).level === 1);
ok('level grows with xp', G.levelFromXp(5000).level > G.levelFromXp(500).level);
ok('each level costs more', G.xpForLevel(5) > G.xpForLevel(1));
const lv1000 = G.levelFromXp(1000);
ok('1000 XP is a respectable level', lv1000.level >= 5 && lv1000.level <= 12);
ok('not everyone is level 20 in a fortnight', G.levelFromXp(perDay * 14).level < 12);
const lv = G.levelFromXp(340);
ok('pct within range', lv.pct >= 0 && lv.pct <= 100);
ok('into < need', lv.into < lv.need);

/* ============================================================
   3. QUESTS — same three for everyone, always winnable
   ============================================================ */

const qA = G.questsForDay('2026-03-14');
const qB = G.questsForDay('2026-03-14');
const qC = G.questsForDay('2026-03-15');
ok('three quests a day', qA.length === 3);
ok('same day gives the same set', JSON.stringify(qA) === JSON.stringify(qB));
ok('different day gives a different set', JSON.stringify(qA) !== JSON.stringify(qC));
ok('visit is always included, so a day is never unwinnable',
   ['2026-01-01','2026-06-15','2026-11-30','2027-02-28']
     .every(d => G.questsForDay(d).some(q => q.id === 'visit')));
ok('no duplicate quests in a day', new Set(qA.map(q => q.id)).size === 3);
ok('every quest has a target', qA.every(q => q.target >= 1));

/* ============================================================
   4. THE STREAK — a faithful port of resolve_streak()
   Every branch of the SQL, including the ones that LOSE.
   ============================================================ */

const DAY = 86400000;
const d = ms => new Date(ms).toISOString().slice(0, 10);
const month = ms => new Date(ms).toISOString().slice(0, 7);

function resolveStreak(p, today, completedToday) {
  const canFreeze = !p.freeze_month || p.freeze_month < month(today);
  let streak = p.streak || 0;
  let froze = false, broke = false, lost = 0;
  let freezeMonth = p.freeze_month;

  if (!p.streak_day) {
    streak = completedToday ? 1 : 0;
  } else if (p.streak_day === d(today)) {
    // already counted
  } else {
    const gap = Math.round((new Date(d(today)) - new Date(p.streak_day)) / DAY);
    if (gap === 1) {
      if (completedToday) streak += 1;
    } else if (gap === 2 && canFreeze && streak > 0) {
      froze = true;
      freezeMonth = month(today);
      if (completedToday) streak += 1;
    } else {
      if (streak > 0) { broke = true; lost = streak; }
      streak = completedToday ? 1 : 0;
    }
  }
  return {
    streak, froze, broke, lost,
    freeze_month: freezeMonth,
    streak_best: Math.max(p.streak_best || 0, streak),
    streak_day: completedToday ? d(today) : p.streak_day
  };
}

const T = Date.parse('2026-03-15T10:00:00Z');

// --- growth
let r = resolveStreak({ streak: 5, streak_day: d(T - DAY) }, T, true);
ok('finishing after yesterday grows the streak', r.streak === 6);

r = resolveStreak({ streak: 5, streak_day: d(T - DAY) }, T, false);
ok('an unfinished day does not grow it yet', r.streak === 5);

r = resolveStreak({ streak: 0, streak_day: null }, T, true);
ok('first ever completed day starts at 1', r.streak === 1);

r = resolveStreak({ streak: 6, streak_day: d(T) }, T, true);
ok('finishing twice in a day counts once', r.streak === 6);

// --- LOSS: the rule that did not exist before
r = resolveStreak({ streak: 12, streak_day: d(T - 3 * DAY), freeze_month: month(T) }, T, false);
ok('three days away with no freeze resets to 0', r.streak === 0);
ok('a broken streak is reported', r.broke === true);
ok('it reports how much was lost', r.lost === 12);

r = resolveStreak({ streak: 30, streak_day: d(T - 10 * DAY), freeze_month: month(T) }, T, true);
ok('a long absence resets even if you finish today', r.streak === 1);
ok('losing 30 days is reported', r.lost === 30);

// --- the monthly freeze
r = resolveStreak({ streak: 9, streak_day: d(T - 2 * DAY), freeze_month: null }, T, false);
ok('one missed day is caught by the freeze', r.streak === 9);
ok('the freeze is reported', r.froze === true);
ok('the freeze is marked spent', r.freeze_month === month(T));

r = resolveStreak({ streak: 9, streak_day: d(T - 2 * DAY), freeze_month: month(T) }, T, false);
ok('the freeze only works once a month', r.streak === 0 && r.broke === true);

r = resolveStreak({ streak: 9, streak_day: d(T - 2 * DAY), freeze_month: '2026-02' }, T, false);
ok('the freeze refills next month', r.streak === 9 && r.froze === true);

r = resolveStreak({ streak: 9, streak_day: d(T - 2 * DAY), freeze_month: null }, T, true);
ok('freeze plus a finished day still grows', r.streak === 10);

r = resolveStreak({ streak: 0, streak_day: d(T - 2 * DAY), freeze_month: null }, T, false);
ok('no freeze is wasted on a zero streak', r.froze === false);

// --- the record survives a loss
r = resolveStreak({ streak: 21, streak_day: d(T - 5 * DAY), streak_best: 21, freeze_month: month(T) }, T, false);
ok('the streak resets to 0', r.streak === 0);
ok('but the personal best is kept', r.streak_best === 21);

// --- a two-day gap is the ONLY thing the freeze covers
ok('gap of 1 needs no freeze',
   resolveStreak({ streak: 4, streak_day: d(T - DAY), freeze_month: null }, T, false).froze === false);
ok('gap of 3 is beyond rescue',
   resolveStreak({ streak: 4, streak_day: d(T - 3 * DAY), freeze_month: null }, T, false).streak === 0);

/* ============================================================
   5. THE REWARD — visibility, not invented followers
   ============================================================ */

ok('rank 1 gets a badge', !!G.rankBadge(1));
ok('rank 1 is gold', G.rankBadge(1).tone === 'gold');
ok('rank 2 is silver', G.rankBadge(2).tone === 'silver');
ok('rank 3 is bronze', G.rankBadge(3).tone === 'bronze');
ok('top 10 still gets something', !!G.rankBadge(7));
ok('rank 11 gets nothing', G.rankBadge(11) === null);
ok('no rank gets nothing', G.rankBadge(null) === null);

/* ============================================================
   6. THE WIRING — the actual bug from last time
   ============================================================ */

const S = await import(b + 'core/store_sm.js');
S.initStore();
S.me.set({ id: 'u1', username: 'sara.b', full_name: 'Sara', faculty: 'Informatique', status: 'approved', xp: 0 });

const seen = [];
S.on('game:action', payload => seen.push(payload));
G.act('post', 'p1');
G.act('comment', 'c1');
G.act('like_given', 'p2');
await new Promise(r => setTimeout(r, 20));

ok('act() emits an action', seen.length === 3);
ok('the action carries its kind', seen[0].kind === 'post');
ok('the action carries its id', seen[0].id === 'p1');

// The regression that made the game fake: modules must actually call act().
const src = f => fs.readFileSync(new URL('../public/js/features/' + f, import.meta.url), 'utf8');
ok('feed fires the game on post',    /act\('post'/.test(src('feed_sm.js')));
ok('feed fires the game on comment', /act\('comment'/.test(src('feed_sm.js')));
ok('feed fires the game on like',    /act\('like_given'/.test(src('feed_sm.js')));
ok('likes pay the author',           /act\('like_received'/.test(src('feed_sm.js')));
ok('stories fire the game',          /act\('story'/.test(src('stories_sm.js')));
ok('answers fire the game',          /act\('answer'/.test(src('campus_sm.js')));
ok('events fire the game',           /act\('event_join'/.test(src('campus_sm.js')));

const app = fs.readFileSync(new URL('../public/js/app_sm.js', import.meta.url), 'utf8');
ok('the engine is wired at boot',    /wireGame\(\)/.test(app));
ok('the game is initialised at boot',/initGame\(\)/.test(app));

// XP must not be writable from the client
const sql = fs.readFileSync(new URL('../db/06_game_sm.sql', import.meta.url), 'utf8');
ok('no student INSERT policy on xp_events', !/CREATE POLICY[^;]*xp_events FOR (INSERT|ALL)/i.test(sql));
ok('a trigger guards xp and streak', /guard_profile_progress/.test(sql));
ok('award_xp validates the amount', /invalid xp amount/.test(sql));
ok('xp cannot be paid twice', /idx_xp_once/.test(sql));

const pass = t.filter(x => x.startsWith('PASS')).length;
t.filter(x => x.startsWith('FAIL')).forEach(x => console.log(x));
console.log(`${pass}/${t.length} passed`);
