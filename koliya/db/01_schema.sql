-- ============================================================
-- KOLIYA — Database schema (Neon Postgres)
--
-- HOW TO RUN
--   1. Neon Console → Data API → Enable  (tick "Use Managed Better
--      Auth" and "Grant public schema access")
--   2. Neon Console → SQL Editor → paste this file → Run
--   3. Then run 02_policies.sql
--   4. Data API page → "Refresh schema cache"
--
-- Media rule: NEVER store base64 files in these tables.
-- Only https:// URLs pointing at Cloudflare R2.
-- ============================================================

-- ---------- profiles ----------------------------------------
-- Identity itself lives in neon_auth."user" (Managed Better Auth).
-- This table holds the *app* profile, keyed by the same id.
-- The default fills id from the JWT so a student can only ever
-- create their own row.
CREATE TABLE IF NOT EXISTS profiles (
  id            TEXT PRIMARY KEY DEFAULT (auth.user_id()),
  username      TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL DEFAULT '',
  email         TEXT,
  -- The student card is the login identifier, so it must be unique
  -- and normalised (upper case, no spaces) before it is stored.
  student_card  TEXT NOT NULL UNIQUE,
  faculty       TEXT NOT NULL DEFAULT '',
  bio           TEXT NOT NULL DEFAULT '',
  pronouns      TEXT,
  website       TEXT,
  github        TEXT,
  linkedin      TEXT,

  avatar_url    TEXT,                      -- R2 URL, never base64
  banner_url    TEXT,                      -- R2 URL, never base64

  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','banned')),
  role          TEXT NOT NULL DEFAULT 'student'
                CHECK (role IN ('student','admin')),

  is_private    BOOLEAN NOT NULL DEFAULT FALSE,
  xp            INTEGER NOT NULL DEFAULT 0,
  streak        INTEGER NOT NULL DEFAULT 0,
  streak_day    DATE,
  guide_done    BOOLEAN NOT NULL DEFAULT FALSE,

  last_seen     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_card ON profiles(upper(student_card));
CREATE INDEX IF NOT EXISTS idx_profiles_status   ON profiles(status);
CREATE INDEX IF NOT EXISTS idx_profiles_faculty  ON profiles(faculty);

-- ---------- follows -----------------------------------------
-- Was: three text[] columns on the user row. Now a real table.
CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  state       TEXT NOT NULL DEFAULT 'accepted'
              CHECK (state IN ('pending','accepted')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id, state);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

-- ---------- channels ----------------------------------------
CREATE TABLE IF NOT EXISTS channels (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  faculty     TEXT,
  owner_id    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  icon_url    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    TEXT   NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

-- ---------- posts -------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  text       TEXT NOT NULL DEFAULT '',

  image_url  TEXT,                          -- R2 URL
  media_url  TEXT,                          -- R2 URL (video/file)
  media_type TEXT CHECK (media_type IN ('image','video','file')),
  media_name TEXT,

  channel_id BIGINT REFERENCES channels(id) ON DELETE SET NULL,
  repost_id  BIGINT REFERENCES posts(id) ON DELETE SET NULL,
  anonymous  BOOLEAN NOT NULL DEFAULT FALSE,
  pinned     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user    ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_channel ON posts(channel_id);

-- likes / saves / comments as real rows (were JSON arrays)
CREATE TABLE IF NOT EXISTS post_likes (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT   NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_saves (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT   NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         BIGSERIAL PRIMARY KEY,
  post_id    BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT   REFERENCES profiles(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  reply_to   BIGINT REFERENCES comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);

-- ---------- messages (DM) -----------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id          BIGSERIAL PRIMARY KEY,
  sender_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  text        TEXT NOT NULL DEFAULT '',

  media_url   TEXT,                         -- R2 URL, never base64
  media_type  TEXT CHECK (media_type IN ('image','video','file','audio')),
  media_name  TEXT,

  reply_to    BIGINT REFERENCES messages(id) ON DELETE SET NULL,
  view_once   BOOLEAN NOT NULL DEFAULT FALSE,
  seen_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- the index that makes "my conversation" queries fast
CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(sender_id, receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_recv ON messages(receiver_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT   NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji      TEXT   NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

-- ---------- stories -----------------------------------------
CREATE TABLE IF NOT EXISTS stories (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  media_url  TEXT NOT NULL,                 -- R2 URL
  media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image','video')),
  text       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);
CREATE INDEX IF NOT EXISTS idx_stories_active ON stories(expires_at);

CREATE TABLE IF NOT EXISTS story_views (
  story_id BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id  TEXT   NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);

-- ---------- Q&A ---------------------------------------------
CREATE TABLE IF NOT EXISTS qa (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  text       TEXT NOT NULL,
  anonymous  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qa_answers (
  id         BIGSERIAL PRIMARY KEY,
  qa_id      BIGINT NOT NULL REFERENCES qa(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  text       TEXT NOT NULL,
  anonymous  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- events ------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  owner_id    TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  faculty     TEXT,
  location    TEXT,
  cover_url   TEXT,                          -- R2 URL
  starts_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_attendees (
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id  TEXT   NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);

-- ---------- notifications & reports -------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_id   TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  post_id    BIGINT REFERENCES posts(id) ON DELETE CASCADE,
  text       TEXT,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id          BIGSERIAL PRIMARY KEY,
  reporter_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  handled     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- housekeeping ------------------------------------
-- delete stories older than 24h (call from a cron or on app boot)
CREATE OR REPLACE FUNCTION purge_expired_stories() RETURNS void AS $$
  DELETE FROM stories WHERE expires_at < now();
$$ LANGUAGE sql;
