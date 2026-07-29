# "You do not have permission" — found and fixed

## Do this now (2 minutes)

Neon Console → **SQL Editor** → paste **`db/10_open_signup_sm.sql`** → Run.
Then Data API page → **Refresh schema cache**. Reload the app.

Safe to run twice. Safe even if you never ran 05–09.

The last thing it prints should be `pending_left = 0`.

---

## What was actually wrong

I finally installed a real PostgreSQL 17, loaded your migrations into
it, switched into the `authenticated` role the way PostgREST does, set
the JWT claim the way Neon does, and acted as a student:

```
INSERT INTO post_likes ... -> ERROR: new row violates row-level
                                     security policy
INSERT INTO comments   ... -> same
INSERT INTO posts      ... -> same
```

**Cause:** `profiles.status` DEFAULTS to `'pending'` (01_schema.sql),
and nearly every write policy is gated on `is_approved()`, which
demands `status = 'approved'`. Every account created through the app
was frozen — it could read and edit its own profile row, but never
like, comment or post. And **no admin screen was ever built**, so
nobody could be approved. The moderation queue was designed for a
university rollout that hasn't happened.

`10_open_signup_sm.sql` does three things:

1. `status` now defaults to `'approved'`, and the INSERT policy allows it
2. every existing `pending` account is switched to `approved`
3. `is_approved()` now only blocks `'rejected'` and `'banned'`

`auth_sm.js` also creates new profiles as `approved` instead of
`pending`, so signup no longer lands on the "waiting for an
administrator" screen.

## I was wrong for three sessions

I kept telling you to run `08_fixes_sm.sql` because `06_game_sm.sql`
narrowed the update policy to `role = 'student'`, "locking admins out".

**That was never the cause.** `profiles_admin_all` is a PERMISSIVE
policy, so admins always passed. I verified it: with the "bad" 06
policy in place, an admin UPDATE succeeded. I had been reading the SQL
and reasoning about it instead of running it. Running it took ten
minutes.

Run `08` anyway — it correctly stops a student rewriting their own
role or status — but it was not your bug.

## Why my tests kept saying it worked

`tests/browser/mock_neon.mjs` implemented PostgREST's *shape* and
**enforced no policies at all**. It returned whatever matched the
filter. So it happily "proved" liking and profile editing worked while
the real Neon refused both. That is the same class of mistake as
testing a seam nobody calls.

Two things now exist so this cannot repeat:

- **`tests/sql/rls.test.sh` — 30 assertions against a real Postgres.**
  Loads every migration, then checks what a student, a brand-new
  signup, an admin and a banned user can and cannot do.
- **The browser mock now enforces the approval gate** and returns a
  real 403 for pending/rejected/banned accounts.

## Also fixed

- The message itself. "You do not have permission" told you nothing.
  It now reads *"Your account is still awaiting approval, so it cannot
  post yet"*, and the console names the file to run.

## Totals

```
tests/run.sh          848/848   jsdom
tests/browser/run.sh  134/134   real Chrome
tests/sql/run.sh       30/30    real PostgreSQL 17   <-- new
```

## Two test bugs found while writing the RLS suite

- `psql -q` swallows the `UPDATE 0` command tag. RLS refuses in two
  ways — an error for a failed `WITH CHECK`, and a silent 0 rows when
  `USING` hides the row — so the harness read a correctly-refused
  UPDATE as success and claimed "student CAN edit others".
- The check only grepped for error text, missing the 0-row case.

Both fixed; neither was an app bug.

## Still not verified

I cannot reach your Neon project. The SQL is proven against
PostgreSQL 17 with your exact migrations, but **you have to run
`10_open_signup_sm.sql` yourself** — and if it still fails afterwards,
send me the output of:

```sql
SELECT id, username, status, role FROM profiles;
```
