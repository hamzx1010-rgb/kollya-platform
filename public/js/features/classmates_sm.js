/**
 * KOLIYA — features/classmates_sm.js
 * ============================================================
 * Classmates grouped by faculty, then by level (profiles.level).
 * The Data API does the approved-only + faculty/level filtering; the
 * grouping here is presentation only — it never decides who is
 * visible, RLS and the profiles.status gate do.
 * ============================================================
 */

import { $, on, esc, initials, avatarColor, groupBy } from '../core/utils_sm.js';
import { me, scoped, on as onEvent } from '../core/store_sm.js';
import { t } from '../core/i18n_sm.js';
import { I, icon } from '../core/icons_sm.js';
import { emptyState, skeletonList } from '../core/ui_sm.js';
import { route } from '../core/router_sm.js';

let api = null;
export function useApi(impl) { api = impl; }

const store = scoped('classmates');
let faculty = store.get('faculty', '');
let level   = store.get('level', '');
let people  = [];
let loading = false;
let lastHost = null;

async function load() {
  if (!api?.list) { people = []; return; }
  loading = true;
  try {
    people = await api.list({ faculty, level }) || [];
  } catch (e) {
    console.warn('[koliya] classmates indisponibles', e.message);
    people = [];
  } finally {
    loading = false;
  }
}

const LEVELS = ['', '1', '2', '3', '4', '5', '6'];

function personCard(p) {
  return `<a class="clm-card" href="#/profile/${esc(p.username || '')}">
    <span class="av sm"${p.avatar_url ? '' : ` style="background:${avatarColor(p.id)}"`}>${
      p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : esc(initials(p.full_name))
    }</span>
    <span class="grow" style="min-width:0">
      <span class="t-sm t-bold truncate" style="display:block">${esc(p.full_name)}</span>
      <span class="t-xs t-dim truncate" style="display:block">${p.faculty ? esc(p.faculty) : ''}</span>
    </span>
  </a>`;
}

const levelLabel = l => l ? t('classmates.levelN', { n: l }) : t('classmates.levelAny');

function render(host) {
  lastHost = host;
  const mine = me.get() || {};
  const faculties = [...new Set(people.map(p => p.faculty || '').filter(Boolean))].sort();

  const groups = faculties.map(f => {
    const rows = people.filter(p => (p.faculty || '') === f);
    const byLevel = groupBy(rows, p => p.level || '');
    return `<section class="clm-fac">
      <div class="clm-fac-head">
        <span class="clm-fac-name">${esc(f)}</span>
        <span class="clm-fac-count">${rows.length} ${esc(t('classmates.students'))}</span>
      </div>
      ${LEVELS.filter(l => byLevel.has(l)).map(l => `
        <div class="clm-level-title">${esc(levelLabel(l))}</div>
        <div class="clm-grid">${byLevel.get(l).map(personCard).join('')}</div>
      `).join('')}
    </section>`;
  }).join('');

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">${esc(t('classmates.title'))}</div>
        <div class="page-sub">${esc(t('classmates.sub'))}</div>
      </div>
    </div>
    <div class="clm-level-selects">
      <input class="input" id="clmFaculty" list="facultyList" value="${esc(faculty || '')}" placeholder="${esc(t('classmates.facultyPh'))}">
      <datalist id="facultyList">${faculties.map(f => `<option value="${esc(f)}">`).join('')}</datalist>
      <select class="select" id="clmLevel">
        ${LEVELS.map(l => `<option value="${l}"${l === level ? ' selected' : ''}>${esc(levelLabel(l))}</option>`).join('')}
      </select>
      <button class="btn btn-outline" id="clmSearch">${icon('search', { size: 15 })} ${esc(t('action.apply'))}</button>
    </div>
    ${loading ? skeletonList(4, 'post') : ''}
    ${!loading && !people.length ? `<div>${emptyState({
      icon: I.graduation,
      title: t('classmates.empty.title'),
      text: me.get()?.faculty ? t('classmates.empty.myFaculty') : t('classmates.empty.text')
    })}</div>` : ''}
    ${!loading && groups ? groups : ''}`;

  wire(host);
}

function wire(host) {
  on(host, 'click', e => {
    if (e.target.closest('#clmSearch')) apply(host);
  });
  on(host, 'keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'clmFaculty') apply(host);
  });
}

async function apply(host) {
  faculty = $('#clmFaculty')?.value.trim() || '';
  level = $('#clmLevel')?.value || '';
  store.set('faculty', faculty);
  store.set('level', level);
  await load();
  render(host);
}

export function initClassmates(mountFn) {
  route('classmates', () => {
    const host = mountFn();
    if (!host) return;
    host.closest('.view')?.classList.remove('full');
    render(host);
    load().then(() => render(host));
  });

  onEvent('route:relabel', () => {
    if (lastHost) render(lastHost);
  });
}
