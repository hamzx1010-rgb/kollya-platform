/** Core modules: utils, store, router, icons, ui, shell, service worker. */
import { JSDOM } from '../node_modules/jsdom/lib/api.js';
import fs from 'fs';

const dom=new JSDOM(fs.readFileSync(new URL('../public/index_sm.html',import.meta.url),'utf8'),
  {url:'http://localhost/#/feed',pretendToBeVisual:true});
const {window}=dom;
for(const k of ['window','document','location','history','navigator','HTMLElement','Node','Event',
                'CustomEvent','MouseEvent','KeyboardEvent','getComputedStyle','CSS','URL','Blob'])
  if(window[k]!==undefined) globalThis[k]=window[k];
globalThis.addEventListener=window.addEventListener.bind(window);
globalThis.localStorage=window.localStorage;   // module probes the global
globalThis.innerWidth=1400; globalThis.innerHeight=900;
globalThis.matchMedia=q=>({matches:/hover: hover|pointer: fine/.test(q),addEventListener(){},removeEventListener(){}});
globalThis.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
globalThis.requestAnimationFrame=f=>setTimeout(()=>f(0),0);
window.HTMLElement.prototype.scrollTo=function(){};
window.HTMLElement.prototype.scrollIntoView=function(){};

const t=[];const ok=(n,c)=>t.push((c?'PASS':'FAIL')+'  '+n);
const b=new URL('../public/js/',import.meta.url).pathname;

// ---------- utils ----------
const U=await import(b+'core/utils_sm.js');
ok('esc blocks script', U.esc('<script>')==='&lt;script&gt;');
ok('html tag escapes', U.html`<p>${'<b>'}</p>`==='<p>&lt;b&gt;</p>');
ok('raw opts out', U.html`${U.raw('<b>x</b>')}`==='<b>x</b>');
ok('richText escapes', !U.richText('<b>hi</b> #tag').includes('<b>hi'));
ok('richText makes tags', U.richText('hi #exam').includes('rt-tag'));
ok('safeUrl blocks js:', U.safeUrl('javascript:alert(1)')==='');
ok('assertNotBase64 throws', (()=>{try{U.assertNotBase64('data:image/png;base64,x','a');return false}catch{return true}})());
ok('cssEscape works', typeof U.cssEscape('a b')==='string');
ok('on() tolerates null', typeof U.on(null,'click',()=>{})==='function');
ok('compact 1500', U.compact(1500)==='1.5K');
ok('duration 95', U.duration(95)==='1:35');
ok('initials', U.initials('Sara Benali')==='SB');
ok('pairKey symmetric', U.pairKey('a','b')===U.pairKey('b','a'));

// ---------- icons ----------
const IC=await import(b+'core/icons_sm.js');
ok('70+ icons', Object.keys(IC.I).length>=70);
ok('all icons currentColor', Object.values(IC.I).every(v=>v.includes('currentColor')));
ok('all icons valid svg', Object.values(IC.I).every(v=>v.startsWith('<svg')&&v.endsWith('</svg>')));
ok('6 reactions', IC.REACTION_KEYS.length===6);
ok('reactions are keys not emoji', IC.REACTION_KEYS.every(k=>/^[a-z]+$/.test(k)));
ok('reaction svg renders', IC.reactionIcon('love').startsWith('<svg'));
ok('unknown icon safe', IC.icon('nope')==='');

// ---------- store ----------
const S=await import(b+'core/store_sm.js');
S.initStore();
S.write('k',{a:1}); ok('store write/read', S.read('k').a===1);
S.session.save({token:'t',userId:'u1',expiresAt:Date.now()+600000});
ok('session valid', S.session.valid===true);
ok('session persists to storage', !!window.localStorage.getItem('kl:session'));
S.session.clear(); ok('session clears', S.session.valid===false);
S.me.set({id:'u1',full_name:'Sara Benali',username:'sara.b',status:'approved',role:'student'});
ok('me.id', S.me.id==='u1');
ok('me.approved', S.me.approved===true);
S.setState({activeChat:'x'}); ok('setState', S.state.activeChat==='x');
let ro=true; try{S.state.activeChat='hack'; ro=S.state.activeChat!=='hack'}catch{}
ok('state read-only', ro);
S.frequency.bump('e','fire'); S.frequency.bump('e','fire'); S.frequency.bump('e','love');
ok('frequency ranks', S.frequency.top('e',1)[0]==='fire');
S.draft.set('c','hi'); ok('draft saved', S.draft.get('c')==='hi');
ok('theme defaults to system', ['system','light','dark'].includes(S.prefs.theme));

// ---------- router ----------
const R=await import(b+'core/router_sm.js');
ok('parse route', R.parseHash('#/messages/u1?t=1').name==='messages');
ok('parse arg', R.parseHash('#/messages/u1').arg==='u1');
ok('unknown falls back', R.parseHash('#/zzz').name==='feed');
ok('build roundtrip', R.parseHash(R.buildHash('profile','a')).arg==='a');
ok('shortcuts listed', R.SHORTCUTS.length>=8);

// ---------- ui + shell ----------
const UI=await import(b+'core/ui_sm.js');
const SH=await import(b+'core/shell_sm.js');
R.route('feed',()=>{}); R.route('messages',()=>{}); R.route('profile',()=>{});
R.initRouter({start:'feed'}); SH.initShell();
const D=window.document;
ok('rail expanded on feed', D.getElementById('app').dataset.rail==='expanded');
R.go('messages');
// The rail no longer collapses anywhere: the fold was removed after
// three competing mechanisms kept crushing the icons.
ok('rail stays expanded on messages', D.getElementById('app').dataset.rail==='expanded');
R.go('profile');
ok('rail expands again', D.getElementById('app').dataset.rail==='expanded');
R.go('messages');
ok('nav highlight follows', D.querySelector('[data-nav="messages"]').classList.contains('on'));
ok('other nav cleared', !D.querySelector('[data-nav="feed"]').classList.contains('on'));
R.go('profile');

const dismiss=UI.toast('x'); ok('toast shows', !!D.querySelector('.toast')); dismiss();
const m=UI.modal({title:'T',body:'b'});
ok('modal opens', !!D.querySelector('.modal'));
ok('body locked', D.body.style.overflow==='hidden');
m.close(); await new Promise(r=>setTimeout(r,260));
ok('modal closes', !D.querySelector('.modal'));
ok('body unlocked', D.body.style.overflow==='');

UI.contextMenu({clientX:1,clientY:1,preventDefault(){},stopPropagation(){}},[{label:'A',onClick(){}},{sep:true},{label:'B',danger:true}]);
ok('context menu opens', !!D.querySelector('.menu'));
ok('menu items', D.querySelectorAll('.menu-item').length===2);
UI.closeMenu();
ok('menu closes', !D.querySelector('.menu'));

// ---------- service worker ----------
const sw=fs.readFileSync(new URL('../public/sw_sm.js',import.meta.url),'utf8');
ok('sw GET-only', /request\.method\s*!==\s*'GET'/.test(sw));
ok('sw never caches private', /if \(isPrivate\(url\)\) return;/.test(sw));
ok('sw blocks rest/auth/api', /\\\/\(rest\|auth\|api\)\\\//.test(sw));
ok('sw caps media cache', /MEDIA_MAX/.test(sw));
ok('sw has PURGE', /'PURGE'/.test(sw));

// ---------- manifest ----------
const man=JSON.parse(fs.readFileSync(new URL('../public/manifest_sm.json',import.meta.url),'utf8'));
ok('manifest has 192+512', man.icons.some(i=>i.sizes==='192x192')&&man.icons.some(i=>i.sizes==='512x512'));
ok('manifest maskable', man.icons.some(i=>(i.purpose||'').includes('maskable')));
ok('manifest shortcuts', man.shortcuts.length===3);

console.log(t.join('\n'));
const p=t.filter(x=>x.startsWith('PASS')).length;
console.log('\n'+p+'/'+t.length+' passed');
if(p<t.length) process.exit(1);
