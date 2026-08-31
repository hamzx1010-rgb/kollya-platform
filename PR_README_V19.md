# PR to open: V19 — Marketplace, Facebook-style sidebar, Documents, Classmates

## How to ship (new coding session, or local clone)

```bash
cd kollya-platform

git checkout arena/01a054ce-kollya-platform   # work is already here
git push -u origin arena/01a054ce-kollya-platform

gh pr create --base main --head arena/01a054ce-kollya-platform \
  --title "Marketplace, Facebook-style sidebar, Documents shelf, Classmates by level" \
  --body-file PR_README_V19.md
```

The branch sits on the old base `9898042`. It does NOT contain PR #1's
merge, so after pushing either (a) `git fetch origin && git merge origin/main`
or (b) let GitHub compute it — the diff vs `main` is clean, shown below.

If conflicts appear, `git rebase origin/main` resolves them trivially
(the touched files are disjoint from PR #1's).

## Commits

- `6ca6211` Marketplace: student flea market as the 5th campus tab
- `9defe30` Refresh public/FULL_SCHEMA_sm.sql copy with marketplace table
- `f217d17` Facebook-style sidebar (hamburger + drawer), Documents shelf, Classmates by level

## Diff vs merged main (28 files, +4880/−37)

```
db/18_marketplace_sm.sql            |  59 +   (marketplace table + RLS)
db/19_docs_classmates_sm.sql        |  65 +   (documents table + profiles.level + RLS)
db/FULL_SCHEMA_sm.sql               | 139 +-  (both merged in)
db/README_sm.md                     |   4 +-
public/index_sm.html                |  80 +   (hamburger, drawer, rail items)
public/js/core/shell_sm.js          |  40 +   (rail toggle + drawer logic)
public/js/core/api_sm.js            | 107 +-  (marketplace/documents/classmates methods, level col)
public/js/core/i18n_sm.js           | 144 +-  (EN/FR/AR keys)
public/js/core/icons_sm.js          |   6 +   (tag, file, upload, chart, menu)
public/js/core/router_sm.js         |   3 +
public/js/features/campus_sm.js     | 233 +-  (marketplace screen)
public/js/features/documents_sm.js  | 204 ++  (new)
public/js/features/classmates_sm.js | 125 ++  (new)
public/js/features/profile_sm.js    |   9 +-  (level field)
public/css/layout_sm.css            | 155 +-  (rail-closed, drawer, docs, classmates)
public/sw_sm.js                     |   7 +-  (cache v3)
tests/*                             | ~120   (nav 84/84, quality 62/62, mocks, routes)
package.json / package-lock.json    | devDeps: puppeteer + @sparticuz/chromium (test infra)
public/FULL_SCHEMA_sm.sql           | copy served at /FULL_SCHEMA_sm.sql for Neon paste
```

## Verification (all green)

- nav 84/84 (hamburger collapse/expand, phone drawer open→navigate→close,
  market/documents/classmates/profile in rail)
- background 47/47 · live 74/74 · persist 38/38 · sound 22/22
- quality 62/62 (new guards: manual toggle only, no auto-fold)
- app 56/56, css 28/28, i18n-notify 68/68; jsdom = HEAD baseline
- Live-verified: doc upload + delete, classmates grouping (4 faculties/6 levels/24 people), rail toggle, drawer navigation

## Notes for the reviewer

- `public/FULL_SCHEMA_sm.sql` is the single-file schema the user pastes
  into Neon (docs say "the one file"); it now contains marketplace +
  documents + level. `db/18_*` and `db/19_*` are the readable migrations.
- Launch still requires the user-side Neon step (Auth → Email & Password
  + trusted domains) before real sign-in works.
