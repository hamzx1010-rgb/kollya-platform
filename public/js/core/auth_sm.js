/**
 * KOLIYA — auth_sm.js
 * ============================================================
 * Neon Managed Better Auth.
 *
 * Endpoints below were probed against the live project rather than
 * copied from docs, because the paths are easy to get wrong:
 *
 *   POST  /sign-up/email        create account   (needs Origin header)
 *   POST  /sign-in/email        log in
 *   POST  /sign-out             log out
 *   GET   /get-session          current session, or null
 *   GET   /token                JWT for the Data API   (401 when logged out)
 *   GET   /.well-known/jwks.json  public keys — NOT /jwks
 *
 * Auth cookies are httpOnly and cross-origin, so every call needs
 * credentials:'include'. Forgetting that is the classic failure:
 * sign-in appears to work and the next request is anonymous.
 *
 * IDENTIFIER STRATEGY
 * -------------------
 * Students log in with their carte étudiant, not an email. Better
 * Auth only accepts an email as the credential, and the profiles
 * table is behind RLS so an anonymous visitor cannot look a card up.
 *
 * So the card becomes the email, deterministically:
 *
 *     CS-042  ->  cs-042@carte.koliya.dz
 *
 * The student never sees that address. Their real Gmail is collected
 * at sign-up and stored on the profile for contact and recovery only.
 * The mapping is pure, so login needs no database read before auth.
 * ============================================================
 */

import { CONFIG } from './config_sm.js';
import { t } from './i18n_sm.js';
import { session, me, emit, clearAll, KEYS } from './store_sm.js';

const base = () => CONFIG.AUTH_URL.replace(/\/$/, '');

/* ------------------------------------------------------------
   CARTE ÉTUDIANT
   ------------------------------------------------------------ */

/** Internal domain. Never shown to a student. */
const CARD_DOMAIN = 'carte.koliya.dz';

/**
 * Normalise a card number so "cs 042", "CS-042" and "cs–042" all
 * resolve to the same account. Students type these by hand.
 */
export function normalizeCard(card) {
  return String(card || '')
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, '-')   // unicode dashes → ascii
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '');
}

/** Deterministic: same card always yields the same login address. */
export const cardToEmail = card => `${normalizeCard(card).toLowerCase()}@${CARD_DOMAIN}`;

/** True for a plausible card: letters, digits, dashes, 3–24 chars. */
export function isValidCard(card) {
  const c = normalizeCard(card);
  return c.length >= 3 && c.length <= 24 && /^[A-Z0-9-]+$/.test(c) && /[0-9]/.test(c);
}

export const isValidEmail = e => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(e || '').trim());

/* ------------------------------------------------------------
   LOW LEVEL
   ------------------------------------------------------------ */

async function call(path, { method = 'POST', body, silent = false } = {}) {
  let res;
  try {
    res = await fetch(base() + path, {
      method,
      credentials: 'include',              // httpOnly session cookie
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new AuthError('network', t('auth.err.network'));
  }

  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { message: text }; } }

  if (!res.ok) {
    if (silent) return null;
    throw new AuthError(data?.code || String(res.status), friendly(data, res.status));
  }
  return data;
}

export class AuthError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Turn Better Auth codes into something a student can act on. */
function friendly(data, status) {
  const code = data?.code || '';
  const map = {
    INVALID_EMAIL_OR_PASSWORD: t('auth.err.badCreds'),
    USER_ALREADY_EXISTS:       t('auth.err.exists'),
    INVALID_EMAIL:             t('auth.err.badCard'),
    PASSWORD_TOO_SHORT:        t('auth.err.shortPass'),
    WEAK_PASSWORD:             'Mot de passe trop faible.',
    VALIDATION_ERROR:          'Veuillez remplir tous les champs correctement.',
    MISSING_ORIGIN:            t('auth.err.domain'),
    MISSING_OR_NULL_ORIGIN:    t('auth.err.domain'),
    INVALID_CALLBACKURL:       t('auth.err.domain'),
    INVALID_ORIGIN:            t('auth.err.domain'),
    USER_NOT_FOUND:            t('auth.err.noAccount'),
    EMAIL_AND_PASSWORD_IS_NOT_ENABLED:
      'Connexion par email désactivée. Activez-la dans Neon → Auth → Sign-in methods.',
    EMAIL_NOT_VERIFIED:        t('auth.err.verify')
  };
  if (map[code]) return map[code];
  if (status === 401) return t('auth.err.expired');
  if (status === 429) return t('auth.err.tooMany');
  return data?.message || 'Une erreur est survenue.';
}

/* ------------------------------------------------------------
   TOKEN
   The Data API wants a JWT, which is separate from the session
   cookie. It is short-lived, so we cache it and refresh early.
   ------------------------------------------------------------ */

let cached = { token: null, at: 0 };
const TOKEN_TTL = 4 * 60 * 1000;      // refresh well before expiry

export async function getToken({ force = false } = {}) {
  if (!force && cached.token && Date.now() - cached.at < TOKEN_TTL) return cached.token;

  const data = await call('/token', { method: 'GET', silent: true });
  const token = data?.token || null;

  cached = { token, at: Date.now() };
  if (token) {
    session.save({
      token,
      userId: session.userId || me.id,
      expiresAt: Date.now() + TOKEN_TTL
    });
  }
  pushTokenToNative(token);
  return token;
}

/**
 * Give the APK's background poller the token we just fetched.
 *
 * WHY THIS EXISTS — the fix for "streak notifications arrive but
 * message ones never do".
 *
 * The streak reminder is woken by WorkManager and posts locally: no
 * network, no auth, so it always worked. The message poller had to
 * authenticate itself first, and step one was reading the session
 * cookie with CookieManager.getCookie() — which returns null for an
 * httpOnly + SameSite cookie on many WebView builds. The service then
 * got NOT_SIGNED_IN and went silent, with nothing visible anywhere.
 * Same scheduler, same service; only the auth path differed.
 *
 * The page already holds a valid token here, so it simply hands it
 * over. No-op in a browser: window.AndroidSync does not exist.
 */
function pushTokenToNative(token) {
  try {
    const s = typeof window !== 'undefined' && window.AndroidSync;
    if (!s?.setToken) return;
    s.setToken(token || '', String(Date.now() + TOKEN_TTL));
  } catch { /* a bridge failure must never break signing in */ }
}

export function clearToken() {
  cached = { token: null, at: 0 };
  // Signing out has to reach the service, or it keeps polling with a
  // token for an account nobody is signed into any more.
  pushTokenToNative(null);
}

/* ------------------------------------------------------------
   PUBLIC API
   ------------------------------------------------------------ */

export async function signUp({ studentCard, username, name, email, password, faculty }) {
  const card = normalizeCard(studentCard);

  if (!isValidCard(card))
    throw new AuthError('INVALID_CARD', t('auth.err.badCard'));
  if (!username || username.trim().length < 3)
    throw new AuthError('INVALID_USERNAME', t('auth.err.shortUser'));
  if (!/^[a-zA-Z0-9._]+$/.test(username.trim()))
    throw new AuthError('INVALID_USERNAME', "Le nom d'utilisateur ne peut contenir que lettres, chiffres, point et tiret bas.");
  if (!name || name.trim().length < 2)
    throw new AuthError('INVALID_NAME', 'Veuillez saisir votre nom complet.');
  if (!isValidEmail(email))
    throw new AuthError('INVALID_EMAIL', 'Adresse email invalide.');
  if (!password || password.length < 8)
    throw new AuthError('PASSWORD_TOO_SHORT', t('auth.err.shortPass'));

  // The card is the credential; the real email lives on the profile.
  const data = await call('/sign-up/email', {
    body: { email: cardToEmail(card), password, name: name.trim() }
  });

  clearToken();
  await getToken({ force: true });

  await ensureProfile({
    card, username: username.trim().toLowerCase(),
    name: name.trim(), contactEmail: email.trim().toLowerCase(), faculty
  });

  emit('auth:signup', data?.user || null);
  return data;
}

export async function signIn({ studentCard, password }) {
  const card = normalizeCard(studentCard);

  if (!card)     throw new AuthError('VALIDATION_ERROR', t('auth.err.enterCard'));
  if (!password) throw new AuthError('VALIDATION_ERROR', 'Saisissez votre mot de passe.');

  // No callbackURL: sign-in returns JSON rather than redirecting, and an
  // untrusted origin would make the service reject the request with
  // INVALID_CALLBACKURL instead of reporting a wrong password.
  const data = await call('/sign-in/email', {
    body: { email: cardToEmail(card), password }
  });

  clearToken();
  await getToken({ force: true });
  emit('auth:signin', data?.user || null);
  return data;
}

export async function signOut() {
  try { await call('/sign-out', { body: {} }); } catch {}
  clearToken();
  session.clear();
  // keep preferences, drop everything tied to the account
  clearAll([KEYS.THEME, KEYS.LOCALE]);
  emit('auth:signout');
}

/** Current session, or null. Never throws. */
export async function getSession() {
  const data = await call('/get-session', { method: 'GET', silent: true });
  return data?.user ? data : null;
}

/** True when a valid session exists on the server, not just locally. */
export async function isAuthenticated() {
  return !!(await getSession());
}

export async function requestPasswordReset(studentCard) {
  const card = normalizeCard(studentCard);
  if (!isValidCard(card))
    throw new AuthError('INVALID_CARD', t('auth.err.badCard'));
  // Better Auth mails the address it has on file, which is the internal
  // one. Recovery therefore goes through an admin until a mail relay is
  // configured — see db/03_admin.sql.
  return call('/forget-password', { body: { email: cardToEmail(card) } });
}

/* ------------------------------------------------------------
   PROFILE BOOTSTRAP
   neon_auth."user" holds identity; `profiles` holds the app row.
   ------------------------------------------------------------ */

async function ensureProfile({ card, username, name, contactEmail, faculty }) {
  const { db } = await import('./db_sm.js');
  const uid = (await getSession())?.user?.id;
  if (!uid) return null;

  const existing = await db.select('profiles', { id: `eq.${uid}`, limit: 1 }).catch(() => []);
  if (existing?.length) return existing[0];

  const row = {
    id: uid,
    student_card: card,
    username,
    full_name: name,
    email: contactEmail,       // the student's real address, for contact
    faculty: faculty || '',
    // 'approved', not 'pending'. Reproduced in a real Postgres with
    // these migrations loaded: a pending account is refused by RLS on
    // post_likes, comments and posts, so a new student could read the
    // app but never like, comment or post — and no admin UI existed to
    // approve anyone. db/10_open_signup_sm.sql opens the INSERT policy
    // to match. If you later want a moderation queue back, change this
    // line and 10_open_signup_sm.sql together, and build the approval
    // screen first.
    status: 'approved',
    role: 'student'
  };

  try {
    const created = await db.insert('profiles', row);
    return created?.[0] || null;
  } catch (e) {
    // 23505 = unique violation: the card or username is taken
    if (/duplicate|unique|23505/i.test(e.message || '')) {
      await signOut();
      throw new AuthError('DUPLICATE', t('auth.err.taken'));
    }
    console.warn('[koliya] création du profil échouée', e.message);
    return null;
  }
}

/** Load the signed-in student's profile row into the store. */
export async function loadMyProfile() {
  const s = await getSession();
  if (!s?.user) return null;

  const { db } = await import('./db_sm.js');
  const rows = await db.select('profiles', { id: `eq.${s.user.id}`, limit: 1 }).catch(() => []);
  const profile = rows?.[0];
  if (!profile) return null;

  me.set(profile);
  session.save({ token: cached.token, userId: profile.id, expiresAt: Date.now() + TOKEN_TTL });
  return profile;
}

/* ------------------------------------------------------------
   BOOT
   ------------------------------------------------------------ */

/**
 * Resolve the auth state once at startup.
 * Returns 'authenticated' | 'pending' | 'anonymous'.
 */
export async function initAuth() {
  const s = await getSession();
  if (!s?.user) return 'anonymous';

  await getToken({ force: true });
  const profile = await loadMyProfile();

  if (!profile) return 'anonymous';
  if (profile.status === 'pending')  return 'pending';
  if (profile.status === 'rejected' || profile.status === 'banned') {
    await signOut();
    return 'anonymous';
  }
  return 'authenticated';
}
