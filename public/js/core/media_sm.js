/**
 * KOLIYA — media_sm.js
 * ============================================================
 * Images go straight into Postgres.
 *
 * The original plan routed every file through Cloudflare R2. You
 * asked for the simpler shape: no external bucket, the picture lands
 * in the same row as the profile it belongs to. That is a real
 * trade-off, so it is worth naming what makes it safe here:
 *
 *   - the browser resizes and re-encodes BEFORE upload, so a 6 MB
 *     phone photo becomes a ~90 KB avatar. Nothing large ever leaves
 *     the machine.
 *   - db/05_upgrade_sm.sql adds CHECK constraints, so even a bug in
 *     this file cannot write a 40 MB row.
 *   - the columns are unchanged TEXT. A `data:` URL works in <img
 *     src> exactly like an https one, so no rendering code cares.
 *
 * If the campus ever outgrows this, swapping in R2 means changing
 * ONE function — toStorable() — and nothing else.
 * ============================================================
 */

import { CONFIG } from './config_sm.js';

/* ------------------------------------------------------------
   BUDGETS
   Bytes of stored text, matching the SQL CHECK constraints.
   base64 inflates by ~4/3, so the JPEG budget is ~73% of these.
   ------------------------------------------------------------ */

export const MEDIA_BUDGET = {
  avatar: { maxDim: 400,  quality: 0.82, maxBytes: 400_000 },
  banner: { maxDim: 1280, quality: 0.78, maxBytes: 900_000 },
  post:   { maxDim: 1280, quality: 0.76, maxBytes: 1_400_000 },
  story:  { maxDim: 1080, quality: 0.74, maxBytes: 2_000_000 },
  dm:     { maxDim: 1280, quality: 0.76, maxBytes: 1_400_000 },
  audio:  { maxBytes: 1_200_000 },
  file:   { maxBytes: 900_000 }
};

export class MediaError extends Error {}

/* ------------------------------------------------------------
   DECODE
   ------------------------------------------------------------ */

function loadBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob).catch(() => loadViaImg(blob));
  }
  return loadViaImg(blob);
}

function loadViaImg(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new MediaError('Image illisible')); };
    img.src = url;
  });
}

/* ------------------------------------------------------------
   RESIZE + ENCODE
   ------------------------------------------------------------ */

/**
 * Shrink to fit maxDim, encode as JPEG, and — if it is still over
 * budget — drop the quality step by step rather than failing. A
 * slightly softer picture beats an error message.
 */
export async function shrinkImage(blob, kind = 'post') {
  const b = MEDIA_BUDGET[kind] || MEDIA_BUDGET.post;
  const src = await loadBitmap(blob);

  const w0 = src.width  || src.naturalWidth;
  const h0 = src.height || src.naturalHeight;
  if (!w0 || !h0) throw new MediaError('Image vide');

  const scale = Math.min(1, b.maxDim / Math.max(w0, h0));
  let w = Math.max(1, Math.round(w0 * scale));
  let h = Math.max(1, Math.round(h0 * scale));

  let quality = b.quality;
  let dataUrl = '';

  for (let attempt = 0; attempt < 6; attempt++) {
    dataUrl = drawToDataUrl(src, w, h, quality);
    if (dataUrl.length <= b.maxBytes) break;

    // alternate: first lower the quality, then the dimensions
    if (attempt % 2 === 0) quality = Math.max(0.42, quality - 0.12);
    else { w = Math.round(w * 0.82); h = Math.round(h * 0.82); }
  }

  if (dataUrl.length > b.maxBytes) {
    throw new MediaError(
      `Image trop lourde même après compression (${Math.round(dataUrl.length / 1024)} Ko). ` +
      `Essayez une image plus simple.`
    );
  }

  src.close?.();
  return dataUrl;
}

function drawToDataUrl(src, w, h, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // white behind, so a transparent PNG does not turn black as JPEG
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/* ------------------------------------------------------------
   NON-IMAGE BLOBS  (voice notes, small files)
   ------------------------------------------------------------ */

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new MediaError('Lecture du fichier impossible'));
    r.readAsDataURL(blob);
  });
}

export async function packAudio(blob) {
  const b = MEDIA_BUDGET.audio;
  const url = await blobToDataUrl(blob);
  if (url.length > b.maxBytes) {
    throw new MediaError(
      `Message vocal trop long (${Math.round(url.length / 1024)} Ko). Maximum ~60 secondes.`
    );
  }
  return url;
}

export async function packFile(file) {
  const b = MEDIA_BUDGET.file;
  const url = await blobToDataUrl(file);
  if (url.length > b.maxBytes) {
    throw new MediaError(
      `Fichier trop lourd (${Math.round(url.length / 1024)} Ko). Maximum ~650 Ko.`
    );
  }
  return url;
}

/* ------------------------------------------------------------
   THE ONE SEAM
   Everything above is local. If R2 is ever configured, this is the
   only function that changes: upload, return the https URL.
   ------------------------------------------------------------ */

export async function toStorable(blobOrFile, kind = 'post') {
  if (!blobOrFile) return null;

  const isImage = (blobOrFile.type || '').startsWith('image/');
  const isAudio = (blobOrFile.type || '').startsWith('audio/');

  if (isImage) return shrinkImage(blobOrFile, kind);
  if (isAudio) return packAudio(blobOrFile);
  return packFile(blobOrFile);
}

/** True when a stored value is safe to put in <img src>. */
export const isStorableUrl = v =>
  typeof v === 'string' && /^(data:image\/|data:audio\/|data:video\/|https?:\/\/)/.test(v);

/** Rough on-disk cost, for the UI to warn before a save. */
export const approxKb = v => Math.round((typeof v === 'string' ? v.length : 0) / 1024);

export default { toStorable, shrinkImage, packAudio, packFile, MEDIA_BUDGET, isStorableUrl };
