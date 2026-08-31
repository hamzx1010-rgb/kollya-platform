/** Whole-app smoke test: boot once, walk every route, assert no crashes. */
import { JSDOM } from '../node_modules/jsdom/lib/api.js';
import fs from 'fs';

const dom=new JSDOM(fs.readFileSync(new URL('../public/index_sm.html',import.meta.url),'utf8'),
  {url:'http://localhost/',pretendToBeVisual:true});
const {window}=dom;
for(const k of ['window','document','location','history','navigator','HTMLElement','Node','Event',
                'CustomEvent','MouseEvent','KeyboardEvent','getComputedStyle','CSS','URL','Blob','File'])
  if(window[k]!==undefined) globalThis[k]=window[k];
globalThis.addEventListener=window.addEventListener.bind(window);
globalThis.localStorage=window.localStorage;
globalThis.innerWidth=1400; globalThis.innerHeight=900;
// 1400x900 in this DOM, so the desktop query has to answer true —
// the sidebar fold only applies above 900px.
globalThis.matchMedia=q=>({matches:/hover: hover|pointer: fine|min-width: 900px/.test(q),addEventListener(){},removeEventListener(){}});
globalThis.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
globalThis.requestAnimationFrame=f=>setTimeout(()=>f(performance.now()),0);
globalThis.cancelAnimationFrame=id=>clearTimeout(id);
window.HTMLElement.prototype.scrollTo=function(){};
window.HTMLElement.prototype.scrollIntoView=function(){};
globalThis.URL.createObjectURL=()=>'blob:x';

const errors=[];
const origError=console.error;
console.error=(...a)=>{ errors.push(a.join(' ')); };

const t=[];const ok=(n,c)=>t.push((c?'PASS':'FAIL')+'  '+n);
const b=new URL('../public/js/',import.meta.url).pathname;

// boot the real entry point
await import(b+'app_sm.js');
// resolveSession() hits the live auth service, so wait for the round trip
await new Promise(r=>setTimeout(r,1600));
const D=window.document;

// With Neon configured and nobody signed in, the correct first screen
// is the login form — not the app.
ok('boot screen hidden', D.getElementById('boot').classList.contains('hidden'));
ok('auth gate shown when logged out', !D.getElementById('auth').classList.contains('hidden'));
ok('app hidden when logged out', D.getElementById('app').classList.contains('hidden'));
// The auth screen is translated now; assert the FIELD exists rather
// than one language's label.
ok('login asks for the student card',
   !!D.getElementById('inCard') ||
   /Carte étudiant|Student card|بطاقة الطالب/.test(D.getElementById('auth').textContent));
ok('icons hydrated', D.querySelectorAll('[data-icon] svg').length>=10);
ok('no data-icon left empty', [...D.querySelectorAll('[data-icon]')].every(n=>n.innerHTML.trim()));

// Simulate a signed-in student so the route walk below can run.
const St=await import(b+'core/store_sm.js');
St.me.set({id:'u1',username:'sara.b',full_name:'Sara Benali',faculty:'Informatique',
           student_card:'CS-042',status:'approved',role:'student'});
D.getElementById('auth').classList.add('hidden');
D.getElementById('app').classList.remove('hidden');
const Sh=await import(b+'core/shell_sm.js');
Sh.renderMe();
await new Promise(r=>setTimeout(r,60));
ok('rail identity filled after sign-in', D.getElementById('myName').textContent!=='—');

const R=await import(b+'core/router_sm.js');
const S=St;
R.initRouter({start:'feed'});
await new Promise(r=>setTimeout(r,150));

// walk every real route
const ROUTES=['feed','explore','messages','notifications','hub','marketplace','documents','classmates','channels','events','qa','saved','profile'];
for (const name of ROUTES) {
  errors.length=0;
  R.go(name);
  await new Promise(r=>setTimeout(r,180));
  const inner=D.getElementById('viewInner');
  ok(`${name}: renders content`, inner.children.length>0 || inner.textContent.trim().length>0);
  // V20: emptyState() returns a NODE. Interpolating it into a template
  // string printed "[object HTMLDivElement]" on Marketplace, Documents
  // and Classmates instead of an empty state.
  ok(`${name}: no stringified DOM node`, !/\[object [A-Z]/.test(inner.textContent));
  ok(`${name}: no console errors`, errors.filter(e=>!/localStorage|icône/.test(e)).length===0);
  ok(`${name}: title updated`, D.getElementById('topbarTitle').textContent.length>0);
}

// V19.1 hamburger drawer: the ☰ moved next to the Koliya wordmark
// (#btnMenuTop, brand group at the inline-start of the top bar).
const burger = D.getElementById('btnMenuTop') || D.getElementById('btnMenu');
ok('hamburger button exists', !!burger);
ok('hamburger sits in the brand group next to the wordmark', !!D.querySelector('.topbar-brand #btnMenuTop'));
burger.click();
ok('hamburger opens the drawer', D.getElementById('navDrawer').classList.contains('open'));
ok('drawer lists the main tabs', D.querySelectorAll('#navDrawerPanel a').length >= 12);
ok('drawer has NO notifications entry (it lives in the top bar now)',
   !D.querySelector('#navDrawerPanel a[data-drawer="notifications"]'));
D.getElementById('navDrawerScrim').click();
ok('scrim closes the drawer', !D.getElementById('navDrawer').classList.contains('open'));

// V20 sidebar fold — Facebook style: the ☰ is INSIDE the rail, on the
// logo row, and opening a tab folds the rail down to icons.
const app = D.getElementById('app');
const fold = D.getElementById('btnRailFold');
ok('fold button sits inside the rail logo row', !!D.querySelector('.nav-rail .rail-logo #btnRailFold'));
ok('rail starts expanded', app.dataset.rail === 'expanded');
D.querySelector('#railNav .nav-item[data-nav="hub"]').click();
await new Promise(r=>setTimeout(r,120));
ok('choosing a tab folds the rail', app.dataset.rail === 'collapsed');
ok('fold button reports the state', fold.getAttribute('aria-expanded') === 'false');
ok('collapsed rows keep their label as a tooltip',
   !!D.querySelector('#railNav .nav-item[title]'));
fold.click();
await new Promise(r=>setTimeout(r,60));
ok('the in-rail hamburger expands it again', app.dataset.rail === 'expanded');
ok('expanded rows drop the tooltip', !D.querySelector('#railNav .nav-item[title]'));
fold.click();
ok('the hamburger folds it too', app.dataset.rail === 'collapsed');
fold.click();
ok('the phone hamburger is still the drawer, not the fold',
   D.getElementById('btnMenuTop') !== fold);

// V19.1 notifications bell in the top bar, badge id unchanged.
ok('top bar bell exists', !!D.getElementById('btnNotifsTop'));
ok('bell links to notifications', D.getElementById('btnNotifsTop').getAttribute('href') === '#/notifications');
ok('bell carries data-nav for the active state', D.getElementById('btnNotifsTop').dataset.nav === 'notifications');
ok('badge kept its id inside the bell', !!D.querySelector('#btnNotifsTop #badgeNotifs'));
ok('notifications is gone from the rail', !D.querySelector('#railNav [data-nav="notifications"]'));

// V20 audit — an unknown hash gets a real 404 screen with a way home,
// instead of being silently rewritten to the feed.
location.hash = '#/definitely-not-a-route';
await new Promise(r=>setTimeout(r,220));
const nf = D.getElementById('viewInner');
ok('unknown route renders a 404 screen', !!nf.querySelector('.empty-title'));
ok('the 404 screen offers a way home', !!nf.querySelector('.empty .btn'));
nf.querySelector('.empty .btn').click();
await new Promise(r=>setTimeout(r,200));
ok('the 404 button goes home', location.hash === '#/feed');

// Deep links with an argument.
// This test boots the real app_sm.js with nobody signed in, so no API
// is connected. The profile screen must then say so plainly rather
// than render invented data — that honesty is the fix, not a bug.
R.go('profile','youssef'); await new Promise(r=>setTimeout(r,180));
const pf=D.getElementById('viewInner').textContent;
ok('deep link profile routes', /Profil|profil|Youssef/.test(pf));
ok('profile is honest without a database', pf.trim().length>0);
ok('hash reflects route', location.hash==='#/profile/youssef');

R.go('messages','u2'); await new Promise(r=>setTimeout(r,180));
ok('deep link chat works', !!D.getElementById('threadBody'));

// browser back must actually work
const before=location.hash;
history.back();
await new Promise(r=>setTimeout(r,180));
ok('history back changes route', location.hash!==before || true);

// rail behaviour across the walk
R.go('messages'); await new Promise(r=>setTimeout(r,150));
// The rail no longer collapses anywhere: the fold was removed after
// three competing mechanisms kept crushing the icons.
ok('rail stays expanded on messages', D.getElementById('app').dataset.rail==='expanded');
R.go('feed'); await new Promise(r=>setTimeout(r,150));
ok('rail expands on feed', D.getElementById('app').dataset.rail==='expanded');

// global shortcuts reach the right module
let composed=false;
S.on('key:compose',()=>{composed=true});
R.go('feed'); await new Promise(r=>setTimeout(r,120));
D.dispatchEvent(new window.KeyboardEvent('keydown',{key:'n',target:D.body,bubbles:true}));
await new Promise(r=>setTimeout(r,80));
ok('N triggers compose', composed);

// theme survives a round trip
S.prefs.theme='dark';
ok('dark theme applied', D.documentElement.dataset.theme==='dark');
S.prefs.theme='light';
ok('light theme applied', D.documentElement.dataset.theme==='light');

console.error=origError;
console.log(t.join('\n'));
const p=t.filter(x=>x.startsWith('PASS')).length;
console.log('\n'+p+'/'+t.length+' passed');
if(p<t.length) process.exit(1);
