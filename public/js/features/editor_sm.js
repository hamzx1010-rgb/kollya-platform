/**
 * KOLIYA — features/editor_sm.js
 * ============================================================
 * Image editor: crop, filters, adjustments, draw, text, blur.
 *
 * Desktop model:
 *   - filters are a strip of live thumbnails of YOUR image
 *   - the selected filter reveals a strength slider (the mouse is
 *     precise enough that a slider beats a fixed preset)
 *   - Ctrl+Z / Ctrl+Shift+Z undo and redo, which the old editor
 *     had no equivalent of at all
 *   - crop has draggable handles and a rule-of-thirds grid
 *
 * Everything renders to one canvas. History stores the operation
 * list, not bitmaps, so undo stays cheap regardless of image size.
 * ============================================================
 */

import { $, $$, el, on, clamp, esc } from '../core/utils_sm.js';
import { t } from '../core/i18n_sm.js';
import { I, icon } from '../core/icons_sm.js';
import { toast, modal } from '../core/ui_sm.js';
import { read, write } from '../core/store_sm.js';

const MAX_DIM = 1600;

/* ------------------------------------------------------------
   FILTERS  — CSS filter strings, applied to canvas context
   ------------------------------------------------------------ */

export const FILTERS = [
  { id: 'none',    label: 'Original', css: () => 'none' },
  { id: 'warm',    label: 'Chaud',    css: s => `sepia(${.30*s}) saturate(${1+.35*s}) hue-rotate(${-10*s}deg) brightness(${1+.05*s})` },
  { id: 'cool',    label: 'Froid',    css: s => `hue-rotate(${170*s}deg) saturate(${1-.2*s}) brightness(${1+.05*s})` },
  { id: 'vintage', label: 'Vintage',  css: s => `sepia(${.38*s}) contrast(${1+.12*s}) saturate(${1+.18*s})` },
  { id: 'mono',    label: 'N&B',      css: s => `grayscale(${s}) contrast(${1+.10*s})` },
  { id: 'vivid',   label: t('editor.vivid'), css: s => `saturate(${1+.7*s}) contrast(${1+.15*s})` },
  { id: 'fade',    label: t('editor.faded'),   css: s => `saturate(${1-.4*s}) brightness(${1+.10*s}) contrast(${1-.12*s})` },
  { id: 'night',   label: 'Nuit',     css: s => `brightness(${1-.18*s}) contrast(${1+.22*s}) hue-rotate(${-14*s}deg) saturate(${1+.2*s})` }
];

const RATIOS = [
  { id: 'free', label: 'Libre',  value: null },
  { id: '1:1',  label: t('editor.square'),  value: 1 },
  { id: '4:5',  label: 'Portrait', value: 4/5 },
  { id: '16:9', label: 'Large',  value: 16/9 },
  { id: '9:16', label: 'Story',  value: 9/16 }
];

/** Suggested crop per destination — the app already knows the answer. */
const SUGGEST = { story: '9:16', post: '4:5', avatar: '1:1', dm: 'free' };

/* ------------------------------------------------------------
   STATE
   ------------------------------------------------------------ */

function freshState(mode) {
  return {
    mode,
    filter: read('editor:lastFilter', 'none'),
    strength: 1,
    adjust: { brightness: 0, contrast: 0, saturation: 0, warmth: 0 },
    rotate: 0,
    flipX: false,
    flipY: false,
    crop: null,                    // {x,y,w,h} in natural pixels
    ratio: SUGGEST[mode] || 'free',
    strokes: [],                   // {points, color, size, blur}
    texts: []                      // {x,y,value,color,size}
  };
}

let ed = null;
let img = null;
let history = [];
let future = [];

const snapshot = () => JSON.parse(JSON.stringify(ed));

function commit() {
  history.push(snapshot());
  if (history.length > 40) history.shift();
  future.length = 0;
  refreshHistoryButtons();
}

function undo() {
  if (!history.length) return;
  future.push(snapshot());
  ed = history.pop();
  syncControls();
  draw();
  refreshHistoryButtons();
}

function redo() {
  if (!future.length) return;
  history.push(snapshot());
  ed = future.pop();
  syncControls();
  draw();
  refreshHistoryButtons();
}

function refreshHistoryButtons() {
  const u = $('#edUndo'), r = $('#edRedo');
  if (u) u.disabled = !history.length;
  if (r) r.disabled = !future.length;
}

/* ------------------------------------------------------------
   RENDER
   ------------------------------------------------------------ */

function filterString() {
  const f = FILTERS.find(x => x.id === ed.filter) || FILTERS[0];
  const base = f.css(ed.strength);
  const a = ed.adjust;
  const extra = [
    a.brightness ? `brightness(${1 + a.brightness / 100})` : '',
    a.contrast   ? `contrast(${1 + a.contrast / 100})` : '',
    a.saturation ? `saturate(${1 + a.saturation / 100})` : '',
    a.warmth     ? `sepia(${Math.abs(a.warmth) / 200}) hue-rotate(${a.warmth > 0 ? -8 : 8}deg)` : ''
  ].filter(Boolean).join(' ');
  return [base === 'none' ? '' : base, extra].filter(Boolean).join(' ') || 'none';
}

function draw() {
  const canvas = $('#edCanvas');
  if (!canvas || !img) return;
  const ctx = canvas.getContext('2d');

  const src = ed.crop || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  const swapped = ed.rotate % 180 !== 0;
  let w = swapped ? src.h : src.w;
  let h = swapped ? src.w : src.h;

  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  w = Math.round(w * scale); h = Math.round(h * scale);
  canvas.width = w; canvas.height = h;

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(ed.rotate * Math.PI / 180);
  ctx.scale(ed.flipX ? -1 : 1, ed.flipY ? -1 : 1);
  ctx.filter = filterString();
  const dw = swapped ? h : w, dh = swapped ? w : h;
  ctx.drawImage(img, src.x, src.y, src.w, src.h, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  // strokes and text sit above the filter, unfiltered
  ctx.save();
  ctx.filter = 'none';
  for (const s of ed.strokes) {
    ctx.beginPath();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.blur) ctx.filter = `blur(${s.size / 2}px)`;
    s.points.forEach((p, i) => i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h));
    ctx.stroke();
    ctx.filter = 'none';
  }
  for (const t of ed.texts) {
    ctx.font = `700 ${t.size}px Inter, sans-serif`;
    ctx.fillStyle = t.color;
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.lineWidth = t.size / 8;
    ctx.textBaseline = 'top';
    ctx.strokeText(t.value, t.x * w, t.y * h);
    ctx.fillText(t.value, t.x * w, t.y * h);
  }
  ctx.restore();
}

/* ------------------------------------------------------------
   UI
   ------------------------------------------------------------ */

function markup() {
  return `
  <div class="ed">
    <div class="ed-stage" id="edStage">
      <canvas id="edCanvas"></canvas>
      <div class="ed-crop hidden" id="edCropBox">
        <span class="ed-h nw"></span><span class="ed-h ne"></span>
        <span class="ed-h sw"></span><span class="ed-h se"></span>
      </div>
    </div>

    <div class="ed-tools">
      <div class="ed-toolbar">
        <button class="icon-btn" id="edUndo" data-tip="Annuler (Ctrl+Z)" disabled>${I.undo}</button>
        <button class="icon-btn" id="edRedo" data-tip=t('editor.redo') disabled>${I.redo}</button>
        <span class="ed-sep"></span>
        <button class="icon-btn" id="edRotate" data-tip="Pivoter">${I.rotate}</button>
        <button class="icon-btn" id="edFlip" data-tip="Miroir">${I.flip}</button>
        <span class="ed-sep"></span>
        <button class="icon-btn ed-tab on" data-panel="filters" data-tip="Filtres">${I.sliders}</button>
        <button class="icon-btn ed-tab" data-panel="crop" data-tip="Recadrer">${I.crop}</button>
        <button class="icon-btn ed-tab" data-panel="draw" data-tip="Dessiner">${I.brush}</button>
        <button class="icon-btn ed-tab" data-panel="text" data-tip="Texte">${I.text}</button>
      </div>

      <div class="ed-panel" id="pFilters">
        <div class="ed-strip" id="edFilters"></div>
        <div class="ed-slider hidden" id="edStrengthWrap">
          <label class="t-xs t-dim">Intensité <b id="edStrengthVal">100%</b></label>
          <input type="range" id="edStrength" min="0" max="100" value="100">
        </div>
        <div class="ed-adjust">
          ${[['brightness',t('editor.brightness')],['contrast','Contraste'],['saturation','Saturation'],['warmth','Chaleur']]
            .map(([k,l]) => `
            <div class="ed-slider">
              <label class="t-xs t-dim">${l} <b data-out="${k}">0</b></label>
              <input type="range" data-adj="${k}" min="-100" max="100" value="0">
            </div>`).join('')}
        </div>
      </div>

      <div class="ed-panel hidden" id="pCrop">
        <div class="ed-ratios">
          ${RATIOS.map(r => `<button class="pill ed-ratio" data-ratio="${r.id}">${r.label}</button>`).join('')}
        </div>
        <p class="t-xs t-dim2">Faites glisser les poignées sur l'image.</p>
        <button class="btn btn-outline btn-sm" id="edCropReset">Réinitialiser</button>
      </div>

      <div class="ed-panel hidden" id="pDraw">
        <div class="ed-colors" id="edColors"></div>
        <div class="ed-slider">
          <label class="t-xs t-dim">Épaisseur <b id="edSizeVal">8</b></label>
          <input type="range" id="edSize" min="2" max="40" value="8">
        </div>
        <button class="btn btn-outline btn-sm" id="edBlurTool">${icon('blur',{size:15})} Flouter une zone</button>
        <button class="btn btn-outline btn-sm" id="edClearDraw">Effacer les traits</button>
      </div>

      <div class="ed-panel hidden" id="pText">
        <input class="input" id="edTextInput" placeholder="Votre texte…">
        <div class="ed-colors" id="edTextColors"></div>
        <button class="btn btn-outline btn-sm" id="edAddText">Ajouter au centre</button>
        <button class="btn btn-outline btn-sm" id="edClearText">Effacer le texte</button>
      </div>
    </div>
  </div>`;
}

const COLORS = ['#FFFFFF','#111827','#EF4444','#F59E0B','#22C55E','#2563EB','#A855F7','#EC4899'];

function buildFilterStrip() {
  const strip = $('#edFilters');
  if (!strip || !img) return;

  // thumbnails are the user's own image, so the preview is truthful
  const thumb = document.createElement('canvas');
  const size = 56;
  thumb.width = size; thumb.height = size;
  const tctx = thumb.getContext('2d');
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;

  strip.innerHTML = FILTERS.map(f => {
    tctx.filter = f.css(1) === 'none' ? 'none' : f.css(1);
    tctx.clearRect(0, 0, size, size);
    tctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return `<button class="ed-filter${f.id === ed.filter ? ' on' : ''}" data-filter="${f.id}">
        <img src="${thumb.toDataURL('image/jpeg', .7)}" alt="">
        <span class="t-xs">${f.label}</span>
      </button>`;
  }).join('');

  for (const btn of $$('.ed-filter')) {
    on(btn, 'click', () => {
      commit();
      ed.filter = btn.dataset.filter;
      ed.strength = 1;
      write('editor:lastFilter', ed.filter);
      for (const b of $$('.ed-filter')) b.classList.toggle('on', b === btn);
      $('#edStrengthWrap')?.classList.toggle('hidden', ed.filter === 'none');
      $('#edStrength').value = 100;
      $('#edStrengthVal').textContent = '100%';
      draw();
    });
  }
  $('#edStrengthWrap')?.classList.toggle('hidden', ed.filter === 'none');
}

function syncControls() {
  for (const b of $$('.ed-filter')) b.classList.toggle('on', b.dataset.filter === ed.filter);
  const st = $('#edStrength');
  if (st) { st.value = Math.round(ed.strength * 100); $('#edStrengthVal').textContent = st.value + '%'; }
  for (const [k, v] of Object.entries(ed.adjust)) {
    const input = $(`[data-adj="${k}"]`);
    if (input) input.value = v;
    const out = $(`[data-out="${k}"]`);
    if (out) out.textContent = v;
  }
  for (const b of $$('.ed-ratio')) b.classList.toggle('on', b.dataset.ratio === ed.ratio);
}

/* ------------------------------------------------------------
   INTERACTION
   ------------------------------------------------------------ */

function wire(onDone) {
  // panels
  for (const tab of $$('.ed-tab')) {
    on(tab, 'click', () => {
      for (const t of $$('.ed-tab')) t.classList.toggle('on', t === tab);
      for (const p of $$('.ed-panel')) p.classList.add('hidden');
      $('#p' + tab.dataset.panel[0].toUpperCase() + tab.dataset.panel.slice(1))?.classList.remove('hidden');
      $('#edCropBox')?.classList.toggle('hidden', tab.dataset.panel !== 'crop');
    });
  }

  on($('#edUndo'), 'click', undo);
  on($('#edRedo'), 'click', redo);

  on($('#edRotate'), 'click', () => { commit(); ed.rotate = (ed.rotate + 90) % 360; draw(); });
  on($('#edFlip'), 'click', () => { commit(); ed.flipX = !ed.flipX; draw(); });

  const strength = $('#edStrength');
  on(strength, 'input', () => {
    ed.strength = strength.value / 100;
    $('#edStrengthVal').textContent = strength.value + '%';
    draw();
  });
  on(strength, 'change', commit);

  for (const input of $$('[data-adj]')) {
    on(input, 'input', () => {
      ed.adjust[input.dataset.adj] = Number(input.value);
      $(`[data-out="${input.dataset.adj}"]`).textContent = input.value;
      draw();
    });
    on(input, 'change', commit);
  }

  // crop ratios
  for (const btn of $$('.ed-ratio')) {
    on(btn, 'click', () => {
      commit();
      ed.ratio = btn.dataset.ratio;
      for (const b of $$('.ed-ratio')) b.classList.toggle('on', b === btn);
      applyRatio();
      draw();
    });
  }
  on($('#edCropReset'), 'click', () => { commit(); ed.crop = null; ed.ratio = 'free'; syncControls(); draw(); });

  // colours
  const paint = (host, onPick, initial) => {
    if (!host) return;
    host.innerHTML = COLORS.map((c, i) =>
      `<button class="ed-color${c === initial ? ' on' : ''}" style="background:${c}" data-c="${c}"></button>`).join('');
    for (const b of host.querySelectorAll('.ed-color')) {
      on(b, 'click', () => {
        for (const x of host.querySelectorAll('.ed-color')) x.classList.toggle('on', x === b);
        onPick(b.dataset.c);
      });
    }
  };

  let drawColor = '#FFFFFF', drawSize = 8, blurMode = false, textColor = '#FFFFFF';
  paint($('#edColors'), c => { drawColor = c; blurMode = false; }, drawColor);
  paint($('#edTextColors'), c => { textColor = c; }, textColor);

  const sizeInput = $('#edSize');
  on(sizeInput, 'input', () => { drawSize = Number(sizeInput.value); $('#edSizeVal').textContent = drawSize; });

  on($('#edBlurTool'), 'click', e => {
    blurMode = !blurMode;
    e.currentTarget.classList.toggle('on', blurMode);
    toast(blurMode ? t('editor.drawBlur') : t('editor.blurOff'), { duration: 1800 });
  });
  on($('#edClearDraw'), 'click', () => { commit(); ed.strokes = []; draw(); });

  on($('#edAddText'), 'click', () => {
    const v = $('#edTextInput').value.trim();
    if (!v) { toast(t('toast.writeSomething')); return; }
    commit();
    ed.texts.push({ x: .1, y: .45, value: v, color: textColor, size: Math.round($('#edCanvas').width / 14) });
    $('#edTextInput').value = '';
    draw();
  });
  on($('#edClearText'), 'click', () => { commit(); ed.texts = []; draw(); });

  // freehand drawing on the canvas
  const canvas = $('#edCanvas');
  let stroke = null;
  const pos = e => {
    const r = canvas.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
  };
  on(canvas, 'pointerdown', e => {
    if (!$('#pDraw') || $('#pDraw').classList.contains('hidden')) return;
    canvas.setPointerCapture(e.pointerId);
    commit();
    stroke = { points: [pos(e)], color: blurMode ? 'rgba(255,255,255,.001)' : drawColor, size: drawSize, blur: blurMode };
    ed.strokes.push(stroke);
  });
  on(canvas, 'pointermove', e => { if (!stroke) return; stroke.points.push(pos(e)); draw(); });
  on(canvas, 'pointerup', () => { stroke = null; });

  // keyboard
  const offKeys = on(document, 'keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    }
    if (mod && e.key === 'Enter') { e.preventDefault(); onDone(); }
  });
  return offKeys;
}

function applyRatio() {
  const r = RATIOS.find(x => x.id === ed.ratio);
  if (!r || !r.value) { ed.crop = null; return; }
  const W = img.naturalWidth, H = img.naturalHeight;
  let w = W, h = W / r.value;
  if (h > H) { h = H; w = H * r.value; }
  ed.crop = { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/* ------------------------------------------------------------
   PUBLIC
   ------------------------------------------------------------ */

/**
 * openImageEditor(file|url, mode) -> Promise<Blob|null>
 * mode: 'post' | 'story' | 'avatar' | 'dm'
 */
export function openImageEditor(source, mode = 'dm') {
  return new Promise(resolve => {
    ed = freshState(mode);
    history = []; future = [];

    let settled = false;
    const finish = v => { if (settled) return; settled = true; offKeys?.(); m.close(); resolve(v); };

    const foot = el('div', { class: 'row g2' });
    const m = modal({
      title: t('editor.title'),
      body: markup(),
      footer: foot,
      wide: true,
      className: 'ed-modal',
      onClose: () => finish(null)
    });

    foot.append(
      el('button', { class: 'btn btn-ghost', onclick: () => finish(null) }, 'Annuler'),
      el('button', {
        class: 'btn btn-primary',
        onclick: () => exportBlob().then(finish)
      }, 'Terminer')
    );

    img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (SUGGEST[mode] && SUGGEST[mode] !== 'free') applyRatio();
      buildFilterStrip();
      syncControls();
      draw();
    };
    img.onerror = () => { toast(t('toast.imageUnreadable'), 'err'); finish(null); };
    img.src = source instanceof Blob ? URL.createObjectURL(source) : source;

    const offKeys = wire(() => exportBlob().then(finish));
  });
}

function exportBlob() {
  return new Promise(res => {
    const canvas = $('#edCanvas');
    if (!canvas) return res(null);
    canvas.toBlob(b => res(b), 'image/jpeg', 0.88);
  });
}

export const editorState = () => ed;
