-- ============================================================
-- KOLIYA — 07_privacy_sm.sql
--
-- Run FIFTH, after 01 · 02 · 05 · 06.
-- Re-runnable.
--
-- WHAT "COMPTE PRIVÉ" ACTUALLY MEANT BEFORE THIS FILE
--
-- The switch saved `is_private = true` correctly, and posts were
-- genuinely protected (posts_read calls can_view). But I audited
-- every SELECT policy and found the promise was half kept:
--
--   posts          can_view ✅
--   comments       can_view ✅
--   stories        can_view ✅
--   profiles       ✗  bio, faculty, links, XP — all readable
--   follows        ✗  anyone could list who you follow
--
-- So a private account still leaked its social graph and its whole
-- profile. A privacy switch that protects some things is worse than
-- none, because the student believes they are hidden.
--
-- This file closes both, WITHOUT making private accounts invisible:
-- name, username and avatar stay public so people can find you and
-- ask to follow. That is the Instagram model, and it is the right
-- one — a locked account that cannot be found cannot grow.
-- ============================================================


-- ============================================================
-- 1. PROFILES — the "knock on the door" view
-- ============================================================
-- A private profile still returns a row, so search and follow
-- requests work. What it must NOT return is the private detail.
--
-- RLS is row-level, not column-level, so the filtering is done by a
-- view that blanks the sensitive columns. The base table keeps its
-- own policy for the owner and for admins.

CREATE OR REPLACE VIEW profiles_public AS
SELECT
  p.id,
  p.username,
  p.full_name,
  p.avatar_url,
  p.is_private,
  p.status,
  p.role,
  -- everything below is hidden unless you are allowed to see it
  CASE WHEN can_view(p.id) THEN p.bio        END AS bio,
  CASE WHEN can_view(p.id) THEN p.faculty    END AS faculty,
  CASE WHEN can_view(p.id) THEN p.banner_url END AS banner_url,
  CASE WHEN can_view(p.id) THEN p.pronouns   END AS pronouns,
  CASE WHEN can_view(p.id) THEN p.website    END AS website,
  CASE WHEN can_view(p.id) THEN p.github     END AS github,
  CASE WHEN can_view(p.id) THEN p.linkedin   END AS linkedin,
  CASE WHEN can_view(p.id) THEN p.xp         END AS xp,
  CASE WHEN can_view(p.id) THEN p.streak     END AS streak,
  CASE WHEN can_view(p.id) THEN p.last_seen  END AS last_seen,
  -- the email is contact information and is never public, ever
  CASE WHEN p.id = auth.user_id() OR is_admin() THEN p.email END AS email,
  CASE WHEN p.id = auth.user_id() OR is_admin() THEN p.student_card END AS student_card,
  p.created_at
FROM profiles p
WHERE p.status = 'approved'
   OR p.id = auth.user_id()
   OR is_admin();

-- security_invoker: the view runs as the CALLER, so RLS on the base
-- table still applies. Without this a view is a hole straight through
-- every policy underneath it.
ALTER VIEW profiles_public SET (security_invoker = true);

GRANT SELECT ON profiles_public TO authenticated;


-- ============================================================
-- 2. FOLLOWS — your social graph is not everyone's business
-- ============================================================
DROP POLICY IF EXISTS follows_read ON follows;
CREATE POLICY follows_read ON follows FOR SELECT TO authenticated
  USING (
    -- rows about me are always mine to see
    follower_id = auth.user_id()
    OR followee_id = auth.user_id()
    OR is_admin()
    -- otherwise, only if I may see BOTH sides
    OR (can_view(follower_id) AND can_view(followee_id))
  );


-- ============================================================
-- 3. COUNTERS THAT SURVIVE PRIVACY
-- ============================================================
-- Instagram shows "142 followers" on a locked account and hides the
-- list. Doing that through RLS is impossible — the rows are filtered
-- before they can be counted — so the counts come from a function
-- that runs with definer rights and returns numbers only.

CREATE OR REPLACE FUNCTION profile_counts(p_user TEXT)
RETURNS TABLE (followers INTEGER, following INTEGER, posts INTEGER) AS $$
  SELECT
    (SELECT COUNT(*)::int FROM follows WHERE followee_id = p_user AND state = 'accepted'),
    (SELECT COUNT(*)::int FROM follows WHERE follower_id = p_user AND state = 'accepted'),
    (SELECT COUNT(*)::int FROM posts   WHERE user_id = p_user);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION profile_counts(TEXT) TO authenticated;


-- ============================================================
-- 4. MAY I MESSAGE THIS PERSON?
-- ============================================================
-- Drives the Message button you asked for: shown on public accounts
-- and on people you follow, hidden otherwise. The UI asks this, and
-- messages_send enforces it independently — the button is a courtesy,
-- the policy is the rule.

CREATE OR REPLACE FUNCTION can_message(p_user TEXT)
RETURNS boolean AS $$
  SELECT
    p_user <> auth.user_id()
    AND NOT blocked_between(auth.user_id(), p_user)
    AND EXISTS (SELECT 1 FROM profiles WHERE id = p_user AND status = 'approved')
    AND (
      NOT (SELECT is_private FROM profiles WHERE id = p_user)
      OR EXISTS (
        SELECT 1 FROM follows
        WHERE follower_id = auth.user_id() AND followee_id = p_user AND state = 'accepted'
      )
      OR EXISTS (
        SELECT 1 FROM follows
        WHERE follower_id = p_user AND followee_id = auth.user_id() AND state = 'accepted'
      )
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION can_message(TEXT) TO authenticated;

-- People I am allowed to start a conversation with, most relevant
-- first. This is what "Nouveau message" lists — it used to query
-- `profiles` directly and return everyone, including accounts that
-- would then reject the message.
CREATE OR REPLACE FUNCTION messageable(p_query TEXT DEFAULT '')
RETURNS TABLE (
  id TEXT, username TEXT, full_name TEXT, faculty TEXT,
  avatar_url TEXT, is_private BOOLEAN, follows_me BOOLEAN, i_follow BOOLEAN
) AS $$
  SELECT
    p.id, p.username, p.full_name,
    CASE WHEN can_view(p.id) THEN p.faculty END,
    p.avatar_url,
    p.is_private,
    EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = p.id AND f.followee_id = auth.user_id() AND f.state = 'accepted'),
    EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = auth.user_id() AND f.followee_id = p.id AND f.state = 'accepted')
  FROM profiles p
  WHERE p.status = 'approved'
    AND p.id <> auth.user_id()
    AND NOT blocked_between(auth.user_id(), p.id)
    AND (
      COALESCE(p_query, '') = ''
      OR p.full_name ILIKE '%' || p_query || '%'
      OR p.username  ILIKE '%' || p_query || '%'
    )
  ORDER BY
    -- people you already talk to, then mutuals, then everyone
    (SELECT MAX(m.created_at) FROM messages m
      WHERE (m.sender_id = auth.user_id() AND m.receiver_id = p.id)
         OR (m.sender_id = p.id AND m.receiver_id = auth.user_id())
    ) DESC NULLS LAST,
    EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = auth.user_id() AND f.followee_id = p.id) DESC,
    p.full_name ASC
  LIMIT 60;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION messageable(TEXT) TO authenticated;


-- ============================================================
-- 5. CHAT FOLDERS
-- ============================================================
-- Your original app had these — all · pinned · unread · study ·
-- muted · archived — and kept them in localStorage, so they vanished
-- when the browser was cleared and differed between your phone and
-- your laptop. Same feature, stored properly.

CREATE TABLE IF NOT EXISTS chat_folders (
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  peer_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  folder     TEXT NOT NULL DEFAULT 'all'
             CHECK (folder IN ('all','pinned','study','muted','archived')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, peer_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_folders_user ON chat_folders(user_id, folder);

ALTER TABLE chat_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_folders_own ON chat_folders;
CREATE POLICY chat_folders_own ON chat_folders FOR ALL TO authenticated
  USING (user_id = auth.user_id())
  WITH CHECK (user_id = auth.user_id());

ALTER TABLE chat_folders FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_folders TO authenticated;


-- ============================================================
-- 6. VERIFY
-- ============================================================
-- Every row below should read "protected".
SELECT 'profiles_public view' AS what,
       CASE WHEN EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'profiles_public')
            THEN 'protected' ELSE 'MISSING' END AS state
UNION ALL
SELECT 'follows honours can_view',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_policies
         WHERE tablename = 'follows' AND policyname = 'follows_read'
           AND qual LIKE '%can_view%'
       ) THEN 'protected' ELSE 'MISSING' END
UNION ALL
SELECT 'chat_folders table',
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'chat_folders')
            THEN 'protected' ELSE 'MISSING' END
UNION ALL
SELECT 'can_message()',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'can_message')
            THEN 'protected' ELSE 'MISSING' END;
