# Koliya Android — `dist/Koliya-1.0.apk`

**3.8 MB · Android 7.0+ (API 24) · arm64-v8a, armeabi-v7a, x86, x86_64 ·
signed v2 + v3 · zipaligned**

## Install

1. Copy `Koliya-1.0.apk` to the phone
2. Tap it → Android will ask to allow "install unknown apps" → allow
3. Open **Koliya**

`dist/koliya-release.jks` is the signing key (`koliya2026` for both
passwords). **Keep it.** An APK signed with a different key cannot
update one signed with this key — Android will refuse and the student
would have to uninstall and lose their session.

---

## What is native, and why

The UI is the same 14,635-line web app with 850 passing tests, running
in a WebView. Rewriting it in Kotlin would have thrown all of that away
for weeks of work. What the browser genuinely **cannot** do is real
Android code:

| Feature | Implementation |
|---|---|
| Camera in story + post | `CameraActivity` on **CameraX** — the only camera API that behaves the same across Samsung / Xiaomi / Oppo / Android Go |
| System notifications | `NotifyBridge` — 9 channels, POST_NOTIFICATIONS on Android 13+, survives the app being closed |
| Daily reminders | `ReminderWorker` on **WorkManager** — survives reboot and Doze |
| Haptics | `DeviceBridge` — 5 distinct patterns for the gestures |
| Share sheet | native Android chooser |
| Back button | asks the web app first, so a sheet closes before the app does |

Assets load from `https://appassets.androidplatform.net`, not `file://`.
That matters: a `file://` page is an opaque origin, and several OEM
WebViews silently disable `getUserMedia`, the Notification API and
persistent `localStorage` on it.

---

## Notifications — every event now produces one

Before, only **like** and **comment** ever wrote a notification row.
Follows, message requests, mentions, answers and events were invisible.

Now written by `api_sm.js`, shown on the notifications page **and** as a
system notification:

follow · follow request · like · comment · **@mention** (scanned out of
post and comment text) · **direct message** · **message request** ·
Q&A answer · event · achievement / badge

Each maps to its own Android channel, so a student can silence *likes*
and keep *messages*. Likes are `IMPORTANCE_LOW` on purpose — a popular
post should not vibrate the phone forty times.

Permission is asked by the in-app explainer card, never on boot: an
unexplained prompt is a denied prompt, and Android will not ask twice.

---

## Gestures — designed sessions ago, built now

`core/gestures_sm.js`, on the message thread:

- **hold** → reaction picker (`medium` haptic)
- **swipe** → reply, with the arrow revealed behind the bubble and a
  `tick` haptic at the commit point
- **double tap** → react
- **pull to refresh** available for lists

Rules it obeys, each one verified with real touch input:
a long-press that **moves** is a scroll, not a press · horizontal
intent is only claimed after 12px sideways · in Arabic the swipe runs
**right-to-left** · on a mouse it refuses to attach at all, because
desktop already has hover toolbars and right-click.

---

## Bug found by looking at a phone screenshot

At 412px the composer's four attachment buttons plus mic and send took
**400px of a 400px row**, leaving the text field **112px** — the
placeholder itself wrapped to two lines and was clipped. Below 560px
GIF/file/emoji now collapse and the field keeps its width:

| width | text field before | after |
|---|---|---|
| 412px | 112px (clipped) | 256px |
| 360px | — | 205px |
| 320px | — | 166px |

---

## Test totals

```
tests/run.sh          850/850   jsdom
tests/browser/run.sh  188/188   real Chrome
  live      74   layout, contrast, i18n, GIF, info panel
  persist   38   everything survives F5
  sound     22   WebAudio oscillators actually fire
  native    34   the APK's JS half, with the bridges faked
  gestures  20   real CDP touch input, incl. RTL direction
tests/sql/run.sh       34/34    real PostgreSQL 17
```

`native.test.mjs` injects fake `AndroidCamera` / `AndroidNotify` /
`AndroidDevice` objects that record every call, then drives the real
UI. A wrong method name or a missing argument fails there exactly as it
would on a phone. It also asserts the **website** still works with the
bridges absent.

---

## What I could NOT verify — read this part

**I never ran this APK.** The sandbox has 2 GB of RAM and no
`/dev/kvm`, so the Android emulator refuses to boot
(`ERROR: Insufficient RAM free for launching emulator`). I tried, with
`-gpu off -accel off -memory 700`, and it still would not start.

So the Java side is verified **structurally**, not behaviourally:

| verified | how |
|---|---|
| compiles against SDK 34 | Gradle, 0 errors |
| all 9 classes present in the APK | read out of `classes.dex` |
| all 12 `@JavascriptInterface` methods present | same |
| signature valid, v2 + v3 | `apksigner verify` |
| zipaligned | `zipalign -c` |
| permissions + minSdk correct | `aapt dump badging` |
| web assets bundled (32 JS files) | unzipped the APK |
| the JS half calls the bridges correctly | 34 Chrome tests |

**Not verified:** that it launches, that CameraX opens on a real
sensor, that a notification actually appears in the shade, that
WorkManager fires at 19:00, that haptics feel right, or how it behaves
on a specific OEM skin.

The first install is the real test. If it crashes, send me the output of:

```
adb logcat -d | grep -iE "koliya|AndroidRuntime"
```

and I will have the exact stack trace.

---

## Rebuild

```bash
cd /home/user/koliya-apk
cp -r ../koliya/public/* app/src/main/assets/
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \
ANDROID_HOME=/home/user/android-sdk \
/home/user/gradle-8.7/bin/gradle :app:assembleRelease --no-daemon
```

Note `gradle.properties` caps the heap at 1 GB — this machine has 2 GB
and a larger heap gets the daemon OOM-killed mid-packaging.
