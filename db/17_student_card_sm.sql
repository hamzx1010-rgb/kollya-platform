-- ============================================================
-- KOLIYA — 17. Student card + self-service account deletion
-- ============================================================
-- What this adds:
--   1. profiles.university  — the missing identity axis ("je suis à
--      l'USTHB"). Shown on the profile student card and editable.
--   2. profiles.status 'deleted' + deleted_at — soft deletion.
--   3. self_delete_account() — SECURITY DEFINER RPC so a student can
--      delete their own account. RLS (profiles_update_self) refuses
--      a student changing their own status, so this must run as the
--      owner, exactly like respond_follow_request().
--
-- Run once:  psql or Neon SQL Editor. Safe to re-run.
-- ============================================================

-- ---------- 1. university ------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS university TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_profiles_university ON profiles(university);

-- ---------- 2. status 'deleted' + deleted_at -----------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- The CHECK constraint predates deletion. Drop and rebuild it.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('pending','approved','rejected','banned','deleted'));

-- ---------- 3. self_delete_account() -------------------------
CREATE OR REPLACE FUNCTION public.self_delete_account()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_me text := auth.user_id();
BEGIN
  IF v_me IS NULL THEN RETURN false; END IF;

  -- Hide the account immediately: status flips, identity is blanked.
  -- The row itself stays for 30 days so a mistaken deletion can be
  -- undone by an admin (see the cleanup note below), and so posts
  -- keep their author_id for integrity. After the grace period a
  -- nightly cleanup can hard-delete rows: see db/03_admin.sql style.
  UPDATE profiles
     SET status = 'deleted',
         deleted_at = now(),
         bio = '', website = NULL, github = NULL, linkedin = NULL,
         avatar_url = NULL, banner_url = NULL,
         is_private = FALSE
   WHERE id = v_me
     AND status <> 'deleted';
  IF NOT FOUND THEN RETURN false; END IF;

  -- Leave the social graph clean: nobody keeps a follow or block on
  -- an account that is gone.
  DELETE FROM follows WHERE follower_id = v_me OR followee_id = v_me;
  DELETE FROM blocks  WHERE blocker_id = v_me OR blocked_id  = v_me;

  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.self_delete_account() TO authenticated;

-- ---------- 4. purge job (optional, after the grace period) ---
-- Neon does not run a scheduler by default. When you have pg_cron
-- (Neon Pro) or any cron, run this daily to hard-delete accounts
-- that passed the 30-day grace period:
--
--   DELETE FROM profiles
--    WHERE status = 'deleted'
--      AND deleted_at < now() - interval '30 days';
--
-- Posts and comments keep author_id TEXT with no FK to profiles, so
-- they survive the hard delete with the author's name already gone
-- (they were blanked above) — nothing dangles.
