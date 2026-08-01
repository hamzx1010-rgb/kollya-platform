# V16 — chat sections, chat folders, follow-request notifications

Answering four things you raised, in the order you raised them.

---

## 1. "did u test the can any student join the channels"

**No, I had not — I have now, and the answer is yes.**

Run against a real PostgreSQL 17, as the `authenticated` role, with
`auth.user_id()` set the way Neon sets it. Carl is in **Médecine** and
the channel is unrelated to his faculty; he had never been invited:

```
sees_channels =3          -- all three are visible to him
join_public   =joined     -- public channel: straight in
is_member     =true
can_post      =true
join_private  =requested  -- private: a request, not a membership
private_member=false
join_announce =joined     -- he can JOIN an announcements channel
can_post_ann  =false      -- but not POST in it
```

So: any approved student can join any public channel, from any faculty.
A private one produces a request. An admins-only channel can be joined
and read but not posted in. That is enforced in the database, not the UI.

---

## 2. THE BUG THAT MADE THE ONE FILE HALF-APPLY

Before anything else — I found something worse than what you reported.

`db/FULL_SCHEMA_sm.sql` **did not finish loading**. On a clean database
it stopped at line 924:

```
ERROR:  function is_event_attendee(bigint) does not exist
```

`can_post_group()` is written before `is_event_attendee()`, which it
calls, and Postgres parses `LANGUAGE sql` bodies at CREATE time. The
Neon SQL Editor aborts on error like `psql -v ON_ERROR_STOP=1`, so
**everything below that line never ran**:

| | before | after |
|---|---|---|
| tables | 28 | 29 |
| functions | **8** | **51** |
| policies | **0** | **76** |

No `pending_alerts()`. No DM-notify trigger. No `join_channel()`. No RLS
on `group_messages` at all. Fixed with `SET check_function_bodies = off`
at the top — the same line `pg_dump` emits for the same reason.

I put it in **`tests/sql/build_schema.mjs`**, not in the .sql file: I
added it to the .sql first and the very next regeneration erased it.

---

## 3. "the request follow is functional but the other person can't see it"

**Cause found, and it could never have worked.**

`api_sm.js` did this:

```js
await db.insert('notifications', { user_id: userId, actor_id: myId(), kind: 'request' });
```

`db.insert()` sends `Prefer: return=representation`, so PostgREST runs
`INSERT ... RETURNING *`. The INSERT passes, then the RETURNING has to
**read the row back** — and `notif_own` is `USING (user_id = auth.user_id())`.
The row belongs to the person being followed, not to me. Refused.

Proven with RETURNING as the only difference:

```
INSERT INTO notifications ... ;             -> INSERT 0 1
INSERT INTO notifications ... RETURNING id  -> ERROR: new row violates
                                               row-level security policy
```

The follow was written, the notification never was, and the `catch`
logged it to a console nobody reads.

Now a trigger (`db/15_follow_notify_sm.sql`), SECURITY DEFINER, so there
is no read-back. Measured:

```
alice requests -> bob:  bob_sees_kind=request from=Alice A   bob_unread=1
bob accepts    -> alice_gets=follow_accepted from=Bob B
                  bobs_line_now=follow    (Accept/Decline retired)
follow from a people-list (never wrote anything before) -> alice_gets=follow
unfollow/refollow x3 -> rows_for_alice=1   (not 3)
decline -> rows_left=0
```

It also fires for **every** path — people lists, search, the APK. Before,
only `profile_sm.js:322` even tried.

---

## 4. "the event groups and channels have to be visible in the messages"

They were not reachable from Messages at all. `openGroupThread()` worked,
but the only ways in were the URL `#/messages/channel-7` or a click from
Campus. The seven-button strip filtered `convs`, which comes from the
`messages` table — a channel is not in it, so no filter could ever show one.

Now **three sections**: Messages · Channels · Events.

- **Channels** appears only if you are in a channel
- **Events** appears only if you attend an event
- a student in neither sees a single list and no tabs — the screen looks
  exactly as it did
- folders live **inside Messages**, where they belong

`my_group_chats()` returns both in one call, newest first, with your rank
and the last message.

## 5. "there is no button to create chat folders"

There was nowhere to put one and nowhere to store the result:

```
chat_folders_folder_check
  CHECK (folder IN ('all','pinned','study','muted','archived'))
```

A sixth folder was refused by the database. Dropped the CHECK, added
`chat_folder_defs` so an **empty** folder can exist (a folder you can
only create by first filling it is not a folder you can create), and put
a `+` at the end of the strip. Right-click one you made to delete it —
the conversations are unfiled, never deleted.

---

## Other bugs found on the way

- **`FOLDERS is not defined`** — `convMenu()` referenced an identifier
  that exists nowhere in the file. Right-clicking a conversation threw
  and **no menu opened at all**, which is why filing a chat never worked.
- **Group chats crashed on the second one opened.** `wireComposer()` did
  `draft.get(peer.id)` and `peer` is deliberately `null` in a group.
  `TypeError: Cannot read properties of null (reading 'id')`.
- **`follow_accepted` had no entry in `notifKind()`**, so it fell through
  to `like` and would have read *"X liked your post"*.
- **Accept / Decline were hardcoded French** in a three-language app.
- **"1 members"** — visible in the first screenshot. No plural machinery
  exists, and Arabic needs a different word, so it is its own key.
- **Tab labels rendered "Mess..." / "Chan..."** at 1280px. The breakpoint
  was on the window; it needed to be much earlier because the constraint
  is the list column (~345px).

## Test-harness bugs (these matter — they hid the real ones)

- The mock **accepted the notification insert that the real database
  refuses.** That is precisely why "follow notifications don't arrive"
  survived every browser test. It now returns the same 403.
- The mock had **no triggers**, so it "proved" a feature the database
  does not implement. `follows` INSERT/DELETE now fire theirs.
- My patch script was **not idempotent** — it claimed to be. Running it
  twice produced a second `let section = 'dm';`, a fatal duplicate
  declaration. `node --check` does not catch it at module scope. Found
  only by running it twice.

---

## Results

| suite | result |
|---|---|
| `tests/run.sh` (jsdom) | **853/853** |
| `tests/sql/run.sh` (real PostgreSQL) | **34/34** |
| `tests/browser/v16.test.mjs` (real Chrome) | **38/38** |
| `browser/v13`, `browser/nav` | 30/30, 63/63 |

Screenshots I looked at myself: `shots/V16-channels-in-messages.png`,
`V16-events-tab.png`, `V16-wide-ar.png` (RTL).

---

## WHAT I DID NOT VERIFY — read this part

1. **The APK does not contain any of this.** V15 wording is also still
   missing from it. Both need a rebuild (~10 min) — say the word.
2. **You must run `db/FULL_SCHEMA_sm.sql` again** (2405 lines), then
   Data API → **Refresh schema cache**. Given finding #2, whatever you
   ran before almost certainly applied only partly — this is not
   optional.
3. **No real Neon, no real phone, no emulator.** Everything above is a
   local PostgreSQL 17 and headless Chrome against a mock. The mock now
   models the RLS rule that caused the bug, but it is still a mock.
4. **Notifications are still poll-based**, not Web Push. Nothing here
   changed that.
5. **Never tested on iOS Safari.**
6. **The custom-folder name is not checked for duplicates across case** —
   "Projet" and "projet" are two folders.
7. **`my_group_chats()` has no LIMIT.** Fine for a student in ten
   channels; I have not measured it at a thousand.
