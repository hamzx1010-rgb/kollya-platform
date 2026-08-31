/**
 * KOLIYA — features/marketplace_sm.js
 * ============================================================
 * Student flea market. One grid of listings, a publish sheet, and
 * the two status changes a seller actually makes: marked as sold,
 * or deleted. Everything else (approval, RLS, media size) lives in
 * the database and in api_sm.js — this file only paints and wires.
 * ============================================================
 */

import { $, $$, el, on, esc, truncate, initials, avatarColor, safeUrl } from '../core/utils_sm.js';
import { me, scoped, on as onEvent } from '../core/store_sm.js';
import { t, errorText } from '../core/i18n_sm.js';
import { I, icon } from '../core/icons_sm.js';
import { toast, modal, confirmDialog, emptyState, skeletonList } from '../core/ui_sm.js';
import { route } from '../core/router_sm.js';

let api = null;
export function useApi(impl) { api = impl; }

const store = scoped('marketplace');
let filter = store.get('filter', 'all');   // all | available | mine
let items  = [];
let loading = false;
let loadError = null;
let lastHost = null;

const FILTERS = [
  ['all', 'marketplace.filterAll'],
  ['available', 'marketplace.filterAvailable'],
  ['mine', 'marketplace.filterMine'],
  ['sold', 'marketplace.statusSold']
];

const STATUS_LABEL = {
  available: 'marketplace.statusAvailable',
  reserved:  'marketplace.statusReserved',
  sold:      'marketplace.statusSold',
  removed:   'marketplace.statusRemoved'
};

const CATEGORIES = ['books', 'electronics', 'furniture', 'clothing', 'sports', 'other'];
const CONDITIONS = ['new', 'like-new', 'used', 'for-parts'];

async function load() {
  if (!api?.list) { items = []; return; }
  loading = true;
  loadError = null;
  try {
    items = await api.list({ filter }) || [];
  } catch (e) {
    // A stale Neon schema cache (PGRST205) used to be swallowed here
    // and the market looked "empty" — the user's "could not found".
    // Keep the error and render it; errorText() says what to do.
    console.warn('[koliya] marketplace indisponible', e.message);
    items = [];
    loadError = e;
  } finally {
    loading = false;
  }
}

const money = cents => {
  const n = Number(cents || 0);
  return `${n.toLocaleString('fr-FR')} DA`;
};

function card(it) {
  const mine = String(it.seller_id) === String(me.id);
  const seller = it.seller || { id: it.seller_id, full_name: 'Étudiant', username: it.seller_id || '' };
  return `<article class="mp-card" data-id="${esc(it.id)}">
    <span class="mp-img">${it.image_url
      ? `<img src="${esc(safeUrl(it.image_url))}" alt="${esc(it.title)}">`
      : `<span style="display:grid;place-items:center;height:100%;color:var(--text-3)">${icon('image', { size: 34 })}</span>`}</span>
    <div class="mp-body">
      <span class="mp-title">${esc(truncate(it.title, 70))}</span>
      <span class="mp-price">${money(it.price_cents)}</span>
      <span class="mp-sub">${esc(t('marketplace.category', { category: t('marketplace.cat.' + (it.category || 'other')) }))} · ${esc(t('marketplace.condition', { condition: t('marketplace.cond.' + (it.condition || 'used')) }))}</span>
      <span class="mp-sub">${esc(seller.full_name)} ${mine ? `· ${esc(t('marketplace.yours'))}` : ''}</span>
      <span class="mp-status ${esc(it.status)}">${esc(t(STATUS_LABEL[it.status] || STATUS_LABEL.available))}</span>
      ${mine && it.status !== 'sold' && it.status !== 'removed' ? `
        <div class="mp-actions">
          ${it.status === 'available' ? `<button class="btn btn-outline btn-sm" data-act="sold" data-id="${esc(it.id)}">${icon('check', { size: 14 })} ${esc(t('marketplace.markSold'))}</button>` : ''}
          <button class="btn btn-outline btn-sm" data-act="edit" data-id="${esc(it.id)}">${icon('edit', { size: 14 })} ${esc(t('action.edit'))}</button>
          <button class="btn btn-ghost danger btn-sm" data-act="delete" data-id="${esc(it.id)}">${icon('trash', { size: 14 })}</button>
        </div>` : ''}
    </div>
  </article>`;
}

function pageHead() {
  return `<div class="page-head">
    <div>
      <div class="page-title">${esc(t('marketplace.title'))}</div>
      <div class="page-sub">${esc(t('marketplace.sub'))}</div>
    </div>
    <button class="btn btn-primary" id="mpPublish">${icon('plus', { size: 15 })} ${esc(t('marketplace.publish'))}</button>
  </div>
  <div class="mp-filters">
    ${FILTERS.map(([v, key]) => `<button class="mp-filter${v === filter ? ' on' : ''}" data-filter="${v}">${esc(t(key))}</button>`).join('')}
  </div>`;
}

function render(host) {
  lastHost = host;
  host.innerHTML = pageHead();
  const list = document.createElement('div');
  list.className = 'col g3';
  if (loading) {
    list.innerHTML = skeletonList(3, 'post');
  } else if (loadError) {
    list.innerHTML = `<div>${emptyState({
      icon: I.store,
      title: t('error.loading'),
      text: errorText(loadError)
    }).outerHTML}</div>`;
  } else if (!items.length) {
    list.innerHTML = `<div>${emptyState({
      icon: I.store,
      title: t('marketplace.empty.title'),
      text: t('marketplace.empty.text')
    }).outerHTML}</div>`;
  } else {
    list.innerHTML = `<div class="mp-grid">${items.map(card).join('')}</div>`;
  }
  host.append(list);
  wire(host);
}

function selectImage() {
  return new Promise(resolve => {
    const input = el('input', { type: 'file', accept: 'image/*', class: 'hidden' });
    input.addEventListener('change', () => resolve(input.files?.[0] || null));
    input.click();
  });
}

async function openComposer(item = null) {
  const title = el('input', { class: 'input', value: item?.title || '', placeholder: t('marketplace.titlePh'), maxlength: '80' });
  const price = el('input', { class: 'input', type: 'number', min: '0', step: '1', value: item ? item.price_cents : '', placeholder: t('marketplace.pricePh') });
  const desc  = el('textarea', { class: 'textarea', rows: '3', value: item?.description || '', placeholder: t('marketplace.descPh'), maxlength: '500' });
  const cat   = el('select', { class: 'select' }, ...CATEGORIES.map(c => el('option', { value: c, selected: item?.category === c }, t('marketplace.cat.' + c))));
  const cond  = el('select', { class: 'select' }, ...CONDITIONS.map(c => el('option', { value: c, selected: item?.condition === c }, t('marketplace.cond.' + c))));
  const foot  = el('div', { class: 'row g2' });

  let coverFile = null;
  let coverUrl  = item?.image_url || null;
  const preview = el('div', { class: 'mp-form-img-wrap' });
  const draw = () => {
    preview.innerHTML = coverUrl
      ? `<img class="mp-form-img" src="${esc(safeUrl(coverUrl))}" alt="">`
      : `<div class="ev-cover-empty">${icon('image', { size: 20 })}</div>`;
  };
  draw();
  const pickBtn = el('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: async () => {
    const f = await selectImage();
    if (!f) return;
    if (coverUrl && !coverUrl.startsWith('data:')) URL.revokeObjectURL(coverUrl);
    coverFile = f;
    coverUrl = URL.createObjectURL(f);
    draw();
  }}, t('marketplace.addImage'));

  const m = modal({
    title: item ? t('marketplace.edit') : t('marketplace.publish'),
    body: el('div', { class: 'col g3' },
      el('div', { class: 'field' }, el('label', { class: 'label' }, t('marketplace.fieldTitle')), title),
      el('div', { class: 'field' }, el('label', { class: 'label' }, t('marketplace.fieldPrice')), price),
      el('div', { class: 'field' }, el('label', { class: 'label' }, t('marketplace.fieldCategory')), cat),
      el('div', { class: 'field' }, el('label', { class: 'label' }, t('marketplace.fieldCondition')), cond),
      el('div', { class: 'field' }, el('label', { class: 'label' }, t('marketplace.fieldImage')), preview, pickBtn),
      el('div', { class: 'field' }, el('label', { class: 'label' }, t('marketplace.fieldDesc')), desc)),
    footer: foot
  });

  foot.append(
    el('button', { class: 'btn btn-ghost', onclick: () => m.close() }, t('action.cancel')),
    el('button', { class: 'btn btn-primary', onclick: async e => {
      const btn = e.currentTarget;
      if (!title.value.trim()) { toast(t('marketplace.titleRequired'), 'err'); return; }
      btn.disabled = true;
      btn.textContent = t('toast.creating');
      try {
        if (item) {
          await api.update(item.id, {
            title: title.value.trim(), price_cents: Math.max(0, Math.round(Number(price.value) || 0)),
            description: desc.value.trim(), category: cat.value, condition: cond.value, imageFile: coverFile
          });
        } else {
          await api.create({
            title: title.value.trim(), price_cents: Math.max(0, Math.round(Number(price.value) || 0)),
            description: desc.value.trim(), category: cat.value, condition: cond.value, imageFile: coverFile
          });
        }
        m.close();
        toast(item ? t('toast.saved') : t('toast.published'), 'ok');
        await reload(host);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = t('toast.createFailed');
        toast(t('toast.createFailed'), 'err');
      }
    }}, item ? t('action.save') : t('action.publish'))
  );
  setTimeout(() => title.focus(), 80);
}

async function reload(host) {
  await load();
  render(host);
}

function wire(host) {
  on($('#mpPublish'), 'click', () => openComposer());
  on(host, 'click', e => {
    const f = e.target.closest('[data-filter]');
    const a = e.target.closest('[data-act]');
    if (f) {
      filter = f.dataset.filter;
      store.set('filter', filter);
      load().then(() => render(host));
      return;
    }
    if (a) {
      const id = a.dataset.id;
      const it = items.find(x => String(x.id) === String(id));
      if (a.dataset.act === 'edit' && it) openComposer(it);
      if (a.dataset.act === 'sold' && it) markSold(host, it, a);
      if (a.dataset.act === 'delete' && it) removeItem(host, it);
    }
  });
}

async function markSold(host, it, btn) {
  if (!await confirmDialog({ title: t('marketplace.markSoldQ'), confirmLabel: t('marketplace.markSold'), danger: false })) return;
  btn.disabled = true;
  try {
    await api.update(it.id, { status: 'sold' });
    toast(t('marketplace.markedSold'), 'ok');
    await reload(host);
  } catch {
    btn.disabled = false;
    toast(t('toast.deleteFailed'), 'err');
  }
}

async function removeItem(host, it) {
  if (!await confirmDialog({ title: t('confirm.deletePost'), message: t('confirm.permanent'), confirmLabel: t('action.delete'), danger: true })) return;
  try {
    await api.remove(it.id);
    toast(t('marketplace.deleted'), 'ok');
    await reload(host);
  } catch {
    toast(t('toast.deleteFailed'), 'err');
  }
}

export function initMarketplace(mountFn) {
  route('marketplace', () => {
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
