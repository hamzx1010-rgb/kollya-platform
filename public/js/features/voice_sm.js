/**
 * KOLIYA — features/voice_sm.js
 * ============================================================
 * Voice notes: record, preview, send, play back.
 *
 * Desktop model, not phone:
 *   click to start, click to stop — no press-and-hold. Holding a
 *   mouse button for thirty seconds is unpleasant and easy to lose.
 *   You then get a preview: listen, re-record, or send.
 *
 * The waveform is measured, not decorative. During recording it comes
 * from an AnalyserNode; on playback the bars fill to mark progress and
 * clicking any bar seeks to that point.
 * ============================================================
 */

import { $, $$, el, on, duration, clamp } from '../core/utils_sm.js';
import { t } from '../core/i18n_sm.js';
import { I, icon } from '../core/icons_sm.js';
import { toast } from '../core/ui_sm.js';

const BARS = 34;
const MAX_SECONDS = 300;

/* ------------------------------------------------------------
   RECORDER
   ------------------------------------------------------------ */

let rec = null;

export function isRecording() { return !!rec; }

export async function startRecording(host, { onSend, onCancel } = {}) {
  if (rec) return;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch (e) {
    toast(e.name === 'NotAllowedError'
      ? t('voice.micDenied')
      : t('toast.micUnavailable'), 'err');
    return;
  }

  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    .find(t => MediaRecorder.isTypeSupported?.(t)) || '';

  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  const peaks = [];

  // live level metering
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);

  const ui = renderRecorderUI(host);
  const started = Date.now();
  let raf = 0, tick = 0;

  const loop = () => {
    analyser.getByteTimeDomainData(buf);
    // RMS gives a steadier bar than peak amplitude
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    const level = clamp(Math.sqrt(sum / buf.length) * 2.6, 0.04, 1);

    ui.pushLevel(level);
    if (++tick % 3 === 0) peaks.push(level);   // keep ~1 sample per 50ms

    const secs = (Date.now() - started) / 1000;
    ui.setTime(secs);
    if (secs >= MAX_SECONDS) { stop(true); return; }
    raf = requestAnimationFrame(loop);
  };

  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  recorder.onstop = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach(t => t.stop());
    ctx.close().catch(() => {});
    const secs = Math.round((Date.now() - started) / 1000);
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    rec = null;

    if (rec_cancelled || secs < 1) { ui.destroy(); onCancel?.(); return; }
    ui.destroy();
    openPreview(host, { blob, seconds: secs, waveform: normalise(peaks) }, { onSend, onCancel });
  };

  let rec_cancelled = false;
  function stop(send) { rec_cancelled = !send; recorder.state !== 'inactive' && recorder.stop(); }

  ui.onStop  = () => stop(true);
  ui.onCancel = () => stop(false);

  recorder.start(100);
  rec = { recorder, stop };
  raf = requestAnimationFrame(loop);
}

export function cancelRecording() { rec?.stop(false); }

/** Collapse an arbitrary number of samples down to BARS values, 0–1. */
function normalise(peaks) {
  if (!peaks.length) return Array.from({ length: BARS }, () => 0.3);
  const out = [];
  const step = peaks.length / BARS;
  for (let i = 0; i < BARS; i++) {
    const slice = peaks.slice(Math.floor(i * step), Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1));
    out.push(slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0.3);
  }
  const max = Math.max(...out, 0.001);
  return out.map(v => clamp(v / max, 0.12, 1));
}

/* ------------------------------------------------------------
   RECORDING UI  — replaces the composer in place
   ------------------------------------------------------------ */

function renderRecorderUI(host) {
  const bar = el('div', { class: 'rec-bar' });
  bar.innerHTML = `
    <button class="icon-btn rec-cancel" data-tip="Annuler (Échap)" aria-label="Annuler">${I.trash}</button>
    <span class="rec-dot"></span>
    <span class="rec-time t-mono">0:00</span>
    <div class="rec-wave">${`<i style="--h:8%"></i>`.repeat(BARS)}</div>
    <button class="icon-btn btn-primary rec-stop" data-tip="Terminer" aria-label="Terminer">${I.check}</button>`;

  host.classList.add('recording');
  host.append(bar);

  const bars = [...bar.querySelectorAll('.rec-wave i')];
  let write = 0;

  const api = {
    onStop: null, onCancel: null,
    pushLevel(level) {
      // scroll the bars leftwards so the newest sample is on the right
      const b = bars[write % bars.length];
      b.style.setProperty('--h', Math.round(level * 100) + '%');
      write++;
      bars.forEach((el, i) => {
        const age = (write - i - 1 + bars.length) % bars.length;
        el.style.opacity = String(clamp(1 - age / bars.length, 0.25, 1));
      });
    },
    setTime(s) { bar.querySelector('.rec-time').textContent = duration(s); },
    destroy() { host.classList.remove('recording'); bar.remove(); offEsc(); }
  };

  on(bar.querySelector('.rec-stop'), 'click', () => api.onStop?.());
  on(bar.querySelector('.rec-cancel'), 'click', () => api.onCancel?.());
  const offEsc = on(document, 'keydown', e => {
    if (e.key === 'Escape') api.onCancel?.();
    if (e.key === 'Enter')  api.onStop?.();
  });

  return api;
}

/* ------------------------------------------------------------
   PREVIEW  — listen before it leaves
   ------------------------------------------------------------ */

function openPreview(host, clip, { onSend, onCancel }) {
  const url = URL.createObjectURL(clip.blob);
  const bar = el('div', { class: 'rec-bar preview' });
  bar.innerHTML = `
    <button class="icon-btn rec-cancel" data-tip="${t('action.delete')}" aria-label="${t('action.delete')}">${I.trash}</button>
    <button class="icon-btn prev-play" aria-label="Écouter">${I.play}</button>
    <div class="voice-wave preview-wave">
      ${clip.waveform.map(h => `<i style="--h:${Math.round(h * 100)}%"></i>`).join('')}
    </div>
    <span class="voice-time t-mono">${duration(clip.seconds)}</span>
    <button class="icon-btn btn-primary prev-send" data-tip="${t('action.send')}" aria-label="${t('action.send')}">${I.send}</button>`;

  host.classList.add('recording');
  host.append(bar);

  const audio = new Audio(url);
  const playBtn = bar.querySelector('.prev-play');
  const bars = [...bar.querySelectorAll('.preview-wave i')];

  on(playBtn, 'click', () => {
    if (audio.paused) { audio.play(); playBtn.innerHTML = I.pause; }
    else { audio.pause(); playBtn.innerHTML = I.play; }
  });
  on(audio, 'timeupdate', () => {
    const p = audio.currentTime / (audio.duration || clip.seconds);
    bars.forEach((b, i) => b.classList.toggle('played', i / bars.length <= p));
  });
  on(audio, 'ended', () => {
    playBtn.innerHTML = I.play;
    bars.forEach(b => b.classList.remove('played'));
  });

  const done = () => {
    audio.pause();
    URL.revokeObjectURL(url);
    host.classList.remove('recording');
    bar.remove();
    offEsc();
  };

  on(bar.querySelector('.rec-cancel'), 'click', () => { done(); onCancel?.(); });
  on(bar.querySelector('.prev-send'), 'click', () => {
    done();
    onSend?.({ blob: clip.blob, seconds: clip.seconds, waveform: clip.waveform });
  });
  const offEsc = on(document, 'keydown', e => {
    if (e.key === 'Escape') { done(); onCancel?.(); }
    if (e.key === 'Enter')  { bar.querySelector('.prev-send').click(); }
  });
}

/* ------------------------------------------------------------
   PLAYBACK  — one player at a time, scrubbable
   ------------------------------------------------------------ */

let current = null;

export function wireVoicePlayers(root) {
  for (const node of root.querySelectorAll('.voice:not([data-wired])')) {
    node.dataset.wired = '1';
    setupPlayer(node);
  }
}

function setupPlayer(node) {
  const src = node.dataset.audio;
  const playBtn = node.querySelector('.voice-play');
  const wave = node.querySelector('.voice-wave');
  const timeEl = node.querySelector('.voice-time');
  const speedBtn = node.querySelector('.voice-speed');
  const bars = [...wave.querySelectorAll('i')];
  let audio = null, rate = 1;

  const paint = p => bars.forEach((b, i) => b.classList.toggle('played', i / bars.length <= p));

  function ensure() {
    if (audio) return audio;
    audio = new Audio(src);
    audio.playbackRate = rate;
    on(audio, 'timeupdate', () => {
      const d = audio.duration || 0;
      paint(d ? audio.currentTime / d : 0);
      if (timeEl && d) timeEl.textContent = duration(d - audio.currentTime);
    });
    on(audio, 'ended', () => { playBtn.innerHTML = I.play; paint(0); current = null; });
    return audio;
  }

  on(playBtn, 'click', e => {
    e.stopPropagation();
    const a = ensure();
    if (a.paused) {
      // starting one voice note stops any other — two talking at once
      // is never what you meant
      if (current && current !== a) { current.pause(); }
      current = a;
      a.play().catch(() => toast(t('toast.playFailed'), 'err'));
      playBtn.innerHTML = I.pause;
    } else {
      a.pause();
      playBtn.innerHTML = I.play;
    }
  });

  // click anywhere on the waveform to seek there
  on(wave, 'click', e => {
    e.stopPropagation();
    const a = ensure();
    const r = wave.getBoundingClientRect();
    const p = clamp((e.clientX - r.left) / r.width, 0, 1);
    if (a.duration) { a.currentTime = a.duration * p; paint(p); }
  });

  on(wave, 'keydown', e => {
    const a = ensure();
    if (e.key === 'ArrowRight') a.currentTime = Math.min(a.duration || 0, a.currentTime + 5);
    if (e.key === 'ArrowLeft')  a.currentTime = Math.max(0, a.currentTime - 5);
  });

  if (speedBtn) on(speedBtn, 'click', e => {
    e.stopPropagation();
    rate = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    speedBtn.textContent = rate + '×';
    if (audio) audio.playbackRate = rate;
  });
}
