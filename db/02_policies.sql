-- ============================================================
-- KOLIYA — Row Level Security
-- Run this SECOND, after 01_schema.sql
--
-- This file is the real security of the app.
-- Everything in JavaScript can be bypassed by the user.
-- Nothing here can.
-- ============================================================

-- auth.user_id() returns the "sub" claim of the Neon Auth JWT.
-- Neon defines it for you when the Data API is enabled with
-- Managed Better Auth; nothing to install.

-- ---------- grants ------------------------------------------
-- The Data API talks to Postgres as `authenticated` (logged in) or
-- `anonymous`. Without these grants every request fails before RLS
-- is even consulted. The Console's "Grant public schema access"
-- checkbox does this too — running it twice is harmless.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- ---------- helpers -----------------------------------------
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.user_id() AND role = 'admin' AND status = 'approved'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_approved() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.user_id() AND status = 'approved'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION blocked_between(a TEXT, b TEXT) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocks
    WHERE (blocker_id = a AND blocked_id = b)
       OR (blocker_id = b AND blocked_id = a)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- can I see this person's content? (private-account logic)
CREATE OR REPLACE FUNCTION can_view(target TEXT) RETURNS boolean AS $$
  SELECT
    target = auth.user_id()
    OR is_admin()
    OR (
      NOT blocked_between(auth.user_id(), target)
      AND (
        NOT (SELECT is_private FROM profiles WHERE id = target)
        OR EXISTS (
          SELECT 1 FROM follows
          WHERE follower_id = auth.user_id()
            AND followee_id = target
            AND state = 'accepted'
        )
      )
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ---------- make this file re-runnable -----------------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ---------- enable RLS everywhere ---------------------------
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows           ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels          ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_saves        ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_views       ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa                ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_answers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_attendees   ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports           ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PROFILES
-- ============================================================
CREATE POLICY profiles_read ON profiles FOR SELECT TO authenticated
  USING (
    id = auth.user_id()
    OR is_admin()
    OR (status = 'approved' AND NOT blocked_between(auth.user_id(), id))
  );

-- you may create only your own row, and never as admin/approved
CREATE POLICY profiles_insert_self ON profiles FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.user_id()
    AND role = 'student'
    AND status = 'pending'
  );

-- you may edit your own profile, but NOT role/status
CREATE POLICY profiles_update_self ON profiles FOR UPDATE TO authenticated
  USING (id = auth.user_id())
  WITH CHECK (
    id = auth.user_id()
    AND role   = (SELECT role   FROM profiles WHERE id = auth.user_id())
    AND status = (SELECT status FROM profiles WHERE id = auth.user_id())
  );

-- admins may change anything, including role and status
CREATE POLICY profiles_admin_all ON profiles FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- ============================================================
-- FOLLOWS / BLOCKS
-- ============================================================
CREATE POLICY follows_read ON follows FOR SELECT TO authenticated
  USING (follower_id = auth.user_id() OR followee_id = auth.user_id() OR is_admin());

CREATE POLICY follows_insert ON follows FOR INSERT TO authenticated
  WITH CHECK (follower_id = auth.user_id() AND NOT blocked_between(follower_id, followee_id));

-- the followee accepts a pending request; the follower can unfollow
CREATE POLICY follows_update ON follows FOR UPDATE TO authenticated
  USING (followee_id = auth.user_id());

CREATE POLICY follows_delete ON follows FOR DELETE TO authenticated
  USING (follower_id = auth.user_id() OR followee_id = auth.user_id());

CREATE POLICY blocks_own ON blocks FOR ALL TO authenticated
  USING (blocker_id = auth.user_id()) WITH CHECK (blocker_id = auth.user_id());

-- ============================================================
-- POSTS
-- ============================================================
CREATE POLICY posts_read ON posts FOR SELECT TO authenticated
  USING (is_approved() AND can_view(user_id));

CREATE POLICY posts_insert ON posts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.user_id() AND is_approved());

CREATE POLICY posts_update_own ON posts FOR UPDATE TO authenticated
  USING (user_id = auth.user_id()) WITH CHECK (user_id = auth.user_id());

CREATE POLICY posts_delete_own ON posts FOR DELETE TO authenticated
  USING (user_id = auth.user_id() OR is_admin());

CREATE POLICY likes_read   ON post_likes FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY likes_own    ON post_likes FOR ALL TO authenticated
  USING (user_id = auth.user_id()) WITH CHECK (user_id = auth.user_id() AND is_approved());

-- saves are private to you
CREATE POLICY saves_own    ON post_saves FOR ALL TO authenticated
  USING (user_id = auth.user_id()) WITH CHECK (user_id = auth.user_id());

CREATE POLICY comments_read ON comments FOR SELECT TO authenticated
  USING (is_approved() AND EXISTS (SELECT 1 FROM posts p WHERE p.id = post_id AND can_view(p.user_id)));
CREATE POLICY comments_insert ON comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.user_id() AND is_approved());
CREATE POLICY comments_delete ON comments FOR DELETE TO authenticated
  USING (user_id = auth.user_id() OR is_admin());

-- ============================================================
-- MESSAGES  ← the leak that existed before
-- ============================================================
-- Previously: sp.from("messages").select("*") returned EVERY student's DMs
-- to EVERY browser. Now the database itself refuses.
CREATE POLICY messages_read ON messages FOR SELECT TO authenticated
  USING (sender_id = auth.user_id() OR receiver_id = auth.user_id());

CREATE POLICY messages_send ON messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.user_id()
    AND is_approved()
    AND NOT blocked_between(sender_id, receiver_id)
  );

-- only the receiver marks as seen; only the sender may delete
CREATE POLICY messages_update ON messages FOR UPDATE TO authenticated
  USING (receiver_id = auth.user_id() OR sender_id = auth.user_id());

CREATE POLICY messages_delete ON messages FOR DELETE TO authenticated
  USING (sender_id = auth.user_id());

CREATE POLICY reactions_rw ON message_reactions FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id
            AND (m.sender_id = auth.user_id() OR m.receiver_id = auth.user_id()))
  )
  WITH CHECK (user_id = auth.user_id());

-- ============================================================
-- STORIES
-- ============================================================
CREATE POLICY stories_read ON stories FOR SELECT TO authenticated
  USING (is_approved() AND expires_at > now() AND can_view(user_id));
CREATE POLICY stories_own ON stories FOR ALL TO authenticated
  USING (user_id = auth.user_id() OR is_admin())
  WITH CHECK (user_id = auth.user_id() AND is_approved());

CREATE POLICY story_views_rw ON story_views FOR ALL TO authenticated
  USING (user_id = auth.user_id()
         OR EXISTS (SELECT 1 FROM stories s WHERE s.id = story_id AND s.user_id = auth.user_id()))
  WITH CHECK (user_id = auth.user_id());

-- ============================================================
-- CHANNELS
-- ============================================================
CREATE POLICY channels_read   ON channels FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY channels_insert ON channels FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.user_id() AND is_approved());
CREATE POLICY channels_manage ON channels FOR UPDATE TO authenticated
  USING (owner_id = auth.user_id() OR is_admin());
CREATE POLICY channels_delete ON channels FOR DELETE TO authenticated
  USING (owner_id = auth.user_id() OR is_admin());

CREATE POLICY chmem_read ON channel_members FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY chmem_own  ON channel_members FOR ALL TO authenticated
  USING (user_id = auth.user_id()) WITH CHECK (user_id = auth.user_id() AND is_approved());

-- ============================================================
-- Q&A  (anonymous questions stay anonymous)
-- ============================================================
-- Note: user_id is still stored so abuse can be traced by an admin,
-- but the client must never select it for anonymous rows.
-- Expose a safe view for reading:
CREATE OR REPLACE VIEW qa_public AS
  SELECT id,
         CASE WHEN anonymous THEN NULL ELSE user_id END AS user_id,
         text, anonymous, created_at
  FROM qa;

CREATE POLICY qa_read   ON qa FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY qa_insert ON qa FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.user_id() AND is_approved());
CREATE POLICY qa_delete ON qa FOR DELETE TO authenticated
  USING (user_id = auth.user_id() OR is_admin());

CREATE POLICY qaa_read   ON qa_answers FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY qaa_insert ON qa_answers FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.user_id() AND is_approved());
CREATE POLICY qaa_delete ON qa_answers FOR DELETE TO authenticated
  USING (user_id = auth.user_id() OR is_admin());

-- ============================================================
-- EVENTS
-- ============================================================
CREATE POLICY events_read   ON events FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY events_insert ON events FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.user_id() AND is_approved());
CREATE POLICY events_manage ON events FOR UPDATE TO authenticated
  USING (owner_id = auth.user_id() OR is_admin());
CREATE POLICY events_delete ON events FOR DELETE TO authenticated
  USING (owner_id = auth.user_id() OR is_admin());

CREATE POLICY att_read ON event_attendees FOR SELECT TO authenticated USING (is_approved());
CREATE POLICY att_own  ON event_attendees FOR ALL TO authenticated
  USING (user_id = auth.user_id()) WITH CHECK (user_id = auth.user_id() AND is_approved());

-- ============================================================
-- NOTIFICATIONS / REPORTS
-- ============================================================
CREATE POLICY notif_own ON notifications FOR SELECT TO authenticated
  USING (user_id = auth.user_id());
CREATE POLICY notif_insert ON notifications FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.user_id() AND is_approved());
CREATE POLICY notif_update ON notifications FOR UPDATE TO authenticated
  USING (user_id = auth.user_id());
CREATE POLICY notif_delete ON notifications FOR DELETE TO authenticated
  USING (user_id = auth.user_id());

CREATE POLICY reports_insert ON reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.user_id() AND is_approved());
CREATE POLICY reports_admin ON reports FOR SELECT TO authenticated
  USING (is_admin() OR reporter_id = auth.user_id());
CREATE POLICY reports_handle ON reports FOR UPDATE TO authenticated
  USING (is_admin());

-- ---------- belt and braces ----------------------------------
-- RLS is skipped for a table's owner by default. FORCE makes the
-- rules apply to everyone, so a mistake in a server-side script
-- cannot quietly bypass them.
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('profiles','follows','blocks','channels','channel_members',
                        'posts','post_likes','post_saves','comments','messages',
                        'message_reactions','stories','story_views','qa','qa_answers',
                        'events','event_attendees','notifications','reports')
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ---------- verify -------------------------------------------
-- Every table below must show rowsecurity = true and a policy count > 0.
SELECT c.relname AS table,
       c.relrowsecurity AS rls_on,
       (SELECT count(*) FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY 1;
