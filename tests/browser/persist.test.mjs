/**
 * persist.test.mjs — "does it survive F5?"
 *
 * Every assertion here does the same thing: perform a real action
 * through the real UI, RELOAD THE PAGE, and check the result came back
 * from the database. An optimistic UI update that never reached
 * Postgres passes a normal test and fails this one.
 */
import { openApp, suite } from './harness.mjs';

const s = suite('persist');
const wait = ms => new Promise(r => setTimeout(r, ms));

const app = await openApp({ width: 1280, height: 900 });
const { page } = app;
const reload = async () => {
  await page.reload({ waitUntil: 'networkidle2' });
  await wait(2200);
};
const goto = async route => {
  await page.evaluate(r => { location.hash = '#/' + r; }, route);
  await wait(1800);
};

/* ============================================================
   1. FEED ACTIONS ARE REAL BUTTONS, NOT DECORATION
   ============================================================ */
await goto('feed');
const wired = await page.evaluate(() =>
  [...document.querySelectorAll('.post .post-actions button')].map(b => b.dataset.act || null));
s.eq(wired.filter(x => x === null).length, 0,
  'every feed action button carries a data-act: ' + JSON.stringify(wired));
for (const act of ['like', 'comment', 'repost', 'share', 'save']) {
  s.ok(wired.includes(act), `feed has a ${act} button`);
}

/* ---- like survives a reload ---- */
const likeBefore = await page.evaluate(() =>
  Number(document.querySelector('.post [data-act=like] .c')?.textContent || 0));
await page.click('.post [data-act=like]');
await wait(1200);
await reload();
await goto('feed');
const likeAfter = await page.evaluate(() => ({
  n: Number(document.querySelector('.post [data-act=like] .c')?.textContent || 0),
  on: document.querySelector('.post [data-act=like]')?.classList.contains('on')
}));
s.eq(likeAfter.n, likeBefore + 1, `like count persisted (${likeBefore} -> ${likeAfter.n})`);
s.ok(likeAfter.on, 'and the button still reads as pressed after F5');

/* ---- comment survives a reload ---- */
await page.click('.post [data-act=comment]');
await wait(1100);
await page.type('.modal input.input', 'commentaire persistant');
await wait(200);
await page.evaluate(() => [...document.querySelectorAll('.modal .btn')].pop()?.click());
await wait(1500);
await page.keyboard.press('Escape');
await reload();
await goto('feed');
const cmt = await page.evaluate(() =>
  Number(document.querySelector('.post [data-act=comment] .c')?.textContent || 0));
s.ok(cmt >= 3, `comment count persisted (${cmt})`);

/* ---- repost writes repost_id and the counter moves ---- */
// Grab the ORIGINAL post's id first: after the reload the new repost
// is itself the newest post and sits at .post, so re-reading the first
// card would measure the wrong row.
const origId = await page.evaluate(() => document.querySelector('.post')?.dataset.id);
const repostBefore = await page.evaluate(id =>
  Number(document.querySelector(`.post[data-id="${id}"] [data-act=repost] .c`)?.textContent || 0), origId);
await page.click('.post [data-act=repost]');
await wait(1000);
await page.evaluate(() => [...document.querySelectorAll('.modal .btn-primary')].pop()?.click());
await wait(1600);
await reload();
await goto('feed');
const repostAfter = await page.evaluate(id => {
  const card = document.querySelector(`.post[data-id="${id}"]`);
  const b = card?.querySelector('[data-act=repost]');
  const quote = document.querySelector('.post .repost-quote');
  return { n: Number(b?.querySelector('.c')?.textContent || 0),
           on: b?.classList.contains('on'),
           quoted: !!quote, quoteText: quote?.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) };
}, origId);
s.eq(repostAfter.n, repostBefore + 1,
  `repost count persisted (${repostBefore} -> ${repostAfter.n}) — repost_id really reached the row`);
s.ok(repostAfter.on, 'repost button shows as already reposted after F5');
s.ok(repostAfter.quoted,
  `the repost card shows the QUOTED original instead of a blank card ("${repostAfter.quoteText}")`);

/* ============================================================
   2. PROFILE POST ACTIONS WERE DEAD — NOW WIRED
   ============================================================ */
await goto('profile');
const pfWired = await page.evaluate(() =>
  [...document.querySelectorAll('#pfBody .post-actions button')].map(b => b.dataset.act || null));
s.ok(pfWired.length > 0, 'profile renders post actions');
s.eq(pfWired.filter(x => x === null).length, 0,
  'no decorative buttons left on the profile: ' + JSON.stringify(pfWired));
s.ok(pfWired.includes('repost'), 'profile has the repost button the feed has');

const pfLike = await page.evaluate(() =>
  Number(document.querySelector('#pfBody [data-act=like] .c')?.textContent || 0));
await page.click('#pfBody [data-act=like]');
await wait(1300);
await reload();
await goto('profile');
const pfAfter = await page.evaluate(() => ({
  n: Number(document.querySelector('#pfBody [data-act=like] .c')?.textContent || 0),
  on: document.querySelector('#pfBody [data-act=like]')?.classList.contains('on')
}));
s.eq(pfAfter.n, pfLike + 1, `liking from the PROFILE persisted (${pfLike} -> ${pfAfter.n})`);
s.ok(pfAfter.on, 'and survives F5');

/* ============================================================
   3. COUNTS ARE REAL NUMBERS FROM THE DATABASE
   ============================================================ */
const counts = await page.evaluate(() => ({
  posts: document.querySelector('#stPosts')?.textContent,
  followers: document.querySelector('#stFollowers')?.textContent,
  following: document.querySelector('#stFollowing')?.textContent
}));
// the fixture gives u1 exactly 7 followers and 4 following — numbers
// chosen so a placeholder counting 1,2,3 cannot pass by accident
s.eq(counts.followers, '7', `follower count comes from the DB (${counts.followers})`);
s.eq(counts.following, '4', `following count comes from the DB (${counts.following})`);
s.ok(Number(counts.posts) >= 1, `post count is a real number (${counts.posts})`);

/* ============================================================
   4. AVATAR + BANNER + BIO SURVIVE A RELOAD
   ============================================================ */
await page.evaluate(() =>
  [...document.querySelectorAll('button,a')].find(n => /edit profile/i.test(n.textContent))?.click());
await wait(1400);

async function pickImage(which, file) {
  await page.evaluate(w => document.querySelector(`[data-pick=${w}]`)?.click(), which);
  await wait(300);
  const input = await page.$('.modal input[type=file]');
  await input.uploadFile(file);
  await wait(2800);
  // the image editor opens in between
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find(b => /Terminer|Done|Enregistrer/i.test(b.textContent))?.click());
  await wait(1800);
}
await pickImage('avatar', '/tmp/av.png');
await pickImage('banner', '/tmp/bn.png');

const BIO = 'bio qui survit au rafraichissement';
await page.evaluate(b => {
  const ta = document.querySelector('.modal textarea');
  ta.value = b;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}, BIO);
await wait(300);
await page.evaluate(() =>
  [...document.querySelectorAll('.modal button')].find(b => /save|enregistrer/i.test(b.textContent))?.click());
await wait(3200);

const stored = app.mock.state.profiles.find(p => p.id === 'u1');
s.ok((stored.avatar_url || '').startsWith('data:image/'),
  `avatar reached the database as a data: URL (${(stored.avatar_url || '').length} bytes)`);
s.ok((stored.banner_url || '').startsWith('data:image/'),
  `banner reached the database (${(stored.banner_url || '').length} bytes)`);
s.eq(stored.bio, BIO, 'bio reached the database');

await reload();
await goto('profile');
const shown = await page.evaluate(() => {
  const av = document.querySelector('.pf-av img, .pf-avatar img, .av.xl img');

  return {
    avatarSrc: (av?.getAttribute('src') || '').slice(0, 11),
    avatarPainted: !!av && av.naturalWidth > 1,
    coverHasImage: /data:image/.test(
      getComputedStyle(document.querySelector('#pfCoverImg') || document.body).backgroundImage || ''),
    bio: document.body.innerText.includes('bio qui survit au rafraichissement')
  };
});
s.eq(shown.avatarSrc, 'data:image/', 'after F5 the avatar renders from the stored data: URL');
s.ok(shown.avatarPainted, 'and the browser actually decoded the image (naturalWidth > 1)');
s.ok(shown.coverHasImage, 'after F5 the banner is painted from the stored value');
s.ok(shown.bio, 'after F5 the bio is the edited one');

/* ============================================================
   5. HUB: XP AND QUESTS ARE SAVED AND SHOWN
   ============================================================ */
await goto('hub');
const hub = await page.evaluate(() => ({
  hero: document.querySelector('.hub-hero')?.innerText.replace(/\s+/g, ' ') || '',
  xp: document.querySelector('#hubXp')?.textContent,
  streak: document.querySelector('#hubStreak')?.textContent,
  quests: [...document.querySelectorAll('.quest .quest-count')].map(n => n.textContent.trim())
}));
s.ok(Number(hub.xp) > 0, `hub shows the real XP total, not 0 (${hub.xp})`);
s.ok(Number(hub.streak) > 0, `hub shows the real streak (${hub.streak})`);
s.ok(hub.quests.length > 0, `quests render (${JSON.stringify(hub.quests)})`);
s.eq(hub.quests.filter(q => {
  const [a, b] = q.split('/').map(Number);
  return a > b;
}).length, 0, `no quest exceeds its own goal: ${JSON.stringify(hub.quests)}`);

/* a repaint must NOT blank the numbers again */
await page.evaluate(async () => {
  const { emit } = await import('/js/core/store_sm.js');
  emit('game:xp', { total: 340, gained: 0, kind: 'test' });
});
await wait(600);
const afterRepaint = await page.evaluate(() => document.querySelector('#hubXp')?.textContent);
s.ok(Number(afterRepaint) > 0,
  `a 'game:xp' repaint keeps the number instead of resetting to 0 (${afterRepaint})`);

await reload();
await goto('hub');
const hubAfter = await page.evaluate(() => ({
  xp: document.querySelector('#hubXp')?.textContent,
  quests: [...document.querySelectorAll('.quest .quest-count')].map(n => n.textContent.trim())
}));
s.ok(Number(hubAfter.xp) > 0, `XP still there after F5 (${hubAfter.xp})`);
s.ok(hubAfter.quests.some(q => q.startsWith('1/')),
  `quest progress persisted across F5 (${JSON.stringify(hubAfter.quests)})`);

await app.close();
process.exit(s.done() ? 0 : 1);
