/**
 * KOLIYA — features/documents_sm.js
 * ============================================================
 * Per-student document shelf. RLS decides who can see what (owner +
 * approved students for shared_public rows); this module only renders
 * the shelf and the upload sheet, and never decides privacy itself.
 * ============================================================
 */

import { $, $$, el, on, esc, truncate, initials, avatarColor, safeUrl, fileSize } from '../core/utils_sm.js';
import { me, on as onEvent } from '../core/store_sm.js';
import { t, errorText } from '../core/i18n_sm.js';
import { I, icon } from '../core/icons_sm.js';
import { toast, modal, confirmDialog, emptyState, skeletonList } from '../core/ui_sm.js';
import { route } from '../core/router_sm.js';

let api = null;
export function useApi(impl) { api = impl; }

let items = [];
let loading = false;
let loadError = null;
let lastHost = null;

const LEVELS = ['', '1', '2', '3', '4', '5', '6'];

async function load() {
  if (!api?.list) { items = []; return; }
  loading = true;
  loadError = null;
  try {
    items = await api.list() || [];
  } catch (e) {
    // Same story as the marketplace: a stale schema cache must show
    // the "Database update needed" message, not an empty shelf.
    console.warn('[koliya] documents indisponibles', e.message);
    items = [];
    loadError = e;
  } finally {
    loading = false;
  }
}

const kindIcon = k => k === 'image' ? 'image' : 'file';

function docRow(doc) {
  const mine = String(doc.owner_id) === String(me.id);
  const owner = doc.owner || { id: doc.owner_id, full_name: 'Étudiant', username: doc.owner_id || '' };
  const kind = doc.kind || 'pdf';
  return `<article class="doc-row" data-id="${esc(doc.id)}">
    <span class="doc-kind">${icon(kindIcon(kind), { size: 18 })}</span>
    <div class="doc-body">
      <div class="doc-title">${esc(truncate(doc.title, 90))}</div>
      <div class="file-name">${esc(doc.file_name || '')}</div>
      <div class="doc-meta">
        <span>${esc(owner.full_name)}</span>
        <span>${fileSize(Number(doc.size_bytes) || 0)}</span>
        <span>${esc(doc.subject || '')}</span>
        ${doc.level ? `<span>${esc(t('documents.levelN', { n: doc.level }))}</span>` : ''}
        ${doc.shared_public ? `<span class="doc-shared">${icon('globe', { size: 12 })} ${esc(t('documents.shared'))}</span>` : ''}
      </div>
    </div>
    <div class="doc-actions">
      ${doc.file_url ? `<a class="btn btn-outline btn-sm" href="${esc(safeUrl(doc.file_url))}" download="${esc(doc.file_name || 'doc')}">${icon('download', { size: 14 })} ${esc(t('documents.download'))}</a>` : ''}
      ${mine ? `<button class="btn btn-ghost danger btn-sm" data-del="${esc(doc.id)}">${icon('trash', { size: 14 })}</button>` : ''}
    </div>
  </article>`;
}

function section(title, rows) {
  if (!rows.length) return '';
  return `<div class="doc-shelf-title">${esc(title)}</div>
    <div class="doc-list">${rows.map(docRow).join('')}</div>`;
}

function render(host) {
  lastHost = host;
  const mine = items.filter(i => String(i.owner_id) === String(me.id));
  const shared = items.filter(i => String(i.owner_id) !== String(me.id));
  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">${esc(t('documents.title'))}</div>
        <div class="page-sub">${esc(t('documents.sub'))}</div>
      </div>
      <button class="btn btn-primary" id="docUpload">${icon('upload', { size: 15 })} ${esc(t('documents.upload'))}</button>
    </div>
    <div class="col g2">
      ${loading ? skeletonList(3, 'post') : ''}
      ${!loading && loadError ? `<div>${emptyState({
        icon: I.folder,
        title: t('error.loading'),
        text: errorText(loadError)
      }).outerHTML}</div>` : ''}
      ${section(t('documents.myShelf'), mine)}
      ${section(t('documents.sharedShelf'), shared)}
      ${!loading && !loadError && !items.length ? `<div>${emptyState({
        icon: I.folder,
        title: t('documents.empty.title'),
        text: t('documents.empty.text')
      }).outerHTML}</div>` : ''}
    </div>`;
  wire(host);
}

async function openUploader() {
  const title = el('input', { class: 'input', placeholder: t('documents.titlePh'), maxlength: '80' });
  const subject = el('input', { class: 'input', placeholder: t('documents.subjectPh'), maxlength: '80' });
  const level = el('select', { class: 'select' },
    LEVELS.map(l => el('option', { value: l, selected: l === '' }, l ? t('documents.levelN', { n: l }) : t('documents.levelAny'))));
  const desc = el('textarea', { class: 'textarea', rows: '2', placeholder: t('documents.descPh'), maxlength: '300' });
  const shared = el('label', { class: 'row g2', style: 'align-items:center' },
    el('input', { type: 'checkbox', class: 'doc-shared-box' }),
    el('span', { class: 't-sm' }, t('documents.shareHint')));
  const filePick = el('input', { type: 'file', class: 'doc-file' });
  const fileName = el('span', { class: 't-xs t-dim' }, t('documents.noFile'));
  const foot = el('div', { class: 'row g2' });

  on(filePick, 'change', () => {
    const f = filePick.files?.[0];
    fileName.textContent = f ? f.name : t('documents.noFile');
  });

  const m = modal({
    title: t('documents.upload'),
    body: el('div', { class: 'col g3' },
      el('div', { class: 'field' }, el('label', { class: 'label' }, t('documents.fieldTitle')), title),
      el('div', { class: 'field' }, el('label', { class: 'label' }, t('documents.fieldSubject')), subject),
      el('div', { class: 'field' }, el('label', { class: 'label' }, t('documents.fieldLevel')), level),
      el('div', { class: 'field' }, el('label', { class: 'label' }, t('documents.fieldDesc')), desc),
      el('div', { class: 'field' }, el('label', { class: 'label' }, t('documents.fieldFile')), filePick, fileName),
      el('div', { class: 'field' }, shared)),
    footer: foot
  });

  foot.append(
    el('button', { class: 'btn btn-ghost', onclick: () => m.close() }, t('action.cancel')),
    el('button', { class: 'btn btn-primary', onclick: async e => {
      const btn = e.currentTarget;
      const f = filePick.files?.[0];
      if (!title.value.trim() || !f) { toast(t('documents.required'), 'err'); return; }
      btn.disabled = true;
      btn.textContent = t('toast.uploading');
      try {
        await api.create({
          title: title.value.trim(),
          description: desc.value.trim(),
          subject: subject.value.trim(),
          level: level.value,
          file: f,
          shared_public: shared.querySelector('input').checked
        });
        m.close();
        toast(t('toast.uploaded'), 'ok');
        await reload(lastHost);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = t('action.create');
        toast(t('toast.uploadFailed'), 'err');
      }
    }}, t('action.create'))
  );
  setTimeout(() => title.focus(), 80);
}

async function reload(host) {
  await load();
  render(host);
}

function wire(host) {
  on($('#docUpload'), 'click', openUploader);
  on(host, 'click', async e => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const id = btn.dataset.del;
    const it = items.find(x => String(x.id) === String(id));
    if (!it) return;
    if (!await confirmDialog({ title: t('confirm.deletePost'), message: t('confirm.permanent'), confirmLabel: t('action.delete'), danger: true })) return;
    try {
      await api.remove(id);
      toast(t('documents.deleted'), 'ok');
      await reload(host);
    } catch {
      toast(t('toast.deleteFailed'), 'err');
    }
  });
}

export function initDocuments(mountFn) {
  route('documents', () => {
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
