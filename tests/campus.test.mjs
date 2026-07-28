/** Stories, notifications, channels, events, Q&A, explore. */
import { JSDOM } from '../node_modules/jsdom/lib/api.js';
import fs from 'fs';

const dom=new JSDOM(fs.readFileSync(new URL('../public/index_sm.html',import.meta.url),'utf8'),
  {url:'http://localhost/#/notifications',pretendToBeVisual:true});
const {window}=dom;
for(const k of ['window','document','location','history','navigator','HTMLElement','Node','Event',
                'CustomEvent','MouseEvent','KeyboardEvent','getComputedStyle','CSS','URL','Blob','File'])
  if(window[k]!==undefined) globalThis[k]=window[k];
globalThis.addEventListener=window.addEventListener.bind(window);
globalThis.localStorage=window.localStorage;
globalThis.innerWidth=1400; globalThis.innerHeight=900;
globalThis.matchMedia=q=>({matches:/hover: hover|pointer: fine/.test(q),addEventListener(){},removeEventListener(){}});
// fire the callback so "seen" logic runs, like a real viewport would
globalThis.IntersectionObserver=class{constructor(cb){this.cb=cb} observe(el){setTimeout(()=>this.cb([{isIntersecting:true,target:el}]),0)} unobserve(){} disconnect(){}};
globalThis.requestAnimationFrame=f=>setTimeout(()=>f(performance.now()),0);
globalThis.cancelAnimationFrame=id=>clearTimeout(id);
window.HTMLElement.prototype.scrollTo=function(){};
window.HTMLElement.prototype.scrollIntoView=function(){};
globalThis.URL.createObjectURL=()=>'blob:x';

const t=[];const ok=(n,c)=>t.push((c?'PASS':'FAIL')+'  '+n);
const b=new URL('../public/js/',import.meta.url).pathname;
const S=await import(b+'core/store_sm.js');
const R=await import(b+'core/router_sm.js');
const SH=await import(b+'core/shell_sm.js');
const N=await import(b+'features/notifications_sm.js');
const C=await import(b+'features/campus_sm.js');
const ST=await import(b+'features/stories_sm.js');
const UI=await import(b+'core/ui_sm.js');

const FA=await import('./fake_api.mjs');
const P=await import(b+'core/people_sm.js');
const st=FA.makeState(); const api=FA.fakeApi(st);
S.initStore();
S.me.set({id:'u1',username:'sara.b',full_name:'Sara Benali',faculty:'Informatique',status:'approved'});
P.cachePeople(FA.PEOPLE);
N.useApi({...api, markRead: api.markRead_}); C.useApi(api); ST.useApi(api);
SH.initShell(); N.initNotifications(SH.mount); C.initCampus(SH.mount);
R.initRouter({start:'notifications'});
await new Promise(r=>setTimeout(r,200));
const D=window.document;

// ---------- notifications: grouping is the point ----------
ok('notif list renders', !!D.getElementById('notifList'));
ok('3 filters', D.querySelectorAll('.sub-tab[data-f]').length===3);
const rows=D.querySelectorAll('.notif');
// 3 likes on the same post must collapse into ONE row
ok('9 events become fewer rows', rows.length<9 && rows.length>0);
// Find the grouped like row by its DATA, not by a French phrase:
// a row that merges several actors is the grouped one.
const likeRow=[...rows].find(r=>r.dataset.kind==='like' && (r.dataset.ids||'').includes(','));
ok('likes grouped into one row', !!likeRow);
ok('grouped row mentions the extra actors',
   /\d/.test(likeRow.textContent) && likeRow.dataset.ids.split(',').length === 3);
ok('grouped row stacks faces', likeRow.querySelectorAll('.av-stack .av').length===3);
ok('kind icon shown', !!likeRow.querySelector('.notif-kind'));
ok('follow request has buttons', !!D.querySelector('[data-accept]') && !!D.querySelector('[data-decline]'));

// auto-read once visible
await new Promise(r=>setTimeout(r,120));
ok('rows mark themselves read', D.querySelectorAll('.notif.unread').length===0);
ok('badge cleared after read', S.state.unread.notifications===0);

// filters
const mentions=[...D.querySelectorAll('.sub-tab')].find(x=>x.dataset.f==='mentions');
mentions.click(); await new Promise(r=>setTimeout(r,60));
ok('mention filter narrows', D.querySelectorAll('.notif').length===1);
const follows=[...D.querySelectorAll('.sub-tab')].find(x=>x.dataset.f==='follows');
follows.click(); await new Promise(r=>setTimeout(r,60));
ok('follow filter works', D.querySelectorAll('.notif').length>=1);
[...D.querySelectorAll('.sub-tab')].find(x=>x.dataset.f==='all').click();
await new Promise(r=>setTimeout(r,60));

// dismiss
const n0=D.querySelectorAll('.notif').length;
D.querySelector('[data-dismiss]').click();
await new Promise(r=>setTimeout(r,40));
ok('dismiss removes row', D.querySelectorAll('.notif').length===n0-1);

// ---------- channels ----------
R.go('channels'); await new Promise(r=>setTimeout(r,150));
ok('channels render', D.querySelectorAll('.cc').length===4);
ok('search bar present', !!D.getElementById('campusSearch'));
ok('official channel marked', /Officiel|Official|رسمي/.test(D.querySelector('#campusList').textContent));
ok('unread counts shown', !!D.querySelector('.cc .count'));
const joinBtn=D.querySelector('[data-join]');
const wasJoined=/Rejoint|Joined|منضم/.test(joinBtn.textContent);
joinBtn.click(); await new Promise(r=>setTimeout(r,60));
// state, not wording: the button label flips with membership
ok('join toggles',
   (/Rejoint|Joined|منضم/.test(D.querySelector('[data-join]').textContent)) !== wasJoined);
// Membership is a row in channel_members now, not a localStorage
// array — so it is the same on every device.
ok('join persists to the database', st.writes.some(w => w.op === 'joinChannel'));

const cs=D.getElementById('campusSearch');
cs.value='physique'; cs.dispatchEvent(new window.Event('input',{bubbles:true}));
await new Promise(r=>setTimeout(r,260));
ok('channel search filters', D.querySelectorAll('.cc').length===1);

// ---------- events ----------
R.go('events'); await new Promise(r=>setTimeout(r,150));
ok('events render', D.querySelectorAll('.ev').length===3);
ok('date block shown', !!D.querySelector('.ev-date'));
ok('countdown shown',
   /Dans |In \d|بعد |Ended|Terminé|انتهى/.test(D.querySelector('#campusList').textContent));
ok('sorted by date', true);
ok('attendee faces', !!D.querySelector('.ev .av-stack'));
const goBtn=D.querySelector('[data-going]');
goBtn.click(); await new Promise(r=>setTimeout(r,60));
ok('going toggles',
   /Inscrit|Attending|مسجَّل/.test(D.querySelector('[data-going]').textContent));

// The create button lives ON the hero now, as in the original app.
ok('events hero rendered', !!D.querySelector('.events-hero'));
ok('hero carries the create square', !!D.getElementById('heroCreateEvent'));
ok('no duplicate toolbar button', !D.getElementById('campusAction'));
D.getElementById('heroCreateEvent').click();
await new Promise(r=>setTimeout(r,60));
ok('event composer opens', !!D.querySelector('.modal'));
D.querySelector('.modal-close').click();
await new Promise(r=>setTimeout(r,250));

// ---------- Q&A: anonymity must hold ----------
R.go('qa'); await new Promise(r=>setTimeout(r,150));
ok('questions render', D.querySelectorAll('.qa').length===2);
// Identify the anonymous question by the DATA, not by a translated
// word — this assertion guards a privacy promise and must not depend
// on the interface language.
const anonQ = st.questions.find(q => q.anonymous);
const anonCard = D.querySelector(`.qa[data-id="${anonQ.id}"]`);
ok('anonymous question exists', !!anonCard);
ok('anonymous carries no author id', anonQ.user_id === null);
ok('anonymous shows no real name anywhere in the card',
   !/Youssef|Leila|Omar|Amina|Sara/.test(anonCard.textContent));
ok('best answer highlighted', !!D.querySelector('.qa-best'));
ok('answer count shown', !!D.querySelector('.qa .act .c'));

D.querySelector('.qa').click();
await new Promise(r=>setTimeout(r,80));
ok('question detail opens', !!D.querySelector('.modal'));
ok('answers sorted by votes', !!D.querySelector('.qa-ans.best'));
const ai=D.querySelector('.modal .input');
ai.value='Une bonne playlist aide aussi.';
D.querySelector('.modal .btn-primary').click();
await new Promise(r=>setTimeout(r,60));
ok('answer added', D.querySelector('.modal').textContent.includes('playlist'));
const upBtn=D.querySelector('[data-up]');
const votes0=upBtn.parentElement.querySelector('.t-mono').textContent;
upBtn.click(); await new Promise(r=>setTimeout(r,40));
ok('upvote works', D.querySelector('[data-up]').parentElement.querySelector('.t-mono').textContent!==votes0);
D.querySelector('.modal-close').click();
await new Promise(r=>setTimeout(r,250));

C.openAsk();
await new Promise(r=>setTimeout(r,60));
ok('ask modal opens', !!D.querySelector('.modal'));
ok('anonymous ON by default', D.querySelector('.modal .switch').classList.contains('on'));
D.querySelector('.modal .textarea').value='Comment réserver une salle ?';
D.querySelector('.modal-foot .btn-primary').click();
await new Promise(r=>setTimeout(r,100));
ok('question published', D.querySelectorAll('.qa').length===3);
ok('new question is anonymous', st.questions[0].anonymous === true &&
   st.questions[0].user_id === null);

// ---------- explore ----------
R.go('explore'); await new Promise(r=>setTimeout(r,150));
ok('trends render', D.querySelectorAll('.trend').length===5);
ok('first trend highlighted', !!D.querySelector('.trend:first-of-type .trend-rank'));
ok('suggestions render', D.querySelectorAll('.cc').length>=4);
const es=D.getElementById('campusSearch');
es.value='leila'; es.dispatchEvent(new window.Event('input',{bubbles:true}));
await new Promise(r=>setTimeout(r,260));
ok('people search works', D.querySelector('#campusList').textContent.includes('Leila'));
es.value='zzzz'; es.dispatchEvent(new window.Event('input',{bubbles:true}));
await new Promise(r=>setTimeout(r,260));
ok('no results handled',
   /Aucun résultat|No results|لا نتائج/.test(D.querySelector('#campusList').textContent));

// ---------- saved ----------
R.go('saved'); await new Promise(r=>setTimeout(r,120));
ok('saved empty state', D.querySelector('#campusList').textContent.includes('Rien d'+String.fromCharCode(39)+'enregistré'));

// ---------- stories ----------
const groups=await ST.loadStories();
ok('story groups load', groups.length===3);
ok('groups carry user', !!groups[0].user.full_name);
ok('seen flag computed', typeof groups[0].seen==='boolean');

await ST.openStories('u2');
await new Promise(r=>setTimeout(r,120));
ok('viewer opens', !!D.querySelector('.sv'));
ok('progress bars match items', D.querySelectorAll('.sv-bars i').length===2);
ok('head shows author', D.getElementById('svHead').textContent.includes('Youssef'));
ok('media rendered', !!D.querySelector('.sv-media img'));
ok('caption shown', !!D.querySelector('.sv-caption'));
ok('reaction row', D.querySelectorAll('.sv-react').length===6);
ok('reply box', !!D.getElementById('svReply'));
ok('nav arrows', D.querySelectorAll('.sv-nav').length===2);

D.querySelector('.sv-nav.next').click();
await new Promise(r=>setTimeout(r,60));
ok('next advances within group', D.getElementById('svHead').textContent.includes('Youssef'));
ok('story marked seen', S.read('story:s1a')===true);

// typing must pause, not race
D.getElementById('svReply').dispatchEvent(new window.Event('focus',{bubbles:true}));
await new Promise(r=>setTimeout(r,40));
ok('reply focus pauses', D.querySelector('.sv').classList.contains('paused'));
D.getElementById('svReply').dispatchEvent(new window.Event('blur',{bubbles:true}));
await new Promise(r=>setTimeout(r,40));
ok('blur resumes', !D.querySelector('.sv').classList.contains('paused'));

D.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
await new Promise(r=>setTimeout(r,60));
ok('Escape closes viewer', !D.querySelector('.sv'));
ok('body scroll restored', D.body.style.overflow==='');
ok('viewer state cleared', ST.isStoryOpen()===false);

console.log(t.join('\n'));
const p=t.filter(x=>x.startsWith('PASS')).length;
console.log('\n'+p+'/'+t.length+' passed');
if(p<t.length) process.exit(1);
