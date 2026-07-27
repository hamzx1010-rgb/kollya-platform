/**
 * KOLIYA — R2 upload worker (Cloudflare Workers)
 * ------------------------------------------------------------
 * Why this exists:
 *   The browser must never hold your R2 secret key. Instead it asks
 *   this worker for a short-lived presigned URL, then uploads the file
 *   straight to R2. The file never passes through here, so the worker
 *   stays fast and free.
 *
 * Flow:
 *   1. browser  -> POST /sign   { kind, contentType, size }  + Neon JWT
 *   2. worker   -> verifies JWT, checks size/type, returns { uploadUrl, publicUrl }
 *   3. browser  -> PUT uploadUrl (the actual bytes, direct to R2)
 *   4. browser  -> stores publicUrl in Postgres
 *
 * Deploy:  npx wrangler deploy
 */

const LIMITS = {
  avatar: { max:  2 * 1024 * 1024, types: ['image/jpeg','image/png','image/webp'] },
  banner: { max:  3 * 1024 * 1024, types: ['image/jpeg','image/png','image/webp'] },
  post:   { max: 10 * 1024 * 1024, types: ['image/jpeg','image/png','image/webp','image/gif'] },
  story:  { max: 15 * 1024 * 1024, types: ['image/jpeg','image/png','image/webp','video/mp4','video/webm'] },
  // video kept at 30 MB as requested
  video:  { max: 30 * 1024 * 1024, types: ['video/mp4','video/webm','video/quicktime'] },
  audio:  { max:  5 * 1024 * 1024, types: ['audio/webm','audio/mpeg','audio/ogg','audio/mp4'] },
  file:   { max: 15 * 1024 * 1024, types: ['application/pdf','application/msword',
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'application/vnd.ms-powerpoint',
             'application/vnd.openxmlformats-officedocument.presentationml.presentation'] }
};

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}
const json = (data, status, env) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(env) }
  });

/** Verify the Neon Auth JWT and return its "sub" (the user id). */
async function verifyJWT(token, env) {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;

    const payload = JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;

    // Verify the signature against Neon Auth's JWKS.
    const jwks = await fetch(env.NEON_AUTH_JWKS_URL).then(r => r.json());
    const header = JSON.parse(atob(h.replace(/-/g,'+').replace(/_/g,'/')));
    const jwk = jwks.keys.find(k => k.kid === header.kid) || jwks.keys[0];
    if (!jwk) return null;

    // Neon signs with EdDSA / Ed25519 (verified against a live
    // project's JWKS). RSA verification would reject every token.
    const alg = jwk.alg === 'EdDSA' || jwk.kty === 'OKP'
      ? { name: 'Ed25519' }
      : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

    const key = await crypto.subtle.importKey('jwk', jwk, alg, false, ['verify']);
    const sig = Uint8Array.from(
      atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)
    );
    const ok = await crypto.subtle.verify(
      alg.name === 'Ed25519' ? 'Ed25519' : 'RSASSA-PKCS1-v1_5',
      key, sig, new TextEncoder().encode(`${h}.${p}`)
    );
    return ok ? payload.sub : null;
  } catch (e) {
    return null;
  }
}

const extFor = (ct) => ({
  'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif',
  'video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov',
  'audio/webm':'weba','audio/mpeg':'mp3','audio/ogg':'ogg','audio/mp4':'m4a',
  'application/pdf':'pdf'
}[ct] || 'bin');

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });

    const url = new URL(request.url);
    if (url.pathname !== '/sign' || request.method !== 'POST') {
      return json({ error: 'not found' }, 404, env);
    }

    // --- auth -------------------------------------------------
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return json({ error: 'missing token' }, 401, env);

    const userId = await verifyJWT(token, env);
    if (!userId) return json({ error: 'invalid token' }, 401, env);

    // --- validate --------------------------------------------
    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'bad json' }, 400, env); }

    const { kind, contentType, size } = body || {};
    const rule = LIMITS[kind];
    if (!rule) return json({ error: 'unknown kind' }, 400, env);
    if (!rule.types.includes(contentType))
      return json({ error: `type ${contentType} not allowed for ${kind}` }, 400, env);
    if (!size || size > rule.max)
      return json({ error: `max ${Math.round(rule.max/1024/1024)} MB for ${kind}` }, 400, env);

    // --- key: users cannot overwrite each other ---------------
    const key = `${kind}/${userId}/${Date.now()}-${crypto.randomUUID().slice(0,8)}.${extFor(contentType)}`;

    // --- presign (S3-compatible, SigV4) -----------------------
    const uploadUrl = await presignPut(env, key, contentType, 300);
    const publicUrl = `${env.R2_PUBLIC_URL.replace(/\/$/,'')}/${key}`;

    return json({ uploadUrl, publicUrl, key }, 200, env);
  }
};

/* ---------- AWS SigV4 presigner for R2 ---------------------- */
async function hmac(key, str) {
  const k = await crypto.subtle.importKey('raw', key, { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(str)));
}
async function sha256hex(str) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('');
}

async function presignPut(env, key, contentType, expires) {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;

  const q = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${env.R2_ACCESS_KEY_ID}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'content-type;host'
  });

  const canonicalUri = `/${env.R2_BUCKET}/${key}`.replace(/[^/]+/g, s => encodeURIComponent(s));
  const canonical = [
    'PUT',
    canonicalUri,
    q.toString(),
    `content-type:${contentType}\nhost:${host}\n`,
    'content-type;host',
    'UNSIGNED-PAYLOAD'
  ].join('\n');

  const toSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256hex(canonical)
  ].join('\n');

  let k = new TextEncoder().encode(`AWS4${env.R2_SECRET_ACCESS_KEY}`);
  for (const part of [date, 'auto', 's3', 'aws4_request']) k = await hmac(k, part);
  const sig = [...(await hmac(k, toSign))].map(x => x.toString(16).padStart(2,'0')).join('');

  return `https://${host}${canonicalUri}?${q}&X-Amz-Signature=${sig}`;
}
