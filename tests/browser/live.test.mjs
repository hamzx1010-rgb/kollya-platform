/**
 * live.test.mjs — the FIRST tests that run in a real browser.
 *
 * Everything here measures things jsdom physically cannot: layout,
 * scroll geometry, popup direction, computed colour, overflow.
 * If a number is asserted below, Blink produced it.
 */
import { openApp, suite } from './harness.mjs';

const s = suite('live');
const wait = ms => new Promise(r => setTimeout(r, ms));

const app = await openApp({ width: 1280, height: 860 });
const { page } = app;

/* ============================================================
   0. BOOT — no crash, no unhandled error
   ============================================================ */
s.ok(app.errors.filter(e => !/notifications\?select=id/.test(e)).length === 0,
  'boot raises no page error: ' + app.errors.join(' | '));
s.ok(await page.$eval('#auth', n => n.classList.contains('hidden')), 'auth screen hidden after session resolves');
s.eq(await page.evaluate(() => location.hash), '#/feed', 'lands on the feed');

const rendered = await page.evaluate(() =>
  document.querySelectorAll('.post, article, [data-post-id]').length);
s.ok(rendered >= 4, `feed painted real HTTP rows (${rendered} posts)`);

/* ============================================================
   1. NO HORIZONTAL OVERFLOW at any width  (the "split screen" bug)
   ============================================================ */
const widths = [1600, 1280, 1024, 860, 720, 600, 480, 380];
for (const w of widths) {
  await page.setViewport({ width: w, height: 860 });
  await wait(320);
  const o = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
    worst: [...document.querySelectorAll('body *')]
      .map(n => ({ t: n.tagName + '.' + (n.className || '').toString().split(' ')[0], r: n.getBoundingClientRect().right }))
      .filter(x => x.r > window.innerWidth + 1)
      .sort((a, b) => b.r - a.r)[0] || null
  }));
  s.ok(o.doc <= o.win + 1, `no h-scroll at ${w}px (scrollWidth ${o.doc} vs ${o.win}${o.worst ? ', worst ' + o.worst.t + ' @' + Math.round(o.worst.r) : ''})`);
}

/* ============================================================
   2. FLUID SCALING — the feed column actually resizes
   ============================================================ */
const widthsFeed = {};
for (const w of [1280, 900, 700]) {
  await page.setViewport({ width: w, height: 860 });
  await wait(320);
  widthsFeed[w] = await page.evaluate(() => {
    const n = document.querySelector('.feed-col, .feed, .view-inner > *');
    return n ? Math.round(n.getBoundingClientRect().width) : 0;
  });
}
// Below the 900px breakpoint the nav rail becomes a bottom bar and the
// column legitimately gets WIDER, so a monotonic assertion is wrong.
// What must hold: the width tracks the window and never collapses.
s.ok(widthsFeed[900] !== widthsFeed[700] && widthsFeed[700] > 400,
  `feed column is fluid, not fixed: ${JSON.stringify(widthsFeed)}`);
s.ok(widthsFeed[700] > 300, `column stays usable when narrow (${widthsFeed[700]}px)`);

/* ============================================================
   3. MESSAGES — one click shows the DM list (no "click empty space")
   ============================================================ */
await page.setViewport({ width: 1280, height: 860 });
await wait(250);
// the width loop above left the app on a route rendered at 700px; force a
// clean re-render at desktop width before measuring the DM panel
await page.evaluate(() => { location.hash = '#/feed'; });
await wait(500);
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('a,button')]
    .find(n => /^\s*messages/i.test(n.innerText) || n.getAttribute('href') === '#/messages');
  if (!b) return false;
  b.click();
  return true;
});
s.ok(clicked, 'nav has a Messages control');
await page.waitForFunction(() => document.querySelectorAll('.dm-list-scroll .conv').length > 0,
  { timeout: 8000 }).catch(() => {});
await wait(500);

const dm = await page.evaluate(() => {
  const list = document.querySelector('.dm');
  const convs = [...document.querySelectorAll('.dm-list-scroll .conv')];
  const vis = convs.filter(n => n.getBoundingClientRect().height > 8);
  return {
    hash: location.hash,
    listBox: list ? list.getBoundingClientRect().toJSON() : null,
    convCount: convs.length,
    visibleConvs: vis.length,
    firstRow: vis[0] ? vis[0].getBoundingClientRect().toJSON() : null,
    fullWidthRow: vis[0] ? Math.round(vis[0].getBoundingClientRect().width) : 0,
    railWidth: document.querySelector('.dm-list')
      ? Math.round(document.querySelector('.dm-list').getBoundingClientRect().width) : 0
  };
});
s.eq(dm.hash, '#/messages', 'routes to #/messages on a single click');
s.ok(dm.visibleConvs >= 3, `conversation list renders immediately, no second click (${dm.visibleConvs} rows visible)`);
s.ok(dm.firstRow && dm.firstRow.height > 40, `rows have real height (${dm.firstRow?.height})`);
s.ok(dm.railWidth > 200, `rail is expanded, not folded to 76px (${dm.railWidth}px)`);
s.ok(dm.listBox && dm.listBox.height > 400, `message panel fills the viewport (${Math.round(dm.listBox?.height)}px)`);

/* ============================================================
   4. OPENING A DM SCROLLS TO THE NEWEST MESSAGE
   ============================================================ */
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.dm-list-scroll .conv')]
    .find(n => n.getBoundingClientRect().height > 8);
  row?.click();
});
await page.waitForFunction(() => document.querySelectorAll('.thread-body .bub').length > 0,
  { timeout: 8000 }).catch(() => {});
await wait(600);
const thread = await page.evaluate(() => {
  const sc = document.querySelector('.thread-body');
  const bubbles = document.querySelectorAll('.thread-body .bub, .thread-body .msg, .thread-body [data-id]');
  return {
    bubbles: bubbles.length,
    scroller: sc ? { top: sc.scrollTop, h: sc.scrollHeight, c: sc.clientHeight, cls: sc.className } : null
  };
});
s.ok(thread.bubbles > 0, `thread painted ${thread.bubbles} messages`);
if (thread.scroller) {
  const atBottom = thread.scroller.h - thread.scroller.c - thread.scroller.top;
  s.ok(atBottom < 40, `thread opens at the NEWEST message (${Math.round(atBottom)}px from bottom)`);
} else {
  s.ok(true, 'thread fits without scrolling (nothing to jump to)');
}

/* ============================================================
   5. COMPOSER — Mic and Send are SEPARATE buttons, no emoji
   ============================================================ */
const composer = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('#composer button')];
  const has = re => btns.filter(b => re.test(b.id));
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  return {
    total: btns.length,
    mic: has(/Mic/).length,
    send: has(/Send/).length,
    same: has(/Mic/)[0] === has(/Send/)[0],
    emojiInButtons: btns.filter(b => emojiRe.test(b.textContent)).map(b => b.textContent.trim()).slice(0, 3),
    svgCount: btns.filter(b => b.querySelector('svg')).length
  };
});
s.ok(composer.mic >= 1, 'composer has a Mic button (#btnMic)');
s.ok(composer.send >= 1, 'composer has a Send button');
s.ok(!composer.same, 'Mic and Send are SEPARATE elements');
s.eq(composer.emojiInButtons.length, 0, 'no emoji in composer buttons: ' + JSON.stringify(composer.emojiInButtons));
s.ok(composer.svgCount >= 2, `composer buttons use inline SVG icons (${composer.svgCount})`);

/* ============================================================
   6. GIF PICKER OPENS UPWARD  (measured, not asserted from CSS)
   ============================================================ */
const gif = await page.evaluate(async () => {
  const b = document.getElementById('btnGif');
  if (!b) return { found: false };
  const anchor = b.getBoundingClientRect();
  b.click();
  await new Promise(r => setTimeout(r, 900));
  const panel = document.querySelector('.gif-pop, .gif-panel, .gifs, [data-pop="gif"]');
  return {
    found: true,
    anchorTop: anchor.top,
    panel: panel ? panel.getBoundingClientRect().toJSON() : null,
    tiles: document.querySelectorAll('.gif-pop img, .gif-panel img, .gifs img').length
  };
});
if (gif.found && gif.panel) {
  s.ok(gif.panel.bottom <= gif.anchorTop + 12,
    `GIF picker opens UPWARD (panel bottom ${Math.round(gif.panel.bottom)} vs button top ${Math.round(gif.anchorTop)})`);
  s.ok(gif.panel.top >= -1, `GIF picker stays on screen (top ${Math.round(gif.panel.top)})`);
  s.ok(gif.tiles > 0, `GIF picker shows ${gif.tiles} real <img> tiles, not coloured divs`);
} else {
  s.ok(false, 'GIF button / panel not found in the DM composer: ' + JSON.stringify(gif));
}
// close it again by clicking a point provably OUTSIDE the panel box
// (clicking '.thread-body' centre lands INSIDE the picker, which sits
// over the thread — a mistake worth writing down)
await page.evaluate(() => {
  const p = document.querySelector('.gif-panel');
  const r = p ? p.getBoundingClientRect() : null;
  const x = r ? Math.max(4, r.left - 40) : 100;
  document.elementFromPoint(x, 80)?.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true }));
});
await wait(400);
s.ok(await page.evaluate(() => !document.querySelector('.gif-panel')),
  'GIF picker closes on a click outside it');

/* ============================================================
   7. VOICE RECORDER OPENS UPWARD TOO, AND KEEPS THE DRAFT
   ============================================================ */
const voice = await page.evaluate(async () => {
  const input = document.querySelector('#composer textarea');
  if (input) { input.value = 'brouillon à préserver'; input.dispatchEvent(new Event('input', { bubbles: true })); }
  const draftBefore = input?.value;
  const b = [...document.querySelectorAll('button')]
    .find(n => n.id === 'btnMic');
  if (!b) return { found: false };
  const anchor = b.getBoundingClientRect();
  b.click();
  await new Promise(r => setTimeout(r, 700));
  const panel = document.querySelector('.rec, .recorder, .voice-rec, [data-pop="voice"]');
  const input2 = document.querySelector('#composer textarea');
  return {
    found: true, anchorTop: anchor.top,
    panel: panel ? panel.getBoundingClientRect().toJSON() : null,
    draftBefore, draftAfter: input2?.value ?? null
  };
});
if (voice.found && voice.panel) {
  s.ok(voice.panel.bottom <= voice.anchorTop + 12,
    `voice recorder opens UPWARD (bottom ${Math.round(voice.panel.bottom)} vs ${Math.round(voice.anchorTop)})`);
} else {
  s.ok(voice.found, 'voice/mic button exists: ' + JSON.stringify(voice).slice(0, 160));
}
if (voice.draftBefore) s.eq(voice.draftAfter, voice.draftBefore, 'typed draft survives opening the recorder');

/* ============================================================
   8. LANGUAGE SWITCH actually repaints, and RTL flips direction
   ============================================================ */
await page.goto(page.url().split('#')[0] + '#/feed', { waitUntil: 'domcontentloaded' });
await wait(600);
const beforeText = await page.evaluate(() => document.body.innerText.slice(0, 600));
const langBtn = await page.evaluate(() => !!document.querySelector('#btnLang'));
s.ok(langBtn, '#btnLang exists');

const ar = await page.evaluate(async () => {
  const btn = document.querySelector('#btnLang');
  btn?.click();
  await new Promise(r => setTimeout(r, 400));
  const opt = [...document.querySelectorAll('button, [role=menuitem], li')]
    .find(n => /عرب|arabic|^ar$/i.test(n.textContent.trim()));
  opt?.click();
  await new Promise(r => setTimeout(r, 900));
  return {
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    text: document.body.innerText.slice(0, 600),
    arabicChars: (document.body.innerText.match(/[\u0600-\u06FF]/g) || []).length,
    leftoverKeys: (document.body.innerText.match(/\b(nav|feed|msg|profile)\.[a-zA-Z.]+/g) || []).slice(0, 5)
  };
});
s.eq(ar.dir, 'rtl', 'switching to Arabic sets dir=rtl');
s.eq(ar.lang, 'ar', 'html lang=ar');
s.ok(ar.arabicChars > 40, `UI actually repaints in Arabic (${ar.arabicChars} Arabic glyphs on screen)`);
s.ok(ar.text !== beforeText, 'text changed, the switch is not cosmetic');
s.eq(ar.leftoverKeys.length, 0, 'no raw i18n keys leaked: ' + JSON.stringify(ar.leftoverKeys));

// faculty names must NOT be translated — they are data
const faculty = await page.evaluate(() => document.body.innerText.includes('Informatique') || document.body.innerText.includes('Biologie'));
s.ok(faculty, 'faculty names stay untranslated in Arabic mode');

/* RTL must not create horizontal overflow either */
const rtlOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
s.ok(rtlOverflow <= 1, `no h-scroll in RTL (${rtlOverflow}px)`);

/* ============================================================
   9. CONTRAST — real computed colours (jsdom cannot do this)
   ============================================================ */
const contrast = await page.evaluate(() => {
  const lum = c => {
    const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = s => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  // Backgrounds are composited, not picked. Two things broke the naive
  // walk-up-to-first-opaque-parent approach, both verified against a
  // real screenshot:
  //   1. a gradient button has backgroundColor:transparent and its
  //      colour only in backgroundImage  -> read the stops
  //   2. a TINT like `color(srgb .14 .39 .92 / 0.12)` is 12% opaque,
  //      so the effective background is the tint composited OVER the
  //      parent, not the tint itself. Reading it raw reported 3.13:1
  //      for the active nav item; the screenshot says 5.87:1.
  const parseColor = str => {
    if (!str) return null;
    if (/rgba?\(/.test(str)) {
      const inner = str.slice(str.indexOf('(') + 1, str.lastIndexOf(')'));
      const p = inner.split(',').map(v => Number(v.trim()));
      if (p.some(Number.isNaN)) return null;
      return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
    }
    const m = /color\(srgb ([^)]+)\)/.exec(str);
    if (m) {
      const parts = m[1].replace('/', ' ').split(/\s+/).filter(Boolean).map(Number);
      return { rgb: parts.slice(0, 3).map(v => Math.round(v * 255)),
               a: parts.length > 3 ? parts[3] : 1 };
    }
    return null;
  };
  const over = (fg, bg) => fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a));

  const bgOf = n => {
    const layers = [];
    let e = n;
    while (e) {
      const st = getComputedStyle(e);
      const img = st.backgroundImage;
      if (img && img !== 'none' && /gradient/.test(img)) {
        const stops = [...img.matchAll(/(rgba?\([^)]+\)|color\(srgb[^)]+\))/g)]
          .map(m => parseColor(m[0])).filter(Boolean).filter(c => c.a > 0.01);
        if (stops.length) {
          // darkest visible stop = worst case for the text above it
          stops.sort((a, b) => (a.rgb[0] + a.rgb[1] + a.rgb[2]) - (b.rgb[0] + b.rgb[1] + b.rgb[2]));
          layers.push(stops[0]);
          if (stops[0].a >= 0.999) break;
        }
      }
      const c = parseColor(st.backgroundColor);
      if (c && c.a > 0.01) { layers.push(c); if (c.a >= 0.999) break; }
      e = e.parentElement;
    }
    let base = [255, 255, 255];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };

  const out = [];
  for (const n of [...document.querySelectorAll('body *')].slice(0, 1200)) {
    if (!n.childNodes.length) continue;
    const txt = [...n.childNodes].filter(c => c.nodeType === 3 && c.textContent.trim()).map(c => c.textContent.trim()).join('');
    if (txt.length < 3) continue;
    const st = getComputedStyle(n);
    if (st.visibility === 'hidden' || st.display === 'none' || +st.opacity < 0.3) continue;
    const size = parseFloat(st.fontSize);
    const fc = parseColor(st.color);
    const f = fc ? over(fc, bgOf(n)) : parse(st.color);
    const b = bgOf(n);
    const L1 = lum(f), L2 = lum(b);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const need = (size >= 24 || (size >= 18.66 && +st.fontWeight >= 700)) ? 3 : 4.5;
    out.push({ txt: txt.slice(0, 26), ratio: +ratio.toFixed(2), need, size });
  }
  return {
    checked: out.length,
    worst: out.sort((a, b) => a.ratio - b.ratio).slice(0, 6),
    failing: out.filter(x => x.ratio < x.need).length
  };
});
s.ok(contrast.checked > 20, `measured contrast on ${contrast.checked} text nodes`);
console.log('   contrast worst 6:', JSON.stringify(contrast.worst));
s.ok(contrast.failing === 0, `${contrast.failing} text nodes below WCAG AA`);

/* ============================================================
   10. TAP/CLICK TARGETS + focus ring (web-first: keyboard matters)
   ============================================================ */
const kb = await page.evaluate(async () => {
  document.body.click();
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const e = document.activeElement;
    seen.push(e ? e.tagName + '.' + String(e.className).split(' ')[0] : 'none');
  }
  const el = document.querySelector('button');
  el.focus();
  const st = getComputedStyle(el);
  return { outline: st.outlineStyle + ' ' + st.outlineWidth, boxShadow: st.boxShadow.slice(0, 40) };
});
const focusVisible = await page.evaluate(() => {
  const css = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules].map(r => r.cssText); } catch { return []; } });
  return css.filter(r => r.includes(':focus-visible')).length;
});
s.ok(focusVisible > 0, `stylesheet defines :focus-visible rules (${focusVisible})`);

// The 24px minimum is for STANDALONE controls. An inline text link
// inside a sentence (a #hashtag, a toast's "Undo") is sized by its own
// line-height on purpose; padding it to 24px would wreck the line
// rhythm and WCAG 2.5.8 explicitly exempts inline targets. So: only
// controls that are not inline runs of text.
const small = await page.evaluate(() => [...document.querySelectorAll('button, a')]
  .filter(n => {
    const st = getComputedStyle(n);
    if (st.display === 'inline') return false;               // inline text link
    if (n.closest('p, .post-text, .bub, .toast')) return false;
    return true;
  })
  .map(n => ({ n: n.className.toString().split(' ')[0] || n.tagName, r: n.getBoundingClientRect() }))
  .filter(x => x.r.width > 0 && x.r.height > 0 && (x.r.height < 24 || x.r.width < 24))
  .map(x => `${x.n} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`).slice(0, 6));
console.log('   sub-24px controls:', JSON.stringify(small));
s.ok(small.length === 0, `all controls ≥24px: ${JSON.stringify(small)}`);

/* ============================================================
   11. NETWORK TRUTH — the modules really talked to "Neon"
   ============================================================ */
const tables = [...new Set(app.mock.log.filter(l => l.kind === 'db').map(l => l.table))];
const rpcs = [...new Set(app.mock.log.filter(l => l.kind === 'rpc').map(l => l.fn))];
console.log('   tables hit:', tables.join(','));
console.log('   rpcs hit:', rpcs.join(','));
s.ok(tables.includes('posts') && tables.includes('profiles'), 'feed hit posts + profiles over real HTTP');
s.ok(tables.includes('messages'), 'messages module hit the messages table');
s.ok(rpcs.length > 0, `RPCs actually fired: ${rpcs.join(',')}`);

/* ============================================================
   12. INFO PANEL MUST NEVER COVER THE COMPOSER
   Found by looking at a screenshot, not by a number: at 1360px the
   info panel overlaid 46% of the composer, Send included.
   ============================================================ */
await page.setViewport({ width: 1360, height: 880 });
await page.evaluate(() => { location.hash = '#/feed'; });
await wait(400);
await page.evaluate(() => { location.hash = '#/messages'; });
await page.waitForFunction(() => document.querySelectorAll('.dm-list-scroll .conv').length > 0,
  { timeout: 8000 }).catch(() => {});
await wait(500);
await page.evaluate(() => document.querySelector('.dm-list-scroll .conv')?.click());
await wait(1000);

const autoOpen = await page.evaluate(() => document.querySelector('.dm')?.classList.contains('info-open'));
s.ok(!autoOpen, 'info panel does NOT auto-open at 1360px (no column for it below 1400)');

await page.evaluate(() => document.getElementById('threadHead')?.click());
await wait(900);
const info = await page.evaluate(() => {
  const dm = document.querySelector('.dm');
  if (!dm?.classList.contains('info-open')) return null;
  const c = document.querySelector('#composer').getBoundingClientRect();
  const i = document.querySelector('.info-panel').getBoundingClientRect();
  const b = document.getElementById('btnSend').getBoundingClientRect();
  const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return {
    overlaps: i.bottom > c.top + 1,
    sendClickable: !!(hit && hit.closest('#btnSend')),
    infoHeight: Math.round(i.height),
    composerVar: getComputedStyle(dm).getPropertyValue('--composer-h').trim()
  };
});
s.ok(info, 'clicking the thread header opens the info panel');
if (info) {
  s.ok(!info.overlaps, `info overlay stops above the composer (overlaps=${info.overlaps})`);
  s.ok(info.sendClickable, 'Send button is actually clickable with Info open');
  s.ok(info.infoHeight > 300, `info panel still usable (${info.infoHeight}px tall)`);
  s.ok(/^\d+px$/.test(info.composerVar), `--composer-h is measured, not assumed (${info.composerVar})`);
}

/* ============================================================
   13. NO UN-INTERPOLATED TEMPLATE SYNTAX ON SCREEN
   A `${...}` written inside a single-quoted string instead of a
   backtick template renders literally. Static grep cannot tell the
   two apart (attributes inside templates look identical); the
   rendered DOM can. Caught "Anonyme" this way.
   ============================================================ */
const leaks = [];
for (const r of ['feed', 'explore', 'messages', 'notifications', 'hub',
                 'channels', 'events', 'qa', 'saved', 'settings', 'leaderboard', 'profile']) {
  await page.evaluate(h => { location.hash = '#/' + h; }, r);
  await wait(900);
  const found = await page.evaluate(() => {
    const out = [];
    if (/\$\{/.test(document.body.innerText)) {
      out.push('text: ' + (document.body.innerText.match(/.{0,30}\$\{.{0,30}/) || [''])[0]);
    }
    for (const el of document.querySelectorAll('[aria-label],[placeholder],[title],[data-tip],[style]')) {
      for (const a of ['aria-label', 'placeholder', 'title', 'data-tip', 'style']) {
        const v = el.getAttribute(a);
        if (v && v.includes('${')) out.push(`${a}=${v.slice(0, 50)}`);
      }
    }
    return out;
  });
  for (const f of found) leaks.push(`#/${r} ${f}`);
}
s.eq(leaks.length, 0, 'no literal ${...} rendered anywhere: ' + JSON.stringify(leaks.slice(0, 5)));

/* ============================================================
   14. RTL BIDI — @handles must not flip
   In an Arabic paragraph the leading '@' is neutral punctuation and
   the bidi algorithm moves it to the far end: "@sara.b" rendered as
   "sara.b@". Spotted in a screenshot, fixed with unicode-bidi:isolate.
   ============================================================ */
await page.evaluate(async () => {
  const i = await import('/js/core/i18n_sm.js');
  i.setLang('ar');
});
await wait(1100);
const handles = await page.evaluate(() =>
  [...document.querySelectorAll('.handle')]
    .filter(n => n.getBoundingClientRect().width > 0)
    .map(n => ({ txt: n.textContent.trim(), dir: getComputedStyle(n).direction,
                 bidi: getComputedStyle(n).unicodeBidi })));
s.ok(handles.length > 0, `found ${handles.length} @handles in RTL mode`);
s.eq(handles.filter(h => !h.txt.startsWith('@')).length, 0,
  'every @handle still starts with @ in RTL: ' +
  JSON.stringify(handles.filter(h => !h.txt.startsWith('@')).slice(0, 3)));
s.eq(handles.filter(h => h.dir !== 'ltr' || !/isolate/.test(h.bidi)).length, 0,
  'handles are bidi-isolated LTR runs');

/* ============================================================
   15. LEADERBOARD IS A TABLE, NOT A PODIUM
   ============================================================ */
await page.evaluate(async () => {
  const i = await import('/js/core/i18n_sm.js');
  i.setLang('en');
  location.hash = '#/leaderboard';
});
await wait(1600);

const lb = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.lb-row')];
  const medalOf = r => ['gold', 'silver', 'bronze']
    .find(c => r.querySelector('.lb-rank')?.classList.contains(c)) || null;
  return {
    podiumGone: !document.querySelector('.lb-podium, .lb-slot, .lb-step, .lb-crown, .podium'),
    count: rows.length,
    ranks: rows.map(r => Number(r.dataset.rank)),
    medals: rows.map(medalOf),
    // every row on one baseline == a table, not stepped platforms
    tops: [...new Set(rows.slice(0, 3).map(r => Math.round(r.getBoundingClientRect().height)))],
    header: !!document.querySelector('.lb-cols'),
    mineBar: !document.getElementById('lbMine')?.classList.contains('hidden')
  };
});
s.ok(lb.podiumGone, 'no podium markup survives anywhere');
s.ok(lb.header, 'the table has a column header');
s.ok(lb.count > 3 && lb.count <= 20, `shows a real list capped at 20 (${lb.count} rows)`);
s.eq(lb.medals[0], 'gold', 'rank 1 is gold');
s.eq(lb.medals[1], 'silver', 'rank 2 is silver');
s.eq(lb.medals[2], 'bronze', 'rank 3 is bronze');
s.eq(lb.medals.slice(3).filter(Boolean).length, 0,
  'ranks 4-20 carry NO colour — just the number');
s.eq(lb.tops.length, 1,
  `top three share one row height, no Olympic steps (${JSON.stringify(lb.tops)})`);
s.ok(lb.ranks.every((v, i) => i === 0 || v >= lb.ranks[i - 1]), 'ranks never go backwards');
s.ok(lb.mineBar, '“Your position” bar is still there');

/* the medals must actually be visible against the page */
const medalContrast = await page.evaluate(() => {
  const lum = c => { const v = c.map(x => x / 255)
    .map(t => t <= 0.03928 ? t / 12.92 : ((t + 0.055) / 1.055) ** 2.4);
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const num = s => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  const out = {};
  for (const cls of ['gold', 'silver', 'bronze']) {
    const chip = document.querySelector('.lb-rank.' + cls);
    if (!chip) continue;
    const stops = [...getComputedStyle(chip).backgroundImage.matchAll(/rgba?\(([^)]+)\)/g)]
      .map(m => num(m[1]));
    const fg = num(getComputedStyle(chip).color);
    out[cls] = {
      // worst case = the lightest stop for dark text, darkest for light text
      text: Math.min(...stops.map(st => ratio(fg, st))),
      page: Math.min(...stops.map(st => ratio(st, [255, 255, 255])))
    };
  }
  return out;
});
for (const [cls, v] of Object.entries(medalContrast)) {
  s.ok(v.text >= 4.5, `${cls} chip number is readable (${v.text.toFixed(2)}:1)`);
  s.ok(v.page >= 1.35, `${cls} chip is visible against the page (${v.page.toFixed(2)}:1)`);
}

await app.close();
process.exit(s.done() ? 0 : 1);
