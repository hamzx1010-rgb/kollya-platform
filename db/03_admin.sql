-- ============================================================
-- KOLIYA — Admin operations
-- There is NO admin page. You run these here, in the Neon SQL Editor.
-- ============================================================

-- ---------- who is waiting for approval? --------------------
SELECT username, full_name, faculty, student_card, email,
       created_at
FROM profiles
WHERE status = 'pending'
ORDER BY created_at;

-- ---------- approve a student -------------------------------
UPDATE profiles SET status = 'approved' WHERE username = 'sara.b';

-- approve everyone waiting (careful)
-- UPDATE profiles SET status = 'approved' WHERE status = 'pending';

-- ---------- reject / ban ------------------------------------
UPDATE profiles SET status = 'rejected' WHERE username = 'omar.k';
UPDATE profiles SET status = 'banned'   WHERE username = 'spammer';

-- unban
UPDATE profiles SET status = 'approved' WHERE username = 'omar.k';

-- ---------- make someone an admin  ← what you asked for -----
UPDATE profiles SET role = 'admin' WHERE username = 'your_username';

-- demote back to student
UPDATE profiles SET role = 'student' WHERE username = 'someone';

-- list all admins
SELECT username, full_name, faculty FROM profiles WHERE role = 'admin';

-- ---------- IMPORTANT: bootstrap the first admin ------------
-- RLS blocks students from setting role='admin'.
-- The very first admin must be created here, by you, once.
-- Sign up normally in the app first, then run:
--
--   UPDATE profiles SET role = 'admin', status = 'approved'
--   WHERE username = 'YOUR_USERNAME';
--
-- After that you can promote others from the app or from here.

-- ---------- moderation --------------------------------------
-- open reports
SELECT r.id, r.target_type, r.target_id, r.reason,
       p.username AS reported_by, r.created_at
FROM reports r
LEFT JOIN profiles p ON p.id = r.reporter_id
WHERE NOT r.handled
ORDER BY r.created_at DESC;

UPDATE reports SET handled = TRUE WHERE id = 1;

-- delete a post
DELETE FROM posts WHERE id = 123;

-- ---------- health / usage ----------------------------------
-- how big is the database? (Neon free tier = 0.5 GB)
SELECT pg_size_pretty(pg_database_size(current_database())) AS total;

-- biggest tables
SELECT relname AS table,
       pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 10;

-- WARNING SIGN: if `messages` or `posts` is unexpectedly large,
-- someone is storing base64 media in a row again. Media belongs on R2.
-- Find offenders:
SELECT id, sender_id, length(media_url) AS url_len
FROM messages
WHERE media_url LIKE 'data:%'
LIMIT 20;

-- ---------- stats -------------------------------------------
SELECT
  (SELECT count(*) FROM profiles WHERE status='approved') AS approved_students,
  (SELECT count(*) FROM profiles WHERE status='pending')  AS pending,
  (SELECT count(*) FROM posts)    AS posts,
  (SELECT count(*) FROM messages) AS messages,
  (SELECT count(*) FROM stories WHERE expires_at > now()) AS active_stories;

-- ---------- housekeeping ------------------------------------
SELECT purge_expired_stories();
