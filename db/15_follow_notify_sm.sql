-- ============================================================
-- 15_follow_notify_sm.sql
-- FOLLOW / FOLLOW-REQUEST notifications, written by the DATABASE.
-- ============================================================
--
-- THE BUG, measured — not guessed.
--
-- api_sm.js follow() did this, and it looked completely reasonable:
--
--     await db.insert('notifications', { user_id: userId,
--                                        actor_id: myId(),
--                                        kind: 'request' });
--
-- db.insert() sends `Prefer: return=representation`, which PostgREST
-- compiles to `INSERT ... RETURNING *`. The INSERT passes notif_insert
-- (actor_id = auth.user_id()), then the RETURNING has to READ the row
-- back — and notif_own says
--
--     USING (user_id = auth.user_id())
--
-- The row belongs to the person being followed, NOT to me. So the read
-- is refused and Postgres reports the whole statement as
--
--     ERROR:  new row violates row-level security policy
--             for table "notifications"
--
-- Reproduced on PostgreSQL 17 with only RETURNING as the difference:
--     INSERT ... ;            -> INSERT 0 1
--     INSERT ... RETURNING id -> ERROR: new row violates RLS policy
--
-- That is the reported symptom exactly: "the request follow is
-- functional but the other person can't see it, there is no visible
-- notification". The follow row was written; the notification never
-- was. The catch block logged it to a console nobody was reading.
--
-- WHY A TRIGGER AND NOT A FIXED CLIENT CALL
--   * SECURITY DEFINER, so no RLS read-back problem at all
--   * fires for EVERY path: profile page, people lists, search,
--     the APK, an old build. profile_sm.js:327 was the ONLY place
--     that even tried; following from a suggestion list wrote nothing.
--   * accepting a request notifies the requester, which no client
--     code did anywhere
--
-- Idempotent.
-- ============================================================


-- ------------------------------------------------------------
-- 1. INSERT ON follows  ->  'follow' or 'request'
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_new_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_kind text;
BEGIN
  -- Following yourself is not an event.
  IF NEW.follower_id = NEW.followee_id THEN RETURN NEW; END IF;

  v_kind := CASE WHEN NEW.state = 'accepted' THEN 'follow' ELSE 'request' END;

  -- One row per (person, kind). Un-following and re-following ten times
  -- must not produce ten lines in the shade. Re-requesting after a
  -- refusal moves the existing row forward instead.
  IF EXISTS (
    SELECT 1 FROM notifications
    WHERE user_id  = NEW.followee_id
      AND actor_id = NEW.follower_id
      AND kind     = v_kind
      AND read_at IS NULL
  ) THEN
    UPDATE notifications
       SET created_at = now()          -- so pending_alerts(p_since) sees it
     WHERE user_id  = NEW.followee_id
       AND actor_id = NEW.follower_id
       AND kind     = v_kind
       AND read_at IS NULL;
  ELSE
    INSERT INTO notifications (user_id, actor_id, kind)
    VALUES (NEW.followee_id, NEW.follower_id, v_kind);
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Losing the FOLLOW because the notification failed would be a far
  -- worse bug than a missing notification.
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_new_follow ON follows;
CREATE TRIGGER trg_notify_new_follow
AFTER INSERT ON public.follows
FOR EACH ROW EXECUTE FUNCTION notify_new_follow();


-- ------------------------------------------------------------
-- 2. UPDATE pending -> accepted
--
--    Two things happen here, and both were missing:
--      a) the person who ASKED is told they were let in
--      b) the owner's own 'request' line becomes a 'follow' line,
--         so the accept/decline buttons stop being offered for a
--         decision that has already been made
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_follow_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.state = 'accepted' AND COALESCE(OLD.state, '') <> 'accepted' THEN

    -- (b) retire the stale request line on the ACCEPTER's side
    UPDATE notifications
       SET kind = 'follow'
     WHERE user_id  = NEW.followee_id
       AND actor_id = NEW.follower_id
       AND kind     = 'request';

    -- (a) tell the REQUESTER. kind 'follow_accepted' so the client can
    -- word it as "accepted your request" rather than "follows you",
    -- which would be backwards.
    INSERT INTO notifications (user_id, actor_id, kind)
    VALUES (NEW.follower_id, NEW.followee_id, 'follow_accepted');
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_follow_accepted ON follows;
CREATE TRIGGER trg_notify_follow_accepted
AFTER UPDATE ON public.follows
FOR EACH ROW EXECUTE FUNCTION notify_follow_accepted();


-- ------------------------------------------------------------
-- 3. DELETE  ->  clean up
--
--    Declining a request deletes the follow row. Leaving the
--    notification behind means the owner keeps seeing Accept/Decline
--    for somebody who is no longer asking, and tapping Accept would
--    silently do nothing.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_follow_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  DELETE FROM notifications
   WHERE user_id  = OLD.followee_id
     AND actor_id = OLD.follower_id
     AND kind IN ('request', 'follow');
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_clear_follow_notification ON follows;
CREATE TRIGGER trg_clear_follow_notification
AFTER DELETE ON public.follows
FOR EACH ROW EXECUTE FUNCTION clear_follow_notification();


-- ------------------------------------------------------------
-- 4. accept_follow_request() — one call instead of a bare UPDATE
--
--    notificationsApi.respondToRequest() ran
--        db.update('follows', { state: 'accepted' }, ...)
--    which is `PATCH ... Prefer: return=representation` — the SAME
--    RETURNING problem as above, except follows_read happens to allow
--    it (followee_id = auth.user_id()). It works, but it depends on a
--    policy that exists for another reason. This is explicit.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_follow_request(p_actor text, p_accept boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_me text := auth.user_id();
BEGIN
  IF v_me IS NULL THEN RETURN false; END IF;

  IF p_accept THEN
    UPDATE follows SET state = 'accepted'
     WHERE follower_id = p_actor AND followee_id = v_me;
    RETURN FOUND;                    -- triggers above do the rest
  END IF;

  DELETE FROM follows
   WHERE follower_id = p_actor AND followee_id = v_me;
  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.respond_follow_request(text, boolean) TO authenticated;


-- ------------------------------------------------------------
-- 5. my_group_chats() — the Channels and Events folders
--
--    The Messages screen needs to list the group chats you are
--    actually in. Doing it from the client meant three round trips
--    (channel_members, channels, group_messages) and, because
--    channel_members is only readable by fellow members, a list that
--    was correct but expensive. One call, one shape.
--
--    Returns nothing when you have joined nothing — which is what
--    lets the UI hide the folder entirely instead of showing an
--    empty tab.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_group_chats()
RETURNS TABLE(
  kind        text,
  id          bigint,
  name        text,
  role        text,
  is_private  boolean,
  post_policy text,
  members     integer,
  last_text   text,
  last_at     timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT 'channel'::text,
         c.id,
         c.name,
         cm.role,
         c.is_private,
         c.post_policy,
         (SELECT COUNT(*)::int FROM channel_members m WHERE m.channel_id = c.id),
         (SELECT g.text FROM group_messages g
           WHERE g.channel_id = c.id AND COALESCE(TRIM(g.text),'') <> ''
           ORDER BY g.created_at DESC LIMIT 1),
         (SELECT g.created_at FROM group_messages g
           WHERE g.channel_id = c.id ORDER BY g.created_at DESC LIMIT 1)
  FROM channel_members cm
  JOIN channels c ON c.id = cm.channel_id
  WHERE cm.user_id = auth.user_id()

  UNION ALL

  SELECT 'event'::text,
         e.id,
         e.title,
         CASE WHEN e.owner_id = auth.user_id() THEN 'owner' ELSE 'member' END,
         false,
         'all'::text,
         (SELECT COUNT(*)::int FROM event_attendees a WHERE a.event_id = e.id),
         (SELECT g.text FROM group_messages g
           WHERE g.event_id = e.id AND COALESCE(TRIM(g.text),'') <> ''
           ORDER BY g.created_at DESC LIMIT 1),
         (SELECT g.created_at FROM group_messages g
           WHERE g.event_id = e.id ORDER BY g.created_at DESC LIMIT 1)
  FROM event_attendees ea
  JOIN events e ON e.id = ea.event_id
  WHERE ea.user_id = auth.user_id()

  ORDER BY 9 DESC NULLS LAST;
$function$;

GRANT EXECUTE ON FUNCTION public.my_group_chats() TO authenticated;


-- ------------------------------------------------------------
-- 6. CUSTOM CHAT FOLDERS
--
--    MY FIRST ATTEMPT AT THIS WAS WRONG and the database said so.
--    I planned to store a folder's definition as a chat_folders row
--    with peer_id = ''. Inspecting the live table killed that:
--
--      chat_folders_folder_check
--        CHECK (folder = ANY (ARRAY['all','pinned','study','muted','archived']))
--      chat_folders_peer_id_fkey
--        FOREIGN KEY (peer_id) REFERENCES profiles(id)
--
--    So a custom name was refused by the CHECK, and peer_id = '' was
--    refused by the foreign key. Two hard errors, not one.
--
--    Hence: drop the CHECK (it is what made custom folders impossible
--    in the first place — the UI could only ever offer the same five)
--    and keep folder DEFINITIONS in their own table, so an empty
--    folder can exist.
-- ------------------------------------------------------------
ALTER TABLE chat_folders DROP CONSTRAINT IF EXISTS chat_folders_folder_check;

CREATE TABLE IF NOT EXISTS chat_folder_defs (
  user_id    text NOT NULL,
  name       text NOT NULL,
  icon       text NOT NULL DEFAULT 'bookmark',
  sort       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_folder_defs_pkey PRIMARY KEY (user_id, name),
  CONSTRAINT chat_folder_defs_name_ck CHECK (length(TRIM(name)) BETWEEN 1 AND 24),
  CONSTRAINT chat_folder_defs_user_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

ALTER TABLE chat_folder_defs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cfd_own ON chat_folder_defs;
CREATE POLICY cfd_own ON chat_folder_defs FOR ALL TO authenticated
  USING (user_id = auth.user_id()) WITH CHECK (user_id = auth.user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_folder_defs TO authenticated;

CREATE OR REPLACE FUNCTION public.create_chat_folder(p_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_me text := auth.user_id();
BEGIN
  IF v_me IS NULL OR COALESCE(TRIM(p_name),'') = '' THEN RETURN false; END IF;
  -- Reserved: these are the built-in views, not user folders.
  IF LOWER(TRIM(p_name)) IN ('all','unread','requests','channels','events')
    THEN RETURN false; END IF;
  INSERT INTO chat_folder_defs (user_id, name)
  VALUES (v_me, TRIM(p_name))
  ON CONFLICT DO NOTHING;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_chat_folder(p_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_me text := auth.user_id();
BEGIN
  IF v_me IS NULL THEN RETURN false; END IF;
  -- Removes the folder AND unfiles every conversation in it. The
  -- conversations themselves are never touched.
  DELETE FROM chat_folder_defs WHERE user_id = v_me AND name   = p_name;
  DELETE FROM chat_folders     WHERE user_id = v_me AND folder = p_name;
  RETURN true;
END;
$function$;

/* Every folder the student has: the built-in ones they have actually
   used, plus every one they created (even while still empty). */
CREATE OR REPLACE FUNCTION public.my_chat_folders()
RETURNS TABLE(name text, icon text, custom boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT d.name, d.icon, true
  FROM chat_folder_defs d
  WHERE d.user_id = auth.user_id()
  ORDER BY d.sort, d.created_at;
$function$;

GRANT EXECUTE ON FUNCTION public.create_chat_folder(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_chat_folder(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_chat_folders()        TO authenticated;


-- ------------------------------------------------------------
-- 7. LIKE / COMMENT / MENTION notifications
--
--    FOUND BY THE APK BUILD CHECK, not by a test.
--
--    After fixing follow(), I added a NEGATIVE check to build_apk.sh —
--    "assets/js/core/api_sm.js must not contain db.insert('notifications'".
--    It failed with 2 occurrences. One was my own comment. The other
--    was this, at api_sm.js:272, which I had never looked at:
--
--        async function notify(postId, kind, text = null) {
--          const post = await db.one('posts', ...);
--          await db.insert('notifications',
--            { user_id: post.user_id, actor_id: myId(), kind, post_id: postId, text });
--        }
--
--    Identical bug to the follow one, and it had been there the whole
--    time: `Prefer: return=representation` -> INSERT ... RETURNING ->
--    notif_own refuses the read-back because the row belongs to the
--    POST'S AUTHOR, not to me. Verified on PostgreSQL 17:
--
--      INSERT INTO notifications (user_id,actor_id,kind,post_id)
--      VALUES ('s1','s2','like',9500) RETURNING id;
--      ERROR: new row violates row-level security policy
--
--    And it is wrapped in `catch {}` with the comment "a missed
--    notification must never break the action" — so every like and
--    every comment silently failed to notify anybody, forever.
--
--    Same remedy: let the database do it. Triggers cannot be bypassed,
--    cover the APK and old builds, and need no read-back.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_post_like()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_author text;
BEGIN
  SELECT user_id INTO v_author FROM posts WHERE id = NEW.post_id;
  IF v_author IS NULL OR v_author = NEW.user_id THEN RETURN NEW; END IF;

  -- One line per post, however many times it is liked and unliked.
  IF EXISTS (SELECT 1 FROM notifications
              WHERE user_id = v_author AND actor_id = NEW.user_id
                AND kind = 'like' AND post_id = NEW.post_id AND read_at IS NULL) THEN
    UPDATE notifications SET created_at = now()
     WHERE user_id = v_author AND actor_id = NEW.user_id
       AND kind = 'like' AND post_id = NEW.post_id AND read_at IS NULL;
  ELSE
    INSERT INTO notifications (user_id, actor_id, kind, post_id)
    VALUES (v_author, NEW.user_id, 'like', NEW.post_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_post_like ON post_likes;
CREATE TRIGGER trg_notify_post_like
AFTER INSERT ON public.post_likes
FOR EACH ROW EXECUTE FUNCTION notify_post_like();

/* Un-liking removes the line: an alert for something that is no longer
   true is worse than no alert. */
CREATE OR REPLACE FUNCTION public.clear_like_notification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  DELETE FROM notifications
   WHERE actor_id = OLD.user_id AND kind = 'like'
     AND post_id = OLD.post_id AND read_at IS NULL;
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_clear_like_notification ON post_likes;
CREATE TRIGGER trg_clear_like_notification
AFTER DELETE ON public.post_likes
FOR EACH ROW EXECUTE FUNCTION clear_like_notification();


/* Comments. NOT coalesced: three separate comments are three things to
   read, unlike three likes which are one fact. */
CREATE OR REPLACE FUNCTION public.notify_post_comment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_author text;
BEGIN
  SELECT user_id INTO v_author FROM posts WHERE id = NEW.post_id;
  IF v_author IS NULL OR v_author = NEW.user_id THEN RETURN NEW; END IF;

  INSERT INTO notifications (user_id, actor_id, kind, post_id, text)
  VALUES (v_author, NEW.user_id, 'comment', NEW.post_id, LEFT(COALESCE(NEW.text,''), 120));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_post_comment ON comments;
CREATE TRIGGER trg_notify_post_comment
AFTER INSERT ON public.comments
FOR EACH ROW EXECUTE FUNCTION notify_post_comment();
