/**
 * shots.mjs — real Chrome screenshots of the real app.
 * These are PNGs of rendered pixels, not mockups.
 */
import fs from 'node:fs';
import { openApp } from './harness.mjs';

const OUT = new URL('../../shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));

async function shot(page, name) {
  await page.screenshot({ path: OUT + name + '.png' });
  console.log('  ' + name + '.png');
}

/* ---- desktop, English ---- */
{
  const app = await openApp({ width: 1360, height: 880 });
  const { page } = app;
  await shot(page, '01-feed-1360');

  await page.evaluate(() => { location.hash = '#/messages'; });
  await page.waitForFunction(() => document.querySelectorAll('.dm-list-scroll .conv').length > 0,
    { timeout: 8000 }).catch(() => {});
  await wait(700);
  await shot(page, '02-messages-list');

  await page.evaluate(() => document.querySelector('.dm-list-scroll .conv')?.click());
  await wait(1200);
  await shot(page, '03-thread');

  await page.click('#btnGif');
  await wait(1200);
  await shot(page, '04-gif-opens-upward');

  await page.evaluate(() => {
    const p = document.querySelector('.gif-panel');
    const r = p?.getBoundingClientRect();
    document.elementFromPoint(r ? Math.max(4, r.left - 40) : 100, 80)
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await wait(400);

  await page.evaluate(() => {
    const ta = document.querySelector('#composerInput');
    if (ta) { ta.value = 'draft that must survive'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
    document.getElementById('btnMic')?.click();
  });
  await wait(1200);
  await shot(page, '05-voice-recorder-above');

  await page.evaluate(() => { location.hash = '#/hub'; });
  await wait(1200);
  await shot(page, '06-hub');

  await page.evaluate(() => { location.hash = '#/leaderboard'; });
  await wait(1200);
  await shot(page, '07-leaderboard');

  await app.close();
}

/* ---- the split-screen width that used to collapse ---- */
for (const w of [900, 700]) {
  const app = await openApp({ width: w, height: 880 });
  await shot(app.page, `08-split-${w}px`);
  await app.close();
}

/* ---- Arabic RTL ---- */
{
  const app = await openApp({ width: 1360, height: 880 });
  await app.page.evaluate(async () => {
    const i = await import('/js/core/i18n_sm.js');
    i.setLang('ar');
  });
  await wait(1000);
  await shot(app.page, '09-arabic-rtl-feed');
  await app.page.evaluate(() => { location.hash = '#/messages'; });
  await wait(1400);
  await shot(app.page, '10-arabic-rtl-messages');
  await app.close();
}

/* ---- dark theme ---- */
{
  const app = await openApp({ width: 1360, height: 880 });
  await app.page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.classList.add('dark');
  });
  await wait(700);
  await shot(app.page, '11-dark');
  await app.close();
}

console.log('\nshots written to koliya/shots/');
