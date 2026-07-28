/**
 * Message requests — the Instagram model.
 *
 * The rules being tested are enforced by a Postgres trigger
 * (db/09_requests_sm.sql). The fixture mirrors that trigger, so a
 * change to one must be matched in the other; the assertions below
 * are written against the BEHAVIOUR, not the implementation, so they
 * hold for both.
 *
 * The property that matters most: a declined sender is never told.
 * Every assertion about silence is deliberate.
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
const tick = (ms = 200) => new Promise(r => setTimeout(r, ms));

const FA = await import('./fake_api.mjs');
const S  = await import(b + 'core/store_sm.js'); S.initStore();
S.me.set({ id:'u1', username:'sara.b', full_name:'Sara', faculty:'Informatique', status:'approved' });
const I  = await import(b + 'core/i18n_sm.js'); I.setLang('en');
const P  = await import(b + 'core/people_sm.js'); P.cachePeople(FA.PEOPLE);
const SH = await import(b + 'core/shell_sm.js');
const R  = await import(b + 'core/router_sm.js');
const M  = await import(b + 'features/messages_sm.js');

// one shared world, three people
const st   = FA.makeState();
const sara = FA.fakeApi(st, 'u1');   // me
const omar = FA.fakeApi(st, 'u5');   // a stranger: u1 does not follow u5
const yous = FA.fakeApi(st, 'u2');   // someone I follow

st.messages = [];                                       // start clean

/* ============================================================
   1. THE ROUTING RULE
   ============================================================ */
await yous.sendMessage({ receiver_id: 'u1', text: 'Salut, tu as les notes ?' });
ok('a followed person reaches the inbox directly',
   (await sara.listRequests()).length === 0);
ok('and their message is in the conversation list',
   (await sara.listConversations()).some(c => c.peer.id === 'u2'));

await omar.sendMessage({ receiver_id: 'u1', text: 'Salut, je suis en maths' });
const reqs = await sara.listRequests();
ok('a stranger becomes a request', reqs.length === 1 && reqs[0].peer.id === 'u5');
ok('the request carries a preview', reqs[0].preview.includes('maths'));
ok('a stranger does NOT appear in the inbox',
   !(await sara.listConversations()).some(c => c.peer.id === 'u5'));

/* ============================================================
   2. THE THREE-MESSAGE CAP
   Without it, someone unwanted fills the requests tab.
   ============================================================ */
await omar.sendMessage({ receiver_id: 'u1', text: 'deuxième' });
await omar.sendMessage({ receiver_id: 'u1', text: 'troisième' });
await omar.sendMessage({ receiver_id: 'u1', text: 'quatrième' });
await omar.sendMessage({ receiver_id: 'u1', text: 'cinquième' });
const fromOmar = st.messages.filter(m => m.sender_id === 'u5' && m.receiver_id === 'u1');
ok(`a pending request is capped (${fromOmar.length} stored)`, fromOmar.length === 3);
ok('the sender is not told they were capped',
   !st.writes.some(w => /error|blocked|refus/i.test(JSON.stringify(w))));

/* ============================================================
   3. ACCEPTING
   ============================================================ */
await sara.acceptRequest('u5');
ok('accepting clears it from requests', (await sara.listRequests()).length === 0);
ok('accepting moves it into the inbox',
   (await sara.listConversations()).some(c => c.peer.id === 'u5'));
await omar.sendMessage({ receiver_id: 'u1', text: 'merci !' });
ok('an accepted sender is no longer capped',
   st.messages.filter(m => m.sender_id === 'u5').length === 4);

/* ============================================================
   4. DECLINING IS SILENT — the property that matters most
   ============================================================ */
const st2  = FA.makeState();
const me2  = FA.fakeApi(st2, 'u1');
const them = FA.fakeApi(st2, 'u6');
st2.messages = [];

await them.sendMessage({ receiver_id: 'u1', text: 'coucou' });
ok('their first message creates a request', (await me2.listRequests()).length === 1);

await me2.declineRequest('u6');
ok('declining empties the requests tab', (await me2.listRequests()).length === 0);
ok('declining never lands in the inbox',
   !(await me2.listConversations()).some(c => c.peer.id === 'u6'));

const before = st2.messages.length;
const sent = await them.sendMessage({ receiver_id: 'u1', text: 'tu es là ?' });
ok('a declined sender still gets a success response — no error leaks the decision',
   !!sent && !!sent.id);
ok('but the message is not stored', st2.messages.length === before);
ok('and it never reaches the receiver',
   !(await me2.listMessages('u6')).some(m => m.text === 'tu es là ?'));

/* ============================================================
   5. WHAT THE SENDER IS TOLD IN ADVANCE
   ============================================================ */
const st3 = FA.makeState(); st3.messages = [];
const a3 = FA.fakeApi(st3, 'u1');
ok('writing to someone you follow is NOT a request', (await a3.willBeRequest('u2')) === false);
ok('writing to a stranger IS flagged as a request', (await a3.willBeRequest('u5')) === true);
// Direction matters: me accepting THEM does not open a channel for
// me to write to them. It is THEIR acceptance of me that does — the
// earlier assertion had the direction backwards.
const themSide = FA.fakeApi(st3, 'u5');
await themSide.acceptRequest('u1');          // Omar accepts Sara
ok('once they accept me, my message is no longer a request',
   (await a3.willBeRequest('u5')) === false);

/* ============================================================
   6. THE UI
   ============================================================ */
const st4 = FA.makeState(); st4.messages = [];
const ui  = FA.fakeApi(st4, 'u1');
const str = FA.fakeApi(st4, 'u5');
await str.sendMessage({ receiver_id: 'u1', text: 'Bonjour, une question sur le TP' });

M.useApi(ui);
SH.initShell(); M.initMessages(SH.mount);
R.initRouter({ start: 'messages' });
await tick(400);
const D = window.document;

ok('a Requests folder exists', !!D.querySelector('[data-folder="requests"]'));
const pill = D.querySelector('[data-folder="requests"]');
ok('the folder shows a count', /1/.test(pill.textContent));
ok('it is highlighted while something waits', pill.classList.contains('has-requests'));

pill.click();
await tick(300);
ok('the requests list renders', D.querySelectorAll('.req').length === 1);
ok('the card shows who it is from', /Amina/.test(D.querySelector('.req').textContent));
ok('the card shows what they said', /TP/.test(D.querySelector('.req-preview').textContent));
ok('accept and decline are both offered',
   !!D.querySelector('[data-accept]') && !!D.querySelector('[data-decline]'));
ok('privacy is stated on the screen', !!D.querySelector('.req-note'));

D.querySelector('[data-accept]').click();
await tick(400);
ok('accepting removes the card', D.querySelectorAll('.req').length === 0);
ok('accepting is written to the database', st4.writes.some(w => w.op === 'acceptRequest'));

/* ============================================================
   7. THE SQL AND THE FIXTURE MUST AGREE
   ============================================================ */
const sql = fs.readFileSync(new URL('../db/09_requests_sm.sql', import.meta.url), 'utf8');
ok('routing happens in a trigger, not in the browser', /CREATE TRIGGER trg_route_new_message/.test(sql));
ok('the three-message cap is enforced in SQL', /sent_count >= 3/.test(sql));
ok('a declined insert is dropped silently',
   /existing\.state = 'declined'[\s\S]{0,400}RETURN NULL/.test(sql));
ok('senders cannot read their own request state',
   /USING \(owner_id = auth\.user_id\(\) OR is_admin\(\)\)/.test(sql));
ok('RLS is forced on the table', /ALTER TABLE dm_requests FORCE ROW LEVEL SECURITY/.test(sql));
ok('accept and decline are definer functions',
   /FUNCTION dm_accept[\s\S]{0,300}SECURITY DEFINER/.test(sql));

M.teardownMessages?.();
const pass = T.filter(x => x.startsWith('PASS')).length;
T.filter(x => x.startsWith('FAIL')).forEach(x => console.log(x));
console.log(`${pass}/${T.length} passed`);
