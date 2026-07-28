/**
 * KOLIYA — sound_sm.js
 * ============================================================
 * Celebration sounds, synthesised at runtime.
 *
 * Why no mp3: a reward sound is ~30 KB of audio for 400 ms of noise,
 * it needs a licence, it fails on a slow Algerian connection, and it
 * cannot be tuned. WebAudio generates these from numbers — zero bytes
 * downloaded, zero network requests, works offline, and the melody is
 * readable in the source.
 *
 * Three rules this file obeys without being asked:
 *   1. NEVER sound on a hidden tab — you switched away, you did not
 *      ask to be startled.
 *   2. NEVER sound under prefers-reduced-motion. That setting is also
 *      used by people sensitive to sudden stimuli, not just motion.
 *   3. NEVER touch AudioContext before a user gesture. Chrome blocks
 *      autoplay and logs a warning; we resume lazily instead.
 * ============================================================
 */

import { prefs } from './store_sm.js';
import { env } from './utils_sm.js';

let ctx = null;

/** One shared context, created on first real use, never on boot. */
function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch { return null; }
  return ctx;
}

/**
 * Should we make a noise at all?
 * Exported so the tests can assert the policy without playing anything.
 */
export function canPlay() {
  if (!prefs.sound) return false;
  if (typeof document !== 'undefined' && document.hidden) return false;
  if (env.reducedMotion) return false;
  return !!(window.AudioContext || window.webkitAudioContext);
}

/**
 * One note.
 * `type` 'triangle' reads as bright and toy-like without the harshness
 * of a square wave; 'sine' is used for the soft low notes.
 */
function note(when, freq, dur, { gain = 0.16, type = 'triangle' } = {}) {
  const ac = audio();
  if (!ac) return;

  const osc = ac.createOscillator();
  const amp = ac.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);

  // A hard start/stop clicks. Ramp both ends — 12 ms attack is fast
  // enough to feel instant and slow enough to lose the click.
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.exponentialRampToValueAtTime(gain, when + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + dur);

  osc.connect(amp).connect(ac.destination);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

/** Play a sequence of [semitoneOffset, startBeat, lengthBeats]. */
function play(sequence, { root = 523.25, beat = 0.1, gain = 0.16, type = 'triangle' } = {}) {
  if (!canPlay()) return false;
  const ac = audio();
  if (!ac) return false;

  // A context created before any click starts 'suspended'.
  if (ac.state === 'suspended') ac.resume().catch(() => {});

  const t0 = ac.currentTime + 0.02;
  for (const [semi, start, len] of sequence) {
    note(t0 + start * beat, root * Math.pow(2, semi / 12), len * beat, { gain, type });
  }
  return true;
}

/* ------------------------------------------------------------
   THE SOUNDS
   Written as scale degrees so they stay in tune if root changes.
   ------------------------------------------------------------ */

/** One quest ticked off: a quick rising third. Small win, small sound. */
export const questDone = () =>
  play([[0, 0, 1], [4, 1, 1], [7, 2, 1.6]], { beat: 0.085, gain: 0.14 });

/** All quests done for the day: full major arpeggio landing on the octave. */
export const dayComplete = () =>
  play([[0, 0, 1], [4, 1, 1], [7, 2, 1], [12, 3, 2.4], [7, 3, 2.4], [16, 4.2, 2.6]],
       { beat: 0.1, gain: 0.15 });

/** Level up: same shape, higher and brighter. */
export const levelUp = () =>
  play([[0, 0, 1], [7, 1, 1], [12, 2, 1], [16, 3, 1], [19, 4, 2.8]],
       { root: 659.25, beat: 0.09, gain: 0.15 });

/** Badge earned: two confident notes, not a fanfare. */
export const badge = () =>
  play([[0, 0, 1.4], [12, 1.2, 2.2]], { root: 587.33, beat: 0.1, gain: 0.15 });

/** Streak saved by a freeze: soft and low, relief rather than triumph. */
export const streakSaved = () =>
  play([[0, 0, 1.6], [5, 1.4, 2.2]], { root: 392, beat: 0.11, gain: 0.12, type: 'sine' });

/** Used by Settings so you can hear it before deciding to keep it. */
export const preview = questDone;

export default { questDone, dayComplete, levelUp, badge, streakSaved, canPlay, preview };
