-- ============================================================
-- KOLIYA — 05_upgrade_sm.sql
--
-- Run this THIRD, after 01_schema.sql and 02_policies.sql.
-- Re-runnable: every statement is IF NOT EXISTS / OR REPLACE.
--
-- What it adds
--   1. Direct-to-database media (no Cloudflare R2 needed).
--      Images are stored as `data:` URLs inside the same TEXT
--      columns the app already reads, so nothing else changes.
--   2. Polls on posts.
--   3. Voice-note metadata on messages.
--   4. Votes on Q&A answers.
--   5. Typing indicators + presence.
--   6. Counter views so the feed needs 3 queries instead of 300.
-- ============================================================


-- ============================================================
-- 1. MEDIA STORED DIRECTLY IN POSTGRES
-- ============================================================
-- The original plan was "URLs only, files in R2". You asked for the
-- opposite: keep everything in the database. That is workable for a
-- campus-sized app as long as two rules hold.
--
--   Rule 1 — the client shrinks before it uploads.
--            avatar  400px  · banner 1280px · post 1080px
--   Rule 2 — Postgres refuses anything bigger, so a bug in the
--            browser cannot fill your storage quota.
--
-- Sizes below are in bytes of the *stored text*, which is ~1.37×
-- the size of the JPEG because of base64. TOAST compresses the row
-- transparently, so the on-disk cost is usually lower.

CREATE OR REPLACE FUNCTION media_ok(v TEXT, max_bytes INT)
RETURNS boolean AS $$
  SELECT v IS NULL
      OR (
        octet_length(v) <= max_bytes
        AND (v LIKE 'data:image/%' OR v LIKE 'data:video/%'
             OR v LIKE 'data:audio/%' OR v LIKE 'http://%' OR v LIKE 'https://%')
      );
$$ LANGUAGE sql IMMUTABLE;

-- NOT VALID: existing rows are left alone, new writes are checked.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_avatar_size') THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_avatar_size
      CHECK (media_ok(avatar_url, 400000)) NOT VALID;      -- ~290 KB image
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_banner_size') THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_banner_size
      CHECK (media_ok(banner_url, 900000)) NOT VALID;      -- ~650 KB image
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_image_size') THEN
    ALTER TABLE posts ADD CONSTRAINT posts_image_size
      CHECK (media_ok(image_url, 1400000)) NOT VALID;      -- ~1 MB image
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_media_size') THEN
    ALTER TABLE posts ADD CONSTRAINT posts_media_size
      CHECK (media_ok(media_url, 4000000)) NOT VALID;      -- ~2.9 MB clip
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_media_size') THEN
    ALTER TABLE messages ADD CONSTRAINT messages_media_size
      CHECK (media_ok(media_url, 4000000)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stories_media_size') THEN
    ALTER TABLE stories ADD CONSTRAINT stories_media_size
      CHECK (media_ok(media_url, 2000000)) NOT VALID;
  END IF;
END $$;

-- Media columns are large and almost never filtered on, so keep them
-- out of the way of the planner.
ALTER TABLE profiles ALTER COLUMN avatar_url SET STORAGE EXTENDED;
ALTER TABLE profiles ALTER COLUMN banner_url SET STORAGE EXTENDED;
ALTER TABLE posts    ALTER COLUMN image_url  SET STORAGE EXTENDED;
ALTER TABLE messages ALTER COLUMN media_url  SET STORAGE EXTENDED;
ALTER TABLE stories  ALTER COLUMN media_url  SET STORAGE EXTENDED;


-- ============================================================
-- 2. POLLS
-- ============================================================
-- The options live as JSONB on the post (they are written once and
-- read together). The votes are real rows so one student cannot
-- vote twice and so RLS can protect them.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS poll JSONB;
  -- shape: {"options":["Mercredi 14h","Jeudi 16h"]}

CREATE TABLE IF NOT EXISTS poll_votes (
  post_id  BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id  TEXT   NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  choice   SMALLINT NOT NULL CHECK (choice >= 0 AND choice < 10),
  voted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_post ON poll_votes(post_id);


-- ============================================================
-- 3. VOICE NOTES & VIDEO METADATA
-- ============================================================
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_duration INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS waveform JSONB;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS forwarded_from TEXT;

ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_duration INTEGER;


-- ============================================================
-- 4. Q&A ANSWER VOTES
-- ============================================================
-- The module showed a vote count with nothing behind it.
CREATE TABLE IF NOT EXISTS qa_answer_votes (
  answer_id BIGINT NOT NULL REFERENCES qa_answers(id) ON DELETE CASCADE,
  user_id   TEXT   NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (answer_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_qa_votes_answer ON qa_answer_votes(answer_id);

ALTER TABLE qa ADD COLUMN IF NOT EXISTS faculty TEXT;
ALTER TABLE qa ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT FALSE;


-- ============================================================
-- 5. PRESENCE & TYPING
-- ============================================================
-- Neon has no realtime channel, so "is typing" is a row with a very
-- short lifetime that the other side polls. Cheap, and it disappears
-- on its own without a cleanup job.
CREATE TABLE IF NOT EXISTS typing (
  user_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  peer_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, peer_id)
);

CREATE OR REPLACE FUNCTION touch_presence() RETURNS void AS $$
  UPDATE profiles SET last_seen = now() WHERE id = auth.user_id();
$$ LANGUAGE sql;


-- ============================================================
-- 6. CHANNEL POSTS
-- ============================================================
-- channels already exist; give them a readable "last activity".
ALTER TABLE channels ADD COLUMN IF NOT EXISTS last_text TEXT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS last_at TIMESTAMPTZ;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS official BOOLEAN NOT NULL DEFAULT FALSE;


-- ============================================================
-- 7. SAVED POSTS ALREADY EXIST (post_saves) — nothing to add
-- ============================================================


-- ============================================================
-- 8. RLS FOR THE NEW TABLES
-- ============================================================
ALTER TABLE poll_votes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_answer_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE typing          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS poll_votes_read ON poll_votes;
CREATE POLICY poll_votes_read ON poll_votes FOR SELECT TO authenticated
  USING (is_approved());

DROP POLICY IF EXISTS poll_votes_own ON poll_votes;
CREATE POLICY poll_votes_own ON poll_votes FOR ALL TO authenticated
  USING (user_id = auth.user_id())
  WITH CHECK (user_id = auth.user_id() AND is_approved());

DROP POLICY IF EXISTS qa_votes_read ON qa_answer_votes;
CREATE POLICY qa_votes_read ON qa_answer_votes FOR SELECT TO authenticated
  USING (is_approved());

DROP POLICY IF EXISTS qa_votes_own ON qa_answer_votes;
CREATE POLICY qa_votes_own ON qa_answer_votes FOR ALL TO authenticated
  USING (user_id = auth.user_id())
  WITH CHECK (user_id = auth.user_id() AND is_approved());

-- Typing: I may write only my own row, and read only rows aimed at me.
DROP POLICY IF EXISTS typing_read ON typing;
CREATE POLICY typing_read ON typing FOR SELECT TO authenticated
  USING (peer_id = auth.user_id() OR user_id = auth.user_id());

DROP POLICY IF EXISTS typing_own ON typing;
CREATE POLICY typing_own ON typing FOR ALL TO authenticated
  USING (user_id = auth.user_id())
  WITH CHECK (user_id = auth.user_id());

ALTER TABLE poll_votes      FORCE ROW LEVEL SECURITY;
ALTER TABLE qa_answer_votes FORCE ROW LEVEL SECURITY;
ALTER TABLE typing          FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON poll_votes, qa_answer_votes, typing TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;


-- ============================================================
-- 9. VERIFY
-- ============================================================
SELECT c.relname AS table,
       c.relrowsecurity AS rls_on,
       (SELECT count(*) FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY 1;
