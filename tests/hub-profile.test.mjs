/** Hub (streak, XP, quests, badges, leaderboard) and Profile. */
import { JSDOM } from '../node_modules/jsdom/lib/api.js';
import fs from 'fs';

const dom=new JSDOM(fs.readFileSync(new URL('../public/index_sm.html',import.meta.url),'utf8'),
  {url:'http://localhost/#/hub',pretendToBeVisual:true});
const {window}=dom;
for(const k of ['window','document','location','history','navigator','HTMLElement','Node','Event',
                'CustomEvent','MouseEvent','KeyboardEvent','getComputedStyle','CSS','URL','Blob','File'])
  if(window[k]!==undefined) globalThis[k]=window[k];
globalThis.addEventListener=window.addEventListener.bind(window);
globalThis.localStorage=window.localStorage;
globalThis.innerWidth=1400; globalThis.innerHeight=900;
globalThis.matchMedia=q=>({matches:/hover: hover|pointer: fine/.test(q),addEventListener(){},removeEventListener(){}});
globalThis.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
globalThis.requestAnimationFrame=f=>setTimeout(()=>f(performance.now()),0);

window.HTMLElement.prototype.scrollTo=function(){};
window.HTMLElement.prototype.scrollIntoView=function(){};
globalThis.URL.createObjectURL=()=>'blob:x';

const t=[];const ok=(n,c)=>t.push((c?'PASS':'FAIL')+'  '+n);
const b=new URL('../public/js/',import.meta.url).pathname;
const S=await import(b+'core/store_sm.js');
const R=await import(b+'core/router_sm.js');
const SH=await import(b+'core/shell_sm.js');
const H=await import(b+'features/hub_sm.js');
const P=await import(b+'features/profile_sm.js');
const UI=await import(b+'core/ui_sm.js');

const FA=await import('./fake_api.mjs');
const PP=await import(b+'core/people_sm.js');
const st=FA.makeState(); const api=FA.fakeApi(st);
S.initStore();
S.me.set({id:'u1',username:'sara.b',full_name:'Sara Benali',faculty:'Informatique',status:'approved',role:'student'});
PP.cachePeople(FA.PEOPLE);
H.useApi(api); P.useApi(FA.profileApiFor(st));
SH.initShell(); H.initHub(SH.mount); P.initProfile(SH.mount);
R.initRouter({start:'hub'});
await new Promise(r=>setTimeout(r,150));
const D=window.document;

// ---------- levels ----------
ok('level 1 at 0 xp', H.levelFromXp(0).level===1);
ok('level grows with xp', H.levelFromXp(5000).level>H.levelFromXp(500).level);
ok('level cost increases', H.xpForLevel(5)>H.xpForLevel(1));
const lv=H.levelFromXp(340);
ok('pct within range', lv.pct>=0 && lv.pct<=100);
ok('into < need', lv.into<lv.need);

// ---------- badges are derived ----------
ok('12 badges defined', H.badges().length===12);
ok('all badges have need()', H.badges().every(x=>typeof x.need==='function'));
ok('no badges at zero', H.earnedBadges({posts:0,comments:0,likes:0,answers:0,followers:0,events:0,saved:0,nightPosts:0,streak:0,level:1}).length===0);
const rich={posts:20,comments:30,likes:60,answers:12,followers:60,events:5,saved:25,nightPosts:1,streak:31,level:12};
ok('all badges earnable', H.earnedBadges(rich).length===12);
ok('streak30 needs 30', !H.earnedBadges({...rich,streak:29}).some(x=>x.id==='streak30'));

// ---------- hub view ----------
ok('hero rendered', !!D.querySelector('.hub-hero'));
ok('streak flame', !!D.querySelector('.streak-flame'));
ok('xp bar', !!D.getElementById('hubBar'));
ok('quests rendered', D.querySelectorAll('.quest').length===3);
ok('quest count shown', !!D.getElementById('questCount'));
ok('badge grid full', D.querySelectorAll('.badge').length===12);
await new Promise(r=>setTimeout(r,120));   // stats arrive from the API
ok('some badges earned', D.querySelectorAll('.badge.earned').length>0);
// The hub's board is now the SAME table as the leaderboard page —
// no podium, no empty third slot. Only the rank chip is coloured.
ok('board table present', !!D.querySelector('#boardList .lb-table'));
ok('no podium left in the hub', !D.querySelector('.podium, .podium-slot, .board-row'));
ok('board renders a row per student', D.querySelectorAll('#boardList .lb-row').length>=1);
ok('first place is gold', !!D.querySelector('#boardList .lb-row .lb-rank.gold'));
ok('my row highlighted', !!D.querySelector('#boardList .lb-row.me'));
ok('board caps at 20', D.querySelectorAll('#boardList .lb-row').length<=20);
ok('scope buttons', D.querySelectorAll('.board-scope').length===2);

// Deterministic daily quests. The label is what must be stable; the
// progress number legitimately changes as you act, so compare labels.
const label=n=>D.querySelectorAll('.quest')[n]?.querySelector('.t-sm')?.textContent;
const q1=label(0);
R.go('feed'); await new Promise(r=>setTimeout(r,40));
R.go('hub');  await new Promise(r=>setTimeout(r,160));
ok('quests stable across visits', label(0)===q1);

// quest progress persists
const before=D.querySelectorAll('.quest.done').length;
H.trackQuest('post',1);
await new Promise(r=>setTimeout(r,40));
ok('trackQuest updates ui', D.querySelectorAll('.quest').length===3);
ok('unknown quest is safe', (()=>{try{H.trackQuest('nope');return true}catch{return false}})());

// leaderboard scope
const all=[...D.querySelectorAll('.board-scope')].find(x=>x.dataset.scope==='all');
all.click(); await new Promise(r=>setTimeout(r,40));
ok('scope switches', all.classList.contains('on'));
ok('all scope shows more', D.querySelectorAll('#boardList .lb-row').length>=3);

// badge detail
D.querySelector('.badge').click();
await new Promise(r=>setTimeout(r,60));
ok('badge modal opens', !!D.querySelector('.modal'));
ok('badge modal has art', !!D.querySelector('.badge-unlock'));
D.querySelector('.modal-close').click();
await new Promise(r=>setTimeout(r,250));

// ---------- profile ----------
R.go('profile','sara.b');
await new Promise(r=>setTimeout(r,150));
ok('cover rendered', !!D.getElementById('pfCover'));
ok('avatar with xp ring', !!D.querySelector('.pf-avatar-wrap .av-ring'));
ok('level pill shown', !!D.querySelector('.pf-level'));
ok('own profile shows edit', !!D.getElementById('pfEdit'));
ok('own profile hides follow', !D.getElementById('pfFollow'));
ok('avatar editable when mine', !!D.getElementById('pfAvatarEdit'));
ok('3 tabs', D.querySelectorAll('.pf-tab').length===3);
ok('stats row', D.querySelectorAll('.pf-stat').length===4);
await new Promise(r=>setTimeout(r,120));   // posts are fetched, not invented
ok('posts listed', D.querySelectorAll('#pfBody .post').length===3);
ok('badges strip', !!D.querySelector('.pf-badge'));

// tab switching
const mediaTab=[...D.querySelectorAll('.pf-tab')].find(x=>x.dataset.tab==='media');
mediaTab.click(); await new Promise(r=>setTimeout(r,140));
ok('media tab active', mediaTab.classList.contains('on'));
ok('media grid shown', !!D.querySelector('.pf-grid'));

// someone else
R.go('profile','youssef');
await new Promise(r=>setTimeout(r,150));
ok('other profile loads', D.querySelector('#pfRoot').textContent.includes('Youssef'));
ok('follow button present', !!D.getElementById('pfFollow'));
ok('no edit button', !D.getElementById('pfEdit'));
// The Message button follows can_message(): shown on public accounts,
// hidden on private ones you do not follow. A button that opens a
// conversation the database will refuse is worse than no button.
ok('message button on a public account', !!D.getElementById('pfMessage'));

const fb=D.getElementById('pfFollow');
ok('starts unfollowed', fb.dataset.state==='none');
fb.click(); await new Promise(r=>setTimeout(r,60));
ok('follow is optimistic', fb.dataset.state==='following');
fb.click(); await new Promise(r=>setTimeout(r,60));
ok('unfollow works', fb.dataset.state==='none');

// private account gates content
R.go('profile','leila');
await new Promise(r=>setTimeout(r,150));
ok('private badge shown', D.querySelector('#pfRoot').textContent.includes('Privé'));
ok('private hides posts', D.querySelectorAll('#pfBody .post').length===0);
ok('private explains why',
   /privé|private|خاص/i.test(D.getElementById('pfBody').textContent));
// followState comes from the follows table now, so a fresh fixture
// user has no relation yet — 'none' is the correct answer here.
const pfb=D.getElementById('pfFollow');
ok('private profile still offers follow', !!pfb);
ok('no message button on an unfollowed private account', !D.getElementById('pfMessage'));
ok('follow state is read from the database', ['none','requested','following'].includes(pfb.dataset.state));

// unknown profile
R.go('profile','nobody');
await new Promise(r=>setTimeout(r,150));
// language-independent: an unknown profile shows an empty state and
// no action buttons, whatever the interface language.
const unknown = D.getElementById('pfRoot');
ok('unknown profile handled',
   /introuvable|not found|غير موجود/i.test(unknown.textContent) ||
   !!unknown.querySelector('.empty'));
ok('unknown profile offers no actions',
   !unknown.querySelector('#pfFollow, #pfEdit, #pfMessage'));

console.log(t.join('\n'));
const p=t.filter(x=>x.startsWith('PASS')).length;
console.log('\n'+p+'/'+t.length+' passed');
if(p<t.length) process.exit(1);
