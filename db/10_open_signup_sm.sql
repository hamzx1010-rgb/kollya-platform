-- ============================================================
-- KOLIYA — 10_open_signup_sm.sql
-- THE FIX FOR "you do not have permission"
--
-- HOW TO RUN
--   Neon Console → SQL Editor → paste this whole file → Run
--   Then: Data API page → "Refresh schema cache"
--   Safe to run twice. Safe to run even if 05-09 were never run.
--
-- ------------------------------------------------------------
-- WHAT WAS ACTUALLY WRONG
--
-- Reproduced in a real PostgreSQL 17 with these exact migrations
-- loaded and RLS switched on, acting as a student through the
-- `authenticated` role:
--
--   INSERT INTO post_likes ... -> ERROR: new row violates
--                                  row-level security policy
--   INSERT INTO comments   ... -> same
--   INSERT INTO posts      ... -> same
--
-- Cause: `profiles.status` DEFAULTS to 'pending' (01_schema.sql),
-- and almost every write policy is gated on is_approved(), which
-- requires status = 'approved'. So every account that ever signed
-- up through the app was frozen: it could read, and edit its own
-- profile row, but could not like, comment or post. There was no
-- admin UI to approve anyone, so nobody could ever be unfrozen.
--
-- The moderation queue was designed for a university rollout that
-- has not happened. Until it does, an account is usable the moment
-- it is created — which is what every student expects.
--
-- NOTE: the earlier explanation (that 06_game_sm.sql locked admins
-- out with `role = 'student'`) was WRONG. profiles_admin_all is a
-- PERMISSIVE policy, so admins always passed. Verified by listing
-- pg_policies and by updating as an admin with the old policy in
-- place: it succeeded. 08_fixes_sm.sql is still worth running --
-- it stops a student rewriting their own role/status -- but it was
-- never the cause of the permission error.
-- ============================================================


-- ------------------------------------------------------------
-- 1. New accounts are approved on creation
-- ------------------------------------------------------------
ALTER TABLE profiles ALTER COLUMN status SET DEFAULT 'approved';

-- The INSERT policy forced 'pending' explicitly, so the default
-- alone would not have been enough.
DROP POLICY IF EXISTS profiles_insert_self ON profiles;
CREATE POLICY profiles_insert_self ON profiles FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.user_id()
    AND role = 'student'
    -- you may create yourself as approved, but never as an admin,
    -- and never pre-banned to dodge a future moderation action
    AND status IN ('pending','approved')
  );


-- ------------------------------------------------------------
-- 2. Unfreeze everyone who signed up while the old rule applied
-- ------------------------------------------------------------
UPDATE profiles
   SET status = 'approved'
 WHERE status = 'pending';


-- ------------------------------------------------------------
-- 3. Make is_approved() forgiving
--
-- Belt and braces: a row that somehow has a NULL or unexpected
-- status should not silently lose the ability to speak. Only the
-- two states that are a deliberate moderation decision --
-- 'rejected' and 'banned' -- block a write.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_approved() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.user_id()
      AND coalesce(status,'approved') NOT IN ('rejected','banned')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;


-- ------------------------------------------------------------
-- 4. Check it worked
--
-- Expect: pending_left = 0, and every account listed as approved.
-- ------------------------------------------------------------
SELECT
  count(*) FILTER (WHERE status = 'pending')  AS pending_left,
  count(*) FILTER (WHERE status = 'approved') AS approved,
  count(*) FILTER (WHERE status = 'rejected') AS rejected,
  count(*) FILTER (WHERE status = 'banned')   AS banned
FROM profiles;
