/**
 * KOLIYA — native_sm.js
 * ============================================================
 * The seam between the web app and the Android APK.
 *
 * Every function here also works in a plain browser — it just does
 * less. That is deliberate: one source builds both the website and the
 * app, so a feature can never be "wired in the APK but broken on the
 * web", or the reverse.
 *
 * MainActivity injects three objects into the WebView:
 *   AndroidCamera  — open('story'|'post'), available()
 *   AndroidNotify  — granted(), canAsk(), request(), show(), scheduleDaily()
 *   AndroidDevice  — haptic(style), info(), share(text, url)
 * ============================================================
 */

/** True only inside the APK. Set by MainActivity.onPageFinished. */
export const isNative = () =>
  typeof window !== 'undefined' && window.KOLIYA_NATIVE === true;

const bridge = name => (isNative() && window[name]) ? window[name] : null;

/* ------------------------------------------------------------
   1. HAPTICS
   Invisible gestures need a bump under the finger, or the student
   cannot tell they worked and stops using them.
   ------------------------------------------------------------ */

const WEB_PATTERN = { tick: 8, light: 12, medium: 22, success: [18, 70, 26], warn: 60 };

export function haptic(style = 'light') {
  const dev = bridge('AndroidDevice');
  if (dev?.haptic) { try { dev.haptic(style); return true; } catch {} }
  try {
    if (navigator.vibrate) { navigator.vibrate(WEB_PATTERN[style] ?? 12); return true; }
  } catch {}
  return false;
}

/* ------------------------------------------------------------
   2. CAMERA
   ------------------------------------------------------------ */

/** Web returns false: `<input capture>` is a different, worse thing,
 *  and the web build already has "choose a photo". */
export const hasCamera = () => {
  const cam = bridge('AndroidCamera');
  if (!cam?.available) return false;
  try { return !!cam.available(); } catch { return false; }
};

/**
 * Open the native camera.
 * Resolves { kind:'image', dataUrl } or null if cancelled/denied.
 * A data: URL is exactly what media_sm.js and the SQL CHECK
 * constraints already handle, so nothing downstream changes.
 */
export function openCamera(mode = 'post') {
  const cam = bridge('AndroidCamera');
  if (!cam?.open) return Promise.resolve(null);

  return new Promise(resolve => {
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      window.removeEventListener('camera:captured', onShot);
      window.removeEventListener('camera:cancelled', onStop);
      window.removeEventListener('camera:denied', onStop);
      resolve(value);
    };
    const onShot = e => finish(e.detail || null);
    const onStop = () => finish(null);

    window.addEventListener('camera:captured', onShot);
    window.addEventListener('camera:cancelled', onStop);
    window.addEventListener('camera:denied', onStop);

    try { cam.open(mode); } catch { finish(null); }
  });
}

/* ------------------------------------------------------------
   3. NOTIFICATIONS
   On the web these live only while the tab is open. In the APK they
   are real system notifications.
   ------------------------------------------------------------ */

export function nativeNotifyState() {
  const n = bridge('AndroidNotify');
  if (!n) return null;
  try { return { granted: !!n.granted(), canAsk: !!n.canAsk() }; }
  catch { return null; }
}

/** Show the real Android dialog. Resolves to a boolean. */
export function requestNativeNotify() {
  const n = bridge('AndroidNotify');
  if (!n?.request) return Promise.resolve(false);
  return new Promise(resolve => {
    const done = e => {
      window.removeEventListener('native:notify-permission', done);
      resolve(!!e.detail?.granted);
    };
    window.addEventListener('native:notify-permission', done);
    try { n.request(); } catch { done({ detail: { granted: false } }); }
  });
}

/** Android will not re-prompt after a denial; send them to Settings. */
export function openNativeNotifySettings() {
  try { bridge('AndroidNotify')?.openSettings(); } catch {}
}

/**
 * Post a system notification. `kind` picks the Android channel, so the
 * student can silence likes while keeping messages.
 */
export function nativeNotify({ kind = 'reminder', title, body = '', route = '', id } = {}) {
  const n = bridge('AndroidNotify');
  if (!n?.show || !title) return false;
  // A stable id per (kind, route, title) so the same event updates its
  // notification instead of stacking twenty copies.
  const key = id ?? hashId(kind + '|' + route + '|' + title);
  try { n.show(kind, String(title), String(body), String(route), key); return true; }
  catch { return false; }
}

export function cancelNativeNotify(id) {
  try { bridge('AndroidNotify')?.cancel(id); } catch {}
}

/** A daily reminder that survives the app being closed and rebooted. */
export function scheduleDailyReminder(hour, minute, title, body) {
  const n = bridge('AndroidNotify');
  if (!n?.scheduleDaily) return false;
  try { n.scheduleDaily(hour | 0, minute | 0, String(title), String(body)); return true; }
  catch { return false; }
}

export function cancelReminders() {
  try { bridge('AndroidNotify')?.cancelReminders(); } catch {}
}

/* ------------------------------------------------------------
   4. BACKGROUND SYNC  (AndroidSync, APK 1.2+)

   The APK polls for new messages in a foreground service, so they
   arrive while the app is closed. That service and this page must
   agree on ONE "newest alert already announced" marker, or every
   message rings twice: once from Java while closed, once from
   notify_sm.js on the next open, replaying from its own stale
   localStorage copy.

   So when the bridge exists it OWNS the marker, and notify_sm.js
   reads and writes it through here instead of through its own store.
   On the web every function below degrades to null/false and the
   page keeps using localStorage exactly as before.
   ------------------------------------------------------------ */

/** True only in an APK new enough to have the service (1.2+). */
export const hasBackgroundSync = () => {
  const s = bridge('AndroidSync');
  if (!s?.available) return false;
  try { return !!s.available(); } catch { return false; }
};

/**
 * The shared marker, or null when there is no bridge.
 * null is meaningful: it tells the caller "use your own store".
 */
export function syncLastSeen() {
  const s = bridge('AndroidSync');
  if (!s?.lastSeen) return null;
  try {
    const v = s.lastSeen();
    // Java returns "" rather than null across the bridge, because a
    // null String arrives as the *string* "null" in some WebViews.
    return v ? v : null;
  } catch { return null; }
}

/** Returns true when the bridge accepted it, so the caller knows
 *  whether it still has to write its own copy. */
export function setSyncLastSeen(iso) {
  const s = bridge('AndroidSync');
  if (!s?.setLastSeen || !iso) return false;
  try { s.setLastSeen(iso); return true; } catch { return false; }
}

export function backgroundSyncEnabled() {
  const s = bridge('AndroidSync');
  if (!s?.enabled) return false;
  try { return !!s.enabled(); } catch { return false; }
}

export function setBackgroundSync(on) {
  const s = bridge('AndroidSync');
  if (!s?.setEnabled) return false;
  try { s.setEnabled(!!on); return true; } catch { return false; }
}

/**
 * False means Android may freeze the service in Doze — on MIUI it
 * will. The Settings card shows a warning while this is false.
 */
export function batteryExempt() {
  const s = bridge('AndroidSync');
  if (!s?.batteryExempt) return true;   // nothing to warn about on the web
  try { return !!s.batteryExempt(); } catch { return true; }
}

export function requestBatteryExempt() {
  const s = bridge('AndroidSync');
  if (!s?.requestBatteryExempt) return false;
  try { s.requestBatteryExempt(); return true; } catch { return false; }
}

export function openBatterySettings() {
  const s = bridge('AndroidSync');
  if (!s?.openBatterySettings) return false;
  try { s.openBatterySettings(); return true; } catch { return false; }
}

/**
 * Diagnostics for Settings → About: run count, last run, last error.
 * Without this the only way to know whether the service ever ran is
 * adb logcat, which the student does not have.
 */
export function syncStatus() {
  const s = bridge('AndroidSync');
  if (!s?.status) return null;
  try { return JSON.parse(s.status()); } catch { return null; }
}

/** Force one poll now — the "Test" button. */
export function syncNow() {
  const s = bridge('AndroidSync');
  if (!s?.pollNow) return false;
  try { s.pollNow(); return true; } catch { return false; }
}

/* ------------------------------------------------------------
   5. SHARE + DEVICE
   ------------------------------------------------------------ */

export async function share(text, url) {
  const dev = bridge('AndroidDevice');
  if (dev?.share) { try { dev.share(text || '', url || ''); return true; } catch {} }
  if (navigator.share) {
    try { await navigator.share({ text, url }); return true; } catch { return false; }
  }
  return false;
}

export function deviceInfo() {
  const dev = bridge('AndroidDevice');
  if (!dev?.info) return { platform: 'web' };
  try { return JSON.parse(dev.info()); } catch { return { platform: 'android' }; }
}

/** Small stable positive int, so a notification id is reproducible. */
function hashId(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2000000;
}

export default {
  isNative, haptic, hasCamera, openCamera,
  nativeNotifyState, requestNativeNotify, openNativeNotifySettings,
  nativeNotify, cancelNativeNotify, scheduleDailyReminder, cancelReminders,
  hasBackgroundSync, syncLastSeen, setSyncLastSeen,
  backgroundSyncEnabled, setBackgroundSync,
  batteryExempt, requestBatteryExempt, openBatterySettings,
  syncStatus, syncNow,
  share, deviceInfo
};
