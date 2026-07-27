/** Config, auth client and Data API client — against the real Neon URLs. */
import { JSDOM } from '../node_modules/jsdom/lib/api.js';

const dom=new JSDOM('<!doctype html><body>',{url:'http://localhost/'});
const {window}=dom;
for(const k of ['window','document','location','navigator','HTMLElement','Node','Event','URL','Blob'])
  if(window[k]!==undefined) globalThis[k]=window[k];
globalThis.addEventListener=()=>{};
globalThis.localStorage=window.localStorage;
globalThis.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});

const t=[];const ok=(n,c)=>t.push((c?'PASS':'FAIL')+'  '+n);
const b=new URL('../public/js/',import.meta.url).pathname;

// ---------- config ----------
const C=await import(b+'core/config_sm.js');
ok('data api set', C.CONFIG.DATA_API_URL.startsWith('https://ep-lively-bread'));
ok('auth url set', C.CONFIG.AUTH_URL.startsWith('https://ep-lively-bread'));
ok('data api ends /rest/v1', C.CONFIG.DATA_API_URL.endsWith('/rest/v1'));
ok('auth url ends /auth', C.CONFIG.AUTH_URL.endsWith('/auth'));
ok('database usable', C.canUseDatabase()===true);
ok('media not yet usable', C.canUseMedia()===false);
ok('jwks path is .well-known', C.jwksUrl().endsWith('/.well-known/jwks.json'));
ok('no secrets in config', !JSON.stringify(C.CONFIG).match(/secret|password|private/i));

// ---------- live endpoints ----------
const jwks=await fetch(C.jwksUrl()).then(r=>r.json()).catch(()=>null);
ok('JWKS reachable', !!jwks?.keys?.length);
ok('JWKS is EdDSA', jwks?.keys?.[0]?.alg==='EdDSA');
ok('JWKS has kid', !!jwks?.keys?.[0]?.kid);

const health=await fetch(C.CONFIG.AUTH_URL+'/ok').then(r=>r.json()).catch(()=>null);
ok('auth service healthy', health?.ok===true);

const anon=await fetch(C.CONFIG.DATA_API_URL+'/profiles?select=id&limit=1');
ok('data api rejects anonymous', anon.status===400||anon.status===401);
const anonBody=await anon.json().catch(()=>({}));
ok('rejection mentions token', /token|authorization|credential/i.test(JSON.stringify(anonBody)));

// ---------- auth module ----------
const A=await import(b+'core/auth_sm.js');
ok('exports signUp/signIn/signOut', ['signUp','signIn','signOut'].every(f=>typeof A[f]==='function'));
ok('exports card helpers', ['normalizeCard','cardToEmail','isValidCard'].every(f=>typeof A[f]==='function'));
ok('login uses card not email', A.cardToEmail('CS-042').endsWith('@carte.koliya.dz'));
ok('exports getToken', typeof A.getToken==='function');
ok('exports initAuth', typeof A.initAuth==='function');
ok('AuthError is an Error', new A.AuthError('x','y') instanceof Error);

const sess=await A.getSession();
ok('getSession returns null when logged out', sess===null);
ok('isAuthenticated false when logged out', (await A.isAuthenticated())===false);
ok('getToken null when logged out', (await A.getToken())===null);

let threw=null;
try { await A.signIn({studentCard:'',password:''}); } catch(e){ threw=e; }
ok('signIn validates input', threw?.code==='VALIDATION_ERROR');
threw=null;
try { await A.signUp({studentCard:'CS-042',username:'sara',name:'Sara B',email:'a@b.co',password:'short'}); } catch(e){ threw=e; }
ok('signUp enforces password length', threw?.code==='PASSWORD_TOO_SHORT');

// wrong credentials must give a readable message, not a raw code
threw=null;
try { await A.signIn({studentCard:'ZZ-999',password:'wrongpassword123'}); } catch(e){ threw=e; }
ok('bad login rejected', !!threw);
ok('bad login message is human', /incorrect|invalide|erreur|désactiv|autoris|domaine/i.test(threw?.message||''));
ok('error code preserved', typeof threw?.code==='string' && threw.code.length>0);

// ---------- db module ----------
const D=await import(b+'core/db_sm.js');
ok('db exposes crud', ['select','insert','update','remove','one','count','rpc'].every(f=>typeof D.db[f]==='function'));
ok('queries helpers exist', ['thread','conversations','feed','activeStories'].every(f=>typeof D.queries[f]==='function'));
ok('DbError carries status', new D.DbError('m',403).status===403);

let e2=null;
try { await D.db.select('profiles'); } catch(err){ e2=err; }
ok('select fails cleanly when logged out', e2?.status===401);

e2=null;
try { await D.db.remove('posts'); } catch(err){ e2=err; }
ok('delete without filter refused', /sans filtre/.test(e2?.message||''));

// MEDIA RULE — changed deliberately.
// Images now live in Postgres as data: URLs (db/05_upgrade_sm.sql),
// so base64 is expected. What must still be refused is anything that
// would blow up the row, and anything that cannot survive a refresh.
e2=null;
try { await D.db.insert('posts',{image_url:'data:image/png;base64,AAAA'}); } catch(err){ e2=err; }
ok('small data: image is accepted', !/Média trop lourd|invalide/.test(e2?.message||''));

e2=null;
const huge='data:image/png;base64,'+'A'.repeat(5_000_000);
try { await D.db.insert('posts',{image_url:huge}); } catch(err){ e2=err; }
ok('oversized media blocked before network', /trop lourd/.test(e2?.message||''));
ok('oversize error names the field and size', /image_url/.test(e2?.message||'') && /Ko/.test(e2?.message||''));

e2=null;
const bigAvatar='data:image/jpeg;base64,'+'A'.repeat(600_000);
try { await D.db.update('profiles',{avatar_url:bigAvatar},{id:'eq.1'}); } catch(err){ e2=err; }
ok('avatar has a tighter budget than a post', /trop lourd/.test(e2?.message||''));

// a blob: URL is the bug that made avatars vanish on refresh
e2=null;
try { await D.db.update('profiles',{avatar_url:'blob:http://x/abc'},{id:'eq.1'}); } catch(err){ e2=err; }
ok('blob: URL refused — it dies on refresh', /blob:|rafra/.test(e2?.message||''));

e2=null;
try { await D.db.insert('posts',{image_url:'javascript:alert(1)'}); } catch(err){ e2=err; }
ok('non-media URL refused', /invalide/.test(e2?.message||''));

console.log(t.join('\n'));
const p=t.filter(x=>x.startsWith('PASS')).length;
console.log('\n'+p+'/'+t.length+' passed');
if(p<t.length) process.exit(1);
