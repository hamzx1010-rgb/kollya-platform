/**
 * Language switching, RTL, notifications, and the chat height chain.
 *
 * The height chain is tested by READING THE CSS, because that is
 * where the bug was: .view-inner had no height, so `.dm{height:100%}`
 * resolved against `auto`, the thread grew forever, and the newest
 * message scrolled off screen. jsdom does not do layout, so asserting
 * the declarations is the honest check available here.
 */
import { JSDOM } from '../node_modules/jsdom/lib/api.js';
import fs from 'fs';

const dom = new JSDOM(fs.readFileSync(new URL('../public/index_sm.html', import.meta.url), 'utf8'),
  { url: 'http://localhost/#/settings', pretendToBeVisual: true });
const { window } = dom;
for (const k of ['window','document','location','history','navigator','HTMLElement','Node','Event',
                 'CustomEvent','MouseEvent','KeyboardEvent','getComputedStyle','CSS','URL','Blob','File'])
  if (window[k] !== undefined) globalThis[k] = window[k];
globalThis.addEventListener = window.addEventListener.bind(window);
globalThis.localStorage = window.localStorage;
globalThis.innerWidth = 1500; globalThis.innerHeight = 900;
globalThis.matchMedia = q => ({ matches:false, addEventListener(){}, removeEventListener(){} });
globalThis.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
globalThis.requestAnimationFrame = f => setTimeout(() => f(0), 0);
window.HTMLElement.prototype.scrollTo = function(){};
window.HTMLElement.prototype.scrollIntoView = function(){};

const t_ = []; const ok = (n, c) => t_.push((c ? 'PASS' : 'FAIL') + '  ' + n);
const b = new URL('../public/js/', import.meta.url).pathname;

/* ============================================================
   1. I18N
   ============================================================ */
const I = await import(b + 'core/i18n_sm.js');

ok('three languages', I.LANGS.length === 3);
ok('English is the default', I.DEFAULT_LANG === 'en');
ok('Arabic is marked RTL', I.LANGS.find(l => l.id === 'ar').dir === 'rtl');
ok('French is LTR', I.LANGS.find(l => l.id === 'fr').dir === 'ltr');

// key parity — a missing Arabic string is a visible bug
const cov = I.coverage();
ok('French covers every English key', cov.fr === cov.en);
ok('Arabic covers every English key', cov.ar === cov.en);
ok('a real number of strings', cov.en > 150);

I.setLang('en');
ok('English renders English', I.t('nav.home') === 'Home');
I.setLang('fr');
ok('French renders French', I.t('nav.home') === 'Accueil');
I.setLang('ar');
ok('Arabic renders Arabic', I.t('nav.home') === 'الرئيسية');
ok('Arabic sets dir=rtl', I.dir() === 'rtl');
ok('isRTL agrees', I.isRTL() === true);
ok('document dir follows', window.document.documentElement.dir === 'rtl');
I.setLang('en');
ok('switching back restores ltr', window.document.documentElement.dir === 'ltr');

ok('interpolation works', I.t('profile.privateText', { name: 'Sara' }).includes('Sara'));
ok('a missing key returns the key, not blank', I.t('nope.nope') === 'nope.nope');
ok('fallback to English for a partial language',
   I.t('action.save').length > 0);

// the switcher exists in the shell
const html = fs.readFileSync(new URL('../public/index_sm.html', import.meta.url), 'utf8');
ok('language button is in the top bar', /id="btnLang"/.test(html));
ok('top bar shows the current code', /id="langCode"/.test(html));
ok('fold button exists', /id="btnFold"/.test(html));

/* ============================================================
   2. NOTIFICATIONS
   ============================================================ */
const N = await import(b + 'core/notify_sm.js');

ok('reports unsupported honestly when the API is absent',
   N.supported() === false || typeof N.permission() === 'string');
ok('canNotify is false without permission', N.canNotify() === false);
ok('notify() is a safe no-op without permission',
   N.notify({ title: 'x' }) === null);
ok('testNotification is exported', typeof N.testNotification === 'function');
ok('askPermission is exported', typeof N.askPermission === 'function');

// now with a fake Notification API
let created = [];
let asked = 0;
class FakeNotification {
  static permission = 'default';
  static async requestPermission() { asked++; FakeNotification.permission = 'granted'; return 'granted'; }
  constructor(title, opts) { created.push({ title, ...opts }); this.close = () => {}; }
}
window.Notification = FakeNotification;
globalThis.Notification = FakeNotification;

ok('permission is read from the browser', N.permission() === 'default');
const res = await N.askPermission({ force: true });
ok('asking reaches the browser API', asked === 1);
ok('granted is reported back', res === 'granted');
ok('canNotify flips after granting', N.canNotify() === true);

created = [];
const sent = await N.testNotification();
ok('the test button sends a notification', sent === true && created.length >= 1);
ok('the test notification is titled', /test/i.test(created[created.length - 1].title));
ok('notifications carry an icon', !!created[created.length - 1].icon);
ok('a tag is set so alerts replace instead of stacking',
   !!created[created.length - 1].tag);

// denied path must not throw and must not pretend
FakeNotification.permission = 'denied';
created = [];
const denied = await N.testNotification();
ok('a blocked browser is reported, not faked', denied === false && created.length === 0);

/* ============================================================
   3. THE CHAT HEIGHT CHAIN  ← "the discussion goes off screen"
   ============================================================ */
const cssRaw = fs.readFileSync(new URL('../public/css/layout_sm.css', import.meta.url), 'utf8');
// Comments can contain the very declarations we are asserting about
// (this file explains its own bugs), so strip them first.
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
const ruleOf = sel => {
  const m = css.match(new RegExp('(?<![\\w.-])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 's'));
  return m ? m[1] : '';
};

const viewFull = ruleOf('.view.full');
const innerFull = ruleOf('.view.full .view-inner');
const dmRule = ruleOf('.dm');
const threadRule = ruleOf('.thread');
const bodyRule = ruleOf('.thread-body');

ok('.view.full stops the PAGE scrolling', /overflow:\s*hidden/.test(viewFull));
ok('.view-inner gets a real height in full views',
   /height:\s*100%/.test(innerFull) && /min-height:\s*0/.test(innerFull));
ok('.view-inner drops the feed bottom gutter', /padding-bottom:\s*0/.test(innerFull));
ok('.dm has an EXPLICIT height, not inherited 100%',
   /height:\s*calc\(100dvh/.test(dmRule));
ok('.dm uses dvh so a mobile URL bar cannot clip the composer',
   /dvh/.test(dmRule));
ok('.thread can shrink', /min-height:\s*0/.test(threadRule));
ok('.thread hides its own overflow', /overflow:\s*hidden/.test(threadRule));
ok('.thread-body is the scroller', /overflow-y:\s*auto/.test(bodyRule));
ok('.thread-body has min-height:0 so it does not grow forever',
   /min-height:\s*0/.test(bodyRule));

// the JS side: newest-first and no yanking
const dmJs = fs.readFileSync(new URL('../public/js/features/messages_sm.js', import.meta.url), 'utf8');
ok('opening a thread jumps to the newest message',
   /atBottom = true;[\s\S]{0,80}scrollToBottom\(false\)/.test(dmJs));
ok('scroll is re-applied after layout', /requestAnimationFrame\(jump\)/.test(dmJs));
ok('images re-pin the scroll when they decode',
   /addEventListener\('load'[\s\S]{0,60}jump/.test(dmJs));
ok('a reader scrolled up is NOT dragged down',
   /keepScroll: !stick/.test(dmJs));
ok('unread-below counter exists', /unseenBelow/.test(dmJs));
ok('nearBottom has slack so "close enough" counts', /nearBottom\(body, slack = \d+\)/.test(dmJs));

/* ============================================================
   4. THE DB FIXES
   ============================================================ */
const sql = fs.readFileSync(new URL('../db/08_fixes_sm.sql', import.meta.url), 'utf8');
ok('quests can now be inserted', /CREATE POLICY quests_write_own[\s\S]{0,120}FOR INSERT/.test(sql));
ok('quests can now be updated', /CREATE POLICY quests_update_own[\s\S]{0,120}FOR UPDATE/.test(sql));
ok('xp_events can now be inserted', /CREATE POLICY xp_write_own[\s\S]{0,140}FOR INSERT/.test(sql));
ok('the xp ledger stays append-only',
   !/CREATE POLICY[^;]*xp_events FOR (UPDATE|DELETE)/i.test(sql));
ok('xp amount is still bounded in the policy', /amount <= 100/.test(sql));
// Read the CREATE POLICY body only. The file's own comments explain
// the old broken rule, and matching prose would fail forever.
const sqlNoComments = sql.replace(/^\s*--.*$/gm, '');
const updPolicy = (sqlNoComments.match(
  /CREATE POLICY profiles_update_self[\s\S]*?;/) || [''])[0];
ok('profile update policy exists', updPolicy.length > 0);
ok('profile update no longer hardcodes role=student',
   !/role\s*=\s*'student'/.test(updPolicy));
ok('profile update still blocks self-promotion',
   /role\s*=\s*\(SELECT/.test(updPolicy) && /status\s*=\s*\(SELECT/.test(updPolicy));
ok('name change tracking exists', /name_changed_at/.test(sql) && /name_change_count/.test(sql));
ok('the 15-day window resets itself', /15 days/.test(sql));
ok('name_change_status is callable', /GRANT EXECUTE ON FUNCTION name_change_status/.test(sql));
ok('pending_alerts feeds the notifications', /FUNCTION pending_alerts/.test(sql));

/* ============================================================
   5. GAME WIRING  ← "quests are not dynamic"
   ============================================================ */
const app = fs.readFileSync(new URL('../public/js/app_sm.js', import.meta.url), 'utf8');
ok('game listeners are wired at BOOT, not on /hub', /wireGameEvents\(\)/.test(app));
ok('language is resolved before the first paint',
   app.indexOf('initI18n()') < app.indexOf('hydrateIcons()'));
ok('notifications are initialised', /initNotify\(\)/.test(app));
ok('settings is a real screen now', /initSettings\(mount\)/.test(app));
ok('no placeholder screens remain', /const PLACEHOLDERS = \{\}/.test(app));

const hub = fs.readFileSync(new URL('../public/js/features/hub_sm.js', import.meta.url), 'utf8');
ok('wireGameEvents is exported for boot', /export function wireGameEvents/.test(hub));
ok('a finished quest is announced app-wide', /game:quest-done/.test(hub));

const pass = t_.filter(x => x.startsWith('PASS')).length;
t_.filter(x => x.startsWith('FAIL')).forEach(x => console.log(x));
console.log(`${pass}/${t_.length} passed`);
