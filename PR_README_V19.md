# V19 — Marketplace, hamburger drawer, Documents shelf, Classmates by level

This PR is the **frontend** half of V19. It sits on top of the V19
database schema already in `main` (`db/18_marketplace_sm.sql`,
`db/19_docs_classmates_sm.sql`) and adds the screens that use it.

## What this branch adds

- **Marketplace** — the student flea market as a full campus tab
  - `public/js/features/marketplace_sm.js`
  - Grid of listings, filter chips (All / Available / Mine / Sold),
    publish sheet with photo, price in DZD, category and condition,
    "Mark as sold" and delete for the seller.
  - `marketplaceApi` in `core/api_sm.js` (RLS + media size enforced
    by the database, not the UI).
- **Hamburger drawer**
  - `#btnMenu` in the topbar opens a drawer built from the route table,
    so Marketplace, Documents and Classmates are reachable on a phone
    even though the bottom bar only fits five core items.
  - Drawer markup in `index_sm.html`, logic in core/shell_sm.js.
- **Documents shelf**
  - `public/js/features/documents_sm.js`
  - Upload sheet (title, subject, level, file, optional public share),
    per-student "My shelf", "Shared by other students" list, download
    and delete (owner only).
  - `documentsApi` in `core/api_sm.js` using `toStorable(..., 'doc')`.
- **Classmates** by faculty → level
  - `public/js/features/classmates_sm.js`
  - Approved students grouped by faculty, then by `profiles.level`
    (1–6, or unset).
  - `classmatesApi` in `core/api_sm.js`.
- **Entry point + service worker fix** (`/` was serving the stale
  3 KB placeholder)
  - `public/index.html` is now the real app shell (same as
    `index_sm.html`).
  - `sw_sm.js` bumped to `v4` and precaches `/`, `index.html` and
    `index_sm.html` so navigation falls back to the real shell.
- **i18n**: EN / FR / AR + RTL-safe labels for every new screen and
  the drawer, in `core/i18n_sm.js`.
- **Tests**: `tests/app.test.mjs` now walks the three new routes and
  asserts the hamburger opens/closes the drawer.

## Files changed

```
public/index.html
public/index_sm.html
public/js/app_sm.js
public/js/core/api_sm.js
public/js/core/i18n_sm.js
public/js/core/icons_sm.js
public/js/core/media_sm.js
public/js/core/router_sm.js
public/js/core/shell_sm.js
public/js/features/marketplace_sm.js      (new)
public/js/features/documents_sm.js        (new)
public/js/features/classmates_sm.js       (new)
public/css/layout_sm.css
public/sw_sm.js
tests/app.test.mjs
```

## DB schema

Already in `main`. For a fresh Neon setup run
`db/FULL_SCHEMA_sm.sql` (or `db/18_marketplace_sm.sql` +
`db/19_docs_classmates_sm.sql` on an existing database), then
Data API → Refresh schema cache.

## Verification

- jsdom app smoke: `60/60` including the three new routes.
- quality: `57/57`, css: `28/28`, core: `57/57`, language: `38/38`.
- Pre-existing baseline failures (not regressions): dm 65/66,
  hub-profile 57/58, leaderboard 31/33.
- Static checks for the old deploy bug:
  - `curl <url>/ | grep -c btnMenu` → `1`
  - `curl <url>/sw_sm.js | grep VERSION` → `v4`
