-- ============================================================
-- KOLIYA — 06_game_sm.sql
--
-- Run FOURTH, after 01_schema, 02_policies, 05_upgrade.
-- Re-runnable.
--
-- THE GAME, MOVED INTO THE DATABASE
--
-- Until now the quests and the streak lived in localStorage. That is
-- why the game felt fake: clearing your browser reset your streak,
-- your phone showed different quests than your laptop, and anyone
-- could type one line in the console to award themselves 10,000 XP.
--
-- The rules below are enforced by Postgres, so they are the same on
-- every device and cannot be edited by the player.
--
--   · quests are ROWS, one per student per day
--   · the streak is a column with a reset rule, not a counter
--   · XP is an append-only ledger; profiles.xp is its sum
--   · one streak freeze per calendar month, spent automatically
-- ============================================================


-- ============================================================
-- 1. XP LEDGER
-- ============================================================
-- Append-only. profiles.xp stays as the running total so the
-- leaderboard is one cheap ORDER BY, but every point is traceable
-- back to the action that earned it. If a number ever looks wrong,
-- you can see exactly why.

CREATE TABLE IF NOT EXISTS xp_events (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,          -- post · comment · answer · daily · streak …
  amount     INTEGER NOT NULL,
  ref_type   TEXT,                   -- 'post' · 'comment' · 'quest' …
  ref_id     TEXT,                   -- the thing that caused it
  day        DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_xp_user_day ON xp_events(user_id, day DESC);

-- One award per (user, kind, ref). Liking the same post twice, or a
-- double-click sending the request twice, cannot pay twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_xp_once
  ON xp_events(user_id, kind, ref_type, ref_id)
  WHERE ref_id IS NOT NULL;


-- ============================================================
-- 2. DAILY QUESTS
-- ============================================================
-- One row per student per day per quest. The set of three is chosen
-- by the client from a fixed pool seeded by the date, so everyone
-- gets the same three — but the PROGRESS is per student and lives
-- here, where it cannot be edited.

CREATE TABLE IF NOT EXISTS quests (
  user_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day       DATE NOT NULL DEFAULT CURRENT_DATE,
  quest_id  TEXT NOT NULL,           -- post · comment · like · visit · answer · story
  progress  INTEGER NOT NULL DEFAULT 0,
  target    INTEGER NOT NULL,
  done_at   TIMESTAMPTZ,
  PRIMARY KEY (user_id, day, quest_id)
);
CREATE INDEX IF NOT EXISTS idx_quests_user_day ON quests(user_id, day DESC);


-- ============================================================
-- 3. STREAK STATE
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS streak_best     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS freeze_month    DATE;    -- month the freeze was spent
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS streak_broken_at DATE;   -- so the UI can say "you lost 12 days"
-- streak and streak_day already exist from 01_schema.sql.


-- ============================================================
-- 4. THE RULES, AS FUNCTIONS
-- ============================================================
-- These are SECURITY DEFINER: they run with the table owner's rights
-- so they can write to profiles.xp, which RLS otherwise forbids the
-- student from touching directly. That is the whole point — you earn
-- XP by doing things, never by writing to the column.

-- ---------- 4a. award XP -------------------------------------
CREATE OR REPLACE FUNCTION award_xp(
  p_kind TEXT,
  p_amount INTEGER,
  p_ref_type TEXT DEFAULT NULL,
  p_ref_id TEXT DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  uid TEXT := auth.user_id();
  inserted INTEGER := 0;
  new_total INTEGER;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- A negative or absurd amount can only be a bug or an attack.
  IF p_amount < 0 OR p_amount > 100 THEN
    RAISE EXCEPTION 'invalid xp amount %', p_amount;
  END IF;

  INSERT INTO xp_events (user_id, kind, amount, ref_type, ref_id)
  VALUES (uid, p_kind, p_amount, p_ref_type, p_ref_id)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS inserted = ROW_COUNT;

  IF inserted > 0 THEN
    UPDATE profiles SET xp = xp + p_amount WHERE id = uid
    RETURNING xp INTO new_total;
  ELSE
    SELECT xp INTO new_total FROM profiles WHERE id = uid;
  END IF;

  RETURN new_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------- 4b. advance a quest ------------------------------
-- Returns the row so the client can repaint without re-reading.
CREATE OR REPLACE FUNCTION track_quest(
  p_quest_id TEXT,
  p_target INTEGER,
  p_amount INTEGER DEFAULT 1
) RETURNS TABLE (quest_id TEXT, progress INTEGER, target INTEGER, just_done BOOLEAN, day_complete BOOLEAN) AS $$
DECLARE
  uid TEXT := auth.user_id();
  was_done BOOLEAN;
  row_progress INTEGER;
  row_target INTEGER;
  now_done BOOLEAN;
  all_done BOOLEAN;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  INSERT INTO quests (user_id, day, quest_id, progress, target)
  VALUES (uid, CURRENT_DATE, p_quest_id, 0, p_target)
  ON CONFLICT (user_id, day, quest_id) DO NOTHING;

  SELECT (q.done_at IS NOT NULL) INTO was_done
  FROM quests q WHERE q.user_id = uid AND q.day = CURRENT_DATE AND q.quest_id = p_quest_id;

  UPDATE quests q
     SET progress = LEAST(q.target, q.progress + p_amount),
         done_at  = CASE WHEN q.done_at IS NULL
                          AND q.progress + p_amount >= q.target
                         THEN now() ELSE q.done_at END
   WHERE q.user_id = uid AND q.day = CURRENT_DATE AND q.quest_id = p_quest_id
   RETURNING q.progress, q.target, (q.done_at IS NOT NULL)
        INTO row_progress, row_target, now_done;

  -- did this complete the whole day?
  SELECT COUNT(*) = 0 INTO all_done
  FROM quests q
  WHERE q.user_id = uid AND q.day = CURRENT_DATE AND q.done_at IS NULL;

  RETURN QUERY SELECT p_quest_id, row_progress, row_target,
                      (now_done AND NOT COALESCE(was_done, FALSE)),
                      all_done;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------- 4c. the streak rule ------------------------------
-- Called once when the app opens, and again whenever a day is
-- completed. Everything about winning and losing lives here.
--
--   completed today already      → nothing happens
--   last completed yesterday     → streak + 1
--   last completed 2 days ago    → freeze available? spend it, keep
--                                  the streak. Otherwise → 0.
--   older, or never              → 0
--
-- One freeze per calendar month, spent automatically. You never have
-- to remember it exists; it just quietly saves you once.

CREATE OR REPLACE FUNCTION resolve_streak(p_completed_today BOOLEAN DEFAULT FALSE)
RETURNS TABLE (
  streak INTEGER,
  streak_best INTEGER,
  froze BOOLEAN,
  broke BOOLEAN,
  lost INTEGER,
  freeze_available BOOLEAN
) AS $$
DECLARE
  uid TEXT := auth.user_id();
  p RECORD;
  gap INTEGER;
  new_streak INTEGER;
  did_freeze BOOLEAN := FALSE;
  did_break BOOLEAN := FALSE;
  lost_days INTEGER := 0;
  this_month DATE := date_trunc('month', CURRENT_DATE)::date;
  can_freeze BOOLEAN;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT pr.streak, pr.streak_day, pr.streak_best, pr.freeze_month
    INTO p
  FROM profiles pr WHERE pr.id = uid;

  can_freeze := (p.freeze_month IS NULL OR p.freeze_month < this_month);
  new_streak := COALESCE(p.streak, 0);

  IF p.streak_day IS NULL THEN
    -- never completed a day
    new_streak := CASE WHEN p_completed_today THEN 1 ELSE 0 END;

  ELSIF p.streak_day = CURRENT_DATE THEN
    -- already counted today; nothing to decide
    NULL;

  ELSE
    gap := CURRENT_DATE - p.streak_day;

    IF gap = 1 THEN
      -- yesterday: the streak survives, and grows if today is done
      IF p_completed_today THEN new_streak := new_streak + 1; END IF;

    ELSIF gap = 2 AND can_freeze AND COALESCE(p.streak, 0) > 0 THEN
      -- exactly one missed day, and a freeze is available
      did_freeze := TRUE;
      UPDATE profiles SET freeze_month = this_month WHERE id = uid;
      IF p_completed_today THEN new_streak := new_streak + 1; END IF;

    ELSE
      -- the streak is gone
      IF COALESCE(p.streak, 0) > 0 THEN
        did_break := TRUE;
        lost_days := p.streak;
      END IF;
      new_streak := CASE WHEN p_completed_today THEN 1 ELSE 0 END;
    END IF;
  END IF;

  UPDATE profiles pr
     SET streak      = new_streak,
         streak_best = GREATEST(COALESCE(pr.streak_best, 0), new_streak),
         streak_day  = CASE WHEN p_completed_today THEN CURRENT_DATE ELSE pr.streak_day END,
         streak_broken_at = CASE WHEN did_break THEN CURRENT_DATE ELSE pr.streak_broken_at END
   WHERE pr.id = uid;

  RETURN QUERY
  SELECT new_streak,
         (SELECT pr.streak_best FROM profiles pr WHERE pr.id = uid),
         did_freeze,
         did_break,
         lost_days,
         (SELECT (pr.freeze_month IS NULL OR pr.freeze_month < this_month)
          FROM profiles pr WHERE pr.id = uid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------- 4d. today's quests -------------------------------
CREATE OR REPLACE FUNCTION my_quests()
RETURNS TABLE (quest_id TEXT, progress INTEGER, target INTEGER, done BOOLEAN) AS $$
  SELECT q.quest_id, q.progress, q.target, (q.done_at IS NOT NULL)
  FROM quests q
  WHERE q.user_id = auth.user_id() AND q.day = CURRENT_DATE;
$$ LANGUAGE sql STABLE SECURITY DEFINER;


-- ---------- 4e. rebuild profiles.xp from the ledger ----------
-- A repair tool. If the total ever drifts, this is the truth.
CREATE OR REPLACE FUNCTION recompute_xp() RETURNS void AS $$
  UPDATE profiles p
  SET xp = COALESCE((SELECT SUM(e.amount) FROM xp_events e WHERE e.user_id = p.id), 0);
$$ LANGUAGE sql;


-- ============================================================
-- 5. RLS
-- ============================================================
ALTER TABLE xp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE quests    ENABLE ROW LEVEL SECURITY;

-- You may READ your own ledger, so the hub can explain your points.
DROP POLICY IF EXISTS xp_read_own ON xp_events;
CREATE POLICY xp_read_own ON xp_events FOR SELECT TO authenticated
  USING (user_id = auth.user_id() OR is_admin());

-- Deliberately NO insert/update/delete policy for students.
-- The only way in is award_xp(), which is SECURITY DEFINER and
-- validates the amount. A student writing XP directly is the exact
-- cheat this design exists to prevent.

DROP POLICY IF EXISTS quests_read_own ON quests;
CREATE POLICY quests_read_own ON quests FOR SELECT TO authenticated
  USING (user_id = auth.user_id() OR is_admin());

-- Same reasoning: progress moves through track_quest() only.

ALTER TABLE xp_events FORCE ROW LEVEL SECURITY;
ALTER TABLE quests    FORCE ROW LEVEL SECURITY;

GRANT SELECT ON xp_events, quests TO authenticated;
GRANT EXECUTE ON FUNCTION award_xp(TEXT, INTEGER, TEXT, TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION track_quest(TEXT, INTEGER, INTEGER)        TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_streak(BOOLEAN)                    TO authenticated;
GRANT EXECUTE ON FUNCTION my_quests()                                TO authenticated;

-- profiles.xp / streak must not be writable by hand, or the whole
-- ledger is theatre. This narrows the existing update policy.
DROP POLICY IF EXISTS profiles_update_self ON profiles;
CREATE POLICY profiles_update_self ON profiles FOR UPDATE TO authenticated
  USING (id = auth.user_id())
  WITH CHECK (id = auth.user_id() AND role = 'student');

CREATE OR REPLACE FUNCTION guard_profile_progress() RETURNS trigger AS $$
BEGIN
  -- Admins and the SECURITY DEFINER functions bypass this, because
  -- inside them current_user is the table owner, not the student.
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

DROP TRIGGER IF EXISTS trg_guard_profile_progress ON profiles;
CREATE TRIGGER trg_guard_profile_progress
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profile_progress();


-- ============================================================
-- 6. VERIFY
-- ============================================================
SELECT 'xp_events' AS t, count(*) FROM xp_events
UNION ALL SELECT 'quests', count(*) FROM quests
UNION ALL SELECT 'profiles with streak', count(*) FROM profiles WHERE streak > 0;
