-- ============================================================
-- 12_dm_notify_sm.sql
-- A DIRECT MESSAGE MUST CREATE A NOTIFICATION ROW.
-- ============================================================
--
-- THE BUG
-- sendMessage() in api_sm.js inserts into `messages` and stops. Nothing
-- else — no trigger, no client code — ever wrote a row into
-- `notifications` for a DM. Verified by listing every trigger in the
-- schema (three: two on profiles, one routing strangers to dm_requests)
-- and grepping the whole file for `INSERT INTO notifications`: zero.
--
-- Everything that announces a message reads `notifications` through
-- pending_alerts():
--     the background Android service  → nothing to find
--     notify_sm.js's 20s poller       → nothing to find
--
-- The ONLY thing that ever saw a new message was messages_sm.js polling
-- the `messages` table directly, which runs only while that page is
-- open. That is exactly the reported symptom: the message appears only
-- if you are already inside the conversation.
--
-- WHY A TRIGGER AND NOT CLIENT CODE
--   * fires for every sender: web, APK, an old build, a future one
--   * cannot be skipped by closing the tab mid-send
--   * SECURITY DEFINER, because the SENDER has no RLS permission to
--     write into the RECEIVER's notification inbox — and should not.
--     The trigger is the only path, so a client cannot forge alerts.
--
-- Idempotent: safe to run twice, and safe to run before or after the
-- rest of the schema.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The preview text
--    A notification body must never be a raw blob URL or an empty
--    string. Media gets a word, text gets a truncated copy.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dm_preview(
  p_text text,
  p_media_type text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN COALESCE(NULLIF(TRIM(p_text), ''), '') <> ''
      THEN LEFT(TRIM(p_text), 120)
    WHEN p_media_type = 'image' THEN '[image]'
    WHEN p_media_type = 'video' THEN '[video]'
    WHEN p_media_type = 'audio' THEN '[audio]'
    WHEN p_media_type IS NOT NULL THEN '[file]'
    ELSE ''
  END;
$function$;

-- The bracketed words above are placeholders the CLIENT replaces with a
-- translated string; the database must not ship French or Arabic text,
-- because one row is read by users in three languages.
-- notify_sm.js and SyncService map them via t('notif.attachment').


-- ------------------------------------------------------------
-- 2. The trigger function
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_kind      text := 'message';
  v_muted     boolean := false;
  v_preview   text;
  v_recent_id bigint;
BEGIN
  -- Never notify yourself. Saved-messages-to-self is a real pattern.
  IF NEW.sender_id = NEW.receiver_id THEN
    RETURN NEW;
  END IF;

  -- Respect a muted conversation. The column may not exist on older
  -- deployments, so this is wrapped rather than assumed.
  BEGIN
    SELECT COALESCE(muted, false) INTO v_muted
    FROM dm_threads
    WHERE owner_id = NEW.receiver_id AND peer_id = NEW.sender_id;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_muted := false;
  END;

  IF v_muted THEN
    RETURN NEW;
  END IF;

  -- A first message from a stranger is a REQUEST, not a message. It
  -- gets its own channel in the APK so it can be quieter.
  BEGIN
    IF NOT dm_connected(NEW.sender_id, NEW.receiver_id) THEN
      IF EXISTS (
        SELECT 1 FROM dm_requests
        WHERE owner_id = NEW.receiver_id
          AND peer_id  = NEW.sender_id
          AND state    = 'pending'
      ) THEN
        v_kind := 'dm_request';
      END IF;
    END IF;
  EXCEPTION WHEN undefined_function OR undefined_table THEN
    v_kind := 'message';
  END;

  v_preview := dm_preview(NEW.text, NEW.media_type);

  -- COALESCE, because a burst of twenty messages must be one line in
  -- the shade, not twenty buzzes. If an unread alert from this same
  -- sender already exists and is under two minutes old, move it forward
  -- instead of adding another row.
  SELECT id INTO v_recent_id
  FROM notifications
  WHERE user_id   = NEW.receiver_id
    AND actor_id  = NEW.sender_id
    AND kind      = v_kind
    AND read_at IS NULL
    AND created_at > now() - interval '2 minutes'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_recent_id IS NOT NULL THEN
    UPDATE notifications
       SET text       = v_preview,
           created_at = now()      -- so pending_alerts(p_since) sees it
     WHERE id = v_recent_id;
  ELSE
    INSERT INTO notifications (user_id, actor_id, kind, text)
    VALUES (NEW.receiver_id, NEW.sender_id, v_kind, v_preview);
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- A failure here must NEVER lose the message itself. Delivering the
  -- message silently beats rejecting it because the alert failed.
  RETURN NEW;
END;
$function$;


-- AFTER, not BEFORE: trg_route_new_message is a BEFORE trigger that
-- returns NULL to silently drop messages from a declined sender. An
-- AFTER trigger never runs for a dropped row, so a blocked person
-- cannot use this to reach the notification shade.
DROP TRIGGER IF EXISTS trg_notify_new_message ON messages;
CREATE TRIGGER trg_notify_new_message
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION notify_new_message();


-- ------------------------------------------------------------
-- 2b. BUG FOUND WHILE TESTING THE ABOVE — messaging yourself crashes.
--
--     INSERT INTO messages (sender_id, receiver_id, text)
--     VALUES ('u_sara','u_sara','note to self');
--     ERROR: new row for relation "dm_requests" violates check
--            constraint "dm_requests_check"
--     CONTEXT: PL/pgSQL function route_new_message() line 27
--
-- route_new_message() never considered sender = receiver. dm_connected()
-- returns false for a person and themselves, so it falls through to
-- creating a dm_request from you to you, which the CHECK constraint
-- (owner_id <> peer_id) rightly rejects — and the message is lost.
--
-- "Saved messages" is a real pattern people use as a notepad. This is
-- pre-existing and unrelated to notifications, but it is one line and
-- it is in the same function path, so it is fixed here rather than
-- left as a known crash.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.route_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  existing dm_requests%ROWTYPE;
  sent_count INTEGER;
BEGIN
  -- Talking to yourself is always allowed and never a request.
  IF NEW.sender_id = NEW.receiver_id THEN
    RETURN NEW;
  END IF;

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
$function$;


-- ------------------------------------------------------------
-- 3. Clearing them when the thread is opened
--    Without this pending_alerts() keeps returning the same rows for
--    ever and the phone re-announces messages you have already read.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_dm_read(p_peer text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH done AS (
    UPDATE notifications
       SET read_at = now()
     WHERE user_id  = auth.user_id()
       AND actor_id = p_peer
       AND kind IN ('message', 'dm_request')
       AND read_at IS NULL
    RETURNING 1
  )
  SELECT COUNT(*)::int FROM done;
$function$;

GRANT EXECUTE ON FUNCTION public.dm_preview(text, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_dm_read(text)          TO authenticated;
-- notify_new_message() is NOT granted: it is only ever reached through
-- the trigger, and a callable version would let a client forge alerts.


-- ------------------------------------------------------------
-- 4. Backfill
--    Unread messages that arrived before this migration existed have
--    no notification row. One per sender so the first sync after the
--    upgrade is not a wall of alerts.
-- ------------------------------------------------------------
INSERT INTO notifications (user_id, actor_id, kind, text, created_at)
SELECT DISTINCT ON (m.receiver_id, m.sender_id)
       m.receiver_id, m.sender_id, 'message',
       dm_preview(m.text, m.media_type), m.created_at
FROM messages m
WHERE m.seen_at IS NULL
  AND m.sender_id <> m.receiver_id
  AND m.created_at > now() - interval '7 days'
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.user_id  = m.receiver_id
      AND n.actor_id = m.sender_id
      AND n.kind     = 'message'
      AND n.created_at >= m.created_at
  )
ORDER BY m.receiver_id, m.sender_id, m.created_at DESC
ON CONFLICT DO NOTHING;
