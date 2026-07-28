/**
 * KOLIYA — ui_sm.js
 * ============================================================
 * Overlay primitives: toast, modal, confirm, context menu,
 * hover action bar, reaction picker, lightbox, skeletons.
 *
 * Web conventions, deliberately:
 *   - right-click opens menus (not long-press)
 *   - Esc closes, click-outside closes, and the × stays
 *   - focus is trapped in modals and returned on close
 *   - menus flip when they would fall off screen
 * ============================================================
 */

import { $, el, on, esc, escAttr, env, safeUrl } from './utils_sm.js';
import { t } from './i18n_sm.js';
import { on as onEvent, frequency } from './store_sm.js';
import { I, icon, REACTIONS as RX_SET, REACTION_KEYS, reactionIcon, reactionLabel } from './icons_sm.js';

/* ------------------------------------------------------------
   1. ROOT LAYERS
   ------------------------------------------------------------ */

let layers = null;
function roots() {
  if (layers) return layers;
  const mk = (id, cls) => {
    let n = document.getElementById(id);
    if (!n) { n = el('div', { id, class: cls }); document.body.append(n); }
    return n;
  };
  layers = {
    toasts:  mk('kl-toasts', 'toasts'),
    overlay: mk('kl-overlay', ''),
    menu:    mk('kl-menu', '')
  };
  return layers;
}

/* ------------------------------------------------------------
   2. TOAST
   ------------------------------------------------------------ */

const ICON = { ok: I.check, err: I.close, info: I.help };

/**
 * toast('Message envoyé')
 * toast('Publication supprimée', { kind:'ok', action:{ label:'Annuler', fn } })
 */
export function toast(message, opts = {}) {
  const { kind = '', duration = 3200, action = null } = typeof opts === 'string' ? { kind: opts } : opts;
  const node = el('div', { class: 'toast' + (kind ? ' ' + kind : ''), role: 'status', 'aria-live': 'polite' });

  if (ICON[kind]) node.insertAdjacentHTML('beforeend', ICON[kind]);
  node.append(el('span', {}, message));

  if (action) {
    node.append(el('button', {
      class: 'toast-action',
      onclick: () => { action.fn?.(); dismiss(); }
    }, action.label));
  }

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 200);
  };

  // hovering a toast pauses its countdown — you are reading it
  on(node, 'mouseenter', () => clearTimeout(timer));
  on(node, 'mouseleave', () => { timer = setTimeout(dismiss, 1200); });

  roots().toasts.append(node);
  timer = setTimeout(dismiss, duration);
  return dismiss;
}

/* ------------------------------------------------------------
   3. FOCUS TRAP
   ------------------------------------------------------------ */

const FOCUSABLE = 'a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])';

function trapFocus(container) {
  const previous = document.activeElement;

  const first = container.querySelector(FOCUSABLE);
  (first || container).focus?.();

  const off = on(container, 'keydown', e => {
    if (e.key !== 'Tab') return;
    const items = Array.from(container.querySelectorAll(FOCUSABLE)).filter(n => n.offsetParent !== null);
    if (!items.length) return;
    const a = items[0], z = items[items.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  });

  return () => { off(); previous?.focus?.(); };
}

/* ------------------------------------------------------------
   4. MODAL
   ------------------------------------------------------------ */

const openModals = [];

/**
 * const m = modal({ title, body, footer, wide, onClose });
 * m.close();
 */
export function modal({ title = '', body = '', footer = null, wide = false,
                        closable = true, onClose = null, className = '' } = {}) {
  const scrim = el('div', { class: 'scrim blur-scrim' });
  const card  = el('div', {
    class: 'modal' + (wide ? ' wide' : '') + (className ? ' ' + className : ''),
    role: 'dialog', 'aria-modal': 'true', tabindex: '-1'
  });

  if (title || closable) {
    const head = el('div', { class: 'modal-head' });
    if (title) head.append(el('div', { class: 'modal-title' }, title));
    if (closable) {
      head.append(el('button', {
        class: 'icon-btn modal-close', 'aria-label': 'Fermer', 'data-tip': t('a11y.escape'),
        onclick: () => close(),
        html: I.close
      }));
    }
    card.append(head);
  }

  const bodyNode = el('div', { class: 'modal-body' });
  if (typeof body === 'string') bodyNode.innerHTML = body;
  else if (body) bodyNode.append(body);
  card.append(bodyNode);

  if (footer) {
    const f = el('div', { class: 'modal-foot' });
    if (typeof footer === 'string') f.innerHTML = footer;
    else f.append(footer);
    card.append(f);
  }

  document.body.append(scrim, card);
  requestAnimationFrame(() => { scrim.classList.add('open'); card.classList.add('open'); });

  const releaseFocus = trapFocus(card);
  const offOutside = closable ? on(scrim, 'click', () => close()) : () => {};
  document.body.style.overflow = 'hidden';

  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    offOutside();
    releaseFocus();
    scrim.classList.remove('open');
    card.classList.remove('open');
    setTimeout(() => { scrim.remove(); card.remove(); }, 220);
    const i = openModals.indexOf(handle);
    if (i > -1) openModals.splice(i, 1);
    if (!openModals.length) document.body.style.overflow = '';
    onClose?.(result);
  }

  const handle = { el: card, body: bodyNode, close, closable };
  openModals.push(handle);
  return handle;
}

/** Esc closes the topmost overlay only. */
onEvent('key:escape', () => {
  if (closeMenu()) return;
  const top = openModals[openModals.length - 1];
  if (top?.closable) top.close();
});

/* ------------------------------------------------------------
   5. CONFIRM
   ------------------------------------------------------------ */

export function confirmDialog({ title = 'Confirmer', message = '',
                                confirmLabel = 'Confirmer', cancelLabel = 'Annuler',
                                danger = false } = {}) {
  return new Promise(resolve => {
    let decided = false;
    const foot = el('div', { class: 'row g2' });

    const m = modal({
      title,
      body: `<p class="t-dim">${esc(message)}</p>`,
      footer: foot,
      onClose: () => { if (!decided) resolve(false); }
    });

    foot.append(
      el('button', { class: 'btn btn-ghost', onclick: () => { decided = true; m.close(); resolve(false); } }, cancelLabel),
      el('button', {
        class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'),
        onclick: () => { decided = true; m.close(); resolve(true); }
      }, confirmLabel)
    );
    foot.lastChild.focus();
  });
}

/* ------------------------------------------------------------
   6. CONTEXT MENU  — right-click
   ------------------------------------------------------------ */

let activeMenu = null;

/**
 * contextMenu(event, [
 *   { label:'Copier le lien', icon, onClick, kbd:'C' },
 *   { sep:true },
 *   { label:'Supprimer', danger:true, onClick }
 * ])
 */
export function contextMenu(event, items) {
  event.preventDefault?.();
  event.stopPropagation?.();
  closeMenu();

  const menu = el('div', { class: 'menu blur-menu', role: 'menu' });

  for (const it of items) {
    if (!it) continue;
    if (it.sep)   { menu.append(el('div', { class: 'menu-sep' })); continue; }
    if (it.label === undefined && it.title) {
      menu.append(el('div', { class: 'menu-label' }, it.title)); continue;
    }
    const btn = el('button', {
      class: 'menu-item' + (it.danger ? ' danger' : ''),
      role: 'menuitem',
      disabled: it.disabled || false,
      onclick: () => { closeMenu(); it.onClick?.(); }
    });
    if (it.icon) btn.insertAdjacentHTML('beforeend', it.icon);
    btn.append(el('span', {}, it.label));
    if (it.kbd) btn.append(el('span', { class: 'kbd' }, it.kbd));
    menu.append(btn);
  }

  roots().menu.append(menu);
  positionMenu(menu, event.clientX, event.clientY);

  // arrow-key navigation, because this is a web app
  const offKeys = on(document, 'keydown', e => {
    const opts = Array.from(menu.querySelectorAll('.menu-item:not(:disabled)'));
    if (!opts.length) return;
    const i = opts.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); opts[(i + 1) % opts.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); opts[(i - 1 + opts.length) % opts.length].focus(); }
  });

  const offClick = on(document, 'pointerdown', e => { if (!menu.contains(e.target)) closeMenu(); }, true);
  const offScroll = on(window, 'scroll', () => closeMenu(), true);
  const offResize = on(window, 'resize', () => closeMenu());

  activeMenu = { menu, cleanup: () => { offKeys(); offClick(); offScroll(); offResize(); } };
  return menu;
}

/** Flip the menu so it never falls off the viewport. */
function positionMenu(menu, x, y) {
  const r = menu.getBoundingClientRect();
  const pad = 8;
  const flipX = x + r.width  + pad > innerWidth;
  const flipY = y + r.height + pad > innerHeight;

  menu.style.left = Math.max(pad, flipX ? x - r.width  : x) + 'px';
  menu.style.top  = Math.max(pad, flipY ? y - r.height : y) + 'px';
  menu.style.setProperty('--origin',
    `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}`);
}

export function closeMenu() {
  if (!activeMenu) return false;
  activeMenu.cleanup();
  activeMenu.menu.remove();
  activeMenu = null;
  return true;
}

/* ------------------------------------------------------------
   7. HOVER ACTION BAR
   The web answer to long-press: tools appear where the cursor is.
   ------------------------------------------------------------ */

/**
 * actionBar(hostElement, [{ icon, tip, onClick }], { side:'right' })
 * The host needs class="hover-host"; CSS handles reveal timing.
 */
export function actionBar(host, actions, { side = 'right' } = {}) {
  host.classList.add('hover-host');
  const bar = el('div', { class: `action-bar blur-menu hover-reveal ${side}` });

  for (const a of actions) {
    if (!a) continue;
    bar.append(el('button', {
      class: 'icon-btn',
      'data-tip': a.tip || '',
      'aria-label': a.tip || a.label || '',
      onclick: e => { e.stopPropagation(); a.onClick?.(e); },
      html: a.icon || ''
    }));
  }
  host.append(bar);
  return bar;
}

/* ------------------------------------------------------------
   8. REACTION PICKER
   Real emoji. The old code rendered the words "Love", "Haha".
   ------------------------------------------------------------ */

/** Reaction keys, in default order. Rendered as custom SVG, never emoji. */
export const REACTIONS = REACTION_KEYS;

/**
 * reactionPicker(anchorEl, { current, onPick })
 * Your most-used emoji come first — learned from store.frequency.
 */
export function reactionPicker(anchor, { current = null, onPick } = {}) {
  closeMenu();

  const learned = frequency.top('reaction', 6);
  const ordered = [...new Set([...learned, ...REACTION_KEYS])]
    .filter(k => RX_SET[k]).slice(0, 6);

  const picker = el('div', { class: 'rx-picker blur-menu', role: 'menu' });

  for (const key of ordered) {
    picker.append(el('button', {
      class: 'rx-pick' + (key === current ? ' chosen' : ''),
      'aria-label': reactionLabel(key),
      'data-tip': reactionLabel(key),
      'data-rx': key,
      html: reactionIcon(key, 26),
      onclick: e => {
        e.stopPropagation();
        frequency.bump('reaction', key);
        closeMenu();
        onPick?.(key === current ? null : key);   // click again to remove
      }
    }));
  }

  roots().menu.append(picker);

  // sit above the anchor, or below when there is no room
  const a = anchor.getBoundingClientRect();
  const p = picker.getBoundingClientRect();
  // Above the anchor when there is room, below otherwise — and
  // clamped so it can never hang off the top or bottom edge.
  const above = a.top - p.height - 8 > 8;
  const rawTop = above ? a.top - p.height - 8 : a.bottom + 8;
  picker.style.position = 'fixed';
  picker.style.top  = Math.max(8, Math.min(rawTop, innerHeight - p.height - 8)) + 'px';
  picker.style.left = Math.min(Math.max(8, a.left), innerWidth - p.width - 8) + 'px';

  const offClick = on(document, 'pointerdown', e => { if (!picker.contains(e.target)) closeMenu(); }, true);
  activeMenu = { menu: picker, cleanup: offClick };
  return picker;
}

/* ------------------------------------------------------------
   9. LIGHTBOX
   ------------------------------------------------------------ */

export function lightbox(images, startIndex = 0) {
  let i = Math.max(0, Math.min(startIndex, images.length - 1));

  const img = el('img', {
    src: safeUrl(images[i]), alt: '',
    style: { maxWidth: '92vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 'var(--r)' }
  });

  const counter = el('div', {
    class: 'pill',
    style: { position: 'fixed', top: 'var(--s5)', left: '50%', transform: 'translateX(-50%)' }
  });

  const box = el('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });

  const nav = (dir) => {
    i = (i + dir + images.length) % images.length;
    img.src = safeUrl(images[i]);
    render();
  };
  const render = () => {
    counter.textContent = `${i + 1} / ${images.length}`;
    counter.style.display = images.length > 1 ? '' : 'none';
  };

  const arrow = (dir, rotate) => el('button', {
    class: 'icon-btn blur-menu',
    'aria-label': dir < 0 ? t('a11y.prev') : 'Suivant',
    style: {
      position: 'fixed', top: '50%', transform: 'translateY(-50%)',
      [dir < 0 ? 'left' : 'right']: 'var(--s5)', width: '44px', height: '44px'
    },
    onclick: e => { e.stopPropagation(); nav(dir); },
    html: `<span style="display:block;transform:rotate(${rotate}deg)">${I.chevron.replace('<svg','<svg style="transform:rotate(180deg)"')}</span>`
  });

  box.append(img, counter);
  if (images.length > 1) box.append(arrow(-1, 0), arrow(1, 180));
  box.append(el('button', {
    class: 'icon-btn blur-menu',
    'aria-label': 'Fermer',
    style: { position: 'fixed', top: 'var(--s5)', right: 'var(--s5)', width: '40px', height: '40px' },
    onclick: close,
    html: I.close
  }));

  document.body.append(box);
  document.body.style.overflow = 'hidden';
  render();
  box.focus();

  const offKeys = on(document, 'keydown', e => {
    if (e.key === 'ArrowLeft')  nav(-1);
    if (e.key === 'ArrowRight') nav(1);
    if (e.key === 'Escape')     close();
  });
  const offClick = on(box, 'click', e => { if (e.target === box) close(); });

  function close() {
    offKeys(); offClick();
    box.remove();
    document.body.style.overflow = '';
  }
  return { close, next: () => nav(1), prev: () => nav(-1) };
}

/* ------------------------------------------------------------
   10. SKELETONS & EMPTY STATE
   ------------------------------------------------------------ */

export function skeletonList(count = 5, kind = 'post') {
  const one = kind === 'conv'
    ? `<div class="row g3" style="padding:var(--s3) var(--s4)">
         <div class="skel skel-avatar"></div>
         <div class="grow"><div class="skel skel-text w-40"></div><div class="skel skel-text w-80"></div></div>
       </div>`
    : `<div style="padding:var(--s4);border-bottom:1px solid var(--border)">
         <div class="row g3"><div class="skel skel-avatar"></div>
           <div class="grow"><div class="skel skel-text w-40"></div><div class="skel skel-text w-full"></div>
           <div class="skel skel-text w-60"></div></div></div>
       </div>`;
  return one.repeat(count);
}

export function emptyState({ icon = '', title = '', text = '', action = null } = {}) {
  const node = el('div', { class: 'empty' });
  node.append(el('div', { class: 'empty-art', html: icon }));
  if (title) node.append(el('div', { class: 'empty-title' }, title));
  if (text)  node.append(el('div', { class: 'empty-text' }, text));
  if (action) {
    node.append(el('button', { class: 'btn btn-primary', onclick: action.onClick }, action.label));
  }
  return node;
}

/* ------------------------------------------------------------
   11. MISC
   ------------------------------------------------------------ */

/** The heart that flashes over an image on double-click. */
export function heartBurst(container) {
  const h = el('div', { class: 'heart-burst', html: reactionIcon('love', 96) });
  container.style.position ||= 'relative';
  container.append(h);
  setTimeout(() => h.remove(), 700);
}

/** Count up instead of snapping — used for XP and streaks. */
export function countUp(node, to, ms = 700) {
  if (env.reducedMotion) { node.textContent = to; return; }
  const from = Number(node.textContent.replace(/\D/g, '')) || 0;
  if (from === to) return;
  const t0 = performance.now();
  let frames = 0;
  const step = () => {
    // Measure elapsed time ourselves rather than trusting the timestamp
    // argument: it comes from a different clock in some environments,
    // which would leave the loop running forever.
    const p = Math.min(1, (performance.now() - t0) / ms);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = Math.round(from + (to - from) * eased);
    // hard stop so a stalled clock can never spin indefinitely
    if (p < 1 && ++frames < 240) requestAnimationFrame(step);
    else node.textContent = to;
  };
  requestAnimationFrame(step);
}

/** Optimistic action: paint now, revert quietly if the server says no. */
export async function optimistic(applyFn, revertFn, requestFn, errorMessage = t('toast.actionFailed')) {
  applyFn();
  try {
    return await requestFn();
  } catch (e) {
    revertFn();
    toast(errorMessage, 'err');
    console.error('[koliya] optimistic revert', e);
    return null;
  }
}
