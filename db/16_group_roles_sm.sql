-- ============================================================
-- 16_group_roles_sm.sql
-- The event/channel CREATOR can talk. Events get moderators too.
-- ============================================================
--
-- THREE BUGS, ALL REPRODUCED ON POSTGRESQL 17 BEFORE BEING FIXED.
--
-- 1. THE EVENT CREATOR COULD NOT POST IN HIS OWN EVENT CHAT
--
--    createEvent() inserts the event, THEN inserts event_attendees in a
--    second call. can_post_group() for an event is is_event_attendee().
--    Measured, as the owner, straight after creating event 700:
--
--      attendee_rows_after_create = 0
--      is_event_attendee          = false
--      can_post_group             = false
--      INSERT INTO group_messages -> ERROR: new row violates RLS policy
--
--    ...while a plain member who pressed "attend" posted fine. That is
--    exactly the report: "the other users talk just fine except for the
--    creator". The second insert is a separate request; if it is refused
--    or simply never made (an older build, the APK, a dropped
--    connection) the owner is locked out of his own room forever.
--
--    A trigger makes the attendance row part of creating the event, so
--    the two cannot come apart.
--
-- 2. EVENTS HAD NO ROLES AT ALL
--
--    can_post_group() returned is_event_attendee() — every attendee
--    equal, no way to appoint anybody, no way to quieten a room. You
--    asked for the same Telegram shape as channels: the creator speaks
--    freely and can appoint moderators to stand in for him.
--
-- 3. createChannel() THREW AFTER CREATING THE CHANNEL
--
--      INSERT INTO channel_members (channel_id,user_id) VALUES (500,'own')
--      ERROR: duplicate key value violates unique constraint
--
--    trg_channel_owner_member (14_groups) already inserts the owner row,
--    so the client's own insert now collides with it. The channel was
--    created and then the call raised — so the UI reported failure for
--    something that had succeeded.
--
-- Idempotent.
-- ============================================================


-- ------------------------------------------------------------
-- 1. ROLES ON AN EVENT
--    Same three ranks as a channel so there is ONE mental model:
--    owner > admin > member.
-- ------------------------------------------------------------
ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member';

DO $$ BEGIN
  ALTER TABLE event_attendees ADD CONSTRAINT event_attendees_role_ck
    CHECK (role IN ('owner', 'admin', 'member'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 'all' = every attendee may post · 'admins' = organisers only.
ALTER TABLE events ADD COLUMN IF NOT EXISTS post_policy text NOT NULL DEFAULT 'all';

DO $$ BEGIN
  ALTER TABLE events ADD CONSTRAINT events_post_policy_ck
    CHECK (post_policy IN ('all', 'admins'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Back-fill: every existing event's creator becomes its owner-attendee.
-- Without this, everybody who already made an event stays locked out.
INSERT INTO event_attendees (event_id, user_id, role)
SELECT e.id, e.owner_id, 'owner'
FROM events e
WHERE e.owner_id IS NOT NULL
ON CONFLICT (event_id, user_id) DO UPDATE SET role = 'owner';

-- ...and every event created FROM NOW ON, as part of the same
-- transaction as the event itself.
CREATE OR REPLACE FUNCTION public.event_owner_attendee()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    INSERT INTO event_attendees (event_id, user_id, role)
    VALUES (NEW.id, NEW.owner_id, 'owner')
    ON CONFLICT (event_id, user_id) DO UPDATE SET role = 'owner';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_event_owner_attendee ON events;
CREATE TRIGGER trg_event_owner_attendee
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION event_owner_attendee();

-- Pressing "attend" must never demote the organiser back to member.
CREATE OR REPLACE FUNCTION public.keep_event_owner_role()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id AND owner_id = NEW.user_id)
    THEN NEW.role := 'owner';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_keep_event_owner_role ON event_attendees;
CREATE TRIGGER trg_keep_event_owner_role
BEFORE INSERT OR UPDATE ON public.event_attendees
FOR EACH ROW EXECUTE FUNCTION keep_event_owner_role();

-- The organiser cannot walk out of his own event chat.
CREATE OR REPLACE FUNCTION public.block_event_owner_leave()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM events WHERE id = OLD.event_id AND owner_id = OLD.user_id)
    THEN RETURN NULL;    -- silently refuse the delete
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_block_event_owner_leave ON event_attendees;
CREATE TRIGGER trg_block_event_owner_leave
BEFORE DELETE ON public.event_attendees
FOR EACH ROW EXECUTE FUNCTION block_event_owner_leave();


-- ------------------------------------------------------------
-- 2. HELPERS — mirror the channel ones exactly
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_role(p_event bigint, p_user text DEFAULT NULL)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT role FROM event_attendees
  WHERE event_id = p_event
    AND user_id = COALESCE(p_user, auth.user_id());
$function$;

CREATE OR REPLACE FUNCTION public.is_event_admin(p_event bigint, p_user text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT COALESCE(event_role(p_event, p_user) IN ('owner', 'admin'), false);
$function$;

/* Promote or demote an event helper. Owner only — an admin who can
   appoint admins is an owner in all but name. */
CREATE OR REPLACE FUNCTION public.set_event_role(
  p_event bigint, p_user text, p_role text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF COALESCE(event_role(p_event, auth.user_id()), '') <> 'owner' THEN RETURN false; END IF;
  IF p_role NOT IN ('admin', 'member') THEN RETURN false; END IF;
  IF COALESCE(event_role(p_event, p_user), '') = 'owner' THEN RETURN false; END IF;

  UPDATE event_attendees SET role = p_role
   WHERE event_id = p_event AND user_id = p_user;
  RETURN FOUND;
END;
$function$;

/* Owner-only switch: who may post in the event chat. */
CREATE OR REPLACE FUNCTION public.set_event_policy(p_event bigint, p_policy text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF COALESCE(event_role(p_event, auth.user_id()), '') <> 'owner' THEN RETURN false; END IF;
  IF p_policy NOT IN ('all', 'admins') THEN RETURN false; END IF;
  UPDATE events SET post_policy = p_policy WHERE id = p_event;
  RETURN true;
END;
$function$;


-- ------------------------------------------------------------
-- 3. can_post_group() — REWRITTEN
--
--    The OWNER branch is first and unconditional. Previously an owner
--    was allowed only as a side effect of being a member, so any gap in
--    the membership row silently muted the person who runs the place.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_post_group(p_channel bigint, p_event bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT CASE
    WHEN p_event IS NOT NULL THEN
      -- The organiser can ALWAYS talk, membership row or not.
      EXISTS (SELECT 1 FROM events WHERE id = p_event AND owner_id = auth.user_id())
      OR (
        is_event_attendee(p_event)
        AND (
          is_event_admin(p_event)
          OR COALESCE((SELECT post_policy FROM events WHERE id = p_event), 'all') = 'all'
        )
      )
    WHEN p_channel IS NOT NULL THEN
      EXISTS (SELECT 1 FROM channels WHERE id = p_channel AND owner_id = auth.user_id())
      OR (
        is_channel_member(p_channel)
        AND (
          is_channel_admin(p_channel)
          OR COALESCE((SELECT post_policy FROM channels WHERE id = p_channel), 'all') = 'all'
        )
      )
    ELSE false
  END;
$function$;

/* Reading an event chat: attendees, and the organiser regardless. */
CREATE OR REPLACE FUNCTION public.can_read_group(p_channel bigint, p_event bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT CASE
    WHEN p_event IS NOT NULL THEN
      is_event_attendee(p_event)
      OR EXISTS (SELECT 1 FROM events WHERE id = p_event AND owner_id = auth.user_id())
    WHEN p_channel IS NOT NULL THEN
      is_channel_member(p_channel)
      OR EXISTS (SELECT 1 FROM channels WHERE id = p_channel AND owner_id = auth.user_id())
    ELSE false
  END;
$function$;

DROP POLICY IF EXISTS gm_read ON group_messages;
CREATE POLICY gm_read ON group_messages FOR SELECT TO authenticated
  USING (can_read_group(channel_id, event_id));


-- ------------------------------------------------------------
-- 4. ONE CALL FOR THE WHOLE PERMISSION PICTURE
--
--    groupInfo() made TWO round trips and did `.catch(() => false)` on
--    each. So a single 401 during a token refresh made canPost false and
--    the UI told the OWNER "Only moderators can post here" — measured in
--    Chrome: fail one can_post_group call and the read-only bar appears
--    on a channel you own. That is the "annoying thing that reappears
--    automatically" after being idle.
--
--    One call, and it returns `ok` so the client can tell "you may not
--    post" apart from "I could not find out".
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.group_info(p_channel bigint, p_event bigint)
RETURNS TABLE(
  kind        text,
  role        text,
  can_post    boolean,
  can_read    boolean,
  is_owner    boolean,
  post_policy text,
  is_private  boolean,
  members     integer,
  name        text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT
    CASE WHEN p_event IS NOT NULL THEN 'event' ELSE 'channel' END,
    CASE WHEN p_event IS NOT NULL
         THEN COALESCE(event_role(p_event), 'none')
         ELSE COALESCE(channel_role(p_channel), 'none') END,
    can_post_group(p_channel, p_event),
    can_read_group(p_channel, p_event),
    CASE WHEN p_event IS NOT NULL
         THEN EXISTS (SELECT 1 FROM events   WHERE id = p_event   AND owner_id = auth.user_id())
         ELSE EXISTS (SELECT 1 FROM channels WHERE id = p_channel AND owner_id = auth.user_id()) END,
    CASE WHEN p_event IS NOT NULL
         THEN COALESCE((SELECT post_policy FROM events   WHERE id = p_event), 'all')
         ELSE COALESCE((SELECT post_policy FROM channels WHERE id = p_channel), 'all') END,
    CASE WHEN p_event IS NOT NULL THEN false
         ELSE COALESCE((SELECT is_private FROM channels WHERE id = p_channel), false) END,
    CASE WHEN p_event IS NOT NULL
         THEN (SELECT COUNT(*)::int FROM event_attendees  WHERE event_id   = p_event)
         ELSE (SELECT COUNT(*)::int FROM channel_members  WHERE channel_id = p_channel) END,
    CASE WHEN p_event IS NOT NULL
         THEN (SELECT title FROM events   WHERE id = p_event)
         ELSE (SELECT name  FROM channels WHERE id = p_channel) END;
$function$;

/* The member list for the manage panel, for an event or a channel. */
CREATE OR REPLACE FUNCTION public.group_members(p_channel bigint, p_event bigint)
RETURNS TABLE(user_id text, role text, full_name text, username text, avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT m.user_id, m.role, p.full_name, p.username, p.avatar_url
  FROM (
    SELECT ea.user_id, ea.role FROM event_attendees ea
     WHERE p_event IS NOT NULL AND ea.event_id = p_event
    UNION ALL
    SELECT cm.user_id, cm.role FROM channel_members cm
     WHERE p_channel IS NOT NULL AND cm.channel_id = p_channel
  ) m
  JOIN profiles p ON p.id = m.user_id
  ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
           p.full_name;
$function$;


-- ------------------------------------------------------------
-- 5. RLS + GRANTS
-- ------------------------------------------------------------
-- Roles are changed only through set_event_role(); a direct UPDATE must
-- not let an attendee promote himself.
DROP POLICY IF EXISTS att_own ON event_attendees;
CREATE POLICY att_own ON event_attendees FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.user_id()) AND is_approved());
DROP POLICY IF EXISTS att_delete ON event_attendees;
CREATE POLICY att_delete ON event_attendees FOR DELETE TO authenticated
  USING (user_id = auth.user_id() OR is_event_admin(event_id));
DROP POLICY IF EXISTS att_update ON event_attendees;
CREATE POLICY att_update ON event_attendees FOR UPDATE TO authenticated
  USING (false);

GRANT EXECUTE ON FUNCTION public.event_role(bigint, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_event_admin(bigint, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_role(bigint, text, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_policy(bigint, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_group(bigint, bigint)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.group_info(bigint, bigint)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.group_members(bigint, bigint)       TO authenticated;
