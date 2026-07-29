-- ============================================================
-- KOLIYA — 11_antifraud_sm.sql
-- Closes two real holes: XP and quest progress were forgeable.
--
-- ------------------------------------------------------------
-- HOW I FOUND THEM
-- Acting as a student through the `authenticated` role in a real
-- PostgreSQL 17 with every migration loaded:
--
--   UPDATE profiles SET xp = 99999 WHERE id = 's1';   -> UPDATE 1
--   SELECT xp FROM profiles WHERE id='s1';            -> 99999
--
--   INSERT INTO quests (user_id,day,quest_id,progress,target)
--   VALUES ('s1', current_date, 'visit', 99, 1);      -> accepted
--
-- So any student who opens the network tab can set themselves to the
-- top of the leaderboard and mark every quest complete. The whole
-- game economy was decorative.
--
-- WHY THE EXISTING GUARD DID NOT FIRE
-- 08_fixes_sm.sql installed guard_profile_progress() with:
--
--   IF current_user = session_user AND auth.user_id() = NEW.id THEN
--
-- PostgREST connects as the pooler role and then does
-- `SET ROLE authenticated`, which makes current_user and session_user
-- DIFFERENT. Measured: current_user=authenticated,
-- session_user=postgres. The condition was false for exactly the
-- people it was meant to stop, and true only for a direct psql
-- session — i.e. the trigger protected the admin and waved the
-- students through.
--
-- The fix: key the check on the ROLE PostgREST uses, not on a
-- comparison that is only true outside the app. SECURITY DEFINER
-- functions (award_xp, track_quest, resolve_streak) run as the table
-- owner, so they still bypass it and remain the only way to earn XP.
--
-- Safe to run twice. Run AFTER 01-10 (or just run ALL_IN_ONE_sm.sql).
-- ============================================================


-- ------------------------------------------------------------
-- 1. profiles.xp / streak / role / status are read-only to students
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_profile_progress() RETURNS trigger AS $$
BEGIN
  -- Only police the app's own role. Inside a SECURITY DEFINER function
  -- current_user is the table owner, so award_xp() and friends pass
  -- straight through — they are the legitimate path.
  IF current_user = 'authenticated' THEN
    IF NEW.xp          IS DISTINCT FROM OLD.xp
    OR NEW.streak      IS DISTINCT FROM OLD.streak
    OR NEW.streak_best IS DISTINCT FROM OLD.streak_best THEN
      RAISE EXCEPTION 'xp and streak are earned, not set (use award_xp / resolve_streak)'
        USING ERRCODE = '42501';
    END IF;

    -- role and status are a moderation decision, never self-service.
    -- is_admin() still holds because profiles_admin_all is a separate
    -- PERMISSIVE policy evaluated before this trigger.
    IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status)
       AND NOT is_admin() THEN
      RAISE EXCEPTION 'role and status can only be changed by an administrator'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_profile_progress ON profiles;
CREATE TRIGGER trg_guard_profile_progress
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profile_progress();


-- ------------------------------------------------------------
-- 2. quests may only move through track_quest()
--
-- The policies allowed any INSERT/UPDATE whose user_id matched the
-- caller, so a student could write progress = 99 directly. Quests are
-- now writable ONLY by the SECURITY DEFINER function; the student
-- keeps read access so the hub can still draw the list.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS quests_write_own  ON quests;
DROP POLICY IF EXISTS quests_update_own ON quests;
DROP POLICY IF EXISTS quests_read_own   ON quests;

CREATE POLICY quests_read_own ON quests FOR SELECT TO authenticated
  USING (user_id = auth.user_id() OR is_admin());

-- No INSERT or UPDATE policy for `authenticated` at all. track_quest()
-- is SECURITY DEFINER and runs as the owner, which is not subject to
-- these policies, so the legitimate path keeps working.


-- ------------------------------------------------------------
-- 3. xp_events is an append-only ledger written by award_xp() only
-- ------------------------------------------------------------
DROP POLICY IF EXISTS xp_read_own  ON xp_events;
DROP POLICY IF EXISTS xp_write_own ON xp_events;

CREATE POLICY xp_read_own ON xp_events FOR SELECT TO authenticated
  USING (user_id = auth.user_id() OR is_admin());


-- ------------------------------------------------------------
-- 4. Make sure the earning path still works
--
-- These run as the owner, so they must keep bypassing everything
-- above. Re-granting is harmless and guards against a stale grant.
-- ------------------------------------------------------------
-- Signatures copied from pg_get_function_identity_arguments(), not
-- guessed: an earlier version of this file said award_xp(TEXT,TEXT,
-- INTEGER) and the whole script aborted with "function does not exist".
GRANT EXECUTE ON FUNCTION track_quest(TEXT, INTEGER, INTEGER)        TO authenticated;
GRANT EXECUTE ON FUNCTION award_xp(TEXT, INTEGER, TEXT, TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_streak(BOOLEAN)                    TO authenticated;
GRANT EXECUTE ON FUNCTION my_quests()                                TO authenticated;


-- ------------------------------------------------------------
-- 6. track_quest() was BROKEN — quests could never be earned
--
--   SELECT * FROM track_quest('visit', 1, 1);
--   ERROR: column reference "quest_id" is ambiguous
--
-- The function declares RETURNS TABLE (quest_id TEXT, progress INTEGER,
-- target INTEGER, ...). Those output columns are in scope for the whole
-- body, so the plain column names inside
--   INSERT INTO quests (user_id, day, quest_id, progress, target)
-- are ambiguous between the OUT parameter and the table column, and
-- Postgres refuses the statement. Every call has always failed; the
-- browser mock did not model it, so nothing noticed.
--
-- Fixed WITHOUT renaming the output columns: game_sm.js reads
-- row.progress / row.target / row.just_done, so renaming them to o_*
-- would swap one silent breakage for another. Instead the body uses
-- an explicit alias on the INSERT and #variable_conflict tells PL/pgSQL
-- to prefer the table column over the OUT parameter.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS track_quest(TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION track_quest(
  p_quest_id TEXT,
  p_target   INTEGER,
  p_amount   INTEGER DEFAULT 1
) RETURNS TABLE (
  quest_id     TEXT,
  progress     INTEGER,
  target       INTEGER,
  just_done    BOOLEAN,
  day_complete BOOLEAN
) AS $$
#variable_conflict use_column
DECLARE
  uid          TEXT := auth.user_id();
  was_done     BOOLEAN;
  row_progress INTEGER;
  row_target   INTEGER;
  now_done     BOOLEAN;
  all_done     BOOLEAN;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  INSERT INTO quests (user_id, day, quest_id, progress, target)
  VALUES (uid, CURRENT_DATE, p_quest_id, 0, p_target)
  ON CONFLICT (user_id, day, quest_id) DO NOTHING;

  SELECT (q.done_at IS NOT NULL) INTO was_done
    FROM quests q
   WHERE q.user_id = uid AND q.day = CURRENT_DATE AND q.quest_id = p_quest_id;

  UPDATE quests q
     SET progress = LEAST(q.target, q.progress + p_amount),
         done_at  = CASE WHEN q.done_at IS NULL
                          AND q.progress + p_amount >= q.target
                         THEN now() ELSE q.done_at END
   WHERE q.user_id = uid AND q.day = CURRENT_DATE AND q.quest_id = p_quest_id
   RETURNING q.progress, q.target, (q.done_at IS NOT NULL)
        INTO row_progress, row_target, now_done;

  SELECT COUNT(*) = 0 INTO all_done
    FROM quests q
   WHERE q.user_id = uid AND q.day = CURRENT_DATE AND q.done_at IS NULL;

  RETURN QUERY SELECT p_quest_id, row_progress, row_target,
                      (now_done AND NOT COALESCE(was_done, FALSE)),
                      all_done;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION track_quest(TEXT, INTEGER, INTEGER) TO authenticated;


-- ------------------------------------------------------------
-- 5. Check
-- Expect both to be 0: no INSERT/UPDATE policy left on quests or
-- xp_events for `authenticated`.
-- ------------------------------------------------------------
SELECT
  (SELECT count(*) FROM pg_policies
     WHERE tablename='quests'    AND cmd IN ('INSERT','UPDATE','ALL')) AS quest_write_policies,
  (SELECT count(*) FROM pg_policies
     WHERE tablename='xp_events' AND cmd IN ('INSERT','UPDATE','ALL')) AS xp_write_policies;
