/**
 * walkthrough.mjs — be a student and touch EVERYTHING.
 *
 * Not assertions: exploration. This clicks every route, every button,
 * every menu item, types in every field, and reports anything that
 * looks wrong — a page error, a request that 4xx'd, an empty screen, a
 * control that does nothing, literal `${...}` or `t('...')` on screen,
 * untranslated French while the UI is English, an element off-screen.
 *
 * Run: node tests/browser/walkthrough.mjs
 */
import { openApp } from './harness.mjs';

const wait = ms => new Promise(r => setTimeout(r, ms));
const findings = [];
const note = (where, what) => {
  const line = `${where} :: ${what}`;
  if (!findings.includes(line)) findings.push(line);
};

const app = await openApp({ width: 1360, height: 900 });
const { page } = app;

page.on('pageerror', e => note('PAGE', 'JS error: ' + String(e).slice(0, 140)));
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/favicon|net::ERR_ABORTED.*notifications/.test(t)) return;
  note('CONSOLE', t.slice(0, 140));
});

const ROUTES = ['feed', 'explore', 'messages', 'notifications', 'hub',
                'channels', 'events', 'qa', 'saved', 'leaderboard',
                'settings', 'profile'];

/** Things that are wrong no matter which screen you are on. */
async function inspect(where) {
  const bad = await page.evaluate(() => {
    const out = [];
    const txt = document.body.innerText;

    if (/\$\{/.test(txt)) out.push('literal ${...} on screen: ' +
      (txt.match(/.{0,40}\$\{.{0,40}/) || [''])[0].trim());
    if (/\bt\('[a-z]/.test(txt)) out.push("literal t('...') on screen: " +
      (txt.match(/.{0,30}t\('[^']+'\).{0,20}/) || [''])[0].trim());
    // a raw i18n key that never resolved
    const raw = txt.match(/\b(nav|feed|dm|hub|profile|action|settings|error|empty|toast|lb|qa|events|channels|notif|story|gif|voice|streak|auth)\.[a-zA-Z]+[a-zA-Z.]*\b/g);
    if (raw) out.push('unresolved i18n key: ' + [...new Set(raw)].slice(0, 3).join(', '));

    // horizontal overflow
    const ov = document.documentElement.scrollWidth - window.innerWidth;
    if (ov > 1) out.push('horizontal overflow ' + ov + 'px');

    // anything painted outside the viewport
    for (const n of document.querySelectorAll('button, a, input, .post, .card')) {
      const r = n.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // The conversation list is a slide-out drawer below 900px: it is
      // SUPPOSED to sit at a negative x until you tap Back. Ignore
      // anything inside it, but still catch real overflow.
      if (n.closest('.dm-list')) continue;
      if (r.right > window.innerWidth + 2 || r.left < -2)
        out.push(`off-screen: ${n.tagName}.${String(n.className).split(' ')[0]} @${Math.round(r.left)}..${Math.round(r.right)}`);
    }

    // buttons with no label at all (icon-only and no aria-label)
    for (const b of document.querySelectorAll('button')) {
      const r = b.getBoundingClientRect();
      if (!r.width) continue;
      const name = (b.getAttribute('aria-label') || b.textContent || '').trim();
      if (!name) out.push('unlabelled button .' + String(b.className).split(' ')[0]);
    }

    // an empty main area = a screen that renders nothing
    const view = document.querySelector('.view-inner, #view');
    if (view && view.innerText.trim().length < 3) out.push('screen renders EMPTY');

    return [...new Set(out)];
  });
  for (const b of bad) note(where, b);
}

/** Every network call that failed. */
function httpProblems() {
  for (const l of app.mock.log) {
    if (l.kind === 'rls-deny') note('RLS', `${l.table} refused for status=${l.status}`);
  }
}

console.log('--- walking every route ---');
for (const r of ROUTES) {
  await page.evaluate(x => { location.hash = '#/' + x; }, r);
  await wait(1500);
  await inspect('#/' + r);

  const info = await page.evaluate(() => ({
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 70),
    buttons: document.querySelectorAll('.view-inner button, #view button').length
  }));
  console.log(`  #/${r.padEnd(12)} ${String(info.buttons).padStart(3)} buttons | ${info.text}`);
}

/* ------------------------------------------------------------
   Now actually USE the app the way a student would.
   ------------------------------------------------------------ */
console.log('\n--- posting ---');
await page.evaluate(() => { location.hash = '#/feed'; });
await wait(1400);
const composerOpened = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(n => /create|publier|nouveau/i.test(n.textContent));
  if (!b) return false;
  b.click();
  return true;
});
await wait(1200);
if (!composerOpened) note('#/feed', 'no Create button found');
else {
  // Type with the real keyboard: setting .value and firing one 'input'
  // is not what a student does, and it hid the fact that TWO composers
  // were stacked (typing went to one, the counter watched the other).
  const ta = await page.$('.modal textarea, [role=dialog] textarea');
  const typed = !!ta;
  if (ta) { await ta.click(); await page.keyboard.type('Mon premier post de test'); }
  if (!typed) note('composer', 'no textarea in the composer');
  await wait(400);
  const before = app.mock.state.posts.length;
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.modal button, [role=dialog] button')]
      .find(x => /publish|publier/i.test(x.textContent));
    if (b?.disabled) { window.__pubDisabled = true; return; }
    b?.click();
  });
  await wait(1800);
  const stuck = await page.evaluate(() => !!window.__pubDisabled);
  if (stuck) note('composer', 'Publish button stayed DISABLED after typing');
  if (app.mock.state.posts.length === before) note('composer', 'publishing did NOT create a post row');
  else console.log('  post created ok');
  await page.keyboard.press('Escape');
  await wait(500);
}
await inspect('composer');

console.log('\n--- every post action ---');
for (const act of ['like', 'save', 'comment', 'repost', 'share']) {
  const before = JSON.stringify(app.mock.state).length;
  const ok = await page.evaluate(a => {
    const b = document.querySelector(`.post [data-act=${a}]`);
    if (!b) return 'missing';
    b.click();
    return 'clicked';
  }, act);
  await wait(1300);
  if (ok === 'missing') note('feed', `no ${act} button`);
  const changed = JSON.stringify(app.mock.state).length !== before;
  const ui = await page.evaluate(() => ({
    modal: !!document.querySelector('.modal, [role=dialog]'),
    toast: document.querySelector('.toast')?.textContent.trim().slice(0, 40) || null
  }));
  if (!changed && !ui.modal && !ui.toast) note('feed', `${act} did nothing at all`);
  console.log(`  ${act.padEnd(8)} db=${changed} modal=${ui.modal} toast=${ui.toast || '-'}`);
  await page.keyboard.press('Escape');
  await wait(500);
}
await inspect('feed-actions');

console.log('\n--- messages: open a thread, send, react ---');
await page.evaluate(() => { location.hash = '#/messages'; });
await wait(1600);
await page.evaluate(() => document.querySelector('.dm-list-scroll .conv')?.click());
await wait(1400);
const msgBefore = app.mock.state.messages.length;
await page.evaluate(() => {
  const ta = document.querySelector('#composerInput');
  if (ta) { ta.value = 'salut, test'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
});
await wait(400);
await page.evaluate(() => document.getElementById('btnSend')?.click());
await wait(1600);
if (app.mock.state.messages.length === msgBefore) note('messages', 'sending a message did NOT write a row');
else console.log('  message sent ok');
await inspect('#/messages thread');

console.log('\n--- every chat folder tab ---');
const folders = await page.evaluate(() =>
  [...document.querySelectorAll('.chat-folder')].map(b => b.textContent.trim().slice(0, 14)));
for (let i = 0; i < folders.length; i++) {
  await page.evaluate(n => document.querySelectorAll('.chat-folder')[n]?.click(), i);
  await wait(700);
  const rows = await page.evaluate(() => document.querySelectorAll('.dm-list-scroll .conv').length);
  console.log(`  ${folders[i].padEnd(14)} ${rows} rows`);
}
await inspect('chat-folders');

console.log('\n--- settings: flip every control ---');
await page.evaluate(() => { location.hash = '#/settings'; });
await wait(1500);
const controls = await page.evaluate(() =>
  [...document.querySelectorAll('.set-sec button, .set-sec .switch')]
    .map((b, i) => ({ i, name: (b.id || b.className).slice(0, 24) })));
for (const c of controls) {
  if (/signOut/i.test(c.name)) continue;      // do not log ourselves out
  await page.evaluate(n => {
    const el = [...document.querySelectorAll('.set-sec button, .set-sec .switch')][n];
    el?.click();
  }, c.i);
  await wait(600);
}
await wait(800);
await inspect('#/settings');

console.log('\n--- language: every language, every route ---');
for (const lang of ['fr', 'ar', 'en']) {
  await page.evaluate(async l => {
    const i = await import('/js/core/i18n_sm.js');
    i.setLang(l);
  }, lang);
  await wait(900);
  for (const r of ['feed', 'messages', 'hub', 'profile', 'settings']) {
    await page.evaluate(x => { location.hash = '#/' + x; }, r);
    await wait(1100);
    await inspect(`${lang} #/${r}`);
  }
  const dir = await page.evaluate(() => document.documentElement.dir);
  console.log(`  ${lang}: dir=${dir}`);
}

console.log('\n--- narrow window (split screen) ---');
for (const w of [1024, 860, 700, 520, 380]) {
  await page.setViewport({ width: w, height: 880 });
  for (const r of ['feed', 'messages', 'hub']) {
    await page.evaluate(x => { location.hash = '#/' + x; }, r);
    await wait(900);
    await inspect(`${w}px #/${r}`);
  }
}
await page.setViewport({ width: 1360, height: 900 });

httpProblems();

console.log('\n============================================');
console.log(`FINDINGS: ${findings.length}`);
console.log('============================================');
for (const f of findings) console.log('  • ' + f);

await app.close();
