# V19 — Marketplace, Facebook-style sidebar, Documents shelf, Classmates by level

## What this branch adds

This PR adds the **V19 database schema** that supports the Marketplace,
the Documents shelf, and Classmates-by-level features:

- **Marketplace** — student flea market as the 5th campus tab
  - `db/18_marketplace_sm.sql`: new `marketplace_items` table
    (`seller_id`, `title`, `description`, `price_cents`, `currency`,
    `category`, `condition`, `image_url`, `status`), indexes, an
    `updated_at` trigger, and RLS (browse available, list your own,
    update/delete your own, admin moderation).
- **Documents shelf** — per-user upload shelf
  - `db/19_docs_classmates_sm.sql`: new `documents` table
    (`owner_id`, `title`, `description`, `subject`, `level`, `kind`,
    `file_url`, `file_name`, `size_bytes`, `shared_public`,
    `downloads`), indexes, a touch trigger, and RLS (owner full
    access; approved users can read shared documents).
- **Classmates by level**
  - Adds `profiles.level` (`''` or `1`–`6`) plus indexes on
    `(faculty, level)` / `(faculty)` / `(university)` for grouping
    the Classmates screen.

## Files changed

```
PR_README_V19.md             |  68 +   (this PR description)
db/18_marketplace_sm.sql     | 128 ++  (marketplace migration)
db/19_docs_classmates_sm.sql | 158 ++  (documents + classmates migration)
db/FULL_SCHEMA_V19_sm.sql    | 2948 +  (merged one-file V19 schema)
db/FULL_SCHEMA_sm.sql        | 289 +-  (existing one-file schema, now V19)
db/README_sm.md              |  19 +-  (points to V19 schema/migrations)
public/FULL_SCHEMA_sm.sql    | 2948 +  (copy served for the Neon paste)
```

## DB schema summary

- 31 tables · 66 functions · 2 views · 86 policies · 34 indexes ·
  17 triggers
- Every statement is idempotent (`IF NOT EXISTS` / `OR REPLACE` /
  `DROP … IF EXISTS`), safe to run on a fresh database or on top of
  the existing schema.
- `public/FULL_SCHEMA_sm.sql` is the single file to paste into Neon
  (SQL Editor → Run → Data API → Refresh schema cache).
- For an existing database you can instead run only:
  ```sql
  \i db/18_marketplace_sm.sql
  \i db/19_docs_classmates_sm.sql
  ```

## Verification note

This branch contains the **database/schema layer** of V19. The V19
frontend commits (`6ca6211`, `9defe30`, `f217d17`) are on the separate
feature branch and are intentionally not part of this schema PR, so
the schema can be reviewed and applied independently.
