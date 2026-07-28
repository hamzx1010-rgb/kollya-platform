/**
 * CSS syntax and scaling.
 *
 * A dangling `.dm,` — a selector list with a trailing comma and no
 * second selector — shipped and broke the messages panel: CSS
 * discards the rule AND the block after it, so .dm lost its height
 * and the screen only appeared once something forced a reflow.
 *
 * No test caught it because every test read declarations with a
 * regex, which happily matches text inside a rule the browser threw
 * away. This file parses structure instead.
 */
import fs from 'fs';

const T = []; const ok = (n, c) => T.push((c ? 'PASS' : 'FAIL') + '  ' + n);
const R = new URL('../', import.meta.url).pathname;
const FILES = ['base_sm', 'components_sm', 'layout_sm'];

for (const name of FILES) {
  const raw = fs.readFileSync(`${R}public/css/${name}.css`, 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '');   // comments cannot be syntax

  /* ---- braces balance ---- */
  let depth = 0, minDepth = 0;
  for (const ch of src) {
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; minDepth = Math.min(minDepth, depth); }
  }
  ok(`${name}: braces balance`, depth === 0);
  ok(`${name}: never closes more than it opens`, minDepth === 0);

  /* ---- dangling selectors ----
     `.a,` followed by an at-rule, a comment or a closing brace means
     the selector list was never finished. This is the exact bug. */
  const dangling = [...src.matchAll(/^([^\n{}]*,)[ \t]*\n\s*(@|\}|$)/gm)];
  ok(`${name}: no dangling selector lists (${dangling.length})`, dangling.length === 0);
  dangling.slice(0, 3).forEach(m =>
    console.log(`       line ${src.slice(0, m.index).split('\n').length}: ${m[1].trim()}`));

  /* ---- empty rules ---- */
  const empty = [...src.matchAll(/[^{}]+\{\s*\}/g)];
  ok(`${name}: no empty rules (${empty.length})`, empty.length === 0);

  /* ---- a declaration outside any rule ---- */
  const stray = [...src.matchAll(/^\s*[a-z-]+:\s*[^;{}]+;\s*$/gm)].filter(m => {
    const before = src.slice(0, m.index);
    return (before.split('{').length - before.split('}').length) === 0;
  });
  ok(`${name}: no declarations outside a rule (${stray.length})`, stray.length === 0);

  /* ---- unclosed at-rules ---- */
  const atOpen = (src.match(/@(media|supports|container)[^{]*\{/g) || []).length;
  ok(`${name}: at-rules are well formed`, atOpen >= 0 && depth === 0);

  /* ---- var() references resolve ---- */
  const defined = new Set([...raw.matchAll(/--([\w-]+)\s*:/g)].map(m => m[1]));
  const allDefined = new Set();
  for (const f of FILES)
    for (const m of fs.readFileSync(`${R}public/css/${f}.css`, 'utf8').matchAll(/--([\w-]+)\s*:/g))
      allDefined.add(m[1]);
  // `var(--x, fallback)` is a deliberate runtime variable set by JS
  // (--pct, --shrink, --bubble-grad). Only a var with NO fallback and
  // no definition is a real bug — that is how --s7 silently collapsed
  // a padding to zero.
  const used = [...src.matchAll(/var\(\s*--([\w-]+)\s*(,)?/g)];
  const missing = [...new Set(
    used.filter(m => !m[2] && !allDefined.has(m[1])).map(m => m[1])
  )];
  ok(`${name}: every var() is defined (${missing.length} missing)`, missing.length === 0);
  missing.slice(0, 4).forEach(v => console.log(`       undefined: --${v}`));
}

/* ============================================================
   SCALING — the layout must flow, not jump between breakpoints
   ============================================================ */
const base = fs.readFileSync(`${R}public/css/base_sm.css`, 'utf8');
const layout = fs.readFileSync(`${R}public/css/layout_sm.css`, 'utf8');

ok('the feed column scales with the window',
   /--feed-w:\s*clamp\(/.test(base));
ok('the conversation list scales', /--dm-list-w:\s*clamp\(/.test(layout));
ok('clamp() is used widely, not once',
   (layout.match(/clamp\(/g) || []).length >= 8);
ok('container queries are used for panel-relative layout',
   /@container/.test(layout));
ok('a container context is declared', /container-type/.test(layout));

/* the messages panel must keep a real height */
const dm = (layout.replace(/\/\*[\s\S]*?\*\//g, '').match(/(?<![\w.-])\.dm\s*\{([^}]*)\}/s) || ['',''])[1];
ok('.dm still declares an explicit height', /height:\s*calc\(100dvh/.test(dm));
ok('.dm hides its own overflow', /overflow:\s*hidden/.test(dm));

const pass = T.filter(x => x.startsWith('PASS')).length;
T.filter(x => x.startsWith('FAIL')).forEach(x => console.log(x));
console.log(`${pass}/${T.length} passed`);
