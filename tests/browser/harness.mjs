/**
 * harness.mjs — boots a REAL Chrome on the REAL app.
 *
 * The app's config_sm.js hardcodes the Neon hostnames; rather than edit
 * source (which would mean the tested build isn't the shipped build),
 * Chrome's request interceptor rewrites those two hosts onto the local
 * mock. Everything above fetch() — auth_sm, db_sm, api_sm, every feature
 * module — runs exactly as deployed.
 */

import puppeteer from 'puppeteer';
import { startMockNeon } from './mock_neon.mjs';

export const NEON_DATA = 'ep-lively-bread-as1ap5ab.apirest.c-4.eu-central-1.aws.neon.tech';
export const NEON_AUTH = 'ep-lively-bread-as1ap5ab.neonauth.c-4.eu-central-1.aws.neon.tech';

export async function openApp({ width = 1280, height = 860, signedIn = true, lang = null, realGifs = false } = {}) {
  const mock = await startMockNeon({ signedIn });
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none',
           '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });

  const console_ = [];
  const errors = [];
  page.on('console', m => console_.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => errors.push(String(e)));
  page.on('requestfailed', r => {
    const u = r.url();
    if (!/giphy|tenor|google/.test(u)) errors.push('REQ FAIL ' + u + ' ' + r.failure()?.errorText);
  });

  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.hostname === NEON_DATA) {
      return req.continue({ url: mock.url + '/rest' + u.pathname.replace('/neondb/rest/v1', '') + u.search });
    }
    if (u.hostname === NEON_AUTH) {
      return req.continue({ url: mock.url + '/auth' + u.pathname.replace('/neondb/auth', '') + u.search });
    }
    if (!realGifs && /giphy\.com|tenor\.googleapis/.test(u.hostname)) {
      // Algerian networks may block these; answer with a 1×1 GIF so the
      // test measures OUR layout, not Giphy's uptime.
      return req.respond({ status: 200, contentType: 'image/gif',
        body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') });
    }
    req.continue();
  });

  if (lang) {
    await page.evaluateOnNewDocument(l => {
      try { localStorage.setItem('koliya.locale', JSON.stringify(l)); } catch {}
      try { localStorage.setItem('koliya.locale', l); } catch {}
    }, lang);
  }

  await page.goto(mock.url + '/index_sm.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('#boot') ||
    document.querySelector('#boot').classList.contains('hidden') ||
    getComputedStyle(document.querySelector('#boot')).display === 'none', { timeout: 20000 })
    .catch(() => {});
  await new Promise(r => setTimeout(r, 900));

  return { page, browser, mock, console_, errors, close: async () => { await browser.close(); await mock.close(); } };
}

/* ---- tiny assert kit, same shape as the jsdom suites ---- */
export function suite(name) {
  let pass = 0, total = 0;
  const fails = [];
  return {
    ok(cond, msg) { total++; if (cond) pass++; else fails.push(msg); },
    eq(a, b, msg) { this.ok(Object.is(a, b) || String(a) === String(b), `${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); },
    near(a, b, tol, msg) { this.ok(Math.abs(a - b) <= tol, `${msg} — got ${a}, want ${b}±${tol}`); },
    done() {
      for (const f of fails) console.log('FAIL ' + f);
      console.log(`${pass}/${total} passed`);
      return fails.length === 0;
    }
  };
}
