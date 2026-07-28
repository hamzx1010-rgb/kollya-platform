/**
 * sound.test.mjs — does the celebration actually make a sound?
 *
 * "The function was called" is not evidence. This taps the WebAudio
 * graph itself: every OscillatorNode created is recorded with its
 * frequency and duration, so a silent bug (no nodes, zero gain, wrong
 * order) fails loudly. jsdom has no AudioContext at all, so this test
 * could not exist before today.
 */
import { openApp, suite } from './harness.mjs';

const s = suite('sound');
const wait = ms => new Promise(r => setTimeout(r, ms));

const app = await openApp({ width: 1280, height: 860 });
const { page } = app;

/** Record every oscillator + gain the app schedules. */
async function installSpy() {
  await page.evaluate(() => {
    window.__notes = [];
    window.__gains = [];
    const AC = window.AudioContext;
    const realOsc = AC.prototype.createOscillator;
    const realGain = AC.prototype.createGain;
    AC.prototype.createOscillator = function () {
      const o = realOsc.call(this);
      // Tap setValueAtTime, NOT o.frequency.value. `.value` reports the
      // CURRENT automation value, which for a note scheduled a few ms
      // in the future is still the 440 Hz default — so every note read
      // back as 440 and "is it a melody?" failed against working audio.
      // The scheduled value is the one that will actually be heard.
      const realSet = o.frequency.setValueAtTime.bind(o.frequency);
      o.frequency.setValueAtTime = (v, t) => {
        window.__notes.push({ freq: v, type: o.type, at: t });
        return realSet(v, t);
      };
      return o;
    };
    AC.prototype.createGain = function () {
      const g = realGain.call(this);
      const realRamp = g.gain.exponentialRampToValueAtTime.bind(g.gain);
      g.gain.exponentialRampToValueAtTime = (v, t) => {
        window.__gains.push(v);
        return realRamp(v, t);
      };
      return g;
    };
  });
}
await installSpy();

/* ---- 1. the module exists and is wired ---- */
const mod = await page.evaluate(async () => {
  const m = await import('/js/core/sound_sm.js');
  return { keys: Object.keys(m.default), canPlay: typeof m.canPlay };
});
s.ok(mod.keys.includes('questDone'), 'sound_sm exports questDone');
s.ok(mod.keys.includes('dayComplete'), 'sound_sm exports dayComplete');
s.eq(mod.canPlay, 'function', 'canPlay() is exported so the policy is testable');

/* ---- 2. a quest sound really schedules oscillators ---- */
const quest = await page.evaluate(async () => {
  window.__notes = [];
  const m = await import('/js/core/sound_sm.js');
  const played = m.questDone();
  await new Promise(r => setTimeout(r, 120));
  return { played, notes: window.__notes.map(n => Math.round(n.freq)), gains: window.__gains };
});
s.ok(quest.played === true, 'questDone() reports it played');
s.ok(quest.notes.length >= 3, `questDone schedules real oscillators (${quest.notes.length} notes: ${quest.notes})`);
s.ok(quest.notes.every(f => f > 100 && f < 4000), `every note is audible: ${quest.notes}`);
s.ok(new Set(quest.notes).size > 1, 'it is a melody, not one repeated pitch');
s.ok(quest.gains.some(g => g > 0.05), `gain actually ramps up (max ${Math.max(...quest.gains)})`);
s.ok(quest.gains.some(g => g < 0.001), 'gain ramps back down — no click at the end');

/* ---- 3. day-complete is a bigger sound than one quest ---- */
const day = await page.evaluate(async () => {
  window.__notes = [];
  const m = await import('/js/core/sound_sm.js');
  m.dayComplete();
  await new Promise(r => setTimeout(r, 120));
  return window.__notes.map(n => Math.round(n.freq));
});
s.ok(day.length > quest.notes.length,
  `finishing the day sounds richer than one quest (${day.length} vs ${quest.notes.length} notes)`);
s.ok(Math.max(...day) > Math.max(...quest.notes),
  'day-complete reaches a higher peak — it reads as a bigger win');

/* ---- 4. the mute policy is REAL, not decorative ---- */
const off = await page.evaluate(async () => {
  const { prefs } = await import('/js/core/store_sm.js');
  const m = await import('/js/core/sound_sm.js');
  prefs.sound = false;
  window.__notes = [];
  const played = m.questDone();
  await new Promise(r => setTimeout(r, 80));
  const n = window.__notes.length;
  prefs.sound = true;
  return { played, n };
});
s.eq(off.played, false, 'prefs.sound = false stops it returning true');
s.eq(off.n, 0, 'and schedules ZERO oscillators — actually silent, not just muted');

const hidden = await page.evaluate(async () => {
  const m = await import('/js/core/sound_sm.js');
  Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
  window.__notes = [];
  const played = m.questDone();
  await new Promise(r => setTimeout(r, 80));
  const n = window.__notes.length;
  delete document.hidden;
  return { played, n };
});
s.eq(hidden.n, 0, 'a hidden tab makes no noise');

/* ---- 5. it survives being called many times (no context leak) ---- */
const spam = await page.evaluate(async () => {
  const m = await import('/js/core/sound_sm.js');
  window.__notes = [];
  for (let i = 0; i < 30; i++) m.questDone();
  await new Promise(r => setTimeout(r, 200));
  return { notes: window.__notes.length, state: 'ok' };
});
s.ok(spam.notes >= 60, `30 rapid calls all scheduled (${spam.notes} notes), no throttling crash`);

/* ---- 6. the Settings toggle exists and flips the pref ---- */
await page.evaluate(() => { location.hash = '#/settings'; });
await wait(1200);
const settings = await page.evaluate(async () => {
  const btn = document.getElementById('soundToggle');
  if (!btn) return { found: false };
  const { prefs } = await import('/js/core/store_sm.js');
  const before = prefs.sound;
  btn.click();
  await new Promise(r => setTimeout(r, 60));
  const after = prefs.sound;
  btn.click();                       // restore
  return {
    found: true, before, after,
    role: btn.getAttribute('role'),
    labelled: !!btn.getAttribute('aria-label'),
    testBtn: !!document.getElementById('soundTest')
  };
});
s.ok(settings.found, 'Settings has a sound toggle');
s.ok(settings.before !== settings.after, 'clicking it really flips prefs.sound');
s.eq(settings.role, 'switch', 'toggle is a real ARIA switch');
s.ok(settings.labelled, 'toggle has an accessible name');
s.ok(settings.testBtn, 'there is a Play button to hear it before deciding');

/* ---- 7. finishing a quest in the app plays the sound ---- */
await page.evaluate(() => { location.hash = '#/hub'; });
await wait(1000);
const endToEnd = await page.evaluate(async () => {
  const { prefs } = await import('/js/core/store_sm.js');
  prefs.sound = true;
  window.__notes = [];
  const hub = await import('/js/features/hub_sm.js');
  hub.showAchievement({ label: 'test quest', remaining: 2, xp: 8 });
  await new Promise(r => setTimeout(r, 300));
  return {
    notes: window.__notes.length,
    card: !!document.querySelector('.ach')
  };
});
s.ok(endToEnd.card, 'the achievement card appears');
s.ok(endToEnd.notes >= 3,
  `and it is NOT silent — ${endToEnd.notes} oscillators fired with the card`);

await app.close();
process.exit(s.done() ? 0 : 1);
