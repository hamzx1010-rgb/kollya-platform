/**
 * KOLIYA — features/auth_ui_sm.js
 * ============================================================
 * Sign in with carte étudiant + password.
 * Sign up with carte étudiant + username + full name + email + password.
 *
 * The card is the identifier students already carry, so it is the
 * first field and gets focus. Their Gmail is asked for once, at
 * sign-up, and is never used to log in.
 *
 * Validation runs on blur rather than on every keystroke: telling
 * someone their card is invalid while they are still typing it is
 * just noise.
 * ============================================================
 */

import { $, $$, el, on, esc } from '../core/utils_sm.js';
import { t } from '../core/i18n_sm.js';
import { I, icon } from '../core/icons_sm.js';
import { toast } from '../core/ui_sm.js';
import {
  signIn, signUp, requestPasswordReset,
  normalizeCard, isValidCard, isValidEmail, AuthError
} from '../core/auth_sm.js';

const FACULTIES = [
  'Informatique','Mathématiques','Physique','Chimie','Biologie',
  'Médecine','Pharmacie','Droit','Économie','Langues','Génie civil',
  'Électronique','Architecture','Sciences humaines','Autre'
];

let mode = 'signin';

/* ------------------------------------------------------------
   MARKUP
   ------------------------------------------------------------ */

const field = ({ id, label, type = 'text', placeholder = '', hint = '', autocomplete, maxlength }) => `
  <div class="field">
    <label class="label" for="${id}">${esc(label)}</label>
    <div class="auth-input-wrap">
      <input class="input" id="${id}" type="${type}"
             placeholder="${esc(placeholder)}"
             ${autocomplete ? `autocomplete="${autocomplete}"` : ''}
             ${maxlength ? `maxlength="${maxlength}"` : ''}
             aria-describedby="${id}-msg">
      ${type === 'password' ? `<button type="button" class="auth-eye" data-eye="${id}"
             aria-label="Afficher le mot de passe">${icon('eyeOff', { size: 17 })}</button>` : ''}
    </div>
    <div class="field-msg" id="${id}-msg">${hint ? `<span class="t-xs t-dim2">${esc(hint)}</span>` : ''}</div>
  </div>`;

function signinMarkup() {
  return `
    <form class="auth-form" id="authForm" novalidate>
      ${field({ id:'inCard', label:t('auth.card'), placeholder:'CS-042',
                hint:t('auth.cardHint'), autocomplete:'username', maxlength:24 })}
      ${field({ id:'inPass', label:t('auth.password'), type:'password',
                placeholder:'••••••••', autocomplete:'current-password' })}
      <button type="button" class="auth-link" id="forgotBtn">Mot de passe oublié ?</button>
      <button class="btn btn-primary btn-full btn-lg" id="submitBtn" type="submit">Se connecter</button>
    </form>
    <p class="auth-switch">Pas encore de compte ?
      <button class="auth-link" id="toSignup">${t('auth.createAccount')}</button></p>`;
}

function signupMarkup() {
  return `
    <form class="auth-form" id="authForm" novalidate>
      ${field({ id:'inCard', label:t('auth.cardReq'), placeholder:'CS-042',
                hint:t('auth.usernameHint'), autocomplete:'username', maxlength:24 })}
      ${field({ id:'inName', label:t('auth.fullNameReq'), placeholder:'Sara Benali', autocomplete:'name' })}
      ${field({ id:'inUser', label:"Nom d'utilisateur *", placeholder:'sara.b',
                hint:'Lettres, chiffres, point et tiret bas', autocomplete:'nickname', maxlength:24 })}
      ${field({ id:'inMail', label:'Email *', type:'email', placeholder:'sara@gmail.com',
                hint:'Pour vous contacter — pas pour la connexion', autocomplete:'email' })}
      <div class="field">
        <label class="label" for="inFac">Faculté</label>
        <select class="input" id="inFac">
          <option value="">Sélectionnez…</option>
          ${FACULTIES.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}
        </select>
      </div>
      ${field({ id:'inPass', label:t('auth.passwordReq'), type:'password',
                placeholder:t('auth.min8'), autocomplete:'new-password' })}
      <div class="pw-meter" id="pwMeter"><i></i><i></i><i></i><i></i></div>
      <button class="btn btn-primary btn-full btn-lg" id="submitBtn" type="submit">${t('auth.createMine')}</button>
      <p class="t-xs t-dim2" style="text-align:center">
        Votre compte sera validé par un administrateur avant activation.
      </p>
    </form>
    <p class="auth-switch">Déjà inscrit ?
      <button class="auth-link" id="toSignin">Se connecter</button></p>`;
}

/* ------------------------------------------------------------
   VALIDATION
   ------------------------------------------------------------ */

function setMsg(id, text, kind = 'err') {
  const box = $(`#${id}-msg`);
  const input = $(`#${id}`);
  if (!box) return;
  box.innerHTML = text
    ? `<span class="t-xs ${kind === 'err' ? 'field-error' : 't-dim2'}">${esc(text)}</span>`
    : '';
  input?.classList.toggle('invalid', kind === 'err' && !!text);
}

// A FUNCTION, not a frozen constant: evaluated once at import time
// these labels lock to whichever language loaded first, and a later
// switch never reaches them. Verified in Chrome: the notification
// filters stayed English while the rest of the UI was Arabic.
const authRules = () => ({
  inCard: v => !v ? 'Champ obligatoire'
                : !isValidCard(v) ? 'Format invalide (ex. CS-042)' : '',
  inName: v => !v ? 'Champ obligatoire'
                : v.trim().length < 2 ? t('auth.nameShort') : '',
  inUser: v => !v ? 'Champ obligatoire'
                : v.trim().length < 3 ? t('auth.min3')
                : !/^[a-zA-Z0-9._]+$/.test(v.trim()) ? 'Lettres, chiffres, . et _ uniquement' : '',
  inMail: v => !v ? 'Champ obligatoire'
                : !isValidEmail(v) ? 'Adresse email invalide' : '',
  inPass: v => !v ? 'Champ obligatoire'
                : v.length < 8 ? t('auth.min8') : ''
});

function validate(id) {
  const input = $(`#${id}`);
  if (!input) return true;
  const rule = authRules()[id];
  if (!rule) return true;
  const err = rule(input.value);
  setMsg(id, err);
  return !err;
}

function pwStrength(v) {
  let n = 0;
  if (v.length >= 8) n++;
  if (v.length >= 12) n++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) n++;
  if (/[0-9]/.test(v) && /[^A-Za-z0-9]/.test(v)) n++;
  return n;
}

/* ------------------------------------------------------------
   RENDER
   ------------------------------------------------------------ */

export function renderAuth(onSuccess) {
  const host = $('#auth');
  if (!host) return;
  host.classList.remove('hidden');

  host.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-brand">
          <span class="auth-mark">K</span>
          <div>
            <div class="auth-title">Koliya</div>
            <div class="t-xs t-dim">${mode === 'signin' ? t('auth.welcomeBack') : t('auth.joinCampus')}</div>
          </div>
        </div>
        <div class="auth-error hidden" id="authError"></div>
        ${mode === 'signin' ? signinMarkup() : signupMarkup()}
      </div>
      <p class="auth-foot t-xs t-dim2">
        Réseau privé des étudiants universitaires algériens
      </p>
    </div>`;

  wire(onSuccess);
  setTimeout(() => $('#inCard')?.focus(), 60);
}

function wire(onSuccess) {
  const form = $('#authForm');

  // validate when leaving a field, not while typing
  for (const id of Object.keys(authRules())) {
    const input = $(`#${id}`);
    if (!input) continue;
    on(input, 'blur', () => validate(id));
    on(input, 'input', () => {
      if (input.classList.contains('invalid')) validate(id);
      if (id === 'inCard' && mode === 'signup') {
        const norm = normalizeCard(input.value);
        if (norm && norm !== input.value.toUpperCase().replace(/\s/g, '')) return;
      }
      if (id === 'inPass' && mode === 'signup') {
        const bars = $$('#pwMeter i');
        const n = pwStrength(input.value);
        bars.forEach((b, i) => b.classList.toggle('on', i < n));
        $('#pwMeter')?.setAttribute('data-level', String(n));
      }
    });
  }

  // normalise the card once the student is done typing it
  const card = $('#inCard');
  if (card) on(card, 'blur', () => {
    const n = normalizeCard(card.value);
    if (n) card.value = n;
  });

  for (const btn of $$('[data-eye]')) {
    on(btn, 'click', () => {
      const input = $(`#${btn.dataset.eye}`);
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.innerHTML = icon(showing ? 'eyeOff' : 'globe', { size: 17 });
      btn.setAttribute('aria-label', showing ? 'Afficher le mot de passe' : t('a11y.hidePassword'));
    });
  }

  on($('#toSignup'), 'click', () => { mode = 'signup'; renderAuth(onSuccess); });
  on($('#toSignin'), 'click', () => { mode = 'signin'; renderAuth(onSuccess); });

  on($('#forgotBtn'), 'click', async () => {
    const value = $('#inCard')?.value;
    if (!isValidCard(value)) {
      setMsg('inCard', 'Saisissez votre carte étudiant d\'abord');
      $('#inCard')?.focus();
      return;
    }
    try {
      await requestPasswordReset(value);
      toast(t('toast.resetSent'), { duration: 5000 });
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  on(form, 'submit', async e => {
    e.preventDefault();
    await submit(onSuccess);
  });
}

async function submit(onSuccess) {
  const ids = mode === 'signin' ? ['inCard', 'inPass'] : ['inCard', 'inName', 'inUser', 'inMail', 'inPass'];

  // validate everything, then focus the first problem
  let firstBad = null;
  for (const id of ids) if (!validate(id) && !firstBad) firstBad = id;
  if (firstBad) { $(`#${firstBad}`)?.focus(); return; }

  const btn = $('#submitBtn');
  const errBox = $('#authError');
  btn.classList.add('loading');
  btn.disabled = true;
  errBox.classList.add('hidden');

  try {
    if (mode === 'signin') {
      await signIn({ studentCard: $('#inCard').value, password: $('#inPass').value });
    } else {
      await signUp({
        studentCard: $('#inCard').value,
        name:        $('#inName').value,
        username:    $('#inUser').value,
        email:       $('#inMail').value,
        faculty:     $('#inFac').value,
        password:    $('#inPass').value
      });
    }
    onSuccess?.();
  } catch (e) {
    errBox.textContent = e instanceof AuthError ? e.message : 'Une erreur est survenue.';
    errBox.classList.remove('hidden');
    // point at the field the server complained about
    if (/carte|card/i.test(e.message)) $('#inCard')?.focus();
    else if (/utilisateur|username/i.test(e.message)) $('#inUser')?.focus();
    else if (/mot de passe|password/i.test(e.message)) $('#inPass')?.focus();
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

/** Shown when the account exists but an admin has not approved it yet. */
export function renderPending(onSignOut) {
  const host = $('#auth');
  if (!host) return;
  host.classList.remove('hidden');
  host.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card" style="text-align:center">
        <div class="empty-art" style="margin:0 auto var(--s4)">${icon('clock', { size: 32 })}</div>
        <h2 style="font-size:var(--fs-xl);margin-bottom:var(--s2)">Compte en attente</h2>
        <p class="t-dim" style="margin-bottom:var(--s5)">
          Votre inscription a bien été reçue. Un administrateur doit valider
          votre carte étudiant avant que vous puissiez accéder à Koliya.
        </p>
        <button class="btn btn-outline btn-full" id="pendingOut">Se déconnecter</button>
      </div>
    </div>`;
  on($('#pendingOut'), 'click', () => onSignOut?.());
}

export const setAuthMode = m => { mode = m; };
