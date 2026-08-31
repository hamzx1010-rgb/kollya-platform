# V20 — empty states, the Facebook fold, the profile as a card, and an audit

Four tasks, all on top of `main` at `5cda669`. Nothing that shipped in
PR #2/#3/#4 was moved or undone: notifications stay a top-bar bell, the
phone ☰ stays next to the Koliya wordmark, PGRST205 still says
"Database update needed" in three languages.

---

## 1. `[object HTMLDivElement]` on Marketplace / Documents / Classmates

`emptyState()` returns a **DOM node**. Six places interpolated it into
a template string, and a template string stringifies a node:

| file | lines |
|---|---|
| `public/js/features/marketplace_sm.js` | 112, 118 |
| `public/js/features/documents_sm.js` | 90, 97 |
| `public/js/features/classmates_sm.js` | 100, 105 |

All six now use `${emptyState({...}).outerHTML}`. None of them passes an
`action`, so there is no listener to lose — the markup is identical to
what `append()` would have produced.

The **error** states were kept, exactly as asked: when the Neon schema
cache is stale those three tabs still render "Database update needed…",
only now as text instead of `[object HTMLDivElement]`.

Guarded by a new assertion in the whole-app route walk:
`${name}: no stringified DOM node` — every route, every render.

## 2. The sidebar folds like Facebook's

- The ☰ lives **inside the sidebar**, on the `.rail-logo` row next to
  the K mark (`#btnRailFold`). It is not in the top bar.
- Clicking a nav tab folds the rail to a 64px icon strip
  (`--nav-w-collapsed`); clicking the ☰ toggles it back. The state is
  remembered in `localStorage` (`kl.rail.collapsed`).
- `shell_sm.js` no longer hardcodes `data-rail="expanded"`: one piece
  of state (`railCollapsed`), changed only by a real click.
  `wireRailPeek()` is no longer a no-op — it wires the fold. The three
  mechanisms that used to fight each other (route rule, 2.2s timer,
  hover peek) stay dead.
- Collapsed CSS is fresh in `layout_sm.css`
  (`.app[data-rail="collapsed"]`): labels, wordmark and identity text
  hidden, grid track shrunk, **48px** targets everywhere, badges pinned
  to the icon. Logical properties only, so Arabic mirrors it.
- Labels survive as tooltips. They are native `title` attributes set by
  `syncRail()`, not the styled `[data-tip]` bubble — the rail scrolls
  and clips, so a CSS tooltip would have been cut in half on a 64px
  strip. They are removed again when the rail expands, so an expanded
  row does not show a tooltip that duplicates its own label.
- **Phones are untouched.** `.rail-logo` is `display:none` under 900px,
  which is what makes the in-rail ☰ desktop-only; the phone ☰ is still
  `#btnMenuTop` in `.topbar-brand`. The phone media query also
  neutralises `[data-rail="collapsed"]` explicitly, because
  `.app[data-rail=…]` outranks a bare `.app` on specificity.

## 3. The profile **is** the student card

The card widget that lived inside the profile (`studentCardMarkup()`,
`qrPattern()`, `.student-card`, `.sc-*`) is **gone** — that was the
copy of the official Algerian card, chip and barcode included, that was
already rejected. The head itself is now the card:

- **Square photo** (`--r-lg` corners, not a circle), 96px desktop /
  80px phone, pinned onto the panel and overlapping the banner.
- **The banner is untouched** — same `.pf-cover`, same shrink-and-blur
  on scroll, same edit button.
- The XP ring still works: a conic gradient does not care about corner
  radius, so it now reads as a square ring.
- Same information, laid out like a card: an eyebrow (K + "STUDENT
  CARD"), name, `@username`, faculty, then a printed field strip —
  university, faculty, level, card number. Empty fields are not drawn.
- The card number stays LTR inside Arabic (`unicode-bidi: isolate`).
- Original: no chip, no barcode, no QR, no official wording. One
  gradient hairline along the top edge and Koliya's own type scale.
- The avatar `<img>` finally has a real `alt` ("Photo of {name}").

## 4. Audit — what was missing

**Fixed in this PR (the cheap ones):**

| Gap | What it was | Fix |
|---|---|---|
| Auth screen not trilingual | labels, buttons, every validation message, the eye button's aria-label, the "forgot password" link and the whole pending screen were hardcoded **French** while the app defaults to English | ~20 new keys in en/fr/ar, all literals replaced |
| Terms / privacy unreachable before sign-up | only linked from Settings, i.e. after the account exists | `.auth-legal` row on the auth card, links to `cgu.html` and `privacy.html` |
| No 404 screen | any unknown hash was silently rewritten to the feed, so a dead link looked like a random redirect | `notFound` route + screen ("This page does not exist" + Back to home). An **empty** hash still means home |
| "Report" did nothing | reporting a post or a message fired a success toast and wrote no row — a moderation action that only pretends | both call `profileApi.report('post'/'message', …)` and report failure honestly |
| Notifications swallowed errors | a failed load returned `[]` and painted "No notifications yet" — the exact lie PGRST205 handling exists to prevent | keeps `loadError`, renders the error state with Retry |
| Leaderboard swallowed errors | a throw escaped into `route:error`, leaving the board on skeletons behind a generic toast | same treatment |
| Offline page French-only | `offline_sm.html` cannot import i18n (it has to work with no network) | carries its own en/fr/ar strings, reads the saved locale, sets `dir` |
| Post images invisible to screen readers | `alt=""` on feed/campus post media and event covers | alt = the post's own text, falling back to "Image shared by {name}" / "Cover image for {title}" |
| Stale shell after this release | service worker still on `v4` | bumped to `v5`, so old shell caches drop on activate |

**Already fine (checked, not touched):**

- Sign-out: Settings → Account, plus the pending screen. Settings is
  reachable on desktop (drawer ☰ is visible at every width) and on the
  phone (drawer + profile ⚙).
- Account deletion: Settings → `self_delete_account` RPC, with an
  honest error when the RPC is missing.
- Block: profile menu and chat info panel, both write `blocks`, and
  RLS enforces it server-side (`db/02_policies.sql`).
- Loading / empty / error on every tab: feed, messages, profile,
  marketplace, documents, classmates, campus, hub, notifications and
  the leaderboard all have all three now.
- Offline behaviour: SW never caches `/rest/` or `/auth/`, offline page
  auto-returns when the network comes back, and the app shows a
  persistent offline toast.

**Still missing — needs a product or database decision, not a patch:**

1. **No unblock.** You can block, but nothing lists who you blocked or
   lets you undo it. Needs a Settings → Blocked accounts screen.
2. **Password reset needs an admin.** `/forget-password` mails the
   internal `…@carte.koliya.dz` address, which nobody reads, so the
   toast honestly says an administrator will be in touch. A real
   self-serve reset needs a mail relay and a recovery address per
   student.
3. **Reports have no queue.** Rows land in `reports` and no screen ever
   reads them. Moderation is currently "someone opens the SQL editor".
4. **Account deletion is a soft delete** (status + blanked fields). It
   is the right default, but there is no export-my-data and no hard
   delete after a grace period.
5. **No error boundary per view.** A crashing view emits `route:error`
   and toasts; the pane itself stays on whatever it last painted.

---

## Tests

`node --experimental-vm-modules --import=/tmp/fixg.mjs tests/<file>.test.mjs`

```
app 92/92   auth-ui 57/57   core 58/58   css 28/28   feed 45/45
game 65/65  i18n-notify 68/68  language 38/38  layers 22/22
parse 36/36 polish 39/39  quality 74/74  requests 35/35
campus 67/68        (baseline: story marked seen)
dm 65/66            (baseline: seven folders including Requests)
hub-profile 64/65   (baseline: private badge shown)
leaderboard 31/33   (baseline: scope/metric persist)
```

Only the four pre-existing failures remain. Tests changed on purpose:

- `quality`: the "no fold" guards became "the fold is back, and it is
  in the sidebar" guards, plus new guards for the audit fixes.
- `core`: an unknown hash now resolves to `notFound`, not `feed`.
- `auth-ui`: five assertions checked French literals on a screen that
  is now translated — they check meaning in all three languages.
- `app`: matchMedia stub answers the 900px desktop query, plus the new
  fold, 404 and stringified-node assertions.
- `hub-profile`: new assertions for the card head and the square photo.
