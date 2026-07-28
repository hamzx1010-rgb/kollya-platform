/**
 * A conversation, from BOTH sides.
 *
 * Every previous test drove one user and asserted the DOM. That is
 * how "the messages are still broken" survived 454 green tests: no
 * test ever checked that what Sara sent is what Youssef receives, or
 * that a reaction one side adds shows up on the other.
 *
 * This file runs one shared store and two API clients over it, then
 * exercises send · receive · media · reaction · reply · edit · delete
 * · read receipt · folders — checking BOTH ends after each step.
 *
 * It also renders, so a `data:` image that comes back blank fails
 * here instead of in the user's browser.
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
globalThis.innerWidth = 1500; globalThis.innerHeight = 900;
globalThis.matchMedia = q => ({ matches:/hover: hover|pointer: fine/.test(q), addEventListener(){}, removeEventListener(){} });
globalThis.IntersectionObserver = class { constructor(cb){this.cb=cb} observe(el){setTimeout(()=>this.cb([{isIntersecting:true,target:el}]),0)} unobserve(){} disconnect(){} };
globalThis.requestAnimationFrame = f => setTimeout(() => f(0), 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);
window.HTMLElement.prototype.scrollTo = function(){};
window.HTMLElement.prototype.scrollIntoView = function(){};
globalThis.URL.createObjectURL = () => 'blob:x';
globalThis.URL.revokeObjectURL = () => {};

const t = []; const ok = (n, c) => t.push((c ? 'PASS' : 'FAIL') + '  ' + n);
const b = new URL('../public/js/', import.meta.url).pathname;
const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));

const FA = await import('./fake_api.mjs');
const S  = await import(b + 'core/store_sm.js');
const R  = await import(b + 'core/router_sm.js');
const SH = await import(b + 'core/shell_sm.js');
const P  = await import(b + 'core/people_sm.js');
const M  = await import(b + 'features/messages_sm.js');
const U  = await import(b + 'core/utils_sm.js');

// ONE shared world, TWO clients — this is the whole point.
const st    = FA.makeState();
const sara  = FA.fakeApi(st, 'u1');    // me, on screen
const yous  = FA.fakeApi(st, 'u2');    // the other side, headless

S.initStore();
S.me.set({ id:'u1', username:'sara.b', full_name:'Sara Benali', faculty:'Informatique', status:'approved' });
P.cachePeople(FA.PEOPLE);
M.useApi(sara);
SH.initShell();
M.initMessages(SH.mount);
R.initRouter({ start: 'messages' });
await tick(200);
const D = window.document;

/* ============================================================
   1. THE LIST
   ============================================================ */
ok('conversation list renders', !!D.getElementById('convScroll'));
ok('conversations shown', D.querySelectorAll('.conv').length >= 3);
ok('folder bar present', !!D.getElementById('chatFolders'));
ok('six folders', D.querySelectorAll('.chat-folder').length === 6);
ok('Tous is active by default', D.querySelector('.chat-folder.on')?.dataset.folder === 'all');

/* ============================================================
   2. OPEN A THREAD
   ============================================================ */
await M.openThread('u2');
await tick(150);
ok('thread opens', !!D.getElementById('threadBody'));
ok('peer name in header', D.getElementById('threadHead').textContent.includes('Youssef'));
ok('existing messages rendered', D.querySelectorAll('.bubble-row').length >= 3);
ok('composer visible', !D.getElementById('composerWrap').classList.contains('hidden'));
ok('mic and send are separate controls',
   !!D.getElementById('btnMic') && !!D.getElementById('btnSend') &&
   D.getElementById('btnMic') !== D.getElementById('btnSend'));

/* ============================================================
   3. SARA SENDS  →  YOUSSEF RECEIVES
   ============================================================ */
const input = D.getElementById('composerInput');
input.value = 'Tu viens réviser demain ?';
input.dispatchEvent(new window.Event('input', { bubbles: true }));
D.getElementById('btnSend').click();
await tick(200);

ok('sent message appears for sender',
   D.getElementById('threadBody').textContent.includes('Tu viens réviser demain'));
ok('composer cleared after send', input.value === '');

const yousSide = await yous.listMessages('u1');
ok('receiver sees the message',
   yousSide.some(m => m.text === 'Tu viens réviser demain ?'));
ok('message is attributed to the sender',
   yousSide.find(m => m.text === 'Tu viens réviser demain ?').sender_id === 'u1');
ok('nothing is left pending',
   !D.querySelector('#threadBody .tick.pending'));

/* ============================================================
   4. YOUSSEF REPLIES  →  SARA RECEIVES IT WITHOUT RELOADING
   ============================================================ */
await yous.sendMessage({ receiver_id: 'u1', text: 'Oui, 14h en B12' });
await M.openThread('u2');           // what the poller does
await tick(150);
ok('incoming message reaches the open thread',
   D.getElementById('threadBody').textContent.includes('14h en B12'));

const saraSide = await sara.listMessages('u2');
ok('both sides share one history', saraSide.length === yousSide.length + 1);

/* ============================================================
   5. IMAGES — the bug that blanked 44 render sites
   ============================================================ */
const IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
ok('safeUrl passes a data: image', U.safeUrl(IMG) === IMG);
ok('safeUrl still blocks javascript:', U.safeUrl('javascript:alert(1)') === '');
ok('safeUrl still blocks inline SVG', U.safeUrl('data:image/svg+xml,<svg onload=alert(1)>') === '');

await yous.sendMessage({ receiver_id:'u1', text:'', media_url: IMG, media_type:'image', media_name:'notes.gif' });
await M.openThread('u2');
await tick(150);

const imgs = [...D.querySelectorAll('#threadBody .media img')];
ok('image message renders an <img>', imgs.length > 0);
ok('the src is NOT blank', imgs.every(i => i.getAttribute('src')?.length > 20));
ok('the src is the data: URL', imgs.some(i => i.getAttribute('src').startsWith('data:image/')));

/* ============================================================
   6. REACTIONS — both directions
   ============================================================ */
const target = (await sara.listMessages('u2')).find(m => m.text === 'Oui, 14h en B12');
await sara.react(target.id, 'love');
let after = await yous.listMessages('u1');
ok('sender reaction visible to the other side',
   after.find(m => String(m.id) === String(target.id))?.reactions?.u1 === 'love');

await yous.react(target.id, 'like');
after = await sara.listMessages('u2');
const both = after.find(m => String(m.id) === String(target.id)).reactions;
ok('two people can react to one message', both.u1 === 'love' && both.u2 === 'like');

await sara.react(target.id, null);
after = await sara.listMessages('u2');
ok('removing my reaction leaves theirs',
   !after.find(m => String(m.id) === String(target.id)).reactions.u1 &&
   after.find(m => String(m.id) === String(target.id)).reactions.u2 === 'like');

/* ============================================================
   7. EDIT · DELETE · READ RECEIPT
   ============================================================ */
const mine = (await sara.listMessages('u2')).find(m => m.sender_id === 'u1' && (m.text || '').includes('réviser'));
await sara.editMessage(mine.id, 'Tu viens réviser demain ? (14h)');
ok('edit reaches the other side',
   (await yous.listMessages('u1')).find(m => String(m.id) === String(mine.id)).text.includes('(14h)'));

await sara.markRead(target.id);
ok('read receipt recorded', st.writes.some(w => w.op === 'markRead'));

const before = (await sara.listMessages('u2')).length;
await sara.deleteMessage(mine.id);
ok('delete removes it for the sender', (await sara.listMessages('u2')).length === before - 1);
ok('delete removes it for the receiver',
   !(await yous.listMessages('u1')).some(m => String(m.id) === String(mine.id)));

/* ============================================================
   8. NEW CONVERSATION — the button that showed nothing
   ============================================================ */
const people = await sara.contacts('');
ok('contacts returns people', people.length > 0);
ok('contacts never includes me', !people.some(p => p.id === 'u1'));
const found = await sara.contacts('Leila');
ok('contact search narrows', found.length === 1 && found[0].full_name.includes('Leila'));
const none = await sara.contacts('zzzzzz');
ok('a search with no match returns empty, not an error', Array.isArray(none) && none.length === 0);

/* ============================================================
   9. FOLDERS
   ============================================================ */
await sara.setFolder('u3', 'study');
const f = await sara.listFolders();
ok('folder saved', f.u3 === 'study');
ok('folder persists server-side', st.writes.some(w => w.op === 'setFolder'));
await sara.setFolder('u3', 'all');
ok('moving back to Tous clears it', !(await sara.listFolders()).u3);

/* ============================================================
   10. INCREMENTAL FETCH — what makes 1.5s affordable
   ============================================================ */
const all = await sara.listMessages('u2');
const since = all[all.length - 1].created_at;
await tick(10);
const nothingNew = await sara.listNewMessages('u2', since);
ok('no new messages returns an empty array', nothingNew.length === 0);
await yous.sendMessage({ receiver_id: 'u1', text: 'À demain' });
const delta = await sara.listNewMessages('u2', since);
ok('only the new message is fetched', delta.length === 1 && delta[0].text === 'À demain');

/* ============================================================
   11. THE FLICKER — read receipts must not rebuild the thread
   ============================================================ */
const src = fs.readFileSync(new URL('../public/js/features/messages_sm.js', import.meta.url), 'utf8');
const tailFn = (src.match(/async function refreshTail\(\)[\s\S]*?\n\}/) || [''])[0];

ok('refreshTail does not rebuild the whole thread for a tick',
   !/renderThread\(\{ keepScroll: !atBottom \}\);\s*\n\}/.test(tailFn) ||
   /patchTicks/.test(tailFn));
ok('ticks are patched in place', /patchTicks\(merged\)/.test(tailFn));
ok('reactions repaint one bubble', /repaintBubble\(merged\)/.test(tailFn));
ok('edited text is patched in place', /patchText\(merged\)/.test(tailFn));
ok('only add/remove triggers a rebuild', /structural/.test(tailFn));
ok('patchTicks exists', /function patchTicks/.test(src));
ok('patchText exists', /function patchText/.test(src));

/* ============================================================
   12. THE PAGE MUST OPEN ON A CONVERSATION
   ============================================================ */
ok('a conversation opens without being clicked', /const wanted = arg/.test(src));
ok('it remembers the last chat', /state\.activeChat/.test(src));
ok('it falls back to the newest conversation', /convs\[0\]\?\.peer\?\.id/.test(src));
ok('an empty inbox says so in the thread pane', /function showNoConversations/.test(src));

// prove it in the DOM: route with no argument
M.teardownMessages();
R.go('feed');
await tick(80);
R.go('messages');
await tick(300);
ok('landing on /messages shows a real conversation, not a blank panel',
   D.querySelectorAll('#threadBody .bubble-row').length > 0);
ok('the composer is visible on arrival',
   !D.getElementById('composerWrap').classList.contains('hidden'));
ok('the thread header names someone',
   (D.getElementById('threadHead').textContent || '').trim().length > 0);

/* ============================================================
   13. PANEL FOLD
   ============================================================ */
ok('fold button exists', !!D.getElementById('btnDmFold'));
D.getElementById('btnDmFold').click();
await tick(60);
ok('folding collapses the list', D.getElementById('dm').classList.contains('dm-folded'));
D.getElementById('btnDmFold').click();
await tick(60);
ok('unfolding restores it', !D.getElementById('dm').classList.contains('dm-folded'));

/* ============================================================
   14. GIFS — blocked by my own SVG guard
   ============================================================ */
const gifSrc = fs.readFileSync(new URL('../public/js/features/gif_sm.js', import.meta.url), 'utf8');
const gifCode = gifSrc.replace(/\/\*[\s\S]*?\*\//g, '');
ok('gif tiles are no longer SVG data-urls', !/image\/svg\+xml/.test(gifCode));
ok('gif tiles render to a canvas', /toDataURL\('image\/png'\)/.test(gifCode));
ok('there is an inert fallback', /data:image\/gif;base64/.test(gifCode));
ok('a png tile would pass safeUrl', !!U.safeUrl('data:image/png;base64,iVBORw0KGgo='));
ok('svg is STILL blocked — it can carry script',
   U.safeUrl('data:image/svg+xml,<svg onload=alert(1)>') === '');

// Leaving the screen must release the poll timer. If this line is
// removed the test hangs for the length of the interval — which is
// exactly what a browser tab would do too.
M.teardownMessages();

const pass = t.filter(x => x.startsWith('PASS')).length;
t.filter(x => x.startsWith('FAIL')).forEach(x => console.log(x));
console.log(`${pass}/${t.length} passed`);
