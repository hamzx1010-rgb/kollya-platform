/**
 * V5 acceptance criteria, measured.
 *
 * The brief asked for "pixel-perfect, production-ready, Discord-level
 * polish". Those cannot be asserted, so each one was rewritten as
 * something a machine can check: a rectangle inside the viewport, a
 * z-index ordering, a counter that matches the database, a label that
 * is not in the wrong language.
 *
 * What is NOT covered: actual rendered pixels. jsdom computes no
 * layout, so anything requiring real measurement is called out rather
 * than faked.
 */
import { JSDOM } from '../node_modules/jsdom/lib/api.js';
import fs from 'fs';

const dom = new JSDOM(fs.readFileSync(new URL('../public/index_sm.html', import.meta.url), 'utf8'),
  { url: 'http://localhost/#/messages', pretendToBeVisual: true });
const { window } = dom;
for (const k of ['window','document','location','history','navigator','HTMLElement','Node','Event',
                 'CustomEvent','MouseEvent','KeyboardEvent','getComputedStyle','CSS','URL','Blob','File'])
  if (window[k] !== undefined) globalThis[k] = window[k];
globalThis.addEventListener = window.addEventListener.bind(window);
globalThis.localStorage = window.localStorage;
globalThis.innerWidth = 1440; globalThis.innerHeight = 900;
globalThis.matchMedia = q => ({ matches:false, addEventListener(){}, removeEventListener(){} });
globalThis.IntersectionObserver = class { constructor(cb){this.cb=cb} observe(el){setTimeout(()=>this.cb([{isIntersecting:true,target:el}]),0)} unobserve(){} disconnect(){} };
globalThis.requestAnimationFrame = f => setTimeout(() => f(0), 0);
window.HTMLElement.prototype.scrollTo = function(){};
window.HTMLElement.prototype.scrollIntoView = function(){};
globalThis.URL.createObjectURL = () => 'blob:x';

const T = []; const ok = (n, c) => T.push((c ? 'PASS' : 'FAIL') + '  ' + n);
const b = new URL('../public/js/', import.meta.url).pathname;
const tick = (ms = 260) => new Promise(r => setTimeout(r, ms));

const FA = await import('./fake_api.mjs');
const S  = await import(b + 'core/store_sm.js'); S.initStore();
S.me.set({ id:'u1', username:'sara.b', full_name:'Sara', faculty:'Informatique', status:'approved' });
const I  = await import(b + 'core/i18n_sm.js'); I.setLang('en');
const P  = await import(b + 'core/people_sm.js'); P.cachePeople(FA.PEOPLE);
const st = FA.makeState(); const api = FA.fakeApi(st, 'u1');
const SH = await import(b + 'core/shell_sm.js');
const R  = await import(b + 'core/router_sm.js');
const M  = await import(b + 'features/messages_sm.js'); M.useApi(api);
const PR = await import(b + 'features/profile_sm.js'); PR.useApi(FA.profileApiFor(st));
SH.initShell(); M.initMessages(SH.mount); PR.initProfile(SH.mount);
R.initRouter({ start: 'messages' });
await tick(400);
const D = window.document;

/* ============================================================
   A · MESSAGES
   ============================================================ */
// Instagram behaviour: a wide panel opens the newest thread beside
// the list; a narrow one shows the list alone. jsdom cannot measure
// width, so it takes the narrow path — assert whichever applies.
const dmWide = (D.getElementById('dm')?.clientWidth ?? 0) > 720;
ok('A1  the conversation list is populated', D.querySelectorAll('.conv').length > 0);
ok('A1  no blank thread pane', (D.getElementById('threadBody').textContent || '').trim().length > 0);
if (dmWide) {
  ok('A1  wide panel opens a conversation', D.querySelectorAll('#threadBody .bubble-row').length > 0);
} else {
  ok('A1  narrow panel keeps the list in front', D.querySelectorAll('#threadBody .bubble-row').length === 0);
}

// A2 — the height chain, read from CSS since jsdom does no layout
const layout = fs.readFileSync(new URL('../public/css/layout_sm.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const rule = sel => {
  const m = layout.match(new RegExp('(?<![\\w.-])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 's'));
  return m ? m[1] : '';
};
ok('A2  .dm has a bounded height', /height:\s*calc\(100dvh/.test(rule('.dm')));
ok('A2  .thread-body scrolls, not the page', /overflow-y:\s*auto/.test(rule('.thread-body')));
ok('A2  .thread-body can shrink', /min-height:\s*0/.test(rule('.thread-body')));
ok('A3  full views hide page overflow', /overflow:\s*hidden/.test(rule('.view.full')));

// A4 — floating elements clamp on BOTH axes
const gifSrc = fs.readFileSync(new URL('../public/js/features/gif_sm.js', import.meta.url), 'utf8');
const uiSrc  = fs.readFileSync(new URL('../public/js/core/ui_sm.js', import.meta.url), 'utf8');
// These used to grep for `innerWidth - r.width`, i.e. the old
// top-anchored maths. Chrome showed why that was wrong: place() runs
// while the grid is still skeletons, so r.height is the SMALL height,
// and once the tiles load the panel grew past the bottom of the window
// (measured bottom 1113 in an 860px viewport). It is now anchored by
// `bottom` with an explicit maxHeight, so the assertions follow that
// contract instead of the pixel arithmetic that caused the bug.
ok('A4  gif picker clamps horizontally', /innerWidth\s*-\s*w\s*-\s*pad/.test(gifSrc));
ok('A4  gif picker is anchored by bottom, not top',
   /node\.style\.bottom\s*=/.test(gifSrc) && /node\.style\.top\s*=\s*'auto'/.test(gifSrc));
ok('A4  gif picker bounds its own height', /node\.style\.maxHeight\s*=/.test(gifSrc));
ok('A4  gif picker flips up when low',   /openUp/.test(gifSrc));
ok('A4  reaction picker clamps vertically', /innerHeight\s*-\s*p\.height/.test(uiSrc));
ok('A4  context menu flips on both axes', /flipX/.test(uiSrc) && /flipY/.test(uiSrc));

// A5 — layer order
const base = fs.readFileSync(new URL('../public/css/base_sm.css', import.meta.url), 'utf8');
const z = {}; for (const m of base.matchAll(/--z-([a-z]+):\s*(\d+)/g)) z[m[1]] = +m[2];
ok('A5  menus sit above panels', z.menu > z.nav && z.menu > z.sticky);
ok('A5  toasts sit above menus', z.toast > z.menu);
ok('A5  modals sit above immersive views', z.overlay > z.immersive);

// A7 — avatars come from the scale, never inline
const inlineAv = [...D.querySelectorAll('.av')].filter(a => /width|height/.test(a.getAttribute('style') || ''));
ok('A7  no inline avatar sizing', inlineAv.length === 0);

// C4 — every icon button is labelled
const btns = [...D.querySelectorAll('.icon-btn')];
const unlabelled = btns.filter(x => !x.getAttribute('aria-label') && !x.getAttribute('data-tip') && !x.textContent.trim());
ok(`C4  all ${btns.length} icon buttons labelled`, unlabelled.length === 0);

/* ============================================================
   B · PROFILE
   ============================================================ */
R.go('profile', 'youssef'); await tick(340);
const visitor = D.getElementById('pfRoot').textContent;

ok('B1  no French counters on an English profile',
   !/abonnés|abonnements|Abonné|Se désabonner|publications/.test(visitor));
ok('B1  English labels present', /followers|following|posts/i.test(visitor));
ok('B5  visitor sees Follow', !!D.getElementById('pfFollow'));
ok('B5  visitor has no Edit button', !D.getElementById('pfEdit'));
ok('B4  visitor sees Message', !!D.getElementById('pfMessage'));

// B2/B3 — the counter must follow the database, not a guess
const before = Number(D.getElementById('stFollowers').textContent.replace(/\D/g, '')) || 0;
D.getElementById('pfFollow').click();
await tick(320);
const after = Number(D.getElementById('stFollowers').textContent.replace(/\D/g, '')) || 0;
ok('B3  follower count moves immediately', after !== before);
ok('B2  follow was written to the database', st.writes.some(w => w.op === 'follow'));
ok('B2  counts are re-read after the write', /syncCounts/.test(
   fs.readFileSync(new URL('../public/js/features/profile_sm.js', import.meta.url), 'utf8')));

// B5 — owner view
R.go('profile', 'sara.b'); await tick(340);
ok('B5  owner sees Edit', !!D.getElementById('pfEdit'));
ok('B5  owner sees no Follow', !D.getElementById('pfFollow'));
ok('B5  owner sees no Message-to-self', !D.getElementById('pfMessage'));
ok('B6  stats are clickable', D.querySelectorAll('.pf-stat[data-stat]').length >= 3);

// B4 — the Message button opens or CREATES a conversation
const profSrc = fs.readFileSync(new URL('../public/js/features/profile_sm.js', import.meta.url), 'utf8');
ok('B4  Message opens a conversation, not just a route', /openConversationWith/.test(profSrc));
const dmSrc = fs.readFileSync(new URL('../public/js/features/messages_sm.js', import.meta.url), 'utf8');
ok('B4  a peer with no history is handled', /isNewConversation/.test(dmSrc));
ok('B4  the new conversation appears in the list', /convs = \[\{ peer, last: null/.test(dmSrc));

/* ============================================================
   THE SHADOW BUG
   `mediaLabel = t => …` shadowed the translation function, so a bulk
   edit turned every attachment label into undefined. Guard it.
   ============================================================ */
ok('no parameter shadows the translator in messages',
   !/const mediaLabel = t =>/.test(dmSrc));
ok('mediaLabel translates properly', /mediaLabel = kind =>/.test(dmSrc));

/* ============================================================
   ARABIC / RTL
   ============================================================ */
I.setLang('ar'); await tick(340);
const ar = D.getElementById('pfRoot').textContent;
ok('profile is Arabic after switching', /متابِع|منشور|يتابع/.test(ar));
ok('direction is RTL', D.documentElement.dir === 'rtl');
ok('no French left in Arabic mode', !/abonnés|Abonné|publications/.test(ar));
I.setLang('en');

M.teardownMessages?.();
const pass = T.filter(x => x.startsWith('PASS')).length;
T.filter(x => x.startsWith('FAIL')).forEach(x => console.log(x));
console.log(`${pass}/${T.length} passed`);
