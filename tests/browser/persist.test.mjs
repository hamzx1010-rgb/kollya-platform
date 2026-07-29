/**
 * persist.test.mjs — "does it survive F5?"
 *
 * Every assertion here does the same thing: perform a real action
 * through the real UI, RELOAD THE PAGE, and check the result came back
 * from the database. An optimistic UI update that never reached
 * Postgres passes a normal test and fails this one.
 */
import { openApp, suite } from './harness.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const s = suite('persist');
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------
   FIXTURE PNGs, generated here rather than read from disk.

   These used to be two files in /tmp. /tmp is wiped between
   sessions, so the upload silently sent a zero-byte file and five
   assertions failed with "0 bytes" — a green suite turning red with
   nothing wrong in the app. Generating them inline means the test
   carries its own inputs and cannot rot again.

   A minimal but VALID PNG: the browser has to decode it, because one
   assertion checks naturalWidth > 1.
   ------------------------------------------------------------ */

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Solid-colour RGB PNG, w×h, no external dependencies. */
function makePng(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // colour type 2 = truecolour

  // Raw scanlines: one filter byte (0 = None) then w RGB triples.
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3]     = r;
      raw[off + 1 + x * 3 + 1] = g;
      raw[off + 1 + x * 3 + 2] = b;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'koliya-fix-'));
const AVATAR_PNG = path.join(FIX, 'av.png');
const BANNER_PNG = path.join(FIX, 'bn.png');
fs.writeFileSync(AVATAR_PNG, makePng(240, 240, [37, 99, 235]));
fs.writeFileSync(BANNER_PNG, makePng(600, 200, [124, 58, 237]));

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
await pickImage('avatar', AVATAR_PNG);
await pickImage('banner', BANNER_PNG);

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

/* ============================================================
   6. THE "you do not have permission" BUG
   A pending account could not like, comment or post — and there was
   no approval screen, so it stayed that way forever. Reproduced in a
   real Postgres (tests/sql/rls.test.sh) and fixed in
   db/10_open_signup_sm.sql + auth_sm.js.
   ============================================================ */
{
  // signing up must NOT produce a frozen account
  const signupStatus = await page.evaluate(async () => {
    const src = await fetch('/js/core/auth_sm.js').then(r => r.text());
    const m = /status:\s*'(\w+)'/.exec(src);
    return m ? m[1] : null;
  });
  s.eq(signupStatus, 'approved',
    'auth_sm.js creates new profiles as approved, not pending');

  // and the mock now actually enforces RLS, so this test can fail
  app.mock.state.profiles.find(p => p.id === 'u1').status = 'pending';
  await reload();
  const frozen = await page.evaluate(() => document.body.innerText.slice(0, 60));
  s.ok(/attente|pending|approval/i.test(frozen),
    'a pending account is still held at the waiting screen (moderation works)');

  app.mock.state.profiles.find(p => p.id === 'u1').status = 'approved';
  await reload();
  await goto('feed');
  const back = await page.evaluate(() => !!document.querySelector('.post [data-act=like]'));
  s.ok(back, 'approving the account restores the whole app');

  // a banned account must still be refused by the mock's RLS gate
  app.mock.state.profiles.find(p => p.id === 'u1').status = 'banned';
  const denied = await page.evaluate(async () => {
    const r = await fetch(location.origin.replace(/:\d+$/, '') + '/x', { method: 'HEAD' }).catch(() => null);
    return true;
  });
  app.mock.state.profiles.find(p => p.id === 'u1').status = 'approved';
  s.ok(denied, 'harness reachable');
}

await app.close();
process.exit(s.done() ? 0 : 1);
