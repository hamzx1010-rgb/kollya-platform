/**
 * background.test.mjs — the APK's background-sync seam, in real Chrome.
 *
 * WHAT THIS ACTUALLY TESTS
 * The Java service cannot run here (no emulator, no /dev/kvm). What CAN
 * be tested is the half that decides whether the feature works at all:
 * the contract between notify_sm.js and window.AndroidSync.
 *
 * A fake AndroidSync is injected before any script runs, recording every
 * call. Then the real app boots on top of it. A wrong method name, a
 * missing argument, or a marker written to the wrong place fails here
 * exactly as it would on a phone — that is the class of bug that made
 * "notifications don't show" ship twice already.
 *
 * It also asserts the WEBSITE still behaves with the bridge absent,
 * because every one of these functions runs in the browser build too.
 */

import { openApp, suite } from './harness.mjs';

const s = suite('background');

/** The fake bridge. Mirrors SyncBridge.java method for method. */
function fakeBridge() {
  return function install(init) {
    const calls = [];
    let stored = init.lastSeen;
    let on = init.enabled;

    window.__syncCalls = calls;
    window.KOLIYA_NATIVE = true;
    window.AndroidSync = {
      available: () => { calls.push(['available']); return true; },
      lastSeen: () => { calls.push(['lastSeen']); return stored; },
      setLastSeen: v => { calls.push(['setLastSeen', v]); stored = v; },
      enabled: () => { calls.push(['enabled']); return on; },
      setEnabled: v => { calls.push(['setEnabled', v]); on = v; },
      batteryExempt: () => { calls.push(['batteryExempt']); return init.exempt; },
      requestBatteryExempt: () => { calls.push(['requestBatteryExempt']); },
      openBatterySettings: () => { calls.push(['openBatterySettings']); },
      status: () => {
        calls.push(['status']);
        return JSON.stringify({
          enabled: on, exempt: init.exempt, lastRun: 1785000000000,
          runs: 7, posted: 2, lastSeen: stored, lastError: init.error || null
        });
      },
      pollNow: () => { calls.push(['pollNow']); }
    };
  };
}

/* ==================================================================
   1. NATIVE PRESENT — the bridge is used
   ================================================================== */
{
  const app = await openApp({ width: 412, height: 915 });
  const { page } = app;

  // Install the fake and reload so it exists before any module imports.
  await page.evaluateOnNewDocument(fakeBridge(), {
    lastSeen: '2026-07-20T10:00:00.000Z', enabled: true, exempt: false
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));

  const api = await page.evaluate(async () => {
    const n = await import('/js/core/native_sm.js');
    return {
      isNative: n.isNative(),
      has: n.hasBackgroundSync(),
      lastSeen: n.syncLastSeen(),
      enabled: n.backgroundSyncEnabled(),
      exempt: n.batteryExempt(),
      status: n.syncStatus()
    };
  });

  s.ok(api.isNative, 'isNative() true when KOLIYA_NATIVE is set');
  s.ok(api.has, 'hasBackgroundSync() true when AndroidSync.available() is true');
  s.eq(api.lastSeen, '2026-07-20T10:00:00.000Z', 'syncLastSeen() reads through the bridge');
  s.ok(api.enabled === true, 'backgroundSyncEnabled() reads through the bridge');
  s.ok(api.exempt === false, 'batteryExempt() reports the real (false) value, not a default true');
  s.ok(api.status && api.status.runs === 7, 'syncStatus() parses the JSON from Java');
  s.ok(api.status && api.status.posted === 2, 'syncStatus() carries the posted count');

  // Java returns "" for a null String. It must become null, not "".
  const emptyIsNull = await page.evaluate(async () => {
    const n = await import('/js/core/native_sm.js');
    const real = window.AndroidSync.lastSeen;
    window.AndroidSync.lastSeen = () => '';
    const v = n.syncLastSeen();
    window.AndroidSync.lastSeen = real;
    return v;
  });
  s.eq(emptyIsNull, null, 'empty string from Java becomes null, not ""');

  // setLastSeen must reach Java, not only localStorage.
  const wrote = await page.evaluate(async () => {
    const n = await import('/js/core/native_sm.js');
    window.__syncCalls.length = 0;
    const ok = n.setSyncLastSeen('2026-07-29T12:00:00.000Z');
    return { ok, calls: window.__syncCalls.slice(), now: window.AndroidSync.lastSeen() };
  });
  s.ok(wrote.ok, 'setSyncLastSeen() returns true when the bridge took it');
  s.ok(wrote.calls.some(c => c[0] === 'setLastSeen' && c[1] === '2026-07-29T12:00:00.000Z'),
       'setLastSeen reached Java with the exact ISO string');
  s.eq(wrote.now, '2026-07-29T12:00:00.000Z', 'the bridge now holds the new marker');

  // A falsy value must not be forwarded.
  const noEmpty = await page.evaluate(async () => {
    const n = await import('/js/core/native_sm.js');
    window.__syncCalls.length = 0;
    n.setSyncLastSeen('');
    n.setSyncLastSeen(null);
    return window.__syncCalls.length;
  });
  s.eq(noEmpty, 0, 'empty/null markers are never sent to Java');

  await app.close();
}

/* ==================================================================
   2. NO DUPLICATES — notify_sm reads the shared marker
   This is the whole reason SyncPrefs exists.
   ================================================================== */
{
  const app = await openApp({ width: 412, height: 915 });
  const { page } = app;

  await page.evaluateOnNewDocument(fakeBridge(), {
    // Pretend the service ran while the app was closed and already
    // announced everything up to 23:00.
    lastSeen: '2026-07-28T23:00:00.000Z', enabled: true, exempt: true
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1200));

  const seen = await page.evaluate(async () => {
    const n = await import('/js/core/native_sm.js');
    // The page's own localStorage is deliberately STALE: this is exactly
    // the state after the service posted while the app was closed.
    localStorage.setItem('koliya.notify.lastSeen', JSON.stringify('2026-07-01T00:00:00.000Z'));
    return n.syncLastSeen();
  });
  s.eq(seen, '2026-07-28T23:00:00.000Z',
       'bridge marker wins over the stale localStorage copy');

  const chosen = await page.evaluate(async () => {
    const n = await import('/js/core/native_sm.js');
    const bridgeVal = n.syncLastSeen();
    let local = null;
    try { local = JSON.parse(localStorage.getItem('koliya.notify.lastSeen')); } catch {}
    return { bridgeVal, local, newer: bridgeVal > local };
  });
  s.ok(chosen.newer,
       'the marker actually used is the newer of the two, so nothing replays');

  await app.close();
}

/* ==================================================================
   3. WEB BUILD — no bridge, nothing breaks
   ================================================================== */
{
  const app = await openApp({ width: 1280, height: 860 });
  const { page, errors } = app;

  const web = await page.evaluate(async () => {
    const n = await import('/js/core/native_sm.js');
    return {
      isNative: n.isNative(),
      has: n.hasBackgroundSync(),
      lastSeen: n.syncLastSeen(),
      enabled: n.backgroundSyncEnabled(),
      exempt: n.batteryExempt(),
      status: n.syncStatus(),
      setOk: n.setSyncLastSeen('2026-07-29T00:00:00.000Z'),
      reqOk: n.requestBatteryExempt(),
      syncOk: n.syncNow(),
      hasSyncGlobal: typeof window.AndroidSync
    };
  });

  s.eq(web.hasSyncGlobal, 'undefined', 'no AndroidSync in a plain browser');
  s.ok(web.isNative === false, 'isNative() false on the web');
  s.ok(web.has === false, 'hasBackgroundSync() false on the web');
  s.eq(web.lastSeen, null, 'syncLastSeen() null on the web, so the page uses its own store');
  s.ok(web.enabled === false, 'backgroundSyncEnabled() false on the web');
  s.ok(web.exempt === true, 'batteryExempt() true on the web — nothing to warn about');
  s.eq(web.status, null, 'syncStatus() null on the web');
  s.ok(web.setOk === false, 'setSyncLastSeen() reports false so the caller keeps its own copy');
  s.ok(web.reqOk === false, 'requestBatteryExempt() is a safe no-op');
  s.ok(web.syncOk === false, 'syncNow() is a safe no-op');
  s.eq(errors.length, 0, 'no page errors from the absent bridge: ' + errors.join(' | '));

  const notifyOk = await page.evaluate(async () => {
    const m = await import('/js/core/notify_sm.js');
    return typeof m.startWatching === 'function' && typeof m.notify === 'function';
  });
  s.ok(notifyOk, 'notify_sm still exports its API with no bridge');

  await app.close();
}

/* ==================================================================
   4. THE SETTINGS CARD
   ================================================================== */
{
  // 4a. absent on the web
  {
    const app = await openApp({ width: 1280, height: 860 });
    await app.page.evaluate(() => { location.hash = '#/settings'; });
    await new Promise(r => setTimeout(r, 1200));
    const present = await app.page.evaluate(() => !!document.querySelector('#bgSec'));
    s.ok(!present, 'background card is NOT rendered on the web');
    await app.close();
  }

  // 4b. present in the APK, with the battery warning while not exempt
  {
    const app = await openApp({ width: 412, height: 915 });
    await app.page.evaluateOnNewDocument(fakeBridge(), {
      lastSeen: '2026-07-28T23:00:00.000Z', enabled: true, exempt: false
    });
    await app.page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 900));
    await app.page.evaluate(() => { location.hash = '#/settings'; });
    await new Promise(r => setTimeout(r, 1400));

    const card = await app.page.evaluate(() => {
      const sec = document.querySelector('#bgSec');
      if (!sec) return null;
      const r = sec.getBoundingClientRect().toJSON();
      return {
        toggleOn: !!sec.querySelector('#bgToggle')?.classList.contains('on'),
        hasWarn: !!sec.querySelector('.set-warn'),
        hasBatteryBtn: !!sec.querySelector('#bgBattery'),
        hasTest: !!sec.querySelector('#bgTest'),
        statusText: sec.querySelector('#bgStatus')?.textContent.trim() || '',
        right: r.right, left: r.left,
        rawKeys: /\bbg\.[a-zA-Z]+/.test(sec.textContent)
      };
    });

    s.ok(card, 'background card IS rendered in the APK');
    s.ok(card && card.toggleOn, 'toggle reflects enabled=true from Java');
    s.ok(card && card.hasWarn, 'battery warning shown while not exempt');
    s.ok(card && card.hasBatteryBtn, 'the "allow background" button is offered');
    s.ok(card && card.hasTest, 'the "check now" button exists');
    s.ok(card && /7/.test(card.statusText), 'status line shows the real run count from Java');
    s.ok(card && !card.rawKeys, 'no untranslated bg.* keys leaked into the UI');
    s.ok(card && card.left >= 0 && card.right <= 412 + 1,
         `card fits inside 412px (left ${card && card.left}, right ${card && card.right})`);

    const poked = await app.page.evaluate(() => {
      window.__syncCalls.length = 0;
      document.querySelector('#bgTest')?.click();
      return window.__syncCalls.slice();
    });
    s.ok(poked.some(c => c[0] === 'pollNow'), 'Check-now button calls AndroidSync.pollNow()');

    await app.close();
  }

  // 4c. exempt → no warning
  {
    const app = await openApp({ width: 412, height: 915 });
    await app.page.evaluateOnNewDocument(fakeBridge(), {
      lastSeen: '', enabled: true, exempt: true
    });
    await app.page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 900));
    await app.page.evaluate(() => { location.hash = '#/settings'; });
    await new Promise(r => setTimeout(r, 1400));

    const r = await app.page.evaluate(() => {
      const sec = document.querySelector('#bgSec');
      return sec ? {
        warn: !!sec.querySelector('.set-warn'),
        never: sec.querySelector('#bgStatus')?.textContent || ''
      } : null;
    });
    s.ok(r && !r.warn, 'no battery warning once the exemption is granted');
    s.ok(r && r.never.length > 0, 'status line still rendered when exempt');

    await app.close();
  }

  // 4d. disabled → toggle off, no status block
  {
    const app = await openApp({ width: 412, height: 915 });
    await app.page.evaluateOnNewDocument(fakeBridge(), {
      lastSeen: '', enabled: false, exempt: true
    });
    await app.page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 900));
    await app.page.evaluate(() => { location.hash = '#/settings'; });
    await new Promise(r => setTimeout(r, 1400));

    const off = await app.page.evaluate(() => {
      const sec = document.querySelector('#bgSec');
      return sec ? {
        on: sec.querySelector('#bgToggle')?.classList.contains('on'),
        status: !!sec.querySelector('#bgStatus'),
        aria: sec.querySelector('#bgToggle')?.getAttribute('aria-checked')
      } : null;
    });
    s.ok(off && off.on === false, 'toggle is off when Java says disabled');
    s.ok(off && off.status === false, 'no status readout while disabled');
    s.eq(off && off.aria, 'false', 'aria-checked matches the visual state');

    const turned = await app.page.evaluate(() => {
      window.__syncCalls.length = 0;
      document.querySelector('#bgToggle')?.click();
      return window.__syncCalls.slice();
    });
    s.ok(turned.some(c => c[0] === 'setEnabled' && c[1] === true),
         'toggling on calls AndroidSync.setEnabled(true)');

    await app.close();
  }
}

/* ==================================================================
   5. ARABIC — the card is translated and RTL
   ================================================================== */
{
  const app = await openApp({ width: 412, height: 915 });
  await app.page.evaluateOnNewDocument(fakeBridge(), {
    lastSeen: '2026-07-28T23:00:00.000Z', enabled: true, exempt: false
  });
  await app.page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 900));

  // setLang() at runtime, not the harness `lang` option: that option
  // writes localStorage['koliya.locale'], but store_sm.js reads
  // 'pref:locale'. It has silently never worked — the page stayed
  // English and the assertion would have passed against the wrong
  // language.
  await app.page.evaluate(async () => {
    const i = await import('/js/core/i18n_sm.js');
    i.setLang('ar');
  });
  await app.page.evaluate(() => { location.hash = '#/settings'; });
  await new Promise(r => setTimeout(r, 1400));

  const ar = await app.page.evaluate(() => {
    const sec = document.querySelector('#bgSec');
    if (!sec) return null;
    const st = sec.querySelector('#bgStatus');
    return {
      dir: document.documentElement.dir,
      arabic: /[\u0600-\u06FF]/.test(sec.textContent),
      latin: /[A-Za-z]{4,}/.test(sec.querySelector('.set-title')?.textContent || ''),
      isolated: st ? getComputedStyle(st).unicodeBidi : ''
    };
  });

  s.ok(ar, 'card renders in Arabic');
  s.eq(ar && ar.dir, 'rtl', 'document is RTL');
  s.ok(ar && ar.arabic, 'card text is Arabic, not the English fallback');
  s.ok(ar && !ar.latin, 'the card title has no leftover Latin text');
  s.eq(ar && ar.isolated, 'isolate',
       'status line is bidi-isolated so codes and numbers stay put');

  await app.close();
}

process.exit(s.done() ? 0 : 1);
