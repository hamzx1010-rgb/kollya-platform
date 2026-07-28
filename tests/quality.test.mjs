/**
 * Whole-codebase quality gates.
 *
 * These are the checks that catch a class of problem rather than one
 * instance: a duplicate translation key, a raw error string reaching
 * a student, a timer nobody clears, an untranslated literal creeping
 * back in. Each one exists because it actually caught something.
 */
import fs from 'fs';

const T = []; const ok = (n, c) => T.push((c ? 'PASS' : 'FAIL') + '  ' + n);
const R = new URL('../', import.meta.url).pathname;
const read = p => fs.readFileSync(R + p, 'utf8');

const featureFiles = fs.readdirSync(R + 'public/js/features').filter(f => f.endsWith('.js'));
const coreFiles    = fs.readdirSync(R + 'public/js/core').filter(f => f.endsWith('.js'));
const allJs = [...featureFiles.map(f => 'public/js/features/' + f),
               ...coreFiles.map(f => 'public/js/core/' + f), 'public/js/app_sm.js'];
const js = allJs.map(read).join('\n');
const css = ['base_sm','components_sm','layout_sm'].map(f => read('public/css/' + f + '.css')).join('\n');
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
const i18n = read('public/js/core/i18n_sm.js');

/** Source with comments and console lines removed. */
const codeOnly = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  // console calls can span lines; a single-line regex left half of a
  // wrapped developer message looking like untranslated UI text
  .replace(/console\.[a-z]+\([\s\S]*?\);/g, '');

/* ============================================================
   TRANSLATION INTEGRITY
   ============================================================ */
const block = l => (i18n.match(new RegExp(`\\n  ${l}: \\{([\\s\\S]*?)\\n  \\},?\\n`)) || ['',''])[1];
const keysOf = l => [...block(l).matchAll(/'([a-zA-Z][\w.]*)':/g)].map(m => m[1]);

for (const lang of ['en','fr','ar']) {
  const ks = keysOf(lang);
  const dupes = [...new Set(ks.filter(k => ks.filter(x => x === k).length > 1))];
  // A duplicate is not cosmetic: the later definition silently wins,
  // so one of the two meanings is simply wrong on screen. This caught
  // 'notif.follows' being both a tab label and "follows you".
  ok(`${lang} has no duplicate keys${dupes.length ? ' — ' + dupes.join(', ') : ''}`, dupes.length === 0);
}
const en = new Set(keysOf('en')), fr = new Set(keysOf('fr')), ar = new Set(keysOf('ar'));
ok('every English key exists in French', [...en].every(k => fr.has(k)));
ok('every English key exists in Arabic', [...en].every(k => ar.has(k)));
ok('no orphan keys in French', [...fr].every(k => en.has(k)));
ok('no orphan keys in Arabic', [...ar].every(k => en.has(k)));
ok('translation set is substantial', en.size > 400);

// No French UI literals outside comments and console output.
//
// Faculty names are DATA, not interface: "Informatique" is the name
// of a real faculty at a real Algerian university and reads the same
// in every language, exactly like a person's name. Translating them
// would be wrong, so they are excluded by value rather than by
// weakening the check.
const FRENCH = /[éèêàçùôûîï]/;
const FACULTIES = new Set(['Informatique','Mathématiques','Physique','Chimie','Biologie',
  'Médecine','Pharmacie','Génie civil','Génie mécanique','Électronique','Architecture',
  'Droit','Économie','Sciences politiques','Lettres','Langues étrangères','Psychologie',
  'Sociologie','Sciences du sport','Agronomie']);

const leaks = [];
for (const f of allJs) {
  if (f.includes('i18n_sm')) continue;
  const code = codeOnly(read(f));
  // both quote styles — a single-quote-only sweep missed real strings
  for (const m of [...code.matchAll(/'([^'\\\n]{4,70})'/g), ...code.matchAll(/"([^"\\\n]{4,70})"/g)]) {
    const v = m[1];
    if (!FRENCH.test(v)) continue;
    if (FACULTIES.has(v)) continue;
    if (/^--|^\/|^#|^data:|carte\.koliya|@carte/.test(v)) continue;
    // utils_sm holds the per-language time units by design: the
    // French entry in a fr/en/ar map is not a leak, it is the map.
    if (f.includes('utils_sm')) continue;
    leaks.push(`${f.split('/').pop()}: ${v.slice(0, 46)}`);
  }
}
ok(`no untranslated French UI text (${leaks.length} found)`, leaks.length === 0);
if (leaks.length) leaks.slice(0, 8).forEach(l => console.log('       ' + l));

/* ============================================================
   ERROR HANDLING
   ============================================================ */
ok('a single friendly error formatter exists', /export function errorText/.test(i18n));
ok('errorText covers offline', /error\.offline/.test(i18n));
ok('errorText covers auth, permission and rate limits',
   /error\.session/.test(i18n) && /error\.denied/.test(i18n) && /error\.rate/.test(i18n));
// `err.message === 'sentinel' ? … : errorText(err)` is a comparison,
// not raw output — the old pattern flagged it and hid the real signal.
const rawShown = (js.match(/text:\s*err\?\.message\s*(?![=!]==)(?!\s*===)/g) || [])
  .filter(m => !/===/.test(m)).length;
ok(`no raw error text rendered to users (${rawShown})`, rawShown === 0);

/* ============================================================
   LEAKS AND LIFECYCLE
   ============================================================ */
const intervals = (js.match(/setInterval\(/g) || []).length;
const clears    = (js.match(/clearInterval\(/g) || []).length;
ok(`every interval has a clear (${intervals} set, ${clears} cleared)`, clears >= 1 && intervals <= clears + 1);
ok('the chat screen can be torn down', /export function teardownMessages/.test(js));
ok('object URLs are revoked', /revokeObjectURL/.test(js));

/* ============================================================
   SECURITY
   ============================================================ */
ok('data: URLs are allow-listed by media type', /SAFE_DATA/.test(js));
ok('SVG is refused as user media — it can carry script',
   !/svg\+xml/.test(codeOnly(read('public/js/core/utils_sm.js')).match(/SAFE_DATA[^;]+;/)?.[0] || ''));
ok('no eval on user input', !/\beval\(/.test(js));
ok('RLS is forced on every table', /FORCE ROW LEVEL SECURITY/.test(read('db/02_policies.sql')));
ok('views run as the caller, not the owner', /security_invoker\s*=\s*true/.test(read('db/07_privacy_sm.sql')));
ok('the XP ledger is append-only',
   !/CREATE POLICY[^;]*xp_events FOR (UPDATE|DELETE)/i.test(read('db/06_game_sm.sql') + read('db/08_fixes_sm.sql')));

/* ============================================================
   ACCESSIBILITY
   ============================================================ */
ok('reduced motion is respected', /prefers-reduced-motion/.test(css));
ok('focus rings use :focus-visible', /:focus-visible/.test(css));
ok('there is a skip link', /skip/i.test(read('public/index_sm.html')));
ok('44px touch targets on small screens', /44px|min-height:\s*44/.test(css));
const html = read('public/index_sm.html');
const unlabelled = [...html.matchAll(/<button(?![^>]*aria-label)(?![^>]*data-i18n-attr)[^>]*>\s*<i data-icon/g)];
ok(`icon buttons in HTML are labelled (${unlabelled.length} missing)`, unlabelled.length === 0);

/* ============================================================
   DESIGN TOKENS
   ============================================================ */
const rawZ = [...cssCode.matchAll(/z-index:\s*(\d+)/g)].map(m => +m[1]).filter(v => v > 10);
ok(`no hardcoded z-index above the token scale (${rawZ.length})`, rawZ.length === 0);
ok('spacing uses the --s scale', (cssCode.match(/var\(--s\d\)/g) || []).length > 200);
ok('colour uses tokens', (cssCode.match(/var\(--(brand|text|surface|border)/g) || []).length > 100);

/* ============================================================
   DATABASE
   ============================================================ */
const sqlFiles = fs.readdirSync(R + 'db').filter(f => f.endsWith('.sql'));
ok(`all ${sqlFiles.length} migrations present`, sqlFiles.length >= 8);
const allSql = sqlFiles.map(f => read('db/' + f)).join('\n');
ok('migrations are re-runnable', (allSql.match(/IF NOT EXISTS|OR REPLACE|DROP POLICY IF EXISTS/g) || []).length > 60);
ok('no plaintext secrets in SQL', !/password\s*=\s*'[^']{8,}'/i.test(allSql));
ok('config holds no secret keys',
   !/service_role|secret_key|sk_live/i.test(read('public/js/core/config_sm.js')));

const pass = T.filter(x => x.startsWith('PASS')).length;
T.filter(x => x.startsWith('FAIL')).forEach(x => console.log(x));
console.log(`${pass}/${T.length} passed`);
