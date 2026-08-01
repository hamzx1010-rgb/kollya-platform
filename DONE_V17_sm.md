# V17 — the creator can talk, and the settings panel is real

Three complaints. All three reproduced in a real PostgreSQL 17 or a real
Chrome **before** anything was changed.

---

## 1. "the event chat is still unfunctional… I feel like its an sql problem"

**You were right. It was SQL.**

`createEvent()` inserts the event, then inserts `event_attendees` in a
**second** request. Posting rights for an event were `is_event_attendee()`.
Measured as the owner, immediately after creating event 700:

```
attendee_rows_after_create = 0
is_event_attendee          = false
can_post_group             = false
INSERT INTO group_messages -> ERROR: new row violates RLS policy
```

So the composer appeared, you typed, and the database threw the message
away. The send button worked; the row never landed.

## 2. "the creator cant speak in it lol… the other users talk just fine"

Same measurement, side by side — this is the whole bug in four lines:

```
OWNER  -> can_post=false   INSERT -> ERROR: violates RLS policy
MEMBER -> can_post=true    INSERT -> 1 row
```

Two causes:

- the organiser had no attendance row at all (above)
- `can_post_group()` only allowed an owner **as a side effect** of being
  a member, so any gap in that row silently muted the person who runs
  the place

Now the OWNER branch is first and unconditional, in both the event and
the channel case. Verified with the membership row **deleted**:

```
no_member_row_but_can_post = true
```

### Roles for events, like you asked

Events had no roles whatsoever — every attendee equal, nobody
appointable. They now use the same three ranks as channels
(owner > admin > member) so there is one mental model. Measured:

```
lock_to_admins        = true    (owner sets "moderators only")
promote_m2            = true
owner_still_ok        = true    <- creator always talks
promoted_mod_can_post = true    <- his stand-in talks
plain_member_now      = false
self_promote          = false   <- a member cannot promote himself
```

Guards, also measured:

```
role_after_attend          = owner   (pressing "attend" cannot demote you)
still_attendee_after_leave = true    (the organiser cannot leave his own chat)
```

## 3. "some sort of timer… the only moderators can post here thing just reappears"

**Not a timer — a token refresh.** Reproduced in Chrome by failing one
single RPC:

```
OWNER normally:            readOnlyBar = 0
after ONE failed check:    readOnlyBar = 1   composerHidden = 1
  "Only moderators can post here"
```

`groupInfo()` did `.catch(() => false)` on each of its two calls, which
turns **"I could not find out"** into **"you are not allowed"**. Any 401
mid-refresh, any dropped request, and the owner of a public channel is
told he may not speak.

Fixed three ways:

1. one RPC (`group_info`) instead of two, so there is one failure point
2. it returns `ok`, so unknown is distinguishable from forbidden
3. when the answer is unknown the composer **stays** — let the database
   refuse, since RLS is the real gate and it does not guess

## 4. The settings panel — rewritten

The old one was channel-only, so an event organiser had **no panel at
all** and no way to appoint anybody. It also had a private checkbox that
rendered unchecked every time: opening it on a private channel and
saving quietly made the channel public.

Now: one panel for both, in sections, each switch with a sentence saying
what it will actually do, ranks colour-coded, and the live values filled
in. Screenshots: `shots/V17-event-settings.png`, `shots/V17-panel-ar.png`.

---

## Also found on the way

- **`createChannel()` threw after creating the channel.** Its own insert
  into `channel_members` now collides with the owner trigger added in
  V14: `ERROR: duplicate key value violates unique constraint`. The
  channel existed, the UI reported failure, so people pressed Create
  twice. Removed the redundant insert.
- **`toast.saved` existed in no language** — a green toast reading
  literally `toast.saved`. I saw it in a screenshot, not in a test; the
  raw-key sweep missed it because toasts vanish before `innerText` is
  read. The sweep now includes `toast.` and reads the toast while it is
  still on screen.
- **"Manage channel" on an event.** Shared panel, unshared wording.
- **Arabic said "مشرفو القناة" (channel moderators) inside an event**,
  and the promote button said "تعيين مشرفاً للقناة". Neutral `group.*`
  keys added for the shared panel.
- **`var(--r-md)` does not exist** — the scale is `--r-sm` / `--r` /
  `--r-lg`. Caught by the CSS test, not by looking.
- **The test fixture could not express your bug.** No channel had an
  `owner_id` and no event was owned by `u1`, so "the creator cannot
  talk" was untestable. Added `e3` (owned by us) and owner ids.
- **The mock agreed with the bug.** Its `can_post_group` was a copy of
  the old SQL, so it refused the event creator too — it would have
  "proved" the broken behaviour correct. Rewritten to mirror the new SQL.

---

## Results

| suite | result |
|---|---|
| `tests/run.sh` (jsdom) | **853/853** |
| `tests/sql/run.sh` (real PostgreSQL 17) | **34/34** |
| `tests/browser/v17.test.mjs` (real Chrome) | **29/29** |
| `tests/browser/v16.test.mjs` | 39/39 |
| `browser/v13`, `browser/nav` | 30/30, 63/63 |

The v17 test does not just check that a composer is visible — it **types
a message, presses Send, and asserts the row reached the database**. A
visible composer that cannot deliver is exactly the bug you reported.

---

## WHAT YOU MUST DO

**Run `db/FULL_SCHEMA_sm.sql` in Neon again** (2660 lines), then
Data API → **Refresh schema cache**.

Nothing above works without it — the fixes are triggers and functions,
not client code. The back-fill in section 1 also repairs **every event
that already exists**, so organisers currently locked out of their own
chats get their voice back the moment you run it.

## WHAT I DID NOT VERIFY

1. **The APK does not have any of this.** It still carries the V16
   build. Say the word and I will rebuild (~10 min).
2. **No real Neon.** Everything is local PostgreSQL 17 + headless Chrome
   against a mock. The mock now mirrors the new SQL, but it is a mock.
3. **The "10 minutes" story is a reproduction, not a capture.** I proved
   that a failed permission check produces exactly the bar you saw, and
   fixed that. I never watched your actual session, so I cannot promise
   the same trigger fired on your phone — only that this cause is gone.
4. **Never tested on iOS Safari.**
5. **`set_event_policy` has no rate limit.** An owner can flip the room
   open and shut as fast as they can click.
6. **Removing a moderator does not delete what they posted** while the
   chat was locked. That is probably right, but it is a choice I made.
