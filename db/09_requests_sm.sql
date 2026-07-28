-- ============================================================
-- KOLIYA — 09_requests_sm.sql
--
-- Run SEVENTH, after 01 · 02 · 05 · 06 · 07 · 08.
-- Re-runnable.
--
-- MESSAGE REQUESTS, THE INSTAGRAM MODEL
--
-- Until now a message from a stranger either landed straight in your
-- inbox or was refused outright. Both are wrong for a campus app:
-- the first lets anyone interrupt you, the second means a classmate
-- you have not followed yet cannot reach you at all.
--
-- Instagram's answer, which is the right one:
--
--   · you follow them, or they follow you  → normal conversation
--   · a complete stranger writes           → it goes to REQUESTS
--   · you accept                           → moves to the inbox
--   · you ignore                           → they never know, and
--                                            cannot keep writing
--
-- The sender is never told they were filtered. That matters: telling
-- someone "your message was hidden" invites them to try again from
-- another angle, and it embarrasses the person who was simply not
-- accepted yet.
-- ============================================================


-- ============================================================
-- 1. THE STATE LIVES ON THE CONVERSATION, NOT THE MESSAGE
-- ============================================================
-- One row per (owner, peer). `owner` is the person deciding.
-- A pair therefore has two rows, one per direction, which is what
-- lets me accept you while you have not accepted me.

CREATE TABLE IF NOT EXISTS dm_requests (
  owner_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  peer_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  state      TEXT NOT NULL DEFAULT 'pending'
             CHECK (state IN ('pending','accepted','declined')),
  first_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  PRIMARY KEY (owner_id, peer_id),
  CHECK (owner_id <> peer_id)
);
CREATE INDEX IF NOT EXISTS idx_dm_req_owner ON dm_requests(owner_id, state, first_at DESC);


-- ============================================================
-- 2. WHO IS ALREADY CONNECTED
-- ============================================================
-- A follow in EITHER direction means no request is needed. If you
-- follow me, you have already signalled you want to hear from me.
CREATE OR REPLACE FUNCTION dm_connected(a TEXT, b TEXT)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM follows
    WHERE state = 'accepted'
      AND ((follower_id = a AND followee_id = b)
        OR (follower_id = b AND followee_id = a))
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;


-- ============================================================
-- 3. THE RULE, APPLIED WHEN A MESSAGE IS WRITTEN
-- ============================================================
-- A trigger, not client code: the browser must not be the thing
-- deciding whether a message is a request.
--
-- LIMIT: a pending request allows THREE messages. Without a cap, an
-- unwanted person can fill your requests tab with fifty lines you
-- never asked to receive. Three is enough to say who you are and why
-- you are writing.

CREATE OR REPLACE FUNCTION route_new_message() RETURNS trigger AS $$
DECLARE
  existing dm_requests%ROWTYPE;
  sent_count INTEGER;
BEGIN
  -- Connected already, or the receiver previously accepted: nothing to do.
  IF dm_connected(NEW.sender_id, NEW.receiver_id) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO existing
  FROM dm_requests
  WHERE owner_id = NEW.receiver_id AND peer_id = NEW.sender_id;

  IF FOUND AND existing.state = 'accepted' THEN
    RETURN NEW;
  END IF;

  IF FOUND AND existing.state = 'declined' THEN
    -- Declined is a quiet wall. The insert is dropped and the sender
    -- sees their own message locally with no error — exactly what
    -- Instagram does. Telling them would defeat the purpose.
    RETURN NULL;
  END IF;

  IF NOT FOUND THEN
    INSERT INTO dm_requests (owner_id, peer_id, state)
    VALUES (NEW.receiver_id, NEW.sender_id, 'pending')
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- Pending: cap the number of unanswered messages.
  SELECT COUNT(*) INTO sent_count
  FROM messages
  WHERE sender_id = NEW.sender_id AND receiver_id = NEW.receiver_id;

  IF sent_count >= 3 THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_route_new_message ON messages;
CREATE TRIGGER trg_route_new_message
  BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION route_new_message();


-- ============================================================
-- 4. READING: THE INBOX EXCLUDES PENDING REQUESTS
-- ============================================================
CREATE OR REPLACE FUNCTION dm_is_request(p_peer TEXT)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM dm_requests
    WHERE owner_id = auth.user_id() AND peer_id = p_peer AND state = 'pending'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Conversations in the normal inbox.
CREATE OR REPLACE FUNCTION dm_inbox_peers()
RETURNS TABLE (peer_id TEXT) AS $$
  SELECT DISTINCT CASE WHEN m.sender_id = auth.user_id() THEN m.receiver_id ELSE m.sender_id END
  FROM messages m
  WHERE (m.sender_id = auth.user_id() OR m.receiver_id = auth.user_id())
    AND NOT EXISTS (
      SELECT 1 FROM dm_requests r
      WHERE r.owner_id = auth.user_id()
        AND r.peer_id = CASE WHEN m.sender_id = auth.user_id() THEN m.receiver_id ELSE m.sender_id END
        -- 'declined' as well as 'pending': a declined conversation
        -- must disappear from the inbox, not sit there quietly.
        AND r.state IN ('pending', 'declined')
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- The requests tab: who is waiting, with a preview.
CREATE OR REPLACE FUNCTION dm_requests_list()
RETURNS TABLE (
  peer_id TEXT, username TEXT, full_name TEXT, avatar_url TEXT,
  faculty TEXT, preview TEXT, msg_count INTEGER, first_at TIMESTAMPTZ,
  mutuals INTEGER
) AS $$
  SELECT
    r.peer_id, p.username, p.full_name, p.avatar_url,
    CASE WHEN can_view(p.id) THEN p.faculty END,
    (SELECT m.text FROM messages m
      WHERE m.sender_id = r.peer_id AND m.receiver_id = r.owner_id
      ORDER BY m.created_at ASC LIMIT 1),
    (SELECT COUNT(*)::int FROM messages m
      WHERE m.sender_id = r.peer_id AND m.receiver_id = r.owner_id),
    r.first_at,
    -- shared connections, the strongest signal of who this person is
    (SELECT COUNT(*)::int FROM follows f1
      JOIN follows f2 ON f1.followee_id = f2.followee_id
      WHERE f1.follower_id = auth.user_id() AND f2.follower_id = r.peer_id
        AND f1.state = 'accepted' AND f2.state = 'accepted')
  FROM dm_requests r
  JOIN profiles p ON p.id = r.peer_id
  WHERE r.owner_id = auth.user_id() AND r.state = 'pending'
  ORDER BY r.first_at DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION dm_requests_count()
RETURNS INTEGER AS $$
  SELECT COUNT(*)::int FROM dm_requests
  WHERE owner_id = auth.user_id() AND state = 'pending';
$$ LANGUAGE sql STABLE SECURITY DEFINER;


-- ============================================================
-- 5. DECIDING
-- ============================================================
CREATE OR REPLACE FUNCTION dm_accept(p_peer TEXT) RETURNS void AS $$
  INSERT INTO dm_requests (owner_id, peer_id, state, decided_at)
  VALUES (auth.user_id(), p_peer, 'accepted', now())
  ON CONFLICT (owner_id, peer_id)
  DO UPDATE SET state = 'accepted', decided_at = now();
$$ LANGUAGE sql SECURITY DEFINER;

-- Decline is silent by design: no notification, no "seen", nothing
-- the sender can detect. They simply never get a reply.
CREATE OR REPLACE FUNCTION dm_decline(p_peer TEXT) RETURNS void AS $$
  INSERT INTO dm_requests (owner_id, peer_id, state, decided_at)
  VALUES (auth.user_id(), p_peer, 'declined', now())
  ON CONFLICT (owner_id, peer_id)
  DO UPDATE SET state = 'declined', decided_at = now();
$$ LANGUAGE sql SECURITY DEFINER;

-- Delete removes the conversation as well as the request.
CREATE OR REPLACE FUNCTION dm_delete_request(p_peer TEXT) RETURNS void AS $$
  WITH gone AS (
    DELETE FROM messages
    WHERE (sender_id = p_peer AND receiver_id = auth.user_id())
       OR (sender_id = auth.user_id() AND receiver_id = p_peer)
    RETURNING 1
  )
  INSERT INTO dm_requests (owner_id, peer_id, state, decided_at)
  VALUES (auth.user_id(), p_peer, 'declined', now())
  ON CONFLICT (owner_id, peer_id)
  DO UPDATE SET state = 'declined', decided_at = now();
$$ LANGUAGE sql SECURITY DEFINER;


-- ============================================================
-- 6. can_message() NOW ALLOWS A REQUEST
-- ============================================================
-- Previously a stranger simply could not write to a private account.
-- With requests in place, they can send up to three lines that wait
-- for a decision — which is the whole point.
CREATE OR REPLACE FUNCTION can_message(p_user TEXT)
RETURNS boolean AS $$
  SELECT
    p_user <> auth.user_id()
    AND NOT blocked_between(auth.user_id(), p_user)
    AND EXISTS (SELECT 1 FROM profiles WHERE id = p_user AND status = 'approved')
    AND NOT EXISTS (
      SELECT 1 FROM dm_requests
      WHERE owner_id = p_user AND peer_id = auth.user_id() AND state = 'declined'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Does writing to this person create a request rather than a chat?
-- The composer uses this to explain what will happen BEFORE sending.
CREATE OR REPLACE FUNCTION dm_will_be_request(p_user TEXT)
RETURNS boolean AS $$
  SELECT NOT dm_connected(auth.user_id(), p_user)
     AND NOT EXISTS (
       SELECT 1 FROM dm_requests
       WHERE owner_id = p_user AND peer_id = auth.user_id() AND state = 'accepted'
     );
$$ LANGUAGE sql STABLE SECURITY DEFINER;


-- ============================================================
-- 7. RLS
-- ============================================================
ALTER TABLE dm_requests ENABLE ROW LEVEL SECURITY;

-- You see only the requests addressed to you. A sender must not be
-- able to query whether they were declined.
DROP POLICY IF EXISTS dm_req_own ON dm_requests;
CREATE POLICY dm_req_own ON dm_requests FOR SELECT TO authenticated
  USING (owner_id = auth.user_id() OR is_admin());

DROP POLICY IF EXISTS dm_req_decide ON dm_requests;
CREATE POLICY dm_req_decide ON dm_requests FOR UPDATE TO authenticated
  USING (owner_id = auth.user_id())
  WITH CHECK (owner_id = auth.user_id());

-- Inserts come from the trigger, which runs as definer.
DROP POLICY IF EXISTS dm_req_insert ON dm_requests;
CREATE POLICY dm_req_insert ON dm_requests FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.user_id());

ALTER TABLE dm_requests FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON dm_requests TO authenticated;

GRANT EXECUTE ON FUNCTION dm_connected(TEXT, TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION dm_is_request(TEXT)          TO authenticated;
GRANT EXECUTE ON FUNCTION dm_inbox_peers()             TO authenticated;
GRANT EXECUTE ON FUNCTION dm_requests_list()           TO authenticated;
GRANT EXECUTE ON FUNCTION dm_requests_count()          TO authenticated;
GRANT EXECUTE ON FUNCTION dm_accept(TEXT)              TO authenticated;
GRANT EXECUTE ON FUNCTION dm_decline(TEXT)             TO authenticated;
GRANT EXECUTE ON FUNCTION dm_delete_request(TEXT)      TO authenticated;
GRANT EXECUTE ON FUNCTION dm_will_be_request(TEXT)     TO authenticated;


-- ============================================================
-- 8. VERIFY
-- ============================================================
SELECT 'dm_requests table' AS what,
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE tablename='dm_requests')
            THEN 'ready' ELSE 'MISSING' END AS state
UNION ALL
SELECT 'routing trigger',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_route_new_message')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'requests list',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='dm_requests_list')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'accept / decline',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='dm_accept')
        AND EXISTS (SELECT 1 FROM pg_proc WHERE proname='dm_decline')
            THEN 'ready' ELSE 'MISSING' END;
