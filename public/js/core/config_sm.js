/**
 * KOLIYA — config_sm.js
 * ============================================================
 * PUBLIC configuration only.
 *
 * Everything here ships to the browser and is readable via View
 * Source. That is expected: these URLs are designed to be public.
 * The real protection is db/02_policies.sql — the RLS rules Postgres
 * enforces no matter what the browser sends.
 *
 * NEVER put here: R2 secret/access keys, database passwords, any
 * service-role key. Those go in `wrangler secret put`.
 * ============================================================
 */

export const CONFIG = {

  /* ---- Neon Data API --------------------------------------------
     Neon Console → your project → Data API → "Data API URL"
     Form: https://<project-id>.data-api.neon.tech                */
  DATA_API_URL: 'https://ep-lively-bread-as1ap5ab.apirest.c-4.eu-central-1.aws.neon.tech/neondb/rest/v1',

  /* ---- Neon Auth (Managed Better Auth) --------------------------
     Neon Console → Project → Branch → Auth → "Auth Base URL"
     Form: https://<project-id>.auth.neon.tech
     There is no separate publishable key: the base URL is all the
     browser client needs.                                         */
  AUTH_URL: 'https://ep-lively-bread-as1ap5ab.neonauth.c-4.eu-central-1.aws.neon.tech/neondb/auth',

  /* ---- Cloudflare R2 --------------------------------------------
     Only the PUBLIC bucket URL. Signing keys live in the worker.
     Form: https://pub-xxxxxxxxxxxx.r2.dev                          */
  R2_PUBLIC_URL: '__R2_PUBLIC_URL__',

  /* ---- Upload worker ---------------------------------------------
     The *.workers.dev URL printed by `wrangler deploy`.            */
  UPLOAD_URL: '__UPLOAD_WORKER_URL__',

  /* ---- GIF provider -----------------------------------------------
     Tenor and Giphy both issue browser-safe keys restricted by
     referrer. Leave the placeholder to keep the built-in tiles.    */
  GIF_PROVIDER: 'tenor',            // 'tenor' | 'giphy' | ''
  GIF_KEY:      '__GIF_KEY__',

  /* ---- Media limits — must match server/upload-worker.js -------- */
  LIMITS: {
    avatar: 2  * 1024 * 1024,
    banner: 3  * 1024 * 1024,
    post:   10 * 1024 * 1024,
    story:  15 * 1024 * 1024,
    video:  30 * 1024 * 1024,
    audio:  5  * 1024 * 1024,
    file:   15 * 1024 * 1024
  },
  VIDEO_MAX_SECONDS: 60,

  IMAGE:  { maxDimension: 1080, quality: 0.72 },
  AVATAR: { maxDimension: 400,  quality: 0.80 },

  /* ---- Polling ----------------------------------------------------
     Neon has no realtime channel, so we poll — adaptively, and never
     while the tab is hidden.                                        */
  POLL: { active: 4000, idle: 20000, background: 60000 }
};

/**
 * JWKS endpoint, derived from the auth URL.
 * Verified against a live Neon project: the path is
 * /.well-known/jwks.json — not /jwks or /api/auth/jwks.
 */
export const jwksUrl = () =>
  CONFIG.AUTH_URL.startsWith('__') ? '' : `${CONFIG.AUTH_URL}/.well-known/jwks.json`;

/** True once every placeholder has been replaced. */
export const isConfigured = () => missingConfig().length === 0;

/** Which values are still placeholders. Logged on boot. */
export function missingConfig() {
  return Object.entries(CONFIG)
    .filter(([, v]) => typeof v === 'string' && v.startsWith('__'))
    .map(([k]) => k);
}

/** Media features need R2; data features need the Data API. */
export const canUseMedia = () =>
  !CONFIG.R2_PUBLIC_URL.startsWith('__') && !CONFIG.UPLOAD_URL.startsWith('__');
export const canUseDatabase = () =>
  !CONFIG.DATA_API_URL.startsWith('__') && !CONFIG.AUTH_URL.startsWith('__');
