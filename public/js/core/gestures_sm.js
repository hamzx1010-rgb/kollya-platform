/**
 * KOLIYA — gestures_sm.js
 * ============================================================
 * Touch gestures: hold-to-react, swipe-to-reply, double-tap-to-like.
 *
 * The app is web-first: a mouse already has hover toolbars and
 * right-click menus for all three of these. On a phone none of that
 * exists, so without gestures reacting and replying are unreachable.
 *
 * Rules this file obeys:
 *   * A gesture must never fight scrolling. Horizontal intent is only
 *     claimed after a clear sideways move; vertical movement cancels.
 *   * A long-press must never fire after the finger has moved — that
 *     is a scroll, not a press.
 *   * Everything stays passive until it commits, so the list keeps
 *     60fps while the student is only scrolling.
 *   * On a fine pointer it refuses to attach at all.
 * ============================================================ */

import { haptic } from './native_sm.js';

const HOLD_MS      = 380;   // long-press threshold
const MOVE_CANCEL  = 10;    // px of movement that turns a press into a scroll
const SWIPE_CLAIM  = 12;    // px sideways before we take over from the scroller
const SWIPE_COMMIT = 64;    // px to actually trigger reply
const SWIPE_MAX    = 96;    // rubber-band ceiling
const DOUBLE_MS    = 300;

export const isTouch = () =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * @param {Element} root         the scroll container
 * @param {string}  itemSelector which children are gesture targets
 * @param {object}  handlers     onHold, onSwipe, onDoubleTap
 * @returns {function} detach
 */
export function attachGestures(root, itemSelector, handlers = {}) {
  if (!root || !isTouch()) return () => {};

  let target = null;
  let startX = 0, startY = 0, dx = 0;
  let holdTimer = null;
  let mode = null;             // null | 'hold' | 'swipe' | 'cancelled'
  let lastTapAt = 0, lastTapEl = null;
  let committed = false;

  const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };

  const reset = () => {
    clearHold();
    if (target) {
      const t = target;
      t.style.transition = 'transform .18s cubic-bezier(.2,.9,.3,1)';
      t.style.transform = '';
      setTimeout(() => { t.style.transition = ''; t.classList.remove('gs-swiping'); }, 200);
    }
    target = null; mode = null; dx = 0; committed = false;
  };

  const onStart = e => {
    if (e.touches && e.touches.length > 1) { reset(); return; }   // pinch
    const p = e.touches ? e.touches[0] : e;
    const el = e.target.closest?.(itemSelector);
    if (!el || !root.contains(el)) return;

    target = el; startX = p.clientX; startY = p.clientY; dx = 0;
    mode = null; committed = false;

    if (handlers.onHold) {
      clearHold();
      holdTimer = setTimeout(() => {
        if (mode !== null || !target) return;      // already scrolling/swiping
        mode = 'hold';
        haptic('medium');
        handlers.onHold(target, startX, startY);
        committed = true;                          // the press consumed the touch
      }, HOLD_MS);
    }
  };

  const onMove = e => {
    if (!target) return;
    const p = e.touches ? e.touches[0] : e;
    const mx = p.clientX - startX;
    const my = p.clientY - startY;

    if (mode === 'hold') return;

    if (mode === null) {
      if (Math.abs(my) > MOVE_CANCEL && Math.abs(my) > Math.abs(mx)) {
        mode = 'cancelled';                        // vertical: it is a scroll
        clearHold();
        return;
      }
      if (Math.abs(mx) > SWIPE_CLAIM && Math.abs(mx) > Math.abs(my)) {
        if (!handlers.onSwipe) { mode = 'cancelled'; clearHold(); return; }
        mode = 'swipe';
        clearHold();
        target.classList.add('gs-swiping');
      } else {
        return;
      }
    }

    if (mode !== 'swipe') return;

    // Reply is a start-direction gesture: rightward in LTR, leftward in
    // RTL. Using the raw sign would make it backwards in Arabic.
    const rtl = document.documentElement.dir === 'rtl';
    const forward = rtl ? -mx : mx;
    if (forward < 0) { dx = 0; target.style.transform = ''; return; }

    // Rubber band past the commit point so it feels elastic.
    dx = forward <= SWIPE_COMMIT
      ? forward
      : SWIPE_COMMIT + (forward - SWIPE_COMMIT) * 0.35;
    dx = Math.min(dx, SWIPE_MAX);

    if (e.cancelable) e.preventDefault();          // we own this drag now
    target.style.transform = `translateX(${rtl ? -dx : dx}px)`;

    if (dx >= SWIPE_COMMIT && !committed) {
      committed = true;
      haptic('tick');
      target.classList.add('gs-ready');
    } else if (dx < SWIPE_COMMIT && committed) {
      committed = false;
      target.classList.remove('gs-ready');
    }
  };

  const onEnd = () => {
    if (!target) return;
    const el = target;
    const wasSwipe = mode === 'swipe';
    const wasHold  = mode === 'hold';
    const fired    = committed;

    el.classList.remove('gs-ready');

    if (wasSwipe && fired && handlers.onSwipe) {
      haptic('light');
      handlers.onSwipe(el);
    }

    if (!wasSwipe && !wasHold && handlers.onDoubleTap) {
      const now = Date.now();
      if (lastTapEl === el && now - lastTapAt < DOUBLE_MS) {
        haptic('medium');
        handlers.onDoubleTap(el);
        lastTapAt = 0; lastTapEl = null;
      } else {
        lastTapAt = now; lastTapEl = el;
      }
    }

    reset();
  };

  // touchmove cannot be passive: a claimed swipe must preventDefault or
  // the list scrolls under the finger.
  root.addEventListener('touchstart', onStart, { passive: true });
  root.addEventListener('touchmove',  onMove,  { passive: false });
  root.addEventListener('touchend',   onEnd,   { passive: true });
  root.addEventListener('touchcancel', reset,  { passive: true });

  return () => {
    clearHold();
    root.removeEventListener('touchstart', onStart);
    root.removeEventListener('touchmove', onMove);
    root.removeEventListener('touchend', onEnd);
    root.removeEventListener('touchcancel', reset);
  };
}

export default { attachGestures, isTouch };
