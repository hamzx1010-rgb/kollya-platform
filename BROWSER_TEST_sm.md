# Real-browser testing — what changed

Until today every test ran in **jsdom**, which parses HTML and runs JS
but computes **no layout**: every width is 0, every colour is
unresolved, nothing has a position. That is why 837 passing tests
coexisted with a broken split-screen and a dead GIF button.

There is now a **real headless Chrome** (Chromium 148) running the
**unmodified** `public/` build against a local PostgREST + Better-Auth
look-alike, so `auth_sm.js`, `db_sm.js`, `api_sm.js` and every feature
module execute exactly as deployed.

```
bash tests/run.sh          # jsdom   838/838
bash tests/browser/run.sh  # Chrome   58/58
node tests/browser/lang_audit.mjs   # untranslated-string sweep
node tests/browser/shots.mjs        # screenshots -> shots/
```

## Files

| File | Role |
|---|---|
| `tests/browser/mock_neon.mjs` | PostgREST subset (`eq/in/or/order/limit`, `Prefer: count=exact`, `merge-duplicates`) + Better-Auth routes + all 20 RPCs from `db/06,07,09` |
| `tests/browser/harness.mjs` | launches Chrome, rewrites the two hardcoded Neon hostnames onto the mock, collects console + page errors |
| `tests/browser/live.test.mjs` | 58 assertions on measured pixels |
| `tests/browser/lang_audit.mjs` | walks 12 routes, flags user-visible French |
| `tests/browser/shots.mjs` | writes `shots/*.png` |

The app source was **not** modified to make it testable — Chrome's
request interceptor does the redirection at the network layer.

---

## Bugs found and fixed

### 1. Split screen — pages shrank to a third (the reported bug)

`.app` is `grid-template-columns: var(--nav-w) minmax(0,1fr)`. Below
900px the nav rail becomes a fixed bottom bar, but **the grid still
reserved its column**, and `.main` was handed the leftover track.

Measured at 900px: `.app` computed `248px 652px`, `.main` came out
**248px**, `.view-inner` **238px**.

```css
@media (max-width: 900px) {
  .app, .app.has-rail { grid-template-columns: minmax(0, 1fr); }
}
```

| window | `.view-inner` before | after |
|---|---|---|
| 1280 | 780 | 780 |
| 1000 | 742 | 742 |
| **900** | **238** | **890** |
| 700 | 238 | 690 |
| 380 | 238 | 370 |

Horizontal scroll is 0 at every width tested.

### 2. GIF button did nothing

Two independent faults, both proven, not guessed:

- **Listener leak.** `openThread()` calls `wireComposer()` on every
  thread open, but the composer DOM persists. Confirmed over CDP with
  `DOMDebugger.getEventListeners`: `#btnGif` had **3** click listeners.
  Two handlers meant `openGifPicker()` ran twice per click; the second
  hit its own `if (panel) close()` toggle, so the picker opened and shut
  in the same tick. `MutationObserver` recorded `ADDED` then `REMOVED`.
  Fixed with a `data-wired` guard — now 1 listener, stays 1.
- **Opened downward, off-screen.** `place()` measured the panel while
  the grid was still skeletons (~150px) and set `top`; the panel then
  grew to its 460px max and spilled past the window (bottom **1113** in
  an 860px viewport). Now anchored by `bottom` with an explicit
  `maxHeight`, so growth expands upward.

Verified at three heights — 860/700/520 — all `flip=up`, fully
on-screen, 8 tiles. Against the live Giphy CDN all 8 load at real
dimensions (200×200, 200×112…).

### 3. Info panel covered the composer

At 1360px the info panel overlaid **46% of the composer including
Send** — `elementFromPoint` on the Send button returned `DIV.tg-title`.

- JS auto-opened it at `innerWidth >= 1280`, but CSS only gives it a
  grid column at `>= 1400`. Between those it is an absolute overlay.
  Threshold moved to 1400.
- The overlay used `inset-block: 0` (full height). Also the base
  `.info-panel { height: 100% }` **beat** the inset pair — the panel
  measured 824px inside an 804px box. Now `height: auto` plus
  `inset-block-end: var(--composer-h)`, published live by a
  `ResizeObserver` because the textarea grows to 132px as you type.

Result: info bottom 817, composer top 817, Send clickable.

### 4. Languages were half-wired

The switcher worked; the strings did not.

- **31 hardcoded French strings** rendered while the UI was English —
  `Envoyer`, `Enregistrer un message vocal`, `Rechercher…`,
  `Écrivez un message…`, `Votre position`, and 26 more, plus **36
  hardcoded French toasts**. jsdom could not catch these: it asserts on
  i18n *keys*, and a French literal has no key to be missing.
- `campus_sm.js` built its `SCREENS` config **once at import time**, so
  route titles and placeholders froze in whatever language loaded
  first. Now a function, re-read per mount.
- Added ~40 keys × 3 languages. Sweep is down to 7 hits, all false
  positives (`Archived`, `Archivist`, and seeded post text).

### 5. Contrast below WCAG AA

Real computed colours, composited:

| token | was | now |
|---|---|---|
| `--text-3` light (faculty labels, 11px) | 3.18:1 | **4.87:1** |
| `--text-3` dark | 3.75:1 | **5.30:1** |
| active nav item on brand tint | 4.06:1 | **5.87:1** (new `--brand-on-tint`, lighter in dark theme) |

Worst text on screen is now 4.65:1.

### 6. Hit targets and labels

Post like/comment/share/save buttons measured **18×18** and 26×18 —
under the 24px minimum — and had **no accessible name**. Padded to 32px
(icon unmoved, spacing preserved via negative margin) and given
`aria-label`s. Inline text links are correctly exempt.

### 7. RTL bidi — `@sara.b` rendered as `sara.b@`

The leading `@` is neutral punctuation; in an Arabic paragraph the bidi
algorithm moves it to the far end. Added a `.handle`
(`direction:ltr; unicode-bidi:isolate`) and applied it to all 9
`@username` sites.

### 8. Nav badge clipped

In the bottom bar the unread count inherited `margin-inline-start:auto`
from the sidebar layout, which in a column pushes it *below* the label:
it rendered at 863–881px in an 880px window, 1px off-screen. Now
absolutely positioned on the icon.

---

## Also fixed while here

- `const t = toast(...)` in `profile_sm.js` **shadowed the translation
  function** `t()` for the whole block — the same class of bug as
  before. Renamed to `saving`.
- `data-tip=t('a11y.escape')` was unquoted and would have rendered
  literally.
- `'<span>${esc(t('feed.anonymous'))}</span>'` used **single quotes**,
  so `${}` never interpolated. A static grep cannot distinguish this
  from a normal attribute; a new test greps the **rendered DOM** across
  12 routes for literal `${`.
- `tests/feed.test.mjs` matched the hardcoded French `'Anonyme'` and
  crashed once that pill was translated. It now derives the label from
  i18n, so it is language-agnostic.

---

## Not verified — be precise about this

- **No real device, no real network.** Headless Chrome on Linux at
  fixed viewports. Not tested: an actual phone, touch, iOS Safari,
  Firefox, slow 3G, or a high-DPI screen.
- **Neon was never contacted.** The mock reproduces PostgREST's *shape*,
  not Postgres. **RLS policies were not exercised at all** — the mock
  returns whatever matches the filter. Migrations `05–09` are still
  unrun, so profile editing is still broken for you until you run them.
- **Giphy reachability from Algeria** is unverified. It answered 206
  from this sandbox; that says nothing about your ISP.
- Fonts differ from your machine, so text wrapping may not match
  exactly.
- No screen-reader pass, no keyboard-only walkthrough of every flow.
- Screenshots in `shots/` are real renders, but of **seeded** data.

---

# Session 2 — victory sound + leaderboard table

## The question you asked

- **Victory sound: NO, it did not exist.** The achievement card appeared
  in total silence — zero audio files and zero `AudioContext` anywhere
  in the project. I checked before answering rather than guessing.
- **Leaderboard: yes, it really was an Olympic podium** — stepped
  platforms at 56 / 38 / 26 px with 1st in the middle. There was a
  *second* copy of the same podium in `hub_sm.js`.

## Sound — `core/sound_sm.js` (new)

Synthesised with WebAudio, no mp3: zero bytes downloaded, no licence,
works offline, and the melody is readable in the source.

| event | sound |
|---|---|
| quest ticked | rising third, C-E-G (523/659/784 Hz) |
| all quests done | full arpeggio to the octave, peaks 1319 Hz |
| day complete / level up | brighter arpeggio from E |
| badge earned | two notes, root + octave |
| streak saved by a freeze | soft low sine — relief, not triumph |

Three rules it obeys: never on a hidden tab, never under
`prefers-reduced-motion`, never touches `AudioContext` before a user
gesture. On by default, with a toggle **and a Play button** in Settings.

**Proof it is not silent** (`tests/browser/sound.test.mjs`, 22/22): the
test taps the WebAudio graph and records every oscillator scheduled —
frequencies, gain ramps, note count. Muting is verified as **zero
oscillators created**, not merely a flag flipped. Firing the real
achievement card fires real notes.

## Leaderboard — one table

Both screens now render the same `.lb-table`. Rank 1/2/3 get a gold /
silver / bronze chip; **4-20 are plain numbers**. Capped at 20. Your
pinned position bar is untouched.

Verified in Chrome: 20 rows, ranks `1,2,3,…,9,9,9,12,…,20` (dense
ranking survives), medals `gold, silver, bronze, plain, plain…`, and
the top three share **one** row height — no steps.

## Caught by looking at the screenshot, not the numbers

- The filter pills were still French (`Ma faculté`, `Tout le campus`,
  `Séries`) while the UI was English.
- **The medals were nearly invisible**: the silver chip measured
  **1.11:1** against the white page, gold 1.25:1. Darkened all three.
  Then my own new test caught bronze at 4.41:1 — under AA — so it was
  darkened again to 4.94:1.

Also translated on the way: the day-complete modal, the badge-unlock
title, the empty leaderboard state, and the rank strip.

## A test bug, not an app bug

The first sound test failed "it is a melody, not one repeated pitch".
The cause was my spy reading `oscillator.frequency.value`, which
reports the *current* automation value — for a note scheduled 20 ms
ahead that is still the 440 Hz default, so every note read back as 440.
Tapping `setValueAtTime` instead showed the real melody. The audio was
correct the whole time.

## Totals

```
tests/run.sh          848/848
tests/browser/run.sh   96/96   (live 74 + sound 22)
```

## Still not verified

- **You have never heard it.** I verified the oscillators exist, their
  frequencies, and their gain envelopes — headless Chrome has no
  speaker. Whether the melody is *pleasant* is a judgement only you can
  make. If it grates, the notes are three readable lines in
  `sound_sm.js`.
- iOS Safari needs a user gesture before any audio and is stricter than
  desktop Chrome; untested.
- Migrations `05–09` are **still unrun** — profile editing stays broken
  until you run them.
