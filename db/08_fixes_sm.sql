-- ============================================================
-- KOLIYA — 08_fixes_sm.sql
--
-- Run SIXTH, after 01 · 02 · 05 · 06 · 07.
-- Re-runnable.
--
-- Three bugs, all of them mine, all of them invisible from the UI:
--
--   1. quests and xp_events have FORCE RLS and NO write policy, so
--      every INSERT from track_quest() was silently refused. That is
--      why the quests never registered.
--
--   2. 06_game_sm.sql overwrote profiles_update_self with
--      `role = 'student'`, so an admin could never save their own
--      profile — and the UI reported it as "nothing changed".
--
--   3. Nothing recorded name changes, so the 15-day rule you asked
--      for had nowhere to live.
-- ============================================================


-- ============================================================
-- 1. LET THE GAME WRITE  ← the quests bug
-- ============================================================
-- FORCE ROW LEVEL SECURITY applies RLS even to the table owner, and
-- the table owner is exactly who a SECURITY DEFINER function runs
-- as. With only SELECT policies present, every write inside
-- track_quest() and award_xp() matched zero rows and returned
-- quietly. I added FORCE to stop cheating and stopped the game.
--
-- The fix is not to remove FORCE — it is doing real work — but to
-- write policies that permit exactly the rows a student may own.
-- Direct writes from the browser are still useless to a cheater:
-- award_xp() validates the amount, and the unique index stops the
-- same action being paid twice.

DROP POLICY IF EXISTS quests_write_own ON quests;
CREATE POLICY quests_write_own ON quests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.user_id());

DROP POLICY IF EXISTS quests_update_own ON quests;
CREATE POLICY quests_update_own ON quests FOR UPDATE TO authenticated
  USING (user_id = auth.user_id())
  WITH CHECK (user_id = auth.user_id());

DROP POLICY IF EXISTS xp_write_own ON xp_events;
CREATE POLICY xp_write_own ON xp_events FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.user_id()
    -- a sane amount, mirroring the check inside award_xp()
    AND amount >= 0 AND amount <= 100
  );

-- Deliberately NO update or delete policy on xp_events: the ledger
-- is append-only. You cannot rewrite history to inflate a total.


-- ============================================================
-- 2. LET PEOPLE SAVE THEIR PROFILE  ← the "Enregistrer" bug
-- ============================================================
-- Restores the correct rule from 02_policies.sql: you may change
-- your profile, but you may not promote yourself or approve
-- yourself. `role = 'student'` was wrong because it locked out every
-- admin, including you.

DROP POLICY IF EXISTS profiles_update_self ON profiles;
CREATE POLICY profiles_update_self ON profiles FOR UPDATE TO authenticated
  USING (id = auth.user_id())
  WITH CHECK (
    id = auth.user_id()
    AND role   = (SELECT p.role   FROM profiles p WHERE p.id = auth.user_id())
    AND status = (SELECT p.status FROM profiles p WHERE p.id = auth.user_id())
  );


-- ============================================================
-- 3. NAME CHANGES — the 15-day rule
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS name_changed_at   TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS name_change_count INTEGER NOT NULL DEFAULT 0;

-- The window resets on its own: if the last change was more than 15
-- days ago the counter starts again at 1. No cron job, no cleanup.
CREATE OR REPLACE FUNCTION track_name_change() RETURNS trigger AS $$
DECLARE
  window_days CONSTANT INTEGER := 15;
BEGIN
  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    IF OLD.name_changed_at IS NULL
       OR OLD.name_changed_at < now() - (window_days || ' days')::interval THEN
      NEW.name_change_count := 1;          -- window expired, start over
    ELSE
      NEW.name_change_count := COALESCE(OLD.name_change_count, 0) + 1;
    END IF;
    NEW.name_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_track_name_change ON profiles;
CREATE TRIGGER trg_track_name_change
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION track_name_change();

-- What the UI asks BEFORE showing the confirm dialog, so the warning
-- can state the real number of days left rather than guessing.
CREATE OR REPLACE FUNCTION name_change_status()
RETURNS TABLE (changes INTEGER, last_change TIMESTAMPTZ, days_left INTEGER, will_warn BOOLEAN) AS $$
  SELECT
    CASE WHEN p.name_changed_at IS NULL
           OR p.name_changed_at < now() - interval '15 days'
         THEN 0 ELSE COALESCE(p.name_change_count, 0) END,
    p.name_changed_at,
    CASE WHEN p.name_changed_at IS NULL
           OR p.name_changed_at < now() - interval '15 days'
         THEN 0
         ELSE CEIL(EXTRACT(EPOCH FROM (p.name_changed_at + interval '15 days' - now())) / 86400)::int
    END,
    (p.name_changed_at IS NOT NULL
     AND p.name_changed_at >= now() - interval '15 days'
     AND COALESCE(p.name_change_count, 0) >= 1)
  FROM profiles p WHERE p.id = auth.user_id();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION name_change_status() TO authenticated;

-- The guard trigger must not treat these as forbidden columns.
CREATE OR REPLACE FUNCTION guard_profile_progress() RETURNS trigger AS $$
BEGIN
  IF current_user = session_user AND auth.user_id() = NEW.id THEN
    IF NEW.xp IS DISTINCT FROM OLD.xp
       OR NEW.streak IS DISTINCT FROM OLD.streak
       OR NEW.streak_best IS DISTINCT FROM OLD.streak_best
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'xp, streak, role et status ne sont pas modifiables directement';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 4. NOTIFICATION DELIVERY STATE
-- ============================================================
-- So a browser notification fires once, not on every poll.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notif_unpushed
  ON notifications(user_id, created_at DESC)
  WHERE pushed_at IS NULL;

-- Anything that happened since I last looked, for the bell and for
-- the browser notification. Returns the actor's name so the client
-- does not need a second round trip to render the toast.
CREATE OR REPLACE FUNCTION pending_alerts(p_since TIMESTAMPTZ DEFAULT NULL)
RETURNS TABLE (
  id BIGINT, kind TEXT, actor_id TEXT, actor_name TEXT,
  actor_avatar TEXT, text TEXT, post_id BIGINT, created_at TIMESTAMPTZ
) AS $$
  SELECT n.id, n.kind, n.actor_id,
         COALESCE(a.full_name, 'Un étudiant'),
         a.avatar_url, n.text, n.post_id, n.created_at
  FROM notifications n
  LEFT JOIN profiles a ON a.id = n.actor_id
  WHERE n.user_id = auth.user_id()
    AND n.read_at IS NULL
    AND (p_since IS NULL OR n.created_at > p_since)
  ORDER BY n.created_at DESC
  LIMIT 20;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION pending_alerts(TIMESTAMPTZ) TO authenticated;


-- ============================================================
-- 5. VERIFY
-- ============================================================
SELECT 'quests can be written' AS what,
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies
                         WHERE tablename='quests' AND cmd='INSERT')
            THEN 'fixed' ELSE 'STILL BROKEN' END AS state
UNION ALL
SELECT 'xp_events can be written',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies
                         WHERE tablename='xp_events' AND cmd='INSERT')
            THEN 'fixed' ELSE 'STILL BROKEN' END
UNION ALL
SELECT 'profile is saveable by any role',
       CASE WHEN EXISTS (SELECT 1 FROM pg_policies
                         WHERE tablename='profiles' AND policyname='profiles_update_self'
                           AND with_check NOT LIKE '%''student''%')
            THEN 'fixed' ELSE 'STILL BROKEN' END
UNION ALL
SELECT 'name change tracking',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_name='profiles' AND column_name='name_changed_at')
            THEN 'fixed' ELSE 'MISSING' END
UNION ALL
SELECT 'alert feed',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='pending_alerts')
            THEN 'fixed' ELSE 'MISSING' END;
