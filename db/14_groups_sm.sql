-- ============================================================
-- 14_groups_sm.sql
-- GROUP CHATS for channels and events, with Telegram-style roles.
-- ============================================================
--
-- WHAT EXISTS ALREADY (checked, not assumed)
--   channels(id, name, description, faculty, owner_id, icon_url, official)
--   channel_members(channel_id, user_id, joined_at)   -- no role column
--   events(id, owner_id, title, ..., cover_url)        -- cover already there
--   event_attendees(event_id, user_id)
--
-- WHAT WAS MISSING
--   * a role on a membership, so nobody can appoint moderators
--   * a privacy flag, so any channel could be joined by anyone
--   * "admins only" posting, so a scammer can post to a whole faculty
--   * join requests for a private channel
--   * a place for the messages themselves
--
-- Idempotent. Safe to run twice, and safe to run on a database that
-- already has students in it.
-- ============================================================


-- ------------------------------------------------------------
-- 1. ROLES AND PRIVACY ON A CHANNEL
-- ------------------------------------------------------------
ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_private   boolean NOT NULL DEFAULT false;
-- 'all' = every member may post · 'admins' = read-only for members.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS post_policy  text    NOT NULL DEFAULT 'all';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS members_count integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE channels ADD CONSTRAINT channels_post_policy_ck
    CHECK (post_policy IN ('all', 'admins'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- owner > admin > member. The owner is the only one who cannot be
-- demoted, so a channel can never end up with nobody in charge.
ALTER TABLE channel_members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member';

DO $$ BEGIN
  ALTER TABLE channel_members ADD CONSTRAINT channel_members_role_ck
    CHECK (role IN ('owner', 'admin', 'member'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Every existing channel's owner becomes its owner-member. Without this
-- the person who created a channel could not administer it after the
-- upgrade.
INSERT INTO channel_members (channel_id, user_id, role)
SELECT c.id, c.owner_id, 'owner'
FROM channels c
WHERE c.owner_id IS NOT NULL
ON CONFLICT (channel_id, user_id) DO UPDATE SET role = 'owner';


-- ...and every channel created FROM NOW ON gets the same row.
--
-- The back-fill above only covers channels that already existed. A
-- channel created after the migration had no owner-member at all, so
-- channel_role() returned NULL and its creator could not administer,
-- lock or moderate the thing they had just made. Caught by testing
-- channel_role() on a freshly inserted row: it came back empty.
CREATE OR REPLACE FUNCTION public.channel_owner_member()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    INSERT INTO channel_members (channel_id, user_id, role)
    VALUES (NEW.id, NEW.owner_id, 'owner')
    ON CONFLICT (channel_id, user_id) DO UPDATE SET role = 'owner';

    UPDATE channels SET members_count = 1 WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_channel_owner_member ON channels;
CREATE TRIGGER trg_channel_owner_member
AFTER INSERT ON public.channels
FOR EACH ROW EXECUTE FUNCTION channel_owner_member();


-- ------------------------------------------------------------
-- 2. JOIN REQUESTS  (private channels only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channel_requests (
  channel_id  bigint NOT NULL,
  user_id     text   NOT NULL,
  state       text   NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_requests_pkey PRIMARY KEY (channel_id, user_id),
  CONSTRAINT channel_requests_state_ck CHECK (state IN ('pending', 'accepted', 'declined'))
);


-- ------------------------------------------------------------
-- 3. THE MESSAGES
--
--    One table for both channel chats and event chats rather than two
--    near-identical ones: the UI is the same screen, and a single
--    table means one set of policies to get right instead of two.
--    Exactly one of channel_id / event_id is set.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_messages (
  id          bigserial,
  channel_id  bigint,
  event_id    bigint,
  sender_id   text NOT NULL,
  text        text NOT NULL DEFAULT '',
  media_url   text,
  media_type  text,
  reply_to    bigint,
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  CONSTRAINT group_messages_pkey PRIMARY KEY (id),
  CONSTRAINT group_messages_target_ck CHECK (
    (channel_id IS NOT NULL AND event_id IS NULL) OR
    (channel_id IS NULL AND event_id IS NOT NULL)
  ),
  -- Same ceiling as messages.media_url: a data: URL, not a file host.
  CONSTRAINT group_messages_media_ck CHECK (
    media_url IS NULL OR length(media_url) < 1600000
  )
);

CREATE INDEX IF NOT EXISTS group_messages_channel_idx
  ON group_messages (channel_id, created_at DESC) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS group_messages_event_idx
  ON group_messages (event_id, created_at DESC) WHERE event_id IS NOT NULL;


-- ------------------------------------------------------------
-- 4. HELPERS
--    SECURITY DEFINER so a policy can ask "is this person a member?"
--    without the asker needing read access to the membership table.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.channel_role(p_channel bigint, p_user text DEFAULT NULL)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT role FROM channel_members
  WHERE channel_id = p_channel
    AND user_id = COALESCE(p_user, auth.user_id());
$function$;

CREATE OR REPLACE FUNCTION public.is_channel_member(p_channel bigint, p_user text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM channel_members
    WHERE channel_id = p_channel
      AND user_id = COALESCE(p_user, auth.user_id())
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_channel_admin(p_channel bigint, p_user text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT channel_role(p_channel, p_user) IN ('owner', 'admin');
$function$;

CREATE OR REPLACE FUNCTION public.is_event_attendee(p_event bigint, p_user text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM event_attendees
    WHERE event_id = p_event
      AND user_id = COALESCE(p_user, auth.user_id())
  );
$function$;

/* May I post here?
   Channel: a member, and either the policy is open or I am an admin.
   Event:   anyone attending. An event chat has no ranks — the point is
            that everyone going can coordinate. */
CREATE OR REPLACE FUNCTION public.can_post_group(p_channel bigint, p_event bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT CASE
    WHEN p_event IS NOT NULL THEN is_event_attendee(p_event)
    WHEN p_channel IS NOT NULL THEN
      is_channel_member(p_channel)
      AND (
        is_channel_admin(p_channel)
        OR COALESCE((SELECT post_policy FROM channels WHERE id = p_channel), 'all') = 'all'
      )
    ELSE false
  END;
$function$;


-- ------------------------------------------------------------
-- 5. JOINING
--
--    join_channel() is the ONLY way in, so the private/public decision
--    cannot be bypassed by inserting a membership row directly — the
--    RLS policy below refuses those.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_channel(p_channel bigint)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_private boolean;
  v_me text := auth.user_id();
BEGIN
  IF v_me IS NULL THEN RETURN 'error'; END IF;

  SELECT is_private INTO v_private FROM channels WHERE id = p_channel;
  IF NOT FOUND THEN RETURN 'error'; END IF;

  IF is_channel_member(p_channel, v_me) THEN RETURN 'joined'; END IF;

  IF v_private THEN
    -- An admin has to let you in. Re-requesting after a refusal just
    -- moves the row back to pending; declining again is one tap.
    INSERT INTO channel_requests (channel_id, user_id, state)
    VALUES (p_channel, v_me, 'pending')
    ON CONFLICT (channel_id, user_id) DO UPDATE SET state = 'pending', created_at = now();
    RETURN 'requested';
  END IF;

  INSERT INTO channel_members (channel_id, user_id, role)
  VALUES (p_channel, v_me, 'member')
  ON CONFLICT DO NOTHING;

  UPDATE channels SET members_count = (
    SELECT COUNT(*) FROM channel_members WHERE channel_id = p_channel
  ) WHERE id = p_channel;

  RETURN 'joined';
END;
$function$;

CREATE OR REPLACE FUNCTION public.leave_channel(p_channel bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_me text := auth.user_id();
BEGIN
  -- The owner cannot walk out and leave a channel nobody can run.
  IF channel_role(p_channel, v_me) = 'owner' THEN RETURN false; END IF;

  DELETE FROM channel_members WHERE channel_id = p_channel AND user_id = v_me;
  UPDATE channels SET members_count = (
    SELECT COUNT(*) FROM channel_members WHERE channel_id = p_channel
  ) WHERE id = p_channel;
  RETURN true;
END;
$function$;

/* Accept or decline a join request. Admins only — enforced here, not in
   the client, because the client is not a security boundary. */
CREATE OR REPLACE FUNCTION public.respond_channel_request(
  p_channel bigint, p_user text, p_accept boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NOT is_channel_admin(p_channel) THEN RETURN false; END IF;

  IF p_accept THEN
    INSERT INTO channel_members (channel_id, user_id, role)
    VALUES (p_channel, p_user, 'member')
    ON CONFLICT DO NOTHING;
    UPDATE channel_requests SET state = 'accepted'
      WHERE channel_id = p_channel AND user_id = p_user;
    UPDATE channels SET members_count = (
      SELECT COUNT(*) FROM channel_members WHERE channel_id = p_channel
    ) WHERE id = p_channel;

    INSERT INTO notifications (user_id, actor_id, kind, text)
    VALUES (p_user, auth.user_id(), 'channel_accepted',
            (SELECT name FROM channels WHERE id = p_channel));
  ELSE
    UPDATE channel_requests SET state = 'declined'
      WHERE channel_id = p_channel AND user_id = p_user;
  END IF;
  RETURN true;
END;
$function$;

/* Promote or demote. Only an OWNER may change roles — an admin who
   could appoint admins is an owner in all but name, and could lock the
   real owner out. */
CREATE OR REPLACE FUNCTION public.set_channel_role(
  p_channel bigint, p_user text, p_role text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF channel_role(p_channel, auth.user_id()) <> 'owner' THEN RETURN false; END IF;
  IF p_role NOT IN ('admin', 'member') THEN RETURN false; END IF;
  -- Ownership is not transferable through this call.
  IF channel_role(p_channel, p_user) = 'owner' THEN RETURN false; END IF;

  UPDATE channel_members SET role = p_role
   WHERE channel_id = p_channel AND user_id = p_user;
  RETURN FOUND;
END;
$function$;


-- ------------------------------------------------------------
-- 6. ATTENDING AN EVENT PUTS YOU IN ITS CHAT
--
--    A trigger, not client code: the chat membership IS the attendee
--    row, so they cannot drift apart. Leaving the event removes you
--    from the chat for the same reason.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_chat_welcome()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  -- One system line the first time anybody joins, so the chat is not an
  -- empty room. Not one per person: that would be forty join notices.
  IF NOT EXISTS (SELECT 1 FROM group_messages WHERE event_id = NEW.event_id) THEN
    INSERT INTO group_messages (event_id, sender_id, text)
    VALUES (NEW.event_id, NEW.user_id, '');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_event_chat_welcome ON event_attendees;
CREATE TRIGGER trg_event_chat_welcome
AFTER INSERT ON public.event_attendees
FOR EACH ROW EXECUTE FUNCTION event_chat_welcome();


-- ------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE group_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_requests ENABLE ROW LEVEL SECURITY;

-- READ: members of the channel, or attendees of the event.
DROP POLICY IF EXISTS gm_read ON group_messages;
CREATE POLICY gm_read ON group_messages FOR SELECT TO authenticated
  USING (
    (channel_id IS NOT NULL AND is_channel_member(channel_id))
    OR (event_id IS NOT NULL AND is_event_attendee(event_id))
  );

-- WRITE: can_post_group() decides, so "admins only" is enforced by the
-- database. A student editing the page cannot post to a locked channel.
DROP POLICY IF EXISTS gm_insert ON group_messages;
CREATE POLICY gm_insert ON group_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.user_id()
    AND is_approved()
    AND can_post_group(channel_id, event_id)
  );

DROP POLICY IF EXISTS gm_update_own ON group_messages;
CREATE POLICY gm_update_own ON group_messages FOR UPDATE TO authenticated
  USING (sender_id = auth.user_id());

-- Your own message, or anything if you run the channel.
DROP POLICY IF EXISTS gm_delete ON group_messages;
CREATE POLICY gm_delete ON group_messages FOR DELETE TO authenticated
  USING (
    sender_id = auth.user_id()
    OR (channel_id IS NOT NULL AND is_channel_admin(channel_id))
  );

DROP POLICY IF EXISTS cr_read ON channel_requests;
CREATE POLICY cr_read ON channel_requests FOR SELECT TO authenticated
  USING (user_id = auth.user_id() OR is_channel_admin(channel_id));

-- Requests are created by join_channel() only.
DROP POLICY IF EXISTS cr_insert ON channel_requests;
CREATE POLICY cr_insert ON channel_requests FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS cr_delete ON channel_requests;
CREATE POLICY cr_delete ON channel_requests FOR DELETE TO authenticated
  USING (user_id = auth.user_id() OR is_channel_admin(channel_id));

-- Memberships: readable by fellow members; writable only through the
-- functions above. Direct INSERT is refused so nobody can add
-- themselves to a private channel.
ALTER TABLE channel_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cm_read ON channel_members;
CREATE POLICY cm_read ON channel_members FOR SELECT TO authenticated
  USING (user_id = auth.user_id() OR is_channel_member(channel_id));

DROP POLICY IF EXISTS cm_insert ON channel_members;
CREATE POLICY cm_insert ON channel_members FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS cm_delete ON channel_members;
CREATE POLICY cm_delete ON channel_members FOR DELETE TO authenticated
  USING (user_id = auth.user_id() OR is_channel_admin(channel_id));

DROP POLICY IF EXISTS cm_update ON channel_members;
CREATE POLICY cm_update ON channel_members FOR UPDATE TO authenticated
  USING (false);


-- ------------------------------------------------------------
-- 8. GRANTS
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON group_messages   TO authenticated;
GRANT SELECT, DELETE                 ON channel_requests TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE group_messages_id_seq TO authenticated;

GRANT EXECUTE ON FUNCTION public.channel_role(bigint, text)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_channel_member(bigint, text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_channel_admin(bigint, text)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_event_attendee(bigint, text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_post_group(bigint, bigint)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_channel(bigint)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_channel(bigint)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_channel_request(bigint, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_channel_role(bigint, text, text)    TO authenticated;
