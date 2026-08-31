# The database — one file

## Use this

**`db/FULL_SCHEMA_sm.sql`** (same file is also served at
`public/FULL_SCHEMA_sm.sql` for the one-file Neon paste, and is
copied as `db/FULL_SCHEMA_V19_sm.sql` to make the V19 version obvious).

Neon Console → SQL Editor → paste the whole file → Run →
Data API page → **Refresh schema cache** → reload the app.

That is everything. Do not run `01_…` through `19_…` — this file is
already all of them (including the V19 Marketplace + Documents +
Classmates migrations `18_marketplace_sm.sql` and
`19_docs_classmates_sm.sql`).

Safe to run twice. Safe on a database that already has your data:
it creates what is missing, replaces every function and policy with
the correct version, and un-freezes accounts stuck on `pending`.

---

## Why it is not the migrations glued together

The numbered files are a *history*, and a history contains its own
mistakes next to their fixes:

- `profiles_update_self` is defined **three times** — in 02, again in
  06 (wrongly, as `role = 'student'`), and again in 08.
- `status` defaults to `'pending'` in 01, then an `ALTER` in 10
  changes it to `'approved'`.
- `track_quest()` is created in 06 in a form that **always** raised
  `column reference "quest_id" is ambiguous`, then replaced in 11.
- `guard_profile_progress()` exists in 06, 08 and 11.

Pasting all of that works, but nobody reading it can tell which line
wins. `FULL_SCHEMA_sm.sql` states each object **once, already
correct**, in dependency order:

```
 0. prerequisites (auth.user_id, roles)      6. views
 1. media size guard                         7. row level security
 2. tables                                   8. triggers
 3. foreign keys                             9. grants
 4. indexes                                 10. repair an existing database
 5. functions                               11. final check
```

31 tables · 66 functions · 2 views · 86 policies · 34 indexes ·
17 triggers.

---

## How it was produced, and how it is checked

`tests/sql/build_schema.mjs` loads all migration files into a
throwaway PostgreSQL 17, lets the database settle the final state,
then reads that state back out of the catalog. So the file cannot
drift from what the migrations actually produce — it *is* what they
produce. The V19 addition is applied the same way (see
`db/18_marketplace_sm.sql` + `db/19_docs_classmates_sm.sql`).

Verified, not assumed:

| check | result |
|---|---|
| runs on a completely empty database | 0 errors |
| run a second time | 0 errors |
| columns, types, defaults vs. migrations | identical |
| primary / unique / foreign keys | identical |
| indexes, policies, triggers, functions, views | identical |
| `tests/sql/rls.test.sh` against this file alone | 34/34 |

The last row matters most: a real student, through the
`authenticated` role, can like / comment / post / follow / DM / upload
an avatar — and **cannot** set their own XP, forge a quest, promote
themselves, edit anyone else's profile, or read other people's DMs.

Regenerate any time with:

```bash
node tests/sql/build_schema.mjs
```

---

## The one deliberate change to your data

```sql
UPDATE profiles SET status = 'approved' WHERE status = 'pending';
```

Every account created before this fix is frozen: `status` defaulted to
`'pending'`, and nearly every write policy is gated on
`is_approved()`. That is the "you do not have permission" you kept
hitting. There was no admin screen, so nobody could ever be approved.

Moderation still works — `rejected` and `banned` accounts are still
refused.

---

## If something still fails

Send me the output of:

```sql
SELECT id, username, status, role FROM profiles;
```
