import { JSDOM } from '/home/user/koliya/node_modules/jsdom/lib/api.js';
import fs from 'fs';
const html=fs.readFileSync('/home/user/koliya/public/index_sm.html','utf8');
const dom=new JSDOM(html,{url:'http://localhost/#/feed',pretendToBeVisual:true});
const {window}=dom;
for(const k of ['window','document','location','history','navigator','HTMLElement','Node','Event',
                'CustomEvent','MouseEvent','KeyboardEvent','getComputedStyle','CSS','URL','Blob','File'])
  if(window[k]!==undefined) globalThis[k]=window[k];
globalThis.addEventListener=window.addEventListener.bind(window);
globalThis.localStorage=window.localStorage;
globalThis.innerWidth=1400; globalThis.innerHeight=900;
globalThis.matchMedia=q=>({matches:/hover: hover|pointer: fine/.test(q),addEventListener(){},removeEventListener(){}});
globalThis.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
globalThis.requestAnimationFrame=f=>setTimeout(()=>f(0),0);
window.HTMLElement.prototype.scrollTo=function(){};
window.HTMLElement.prototype.scrollIntoView=function(){};
globalThis.URL.createObjectURL=()=>'blob:x';
Object.defineProperty(window.HTMLElement.prototype,'scrollHeight',{get(){return 100},configurable:true});
Object.defineProperty(window.HTMLElement.prototype,'clientHeight',{get(){return 100},configurable:true});

const t=[];const ok=(n,c)=>t.push((c?'PASS':'FAIL')+'  '+n);
const b='/home/user/koliya/public/js/';
const S=await import(b+'core/store_sm.js');const R=await import(b+'core/router_sm.js');
const SH=await import(b+'core/shell_sm.js');const F=await import(b+'features/feed_sm.js');
const UI=await import(b+'core/ui_sm.js');
const FA=await import('./fake_api.mjs');
const P=await import(b+'core/people_sm.js');
const st=FA.makeState(); const api=FA.fakeApi(st);
S.initStore(); S.me.set({id:'u1',username:'sara.b',full_name:'Sara Benali',faculty:'Informatique',status:'approved'});
P.cachePeople(FA.PEOPLE);
const ST=await import(b+'features/stories_sm.js'); ST.useApi(api);
F.useApi(api);
SH.initShell(); F.initFeed(SH.mount); R.initRouter({start:'feed'});
await new Promise(r=>setTimeout(r,150));
const D=window.document;

ok('feed renders', !!D.getElementById('feedList'));
ok('stories bar', !!D.querySelector('.stories'));
ok('own story first', D.querySelector('.story').dataset.story==='new');
ok('3 tabs', D.querySelectorAll('.sub-tab').length===3);
ok('foryou active', D.querySelector('.sub-tab.on').dataset.tab==='foryou');

const cards=D.querySelectorAll('.post');
ok('posts rendered', cards.length===5);
ok('post has actions', D.querySelectorAll('.post-actions').length===5);
ok('like/comment/save present', !!D.querySelector('[data-act="like"]') && !!D.querySelector('[data-act="comment"]') && !!D.querySelector('[data-act="save"]'));
ok('tools hidden until active', D.querySelector('.post-tools').classList.contains('hover-reveal'));

// anonymous post hides identity
// Was `.includes('Anonyme')` — a hardcoded French literal, which broke
// the moment that pill started going through t() and rendered
// 'Anonymous' under the default English locale. Match the DATA
// (the anonymous post carries no author link), not one language's word.
const anonLabel = (await import('../public/js/core/i18n_sm.js')).t('feed.anonymous');
const anon=[...cards].find(c=>c.textContent.includes(anonLabel));
ok('anonymous post exists', !!anon);
ok('anonymous hides username', !anon.textContent.includes('@'));

// poll
ok('poll rendered', !!D.querySelector('.poll'));
ok('poll has 3 options', D.querySelectorAll('.poll-opt').length===3);
ok('no percentages before voting', !D.querySelector('.poll-pct'));
D.querySelector('.poll-opt').click();
await new Promise(r=>setTimeout(r,40));
ok('vote registers', !!D.querySelector('.poll-pct'));
ok('voted option marked', !!D.querySelector('.poll-opt.voted'));
const n=D.querySelectorAll('.poll-opt.done').length;
ok('all options locked after vote', n===3);

// rich text
ok('hashtag linkified', !!D.querySelector('.rt-tag'));
ok('url linkified', !!D.querySelector('.rt-link'));

// like is optimistic
const card=cards[0];
const likeBtn=card.querySelector('[data-act="like"]');
const before=likeBtn.querySelector('.c').textContent;
likeBtn.click();
await new Promise(r=>setTimeout(r,30));
ok('like updates instantly', likeBtn.querySelector('.c').textContent!==before);
ok('like marked pressed', likeBtn.getAttribute('aria-pressed')==='true');
ok('like swaps to filled glyph', likeBtn.querySelector('svg path[fill="var(--rx)"]')!==null || likeBtn.classList.contains('on'));
likeBtn.click();
await new Promise(r=>setTimeout(r,30));
ok('unlike reverts', likeBtn.querySelector('.c').textContent===before);

// save
const saveBtn=card.querySelector('[data-act="save"]');
saveBtn.click();
await new Promise(r=>setTimeout(r,30));
ok('save toggles', saveBtn.classList.contains('on'));

// click selects
card.click();
await new Promise(r=>setTimeout(r,20));
ok('click selects post', card.classList.contains('is-active'));
cards[1].click();
await new Promise(r=>setTimeout(r,20));
ok('selection moves', cards[1].classList.contains('is-active') && !card.classList.contains('is-active'));

// J/K/L keyboard
S.emit('key:next');
await new Promise(r=>setTimeout(r,20));
ok('J moves selection', D.querySelectorAll('.post.is-active').length===1);
S.emit('key:prev');
await new Promise(r=>setTimeout(r,20));
ok('K moves back', D.querySelectorAll('.post.is-active').length===1);
const sel=D.querySelector('.post.is-active');
const selLike=sel.querySelector('[data-act="like"]');
const c0=selLike.querySelector('.c').textContent;
S.emit('key:like');
await new Promise(r=>setTimeout(r,30));
ok('L likes selected post', selLike.querySelector('.c').textContent!==c0);

// double-click image likes
const withImg=[...D.querySelectorAll('.post')].find(c=>c.querySelector('.post-media'));
const imgLike=withImg.querySelector('[data-act="like"]');
// make sure it starts unliked so the double-click has something to do
if (imgLike.classList.contains('on')) { imgLike.click(); await new Promise(r=>setTimeout(r,30)); }
const before2=imgLike.querySelector('.c').textContent;
withImg.querySelector('.post-media').dispatchEvent(new window.MouseEvent('dblclick',{bubbles:true}));
await new Promise(r=>setTimeout(r,40));
ok('double-click image likes', imgLike.querySelector('.c').textContent!==before2);
ok('heart burst shown', !!withImg.querySelector('.heart-burst'));

// right-click menu
cards[0].dispatchEvent(new window.MouseEvent('contextmenu',{bubbles:true,clientX:50,clientY:50}));
await new Promise(r=>setTimeout(r,20));
const menu=D.querySelector('.menu');
ok('right-click opens menu', !!menu);
ok('menu has copy link', /Copy link|Copier le lien|نسخ/.test(menu.textContent));
// language-independent: the menu offers a destructive action
ok('menu has report or delete',
   !!menu.querySelector('.danger, [data-danger]') ||
   /Signaler|Supprimer|Report|Delete|إبلاغ|حذف/.test(menu.textContent));
UI.closeMenu();

// comments
const cmtBtn=cards[0].querySelector('[data-act="comment"]');
cmtBtn.click();
await new Promise(r=>setTimeout(r,40));
ok('comments modal opens', !!D.querySelector('.modal'));
ok('existing comments shown', D.querySelector('.cmt-list').children.length>=2);
const cin=D.querySelector('.modal .input');
cin.value='Super utile !';
D.querySelector('.modal .btn-primary').click();
await new Promise(r=>setTimeout(r,40));
ok('comment added', D.querySelector('.cmt-list').textContent.includes('Super utile'));
D.querySelector('.modal-close').click();
await new Promise(r=>setTimeout(r,250));

// composer
F.openComposer();
await new Promise(r=>setTimeout(r,60));
ok('composer opens', !!D.querySelector('.modal'));
ok('4 post kinds', D.querySelectorAll('.modal .pill').length>=4);
const ta=D.querySelector('.modal .textarea');
ok('publish disabled when empty', D.querySelector('.modal-foot .btn-primary').disabled===true);
ta.value='Bonjour le campus';
ta.dispatchEvent(new window.Event('input',{bubbles:true}));
await new Promise(r=>setTimeout(r,20));
ok('publish enables with text', D.querySelector('.modal-foot .btn-primary').disabled===false);
ok('counter updates', D.querySelector('.modal-foot .t-xs').textContent.startsWith('17'));
const nBefore=D.querySelectorAll('.post').length;
D.querySelector('.modal-foot .btn-primary').click();
await new Promise(r=>setTimeout(r,120));
ok('post published', D.querySelectorAll('.post').length===nBefore+1);
ok('new post at top', D.querySelector('.post').textContent.includes('Bonjour le campus'));

// tabs filter
const fac=[...D.querySelectorAll('.sub-tab')].find(b=>b.dataset.tab==='faculty');
fac.click();
await new Promise(r=>setTimeout(r,120));
ok('tab switches', fac.classList.contains('on'));

console.log(t.join('\n'));
const p=t.filter(x=>x.startsWith('PASS')).length;
console.log('\n'+p+'/'+t.length+' passed');
if(p<t.length) process.exit(1);
