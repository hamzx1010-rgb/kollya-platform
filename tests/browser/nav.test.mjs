/**
 * nav.test.mjs — every page must be reachable on a phone.
 *
 * THE BUG THIS LOCKS DOWN
 * Events, Q&A, Channels and Saved were fully built and routed, but all
 * four were `.nav-item:not(.primary)`, which the bottom-bar media query
 * sets to display:none. On a phone there was no link, no shortcut and
 * no gesture that reached them — the pages existed and nothing could
 * open them. Nothing failed; they were simply invisible.
 *
 * So this suite asserts REACHABILITY, not markup: it clicks what a
 * student can actually see and checks where it lands.
 */

import { openApp, suite } from './harness.mjs';

const s = suite('nav');
const wait = ms => new Promise(r => setTimeout(r, ms));

/* Every route that must be reachable from a phone with only taps. */
const MUST_REACH = ['feed', 'explore', 'messages', 'notifications',
                    'profile', 'events', 'qa', 'channels', 'saved', 'hub'];

/* ==================================================================
   1. PHONE — six tabs, each big enough to hit
   ================================================================== */
for (const width of [360, 412]) {
  const app = await openApp({ width, height: 820 });
  const { page } = app;
  await wait(900);

  const bar = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('.nav-item')]
      .filter(a => getComputedStyle(a).display !== 'none');
    return vis.map(a => {
      const r = a.getBoundingClientRect().toJSON();
      return { nav: a.dataset.nav, w: Math.round(r.width),
               right: Math.round(r.right), left: Math.round(r.left) };
    });
  });

  s.eq(bar.length, 6, `${width}px: exactly 6 bottom tabs`);
  s.ok(bar.every(b => b.w >= 48),
       `${width}px: every tab is at least 48px wide (smallest ${Math.min(...bar.map(b => b.w))})`);
  s.ok(bar.every(b => b.left >= -1 && b.right <= width + 1),
       `${width}px: no tab overflows the screen`);

  const ids = bar.map(b => b.nav);
  s.ok(ids.includes('campus'), `${width}px: Campus tab present`);
  s.ok(ids.includes('profile'), `${width}px: Profile tab present`);
  s.ok(!ids.includes('hub'),
       `${width}px: Hub is NOT a bottom tab (its strip is on the feed)`);

  await app.close();
}

/* ==================================================================
   2. PHONE — all ten pages reachable by tapping only
   ================================================================== */
{
  const app = await openApp({ width: 360, height: 820 });
  const { page } = app;
  await wait(900);

  const reached = [];

  // The five bottom tabs that go straight somewhere.
  for (const nav of ['feed', 'explore', 'messages', 'notifications', 'profile']) {
    await page.evaluate(n => document.querySelector(`[data-nav="${n}"]`)?.click(), nav);
    await wait(700);
    reached.push(await page.evaluate(() => location.hash.replace(/^#\//, '').split('/')[0]));
  }

  // Campus opens the tab strip; each strip tab is one more page.
  await page.evaluate(() => document.querySelector('[data-nav="campus"]')?.click());
  await wait(1300);
  reached.push(await page.evaluate(() => location.hash.replace(/^#\//, '').split('/')[0]));

  for (const id of ['qa', 'channels', 'saved', 'explore']) {
    const clicked = await page.evaluate(i => {
      const b = document.querySelector(`[data-campus-tab="${i}"]`);
      if (!b) return false;
      b.click();
      return true;
    }, id);
    s.ok(clicked, `campus strip has a visible "${id}" tab`);
    await wait(800);
    reached.push(await page.evaluate(() => location.hash.replace(/^#\//, '').split('/')[0]));
  }

  // Hub via the strip on the feed.
  await page.evaluate(() => document.querySelector('[data-nav="feed"]')?.click());
  await wait(1000);
  const stripHref = await page.evaluate(() =>
    document.querySelector('.hub-strip')?.getAttribute('href'));
  s.eq(stripHref, '#/hub', 'the feed progress strip links to the hub');
  await page.evaluate(() => document.querySelector('.hub-strip')?.click());
  await wait(1000);
  reached.push(await page.evaluate(() => location.hash.replace(/^#\//, '').split('/')[0]));

  for (const want of MUST_REACH) {
    s.ok(reached.includes(want),
         `"${want}" is reachable on a phone by tapping (got: ${reached.join(',')})`);
  }

  s.eq(app.errors.length, 0, 'no page errors while navigating: ' + app.errors.join(' | '));
  await app.close();
}

/* ==================================================================
   3. CAMPUS STRIP — labels readable, active tab correct
   ================================================================== */
{
  const app = await openApp({ width: 360, height: 820 });
  const { page } = app;
  await wait(900);
  await page.evaluate(() => { location.hash = '#/events'; });
  await wait(1400);

  const strip = await page.evaluate(() => {
    const el = document.querySelector('.campus-tabs');
    if (!el) return null;
    return {
      scrolls: el.scrollWidth > el.clientWidth,
      tabs: [...el.querySelectorAll('.sub-tab')].map(b => ({
        id: b.dataset.campusTab,
        on: b.classList.contains('on'),
        aria: b.getAttribute('aria-selected'),
        clipped: b.scrollWidth > b.clientWidth + 1,
        text: b.textContent.trim()
      }))
    };
  });

  s.ok(strip, 'campus tab strip renders');
  s.eq(strip && strip.tabs.length, 5, 'five discovery tabs');
  s.ok(strip && strip.tabs.every(t => !t.clipped),
       'no tab label is clipped at 360px');
  s.ok(strip && strip.tabs.every(t => t.text.length > 0),
       'every tab has a visible label');
  const active = strip && strip.tabs.filter(t => t.on);
  s.eq(active && active.length, 1, 'exactly one tab is active');
  s.eq(active && active[0].id, 'events', 'the active tab matches the route');
  s.eq(active && active[0].aria, 'true', 'aria-selected tracks the active tab');

  await app.close();
}

/* ==================================================================
   4. DEEP LINKS still work — notifications and bookmarks depend on it
   ================================================================== */
{
  const app = await openApp({ width: 360, height: 820 });
  const { page } = app;
  await wait(900);

  for (const r of ['events', 'qa', 'channels', 'saved']) {
    await page.evaluate(x => { location.hash = '#/' + x; }, r);
    await wait(1100);
    const got = await page.evaluate(() =>
      document.querySelector('.campus-tabs .sub-tab.on')?.dataset.campusTab);
    s.eq(got, r, `direct link #/${r} opens the ${r} tab`);
  }

  // The phone tab points at #/explore/events; it must canonicalise so a
  // refresh or a share does not produce a second URL for one page.
  await page.evaluate(() => { location.hash = '#/explore/qa'; });
  await wait(1300);
  const canon = await page.evaluate(() => location.hash);
  s.eq(canon, '#/qa', '#/explore/qa redirects to the canonical #/qa');

  await app.close();
}

/* ==================================================================
   5. DESKTOP — unchanged, and nothing duplicated
   ================================================================== */
{
  const app = await openApp({ width: 1280, height: 860 });
  const { page } = app;
  await wait(900);

  const rail = await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item')]
      .filter(a => getComputedStyle(a).display !== 'none')
      .map(a => a.dataset.nav));

  s.ok(rail.includes('hub'), 'desktop rail still shows Hub');
  s.ok(rail.includes('events') && rail.includes('qa'),
       'desktop rail still shows Events and Q&A directly');
  s.ok(!rail.includes('campus'),
       'the Campus shortcut is hidden on desktop — the four rows are already there');
  s.ok(!rail.includes('profile'),
       'Profile row hidden on desktop: the avatar card at the foot already links there');

  // No duplicate entries, which is what a mis-scoped nav-phone rule
  // would produce.
  s.eq(new Set(rail).size, rail.length, 'no duplicated nav rows');

  await app.close();
}

/* ==================================================================
   6. THE PROGRESS STRIP
   ================================================================== */
{
  const app = await openApp({ width: 412, height: 915 });
  const { page } = app;
  await wait(1200);

  const strip = await page.evaluate(() => {
    const el = document.querySelector('.hub-strip');
    if (!el) return null;
    const r = el.getBoundingClientRect().toJSON();
    const fill = el.querySelector('.hs-fill');
    const bar = el.querySelector('.hs-bar');
    return {
      left: Math.round(r.left), right: Math.round(r.right),
      h: Math.round(r.height),
      lvl: el.querySelector('.hs-lvl')?.textContent.trim() || '',
      quests: el.querySelector('.hs-quests')?.textContent.trim() || '',
      fillPct: fill ? fill.style.width : '',
      role: bar?.getAttribute('role'),
      hasMax: !!bar?.getAttribute('aria-valuemax'),
      label: el.getAttribute('aria-label') || '',
      // A raw i18n key on screen means a missing translation.
      rawKey: /\b(hub|nav)\.[a-zA-Z]+/.test(el.textContent)
    };
  });

  s.ok(strip, 'progress strip renders on the feed');
  s.ok(strip && strip.left >= 0 && strip.right <= 412 + 1,
       `strip fits in 412px (${strip && strip.left} → ${strip && strip.right})`);
  s.ok(strip && strip.h <= 56, `strip stays one line (${strip && strip.h}px)`);
  s.ok(strip && /\d/.test(strip.lvl), `level shown (${strip && strip.lvl})`);
  s.ok(strip && /\d\/\d/.test(strip.quests), `quest progress shown (${strip && strip.quests})`);
  s.ok(strip && /%$/.test(strip.fillPct), `bar filled from real XP (${strip && strip.fillPct})`);
  s.eq(strip && strip.role, 'progressbar', 'the bar is a progressbar for screen readers');
  s.ok(strip && strip.hasMax, 'progressbar declares its maximum');
  s.ok(strip && strip.label.length > 3, 'the strip has an accessible label');
  s.ok(strip && !strip.rawKey, 'no untranslated key leaked into the strip');

  // It must live on the feed only — one progress display per screen.
  await page.evaluate(() => { location.hash = '#/hub'; });
  await wait(1200);
  const onHub = await page.evaluate(() => !!document.querySelector('.hub-strip'));
  s.ok(!onHub, 'the compact strip is not repeated on the hub itself');

  await app.close();
}

/* ==================================================================
   7. ARABIC — translated, RTL, and the chevron flipped
   ================================================================== */
{
  const app = await openApp({ width: 412, height: 915 });
  const { page } = app;
  await wait(900);
  await page.evaluate(async () => {
    const i = await import('/js/core/i18n_sm.js');
    i.setLang('ar');
  });
  await wait(1400);

  const ar = await page.evaluate(() => {
    const strip = document.querySelector('.hub-strip');
    const campus = document.querySelector('[data-nav="campus"] .lbl');
    const go = strip?.querySelector('.hs-go');
    return {
      dir: document.documentElement.dir,
      stripArabic: /[\u0600-\u06FF]/.test(strip?.textContent || ''),
      campusLabel: campus?.textContent.trim() || '',
      campusArabic: /[\u0600-\u06FF]/.test(campus?.textContent || ''),
      chevron: go ? getComputedStyle(go).transform : '',
      xpIsolated: strip?.querySelector('.hs-xp')
        ? getComputedStyle(strip.querySelector('.hs-xp')).unicodeBidi : 'n/a'
    };
  });

  s.eq(ar.dir, 'rtl', 'document is RTL in Arabic');
  s.ok(ar.stripArabic, 'the progress strip is translated');
  s.ok(ar.campusArabic, `the Campus tab is translated ("${ar.campusLabel}")`);
  s.ok(ar.chevron !== 'none' && ar.chevron !== '',
       'the chevron is flipped for RTL');

  // Events hero used to print "à venir" and "vos inscriptions" in
  // French no matter the language — visible in shots/N5.
  await page.evaluate(() => { location.hash = '#/events'; });
  await wait(1500);
  const hero = await page.evaluate(() => {
    const h = document.querySelector('.events-hero');
    if (!h) return null;
    const stats = [...h.querySelectorAll('.hero-stat span')].map(x => x.textContent.trim());
    return {
      eyebrow: h.querySelector('.hero-eyebrow')?.textContent.trim() || '',
      stats,
      cta: h.querySelector('.hero-cta-txt')?.textContent.trim() || ''
    };
  });

  s.ok(hero, 'events hero renders');
  s.ok(hero && /[\u0600-\u06FF]/.test(hero.eyebrow),
       `hero eyebrow translated ("${hero && hero.eyebrow}")`);
  s.ok(hero && hero.stats.every(x => /[\u0600-\u06FF]/.test(x)),
       `hero stats translated (${hero && hero.stats.join(' / ')})`);
  s.ok(hero && !/à venir|vos inscriptions/.test(hero.stats.join(' ')),
       'no French left in the Arabic hero');

  await app.close();
}

process.exit(s.done() ? 0 : 1);
