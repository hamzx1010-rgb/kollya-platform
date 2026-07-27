/**
 * Z-INDEX — the delete button that hid behind the story.
 *
 * The rule is simple and was broken: a fullscreen surface must sit
 * BELOW anything it can open. The story viewer was at the very top
 * (--z-max), so its own delete confirm, its viewers list, every
 * context menu and every toast opened underneath it and looked like
 * dead buttons.
 *
 * This reads the real CSS, resolves the tokens, and asserts the
 * ordering numerically so it cannot drift back.
 */
import fs from 'fs';

const t = []; const ok = (n, c) => t.push((c ? 'PASS' : 'FAIL') + '  ' + n);
const read = f => fs.readFileSync(new URL('../public/css/' + f, import.meta.url), 'utf8');
const css = read('base_sm.css') + read('components_sm.css') + read('layout_sm.css');

// --- resolve the tokens
const tok = {};
for (const m of css.matchAll(/--z-([a-z]+):\s*(\d+)/g)) tok[m[1]] = +m[2];

ok('immersive token exists', typeof tok.immersive === 'number');
ok('overlay token exists',   typeof tok.overlay === 'number');
ok('menu token exists',      typeof tok.menu === 'number');
ok('toast token exists',     typeof tok.toast === 'number');

/** z-index of a selector, with var() and calc() resolved. */
function zOf(selector) {
  const re = new RegExp(`\\${selector}\\s*\\{[^}]*?z-index:\\s*([^;]+);`, 's');
  const m = css.match(re);
  if (!m) return null;
  let v = m[1].trim();
  v = v.replace(/var\(--z-([a-z]+)\)/g, (_, k) => tok[k] ?? 0);
  const calc = v.match(/^calc\((.+)\)$/);
  if (calc) { try { return Function(`"use strict";return(${calc[1]})`)(); } catch { return null; } }
  return Number(v);
}

const sv       = zOf('.sv');
const lightbox = zOf('.lightbox');
const scrim    = zOf('.scrim');
const modal    = zOf('.modal');
const toast    = tok.toast;
const menu     = tok.menu;

ok('.sv has a resolved z-index', Number.isFinite(sv));
ok('.lightbox has a resolved z-index', Number.isFinite(lightbox));
ok('.modal has a resolved z-index', Number.isFinite(modal));

// --- THE RULE
ok('story viewer is NOT the top layer', sv < tok.toast);
ok('modal opens ABOVE the story viewer', modal > sv);
ok('scrim opens above the story viewer', scrim > sv);
ok('context menu opens above a modal', menu > modal);
ok('toast is above everything it can be raised from', toast > menu);
ok('lightbox is above the story viewer', lightbox > sv);
ok('lightbox does not tie with the story viewer', lightbox !== sv);
ok('lightbox stays below modals', lightbox < modal);

// --- the exact chain from the bug report:
//     open story -> press delete -> confirm dialog must be visible
ok('delete confirm is visible over a story', modal > sv && scrim > sv);
//     open story -> press viewers -> list must be visible
ok('viewers list is visible over a story', modal > sv);
//     any action -> toast must be visible
ok('toast is visible over a story', toast > sv);
//     right-click inside a story
ok('context menu is visible over a story', menu > sv);

// --- nothing regressed underneath
ok('nav rail stays below overlays', tok.nav < tok.overlay);
ok('sticky headers stay below the nav', tok.sticky < tok.nav);

// --- no stray hardcoded z-index above the toast layer
const hardcoded = [...css.matchAll(/z-index:\s*(\d{3,})\s*;/g)].map(m => +m[1]);
ok('no hardcoded z-index outranks the toast layer',
   hardcoded.every(v => v <= tok.toast));

const pass = t.filter(x => x.startsWith('PASS')).length;
t.filter(x => x.startsWith('FAIL')).forEach(x => console.log(x));
console.log(`${pass}/${t.length} passed`);
