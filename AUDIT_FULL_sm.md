# Full audit — every file checked, every flow tried

## Do this now

Neon Console → **SQL Editor** → paste **`db/ALL_IN_ONE_sm.sql`** → Run →
Data API page → **Refresh schema cache** → reload the app.

One file. It contains 01, 02, 05, 06, 07, 08, 09, 10 and the new 11.
Verified: run it twice on an empty database and twice on a populated
one — zero errors, and all four final checks return 0.

---

## Static checks (all 30 JS files, 14,635 lines, 11 SQL files)

| check | result |
|---|---|
| every JS file parses | pass |
| tables the JS queries vs. real schema | no mismatches |
| RPCs the JS calls vs. real functions | no missing |
| filter/select columns vs. real columns | no mismatches |
| i18n keys used vs. defined | all resolve |
| en / fr / ar parity | 592 keys each, no gaps, no extras |
| every table has RLS + a policy | 26/26 |
| grants to `authenticated` | all present |

---

## Bugs found by acting as a student

### 1. Posting was impossible
Clicking **Create** opened **two composers stacked in one modal**. You
typed into the first textarea while the character counter and the
Publish button belonged to the second, which stayed at `0 / 500` — so
Publish never enabled.

Two separate causes, both listener leaks:
- `app_sm.js` **and** `feed_sm.js` both listened for `key:compose`.
- `wireFeed()` runs on **every** mount of the feed route and
  re-registered four global bus listeners. Visit the feed three times
  and one keypress opened three composers.

### 2. Six controls rendered literal code on screen
`data-tip=t('editor.redo')` — unquoted, so the attribute value was the
literal string `t('editor.redo')`. One was a visible **placeholder**
in the story reply box.

### 3. Thirteen constants froze the language at import time
`TABS`, `FOLDERS`, `BADGES`, `CHAT_THEMES`, `KIND`, `FILTERS`,
`RATIOS`, `RULES`, `SHORTCUTS`, `KIND_TEXT`, `POST_KINDS`… all built
once at import. Measured: with the UI in Arabic the notification
filters still read `All / Mentions / Following` and one was French.
All converted to functions.

### 4. Thirty-one icon buttons had no accessible name
`data-tip` gives a mouse tooltip; a screen reader gets nothing.

### 5. XP was forgeable — anyone could top the leaderboard
```
UPDATE profiles SET xp = 99999 WHERE id = 's1';   -> UPDATE 1
```
The guard trigger tested `current_user = session_user`. PostgREST does
`SET ROLE authenticated`, so those are **never** equal
(`current_user=authenticated`, `session_user=postgres`). The guard
skipped exactly the people it was written for and only fired for a
direct psql session. Fixed in PART 9 by keying on the role.

### 6. Quest progress was forgeable
A student could `INSERT INTO quests … progress = 99` directly. The
write policies are gone; `track_quest()` is now the only path.

### 7. `track_quest()` had NEVER worked
```
SELECT * FROM track_quest('visit', 1, 1);
ERROR: column reference "quest_id" is ambiguous
```
The `RETURNS TABLE` output names collide with the table's own columns,
so **every** quest call has always failed on real Postgres. The browser
mock did not model it, so nothing noticed. Fixed with
`#variable_conflict use_column`, keeping the original column names
because `game_sm.js` reads `row.progress` / `row.just_done`.

### 8. Small ones
- `Changer la couverture`, `Sondage`, `Tout marquer lu`, `Créer`,
  `Quoi de neuf sur le campus ?` and the composer descriptions were
  hardcoded French.
- `profile_sm.js` imported `badges` while declaring a local
  `const badges` that shadowed it — the same shadowing class as the
  `const t = toast(...)` bug.
- `queries` in `db_sm.js` is exported and called by nothing.

---

## Verified still safe after the changes

Against real PostgreSQL 17, as a student:

| attack | result |
|---|---|
| set own XP / streak | blocked |
| forge quest progress | blocked |
| write `xp_events` by hand | blocked |
| promote self to admin | blocked |
| change own status | blocked |
| edit someone else's profile | blocked |
| like / post / DM **as** another user | blocked |
| delete another's post or comment | blocked |
| read a DM between two other students | blocked |
| banned / rejected accounts writing | blocked |

And the legitimate path still works: `award_xp()`, `track_quest()`,
`my_quests()`, `resolve_streak()` all succeed.

---

## Student flows that now work end-to-end and survive F5

post · like · unlike · comment · repost (with the quoted original) ·
share · save · poll vote · follow · DM · story · join channel ·
attend event · ask + answer + vote a question · edit profile ·
upload avatar · upload banner · quests · XP · leaderboard

---

## Totals

```
tests/run.sh          848/848   jsdom
tests/browser/run.sh  134/134   real Chrome
tests/sql/run.sh       34/34    real PostgreSQL 17, against ALL_IN_ONE_sm.sql
walkthrough.mjs         0 findings  (was 46)
```

---

## Test bugs I found in my own harness

Worth stating plainly, because three of these once made me report a
working app as broken:

- `psql -q` swallows the `UPDATE 0` tag that signals an RLS refusal.
- The refusal check only matched RLS wording, missing `RAISE EXCEPTION`
  from a guard trigger — it reported "student CAN set own XP" against a
  database that had raised an error and changed nothing.
- `INSERT` prints `INSERT <oid> <count>`; I read the oid as the count.
- A HEAD request rewritten by Chrome's interceptor logs
  `net::ERR_ABORTED` even though it succeeded.
- `getBoundingClientRect()` does not survive the CDP boundary.

---

## Still not verified

- **I cannot reach your Neon project.** Everything above is against a
  local PostgreSQL 17 with your exact migrations. You must paste
  `ALL_IN_ONE_sm.sql` yourself.
- No real phone, no touch, no Safari or Firefox, no slow network.
- Images are `data:` URLs in Postgres; proven with a 2 KB PNG, not with
  a 3 MB phone photo on a real device.
- If anything still fails after running the file, send me:
  `SELECT id, username, status, role FROM profiles;`
