# The database — one file

## Use this

**`db/FULL_SCHEMA_sm.sql`**

Neon Console → SQL Editor → paste the whole file → Run →
Data API page → **Refresh schema cache** → reload the app.

That is everything. Do not run `01_…` through `11_…` — this file is
already all of them.

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

26 tables · 29 functions · 2 views · 64 policies · 21 indexes ·
3 triggers.

---

## How it was produced, and how it is checked

`tests/sql/build_schema.mjs` loads all eleven migrations into a
throwaway PostgreSQL 17, lets the database settle the final state,
then reads that state back out of the catalog. So the file cannot
drift from what the migrations actually produce — it *is* what they
produce.

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
