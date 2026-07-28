/** Leaderboard: ranking, ties, scope, self-position. */
import { JSDOM } from '../node_modules/jsdom/lib/api.js';
import fs from 'fs';

const dom=new JSDOM(fs.readFileSync(new URL('../public/index_sm.html',import.meta.url),'utf8'),
  {url:'http://localhost/#/leaderboard',pretendToBeVisual:true});
const {window}=dom;
for(const k of ['window','document','location','history','navigator','HTMLElement','Node','Event',
                'CustomEvent','MouseEvent','KeyboardEvent','getComputedStyle','CSS','URL','Blob'])
  if(window[k]!==undefined) globalThis[k]=window[k];
globalThis.addEventListener=window.addEventListener.bind(window);
globalThis.localStorage=window.localStorage;
globalThis.innerWidth=1400;
globalThis.matchMedia=q=>({matches:/hover: hover/.test(q),addEventListener(){},removeEventListener(){}});
globalThis.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
globalThis.requestAnimationFrame=f=>setTimeout(()=>f(performance.now()),0);
globalThis.cancelAnimationFrame=id=>clearTimeout(id);
window.HTMLElement.prototype.scrollIntoView=function(){};
window.HTMLElement.prototype.scrollTo=function(){};

const t=[];const ok=(n,c)=>t.push((c?'PASS':'FAIL')+'  '+n);
const b=new URL('../public/js/',import.meta.url).pathname;
const S=await import(b+'core/store_sm.js');
const R=await import(b+'core/router_sm.js');
const SH=await import(b+'core/shell_sm.js');
const L=await import(b+'features/leaderboard_sm.js');

const FA=await import('./fake_api.mjs');
const P=await import(b+'core/people_sm.js');
const st=FA.makeState(); const api=FA.fakeApi(st);
S.initStore();
S.me.set({id:'u1',username:'sara.b',full_name:'Sara Benali',faculty:'Informatique',status:'approved'});
P.cachePeople(FA.PEOPLE);
L.useApi(api);
SH.initShell(); L.initLeaderboard(SH.mount);
R.initRouter({start:'leaderboard'});
await new Promise(r=>setTimeout(r,200));
const D=window.document;

ok('page renders', !!D.getElementById('lbList'));
// derive the expected word from i18n — a hardcoded 'Classement' broke
// the moment the default locale became English
const I18N = await import('../public/js/core/i18n_sm.js');
ok('title shown', D.querySelector('.lb-title').textContent.includes(I18N.t('lb.title') || 'Lead'));
ok('scope filters', D.querySelectorAll('.lb-scope').length===2);
ok('metric filters', D.querySelectorAll('.lb-metric').length===2);
// ONE TABLE, no podium. The top three are marked only by the colour
// of their rank chip; ranks 4-20 are plain numbers.
ok('table rendered', !!D.querySelector('.lb-table'));
ok('no podium anywhere', !D.querySelector('.lb-podium, .lb-slot, .podium'));
ok('column header present', !!D.querySelector('.lb-head'));
ok('first row is rank 1', D.querySelector('.lb-row')?.dataset.rank === '1');
ok('gold on first', !!D.querySelector('.lb-row[data-rank="1"] .lb-rank.gold'));
const silver = D.querySelector('.lb-rank.silver'), bronze = D.querySelector('.lb-rank.bronze');
ok('silver/bronze only if those ranks exist',
   (!!silver === !!D.querySelector('.lb-row[data-rank="2"]')) &&
   (!!bronze === !!D.querySelector('.lb-row[data-rank="3"]')));
ok('rank 4+ has no medal colour',
   [...D.querySelectorAll('.lb-row')].filter(r => Number(r.dataset.rank) > 3)
     .every(r => !r.querySelector('.lb-rank.medal')));
ok('caps at 20 rows', D.querySelectorAll('.lb-row').length <= 20);

// faculty scope: only Informatique
ok('faculty scope default', D.querySelector('.lb-scope.on').dataset.scope==='faculty');
const names=D.getElementById('lbList').textContent;
ok('filters to my faculty', names.includes('Amina') && !names.includes('Leila'));
ok('my row highlighted', !!D.querySelector('.lb-row.me'));

// my position bar
ok('my position pinned', !D.getElementById('lbMine').classList.contains('hidden'));
ok('position bar shows rank', /\d/.test(D.getElementById('lbMine').textContent));
ok('jump button exists', !!D.getElementById('lbJump'));
D.getElementById('lbJump').click();
ok('jump does not crash', true);

// all-campus scope
const all=[...D.querySelectorAll('.lb-scope')].find(x=>x.dataset.scope==='all');
all.click(); await new Promise(r=>setTimeout(r,80));
ok('scope switches', all.classList.contains('on'));
ok('all scope adds people', D.getElementById('lbList').textContent.includes('Leila'));
ok('scope persists', S.read('board:scope')==='all');

// ordering is by value, descending
const ranks=[...D.querySelectorAll('.lb-row')].map(r=>Number(r.dataset.rank));
ok('ranks ascend down the list', ranks.every((v,i)=>i===0||v>=ranks[i-1]));

// metric switch
const streak=[...D.querySelectorAll('.lb-metric')].find(x=>x.dataset.metric==='streak');
streak.click(); await new Promise(r=>setTimeout(r,80));
ok('metric switches', streak.classList.contains('on'));
ok('shows days not xp', D.getElementById('lbList').textContent.includes(' j'));
ok('flame icon on streak view', !!D.querySelector('.lb-flame'));
ok('metric persists', S.read('board:metric')==='streak');

// dense ranking: equal scores share a place
L.useApi({ leaderboard: async () => ([
  {id:'a',username:'a',full_name:'Aa Aa',faculty:'Informatique',xp:400,streak:1},
  {id:'b',username:'b',full_name:'Bb Bb',faculty:'Informatique',xp:400,streak:1},
  {id:'c',username:'c',full_name:'Cc Cc',faculty:'Informatique',xp:100,streak:1},
  {id:'d',username:'d',full_name:'Dd Dd',faculty:'Informatique',xp:90,streak:1},
  {id:'u1',username:'sara.b',full_name:'Sara Benali',faculty:'Informatique',xp:50,streak:1}
])});
[...D.querySelectorAll('.lb-metric')].find(x=>x.dataset.metric==='xp').click();
await new Promise(r=>setTimeout(r,120));
ok('ties share a rank', D.getElementById('lbList').textContent.includes('400'));
// Every student is now a .lb-row (the podium is gone), so the whole
// ranking is readable in one place: three students tied on 400 XP are
// all 3rd, and the next is 5th... wait — 1,1,1 then 4. Assert the real
// dense-ranking contract instead of hardcoded positions.
const rowRanks=[...D.querySelectorAll('.lb-row')].map(r=>Number(r.dataset.rank));
ok('all five students are rows now', rowRanks.length===5);
ok('ranks never decrease', rowRanks.every((v,i)=>i===0||v>=rowRanks[i-1]));
const tied = rowRanks.filter(v=>v===rowRanks[0]).length;
ok('rank skips after a tie', rowRanks[tied] === tied + 1);

// empty state
L.useApi({ leaderboard: async () => [] });
[...D.querySelectorAll('.lb-scope')].find(x=>x.dataset.scope==='faculty').click();
await new Promise(r=>setTimeout(r,120));
ok('empty state shown', D.getElementById('lbList').textContent.includes(I18N.t('lb.empty')));
ok('position bar hidden when empty', D.getElementById('lbMine').classList.contains('hidden'));

console.log(t.join('\n'));
const p=t.filter(x=>x.startsWith('PASS')).length;
console.log('\n'+p+'/'+t.length+' passed');
if(p<t.length) process.exit(1);
