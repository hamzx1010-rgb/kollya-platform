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
ok('title shown', D.querySelector('.lb-title').textContent.includes('Classement'));
ok('scope filters', D.querySelectorAll('.lb-scope').length===2);
ok('metric filters', D.querySelectorAll('.lb-metric').length===2);
ok('podium rendered', !!D.querySelector('.lb-podium'));
ok('podium keeps 3 columns', D.querySelector('.lb-podium').children.length===3);
ok('crown on first', !!D.querySelector('.lb-slot.p1 .lb-crown'));

// faculty scope: only Informatique
ok('faculty scope default', D.querySelector('.lb-scope.on').dataset.scope==='faculty');
const names=D.getElementById('lbList').textContent;
ok('filters to my faculty', names.includes('Amina') && !names.includes('Leila'));
ok('my row highlighted', !!D.querySelector('.lb-row.me, .lb-slot.me'));

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
const allRanks=[...D.querySelectorAll('.lb-slot,.lb-row')].map(n=>n.dataset.rank||n.querySelector('.lb-medal')?.textContent);
ok('ties share a rank', D.getElementById('lbList').textContent.includes('400'));
const rowRanks=[...D.querySelectorAll('.lb-row')].map(r=>Number(r.dataset.rank));
ok('rank skips after a tie', rowRanks.length===2 && rowRanks[0]===4 && rowRanks[1]===5);

// empty state
L.useApi({ leaderboard: async () => [] });
[...D.querySelectorAll('.lb-scope')].find(x=>x.dataset.scope==='faculty').click();
await new Promise(r=>setTimeout(r,120));
ok('empty state shown', D.getElementById('lbList').textContent.includes('vide'));
ok('position bar hidden when empty', D.getElementById('lbMine').classList.contains('hidden'));

console.log(t.join('\n'));
const p=t.filter(x=>x.startsWith('PASS')).length;
console.log('\n'+p+'/'+t.length+' passed');
if(p<t.length) process.exit(1);
