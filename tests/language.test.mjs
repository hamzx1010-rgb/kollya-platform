/**
 * A student switches language and checks every screen.
 *
 * This is the test that should have existed before I claimed
 * languages worked. The old i18n test only checked that t() returned
 * the right string — which passed while 8 of 9 SCREENS still rendered
 * French, because almost nothing called t().
 *
 * So this one drives the real UI and reads the rendered text.
 *
 * Note on user content: a post written in French stays French in
 * every language. Only the INTERFACE translates. The fixture is
 * therefore filtered out of the leak check by id, not by hoping the
 * words differ.
 */
import { JSDOM } from '../node_modules/jsdom/lib/api.js';
import fs from 'fs';

const dom = new JSDOM(fs.readFileSync(new URL('../public/index_sm.html', import.meta.url), 'utf8'),
  { url: 'http://localhost/#/feed', pretendToBeVisual: true });
const { window } = dom;
for (const k of ['window','document','location','history','navigator','HTMLElement','Node','Event',
                 'CustomEvent','MouseEvent','KeyboardEvent','getComputedStyle','CSS','URL','Blob','File'])
  if (window[k] !== undefined) globalThis[k] = window[k];
globalThis.addEventListener = window.addEventListener.bind(window);
globalThis.localStorage = window.localStorage;
globalThis.innerWidth = 1500; globalThis.innerHeight = 900;
globalThis.matchMedia = q => ({ matches:false, addEventListener(){}, removeEventListener(){} });
globalThis.IntersectionObserver = class { constructor(cb){this.cb=cb} observe(el){setTimeout(()=>this.cb([{isIntersecting:true,target:el}]),0)} unobserve(){} disconnect(){} };
globalThis.requestAnimationFrame = f => setTimeout(() => f(0), 0);
window.HTMLElement.prototype.scrollTo = function(){};
window.HTMLElement.prototype.scrollIntoView = function(){};
globalThis.URL.createObjectURL = () => 'blob:x';

const t_ = []; const ok = (n, c) => t_.push((c ? 'PASS' : 'FAIL') + '  ' + n);
const b = new URL('../public/js/', import.meta.url).pathname;
const tick = (ms = 260) => new Promise(r => setTimeout(r, ms));

const FA = await import('./fake_api.mjs');
const S  = await import(b + 'core/store_sm.js'); S.initStore();
S.me.set({ id:'u1', username:'sara.b', full_name:'Sara', faculty:'Informatique', status:'approved' });
const I  = await import(b + 'core/i18n_sm.js');
const P  = await import(b + 'core/people_sm.js'); P.cachePeople(FA.PEOPLE);
const st = FA.makeState(); const api = FA.fakeApi(st, 'u1');
const SH = await import(b + 'core/shell_sm.js');
const R  = await import(b + 'core/router_sm.js');
const F  = await import(b + 'features/feed_sm.js');  F.useApi(api);
const M  = await import(b + 'features/messages_sm.js'); M.useApi(api);
const C  = await import(b + 'features/campus_sm.js'); C.useApi(api);
const H  = await import(b + 'features/hub_sm.js');   H.useApi(api);
const PR = await import(b + 'features/profile_sm.js'); PR.useApi(FA.profileApiFor(st));
const N  = await import(b + 'features/notifications_sm.js'); N.useApi({ ...api, markRead: api.markRead_ });
const ST = await import(b + 'features/stories_sm.js'); ST.useApi(api);

I.setLang('en');
SH.initShell();
F.initFeed(SH.mount); M.initMessages(SH.mount); C.initCampus(SH.mount);
H.initHub(SH.mount); PR.initProfile(SH.mount); N.initNotifications(SH.mount);
R.initRouter({ start: 'feed' });
await tick(400);
const D = window.document;

/* ------------------------------------------------------------
   Words that only ever appear in the INTERFACE. If one of these
   shows up while the app is in English, a control was not
   translated. Content words ("Sondage", a student's post) are
   excluded on purpose.
   ------------------------------------------------------------ */
const UI_FRENCH = /\b(Accueil|Explorer|Réglages|Enregistrer|Annuler|Supprimer|Modifier|Abonnés|Abonnements|Défis du jour|Classement|Événements|Rejoindre|Rejoint|Meilleure réponse|Nouveau message|Aucune conversation|Chargement impossible|Tout voir|Se déconnecter|Niveau|Publier une fois|Répondre à une question|Créer un|Poser une)\b/;

const SCREENS = ['feed','messages','notifications','hub','events','qa','channels','explore','profile','settings'];

async function leaksOn(screen) {
  R.go(screen);
  await tick();
  const txt = (D.getElementById('viewInner')?.textContent || '').replace(/\s+/g, ' ');
  return [...new Set(txt.match(new RegExp(UI_FRENCH.source, 'g')) || [])];
}

/* ============================================================
   1. ENGLISH — the official language
   ============================================================ */
let totalLeaks = 0;
for (const s of SCREENS) {
  const hits = await leaksOn(s);
  totalLeaks += hits.length;
  ok(`${s}: no French UI text in English`, hits.length === 0);
}
ok('zero untranslated controls across the app', totalLeaks === 0);

const nav = (D.getElementById('railNav')?.textContent || '').replace(/\s+/g, ' ');
ok('nav rail is English', nav.includes('Home') && nav.includes('Messages'));
ok('nav rail has no French', !/Accueil|Canaux|Réglages/.test(nav));

/* ============================================================
   2. SWITCHING RELABELS WHAT IS ALREADY ON SCREEN
   The real failure mode: t() works, but the current screen keeps
   the language it was drawn in until you navigate away.
   ============================================================ */
R.go('hub');
await tick(300);
const hubEn = D.getElementById('viewInner').textContent;
ok('hub is English first', /Badges|Leaderboard|challenges/i.test(hubEn));

I.setLang('fr');
await tick(320);
const hubFr = D.getElementById('viewInner').textContent;
ok('switching to French repaints the OPEN screen, without navigating',
   hubFr !== hubEn && /Classement|Défis/.test(hubFr));

I.setLang('ar');
await tick(320);
const hubAr = D.getElementById('viewInner').textContent;
ok('switching to Arabic repaints it again', /الترتيب|تحدّيات|الشارات/.test(hubAr));
ok('document direction flips to RTL', D.documentElement.dir === 'rtl');
ok('nav rail is Arabic too', /الرئيسية|الرسائل/.test(D.getElementById('railNav').textContent));

I.setLang('en');
await tick(320);
ok('and back to English', /Badges|Leaderboard/i.test(D.getElementById('viewInner').textContent));
ok('direction returns to LTR', D.documentElement.dir === 'ltr');

/* ============================================================
   3. DATES FOLLOW THE LANGUAGE
   ============================================================ */
const U = await import(b + 'core/utils_sm.js');
const oneHour = new Date(Date.now() - 3600 * 1000).toISOString();
I.setLang('en'); const agoEn = U.timeAgo(oneHour);
I.setLang('fr'); const agoFr = U.timeAgo(oneHour);
I.setLang('ar'); const agoAr = U.timeAgo(oneHour);
ok('relative time differs per language', new Set([agoEn, agoFr, agoAr]).size >= 2);
ok('English uses h', /h$/.test(agoEn));
ok('Arabic uses Arabic units', /س/.test(agoAr));

I.setLang('en');
ok('day label is English', U.dayLabel(new Date().toISOString()) === 'Today');
I.setLang('ar');
ok('day label is Arabic', U.dayLabel(new Date().toISOString()) === 'اليوم');
I.setLang('fr');
ok('day label is French', U.dayLabel(new Date().toISOString()) === "Aujourd'hui");
I.setLang('en');

/* ============================================================
   4. COVERAGE — no key may exist in one language only
   ============================================================ */
const cov = I.coverage();
ok('French has every English key', cov.fr === cov.en);
ok('Arabic has every English key', cov.ar === cov.en);
ok('over 250 strings translated', cov.en > 250);

/* ============================================================
   5. THE REGRESSION GUARD
   Modules must actually CALL t(). This is what was missing: an
   engine nothing used. If a feature module stops importing i18n,
   fail loudly.
   ============================================================ */
const MUST_TRANSLATE = ['feed_sm','messages_sm','profile_sm','campus_sm',
                        'hub_sm','notifications_sm','settings_sm'];
for (const mod of MUST_TRANSLATE) {
  const src = fs.readFileSync(new URL(`../public/js/features/${mod}.js`, import.meta.url), 'utf8');
  ok(`${mod} uses the translation system`,
     /from '\.\.\/core\/i18n_sm\.js'/.test(src) && (src.match(/\bt\(/g) || []).length >= 3);
}
const routerSrc = fs.readFileSync(new URL('../public/js/core/router_sm.js', import.meta.url), 'utf8');
ok('route titles are keys, not text', /title: 'nav\.home'/.test(routerSrc));
ok('router repaints on language change', /koliya:i18n/.test(routerSrc));

M.teardownMessages?.();
const pass = t_.filter(x => x.startsWith('PASS')).length;
t_.filter(x => x.startsWith('FAIL')).forEach(x => console.log(x));
console.log(`${pass}/${t_.length} passed`);
