-- ============================================================
-- KOLIYA — 04_testing_sm.sql
-- Run ONLY while testing. Reverse it before real students join.
-- ============================================================

-- ------------------------------------------------------------
-- OPTION A — auto-approve every new signup
--
-- Lets you register from the UI and land straight in the app with
-- no admin account and no SQL between each test.
-- ------------------------------------------------------------
ALTER TABLE profiles ALTER COLUMN status SET DEFAULT 'approved';

-- The RLS insert policy still demands status='pending', so relax it
-- to accept either while testing.
DROP POLICY IF EXISTS profiles_insert_self ON profiles;
CREATE POLICY profiles_insert_self ON profiles FOR INSERT TO authenticated
  WITH CHECK (
    id = auth.user_id()
    AND role = 'student'
    AND status IN ('pending','approved')
  );

-- ------------------------------------------------------------
-- Approve everyone who is already waiting
-- ------------------------------------------------------------
UPDATE profiles SET status = 'approved' WHERE status = 'pending';

-- ------------------------------------------------------------
-- Make yourself admin — replace the card with yours
-- ------------------------------------------------------------
-- UPDATE profiles SET role = 'admin', status = 'approved'
-- WHERE upper(student_card) = upper('CS-042');

-- ------------------------------------------------------------
-- Seed a few students so the leaderboard has something to show.
-- These have no auth account: they exist only as profile rows.
-- ------------------------------------------------------------
INSERT INTO profiles (id, student_card, username, full_name, faculty, status, role, xp, streak, bio)
VALUES
  ('seed-u2','PHY-117','youssef','Youssef Kader',   'Physique',    'approved','student', 640, 12, 'Physique fondamentale'),
  ('seed-u3','BIO-588','leila',  'Leila Mansouri',  'Biologie',    'approved','student', 295,  3, 'Labo, terrain, répéter.'),
  ('seed-u4','MATH-903','omar.k','Omar Kaci',       'Mathématiques','approved','student',180,  1, ''),
  ('seed-u5','CS-771', 'amina.z','Amina Zerrouki',  'Informatique','approved','student', 812, 21, 'L3 informatique'),
  ('seed-u6','CS-402', 'karim.d','Karimداودي',     'Informatique','approved','student', 455,  8, '')
ON CONFLICT (id) DO UPDATE
  SET xp = EXCLUDED.xp, streak = EXCLUDED.streak, status = 'approved';

-- ------------------------------------------------------------
-- Check what you have
-- ------------------------------------------------------------
SELECT student_card, username, full_name, faculty, status, role, xp, streak
FROM profiles ORDER BY xp DESC;

-- ============================================================
-- REVERSE IT — run this before opening to real students
-- ============================================================
-- ALTER TABLE profiles ALTER COLUMN status SET DEFAULT 'pending';
--
-- DROP POLICY IF EXISTS profiles_insert_self ON profiles;
-- CREATE POLICY profiles_insert_self ON profiles FOR INSERT TO authenticated
--   WITH CHECK (id = auth.user_id() AND role = 'student' AND status = 'pending');
--
-- DELETE FROM profiles WHERE id LIKE 'seed-%';
