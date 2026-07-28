/**
 * proof.mjs — screenshots that show data surviving a real page reload.
 *
 * Each pair is: do the thing -> F5 -> photograph what came back from
 * the database. The "after" shots are taken on a freshly loaded page.
 */
import { openApp } from './harness.mjs';

const OUT = new URL('../../shots/', import.meta.url).pathname;
const wait = ms => new Promise(r => setTimeout(r, ms));
const app = await openApp({ width: 1280, height: 900, realGifs: false });
const { page } = app;

const shot = async n => { await page.screenshot({ path: OUT + n + '.png' }); console.log('  ' + n + '.png'); };
const goto = async r => { await page.evaluate(x => { location.hash = '#/' + x; }, r); await wait(1800); };
const reload = async () => { await page.reload({ waitUntil: 'networkidle2' }); await wait(2400); };

/* ---------- 1. feed actions ---------- */
await goto('feed');
await shot('P1-feed-before');

await page.click('.post [data-act=like]');            await wait(1000);
await page.click('.post [data-act=comment]');         await wait(1000);
await page.type('.modal input.input', 'ce commentaire doit survivre'); await wait(200);
await page.evaluate(() => [...document.querySelectorAll('.modal .btn')].pop()?.click());
await wait(1400);
await page.keyboard.press('Escape');                  await wait(600);
await page.click('.post [data-act=repost]');          await wait(900);
await page.evaluate(() => {
  const ta = document.querySelector('.modal textarea, .modal input.input');
  if (ta) { ta.value = 'je repartage ceci'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
});
await page.evaluate(() => [...document.querySelectorAll('.modal .btn-primary')].pop()?.click());
await wait(1600);

await reload();
await goto('feed');
await shot('P2-feed-after-reload');

/* ---------- 2. profile: avatar, banner, bio, counts ---------- */
await goto('profile');
await page.evaluate(() =>
  [...document.querySelectorAll('button,a')].find(n => /edit profile/i.test(n.textContent))?.click());
await wait(1400);

async function pick(which, file) {
  await page.evaluate(w => document.querySelector(`[data-pick=${w}]`)?.click(), which);
  await wait(300);
  const input = await page.$('.modal input[type=file]');
  await input.uploadFile(file);
  await wait(2600);
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find(b => /Terminer|Done|Enregistrer/i.test(b.textContent))?.click());
  await wait(1700);
}
await pick('avatar', '/tmp/av.png');
await pick('banner', '/tmp/bn.png');
await page.evaluate(() => {
  const ta = document.querySelector('.modal textarea');
  ta.value = 'Cette bio doit rester apres F5';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await wait(300);
await shot('P3-profile-editor-filled');
await page.evaluate(() =>
  [...document.querySelectorAll('.modal button')].find(b => /save|enregistrer/i.test(b.textContent))?.click());
await wait(3200);

await reload();
await goto('profile');
await shot('P4-profile-after-reload');

/* ---------- 3. hub ---------- */
await goto('hub');
await shot('P5-hub-after-reload');

const p = app.mock.state.profiles.find(x => x.id === 'u1');
console.log('\nDATABASE CONTENTS AFTER EVERYTHING:');
console.log('  avatar_url :', p.avatar_url ? p.avatar_url.slice(0, 24) + '… ' + p.avatar_url.length + ' bytes' : 'NULL');
console.log('  banner_url :', p.banner_url ? p.banner_url.slice(0, 24) + '… ' + p.banner_url.length + ' bytes' : 'NULL');
console.log('  bio        :', JSON.stringify(p.bio));
console.log('  xp         :', p.xp);
console.log('  post_likes :', app.mock.state.post_likes.length);
console.log('  comments   :', app.mock.state.comments.length);
console.log('  reposts    :', app.mock.state.posts.filter(x => x.repost_id).length);
console.log('  quests     :', JSON.stringify(app.mock.state.quests));

await app.close();
