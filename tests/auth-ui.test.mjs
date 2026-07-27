/** Carte étudiant login/signup: identifier mapping, validation, UI. */
import { JSDOM } from '../node_modules/jsdom/lib/api.js';
import fs from 'fs';

const dom=new JSDOM(fs.readFileSync(new URL('../public/index_sm.html',import.meta.url),'utf8'),
  {url:'http://localhost:8099/',pretendToBeVisual:true});
const {window}=dom;
for(const k of ['window','document','location','history','navigator','HTMLElement','Node','Event',
                'CustomEvent','MouseEvent','KeyboardEvent','SubmitEvent','getComputedStyle','CSS','URL','Blob'])
  if(window[k]!==undefined) globalThis[k]=window[k];
globalThis.addEventListener=window.addEventListener.bind(window);
globalThis.localStorage=window.localStorage;
globalThis.innerWidth=1400;
globalThis.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
globalThis.requestAnimationFrame=f=>setTimeout(()=>f(performance.now()),0);

const t=[];const ok=(n,c)=>t.push((c?'PASS':'FAIL')+'  '+n);
const b=new URL('../public/js/',import.meta.url).pathname;
const A=await import(b+'core/auth_sm.js');
const UI=await import(b+'features/auth_ui_sm.js');
const S=await import(b+'core/store_sm.js');
S.initStore();

// ---------- card normalisation: students type these by hand ----------
ok('uppercases', A.normalizeCard('cs-042')==='CS-042');
ok('strips spaces', A.normalizeCard('CS 042')==='CS042');
ok('trims', A.normalizeCard('  CS-042  ')==='CS-042');
ok('unicode dash to ascii', A.normalizeCard('CS\u2013042')==='CS-042');
ok('drops punctuation', A.normalizeCard('CS/042!')==='CS042');
ok('handles empty', A.normalizeCard('')==='');
ok('handles null', A.normalizeCard(null)==='');

// ---------- mapping must be pure and stable ----------
ok('card maps to email', A.cardToEmail('CS-042')==='cs-042@carte.koliya.dz');
ok('mapping is case-insensitive', A.cardToEmail('cs-042')===A.cardToEmail('CS-042'));
ok('mapping ignores spacing', A.cardToEmail('CS 042')===A.cardToEmail('cs042'));
ok('different cards differ', A.cardToEmail('CS-042')!==A.cardToEmail('CS-043'));
ok('mapping is deterministic', A.cardToEmail('BIO-7')===A.cardToEmail('BIO-7'));

// ---------- card validity ----------
ok('accepts CS-042', A.isValidCard('CS-042'));
ok('accepts MATH903', A.isValidCard('MATH903'));
ok('rejects empty', !A.isValidCard(''));
ok('rejects too short', !A.isValidCard('A1'));
ok('rejects letters only', !A.isValidCard('ABCDEF'));
ok('rejects over-long', !A.isValidCard('X1'.repeat(20)));
ok('email validator works', A.isValidEmail('sara@gmail.com') && !A.isValidEmail('nope'));

// ---------- signIn / signUp validate before any network call ----------
let e=null;
try { await A.signIn({studentCard:'',password:'x'}); } catch(err){ e=err; }
ok('signIn needs a card', e?.code==='VALIDATION_ERROR');
e=null;
try { await A.signIn({studentCard:'CS-042',password:''}); } catch(err){ e=err; }
ok('signIn needs a password', e?.code==='VALIDATION_ERROR');
e=null;
try { await A.signUp({studentCard:'X',username:'sara',name:'Sara',email:'s@g.com',password:'12345678'}); } catch(err){ e=err; }
ok('signUp rejects bad card', e?.code==='INVALID_CARD');
e=null;
try { await A.signUp({studentCard:'CS-042',username:'ab',name:'Sara',email:'s@g.com',password:'12345678'}); } catch(err){ e=err; }
ok('signUp rejects short username', e?.code==='INVALID_USERNAME');
e=null;
try { await A.signUp({studentCard:'CS-042',username:'sara b',name:'Sara',email:'s@g.com',password:'12345678'}); } catch(err){ e=err; }
ok('signUp rejects spaces in username', e?.code==='INVALID_USERNAME');
e=null;
try { await A.signUp({studentCard:'CS-042',username:'sara',name:'S',email:'s@g.com',password:'12345678'}); } catch(err){ e=err; }
ok('signUp needs a full name', e?.code==='INVALID_NAME');
e=null;
try { await A.signUp({studentCard:'CS-042',username:'sara',name:'Sara B',email:'bad',password:'12345678'}); } catch(err){ e=err; }
ok('signUp validates email', e?.code==='INVALID_EMAIL');
e=null;
try { await A.signUp({studentCard:'CS-042',username:'sara',name:'Sara B',email:'s@g.com',password:'short'}); } catch(err){ e=err; }
ok('signUp enforces 8 chars', e?.code==='PASSWORD_TOO_SHORT');

// ---------- sign-in screen ----------
const D=window.document;
UI.setAuthMode('signin');
UI.renderAuth(()=>{});
ok('auth screen renders', !!D.querySelector('.auth-card'));
ok('card field first', !!D.getElementById('inCard'));
ok('password field', !!D.getElementById('inPass'));
ok('no email on sign-in', !D.getElementById('inMail'));
ok('card labelled carte étudiant', D.querySelector('label[for="inCard"]').textContent.includes('Carte'));
ok('forgot link', !!D.getElementById('forgotBtn'));
ok('switch to signup', !!D.getElementById('toSignup'));
ok('password toggle', !!D.querySelector('[data-eye="inPass"]'));

// blur validation, not keystroke noise
const card=D.getElementById('inCard');
card.value='ab';
card.dispatchEvent(new window.Event('blur',{bubbles:true}));
await new Promise(r=>setTimeout(r,20));
ok('invalid card flagged on blur', D.getElementById('inCard-msg').textContent.includes('invalide'));
card.value='cs 042';
card.dispatchEvent(new window.Event('blur',{bubbles:true}));
await new Promise(r=>setTimeout(r,20));
ok('card normalised on blur', card.value==='CS042');
ok('valid card clears error', !D.getElementById('inCard').classList.contains('invalid'));

// eye toggle
const pass=D.getElementById('inPass');
D.querySelector('[data-eye="inPass"]').click();
ok('eye reveals password', pass.type==='text');
D.querySelector('[data-eye="inPass"]').click();
ok('eye hides again', pass.type==='password');

// empty submit focuses the first problem, never calls the network
D.getElementById('inCard').value='';
D.getElementById('inPass').value='';
D.getElementById('authForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
await new Promise(r=>setTimeout(r,60));
ok('empty submit blocked', D.getElementById('inCard-msg').textContent.length>0);
ok('submit button re-enabled', D.getElementById('submitBtn').disabled===false);

// ---------- sign-up screen ----------
D.getElementById('toSignup').click();
await new Promise(r=>setTimeout(r,40));
ok('signup renders', !!D.getElementById('inMail'));
ok('signup has 5 required fields', ['inCard','inName','inUser','inMail','inPass'].every(i=>!!D.getElementById(i)));
ok('faculty select present', !!D.getElementById('inFac'));
ok('faculty has options', D.getElementById('inFac').options.length>10);
ok('password meter present', !!D.getElementById('pwMeter'));
ok('mentions admin approval', D.querySelector('.auth-card').textContent.includes('administrateur'));
ok('email marked as contact only', D.getElementById('inMail-msg').textContent.includes('pas pour la connexion'));

// strength meter reacts
const p2=D.getElementById('inPass');
p2.value='abcdefgh'; p2.dispatchEvent(new window.Event('input',{bubbles:true}));
await new Promise(r=>setTimeout(r,20));
const weak=D.querySelectorAll('#pwMeter i.on').length;
p2.value='Abcdefgh123!@#'; p2.dispatchEvent(new window.Event('input',{bubbles:true}));
await new Promise(r=>setTimeout(r,20));
ok('strength meter rises', D.querySelectorAll('#pwMeter i.on').length>weak);

D.getElementById('toSignin').click();
await new Promise(r=>setTimeout(r,40));
ok('switch back to signin', !D.getElementById('inMail'));

// ---------- pending screen ----------
let out=false;
UI.renderPending(()=>{out=true});
ok('pending screen renders', D.querySelector('#auth').textContent.includes('attente'));
ok('pending explains why', D.querySelector('#auth').textContent.includes('carte étudiant'));
D.getElementById('pendingOut').click();
ok('pending can sign out', out);

console.log(t.join('\n'));
const p=t.filter(x=>x.startsWith('PASS')).length;
console.log('\n'+p+'/'+t.length+' passed');
if(p<t.length) process.exit(1);
