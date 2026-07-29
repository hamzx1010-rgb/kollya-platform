#!/usr/bin/env bash
# ============================================================
# RLS tests against a REAL PostgreSQL.
#
# Why this exists: every previous suite mocked the database. The
# browser mock returns whatever matches the filter and enforces no
# policies at all, so it happily "proved" that liking and profile
# editing worked while the real Neon refused both with
# "new row violates row-level security policy" — which the UI shows
# as "you do not have permission".
#
# This loads db/*.sql into a throwaway Postgres, switches into the
# `authenticated` role the way PostgREST does, sets the JWT claim the
# way Neon does, and asserts what a student can and cannot do.
#
# Run: bash tests/sql/rls.test.sh
# ============================================================
set -u
export PATH=$PATH:/usr/lib/postgresql/17/bin
PGHOST=/tmp; PGPORT=5433; PGUSER=postgres; DB=koliya_rls_test
export PGHOST PGPORT PGUSER

command -v psql >/dev/null || { echo "psql not installed — skipping"; exit 0; }
pg_isready -q -h $PGHOST -p $PGPORT || { echo "no postgres on $PGHOST:$PGPORT — skipping"; exit 0; }

cd "$(dirname "$0")/../.."
pass=0; total=0; fails=()

psql -q -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
psql -q -c "CREATE DATABASE $DB"          >/dev/null 2>&1

# Neon's environment: an `authenticated` role and auth.user_id()
# reading the JWT claim.
psql -q -d $DB >/dev/null 2>&1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS neon_auth;
CREATE OR REPLACE FUNCTION auth.user_id() RETURNS TEXT AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::text;
$$ LANGUAGE sql STABLE;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon          NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
SQL

# FULL_SCHEMA_sm.sql is the one file the user pastes into Neon, so
# every assertion below runs against exactly that.
for f in db/FULL_SCHEMA_sm.sql; do
  out=$(psql -q -d $DB -v ON_ERROR_STOP=1 -f "$f" 2>&1)
  total=$((total+1))
  if [ $? -eq 0 ]; then pass=$((pass+1)); else
    fails+=("migration $f failed: $(echo "$out" | grep ERROR | head -1)")
  fi
done

# Seed as the table owner (bypasses RLS), the way Neon's console would.
psql -q -d $DB >/dev/null 2>&1 <<'SQL'
INSERT INTO profiles (id,username,full_name,student_card,faculty,status,role) VALUES
  ('s1','student1','Student One','CS-101','Informatique','approved','student'),
  ('s2','student2','Student Two','CS-102','Informatique','approved','student'),
  ('adm','admin1','Admin One','CS-999','Informatique','approved','admin'),
  ('ban','banned1','Banned One','CS-666','Informatique','banned','student');
INSERT INTO posts (id,user_id,text) VALUES (9001,'s2','a post to act on');
SQL

# as(user, sql) -> prints OK or the SQLSTATE
run_as() {
  # NOT -q: quiet mode swallows the "UPDATE 0" / "DELETE 0" command tag,
  # which is exactly the signal that RLS hid the row. Without the tag
  # this harness read a silently-refused UPDATE as success and reported
  # "student CAN edit others" on a database that changed nothing.
  psql -d $DB -t -A 2>&1 <<SQL
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"$1"}', false);
$2
SQL
}

check() {           # check <desc> <user> <sql> <expect: allow|deny>
  local desc="$1" user="$2" sql="$3" want="$4"
  total=$((total+1))
  local out; out=$(run_as "$user" "$sql")
  local denied=0
  # RLS refuses in TWO different ways and both count as "deny":
  #   INSERT/UPDATE with a failing WITH CHECK -> an explicit error
  #   UPDATE/DELETE whose USING hides the row -> no error, 0 rows
  # Only checking for the error text reported "student CAN edit others"
  # on a database that had actually changed nothing.
  # A refusal arrives in THREE shapes and all of them mean "denied":
  #   RLS WITH CHECK failure  -> "row-level security policy"
  #   a guard trigger         -> its own RAISE EXCEPTION message
  #   RLS USING hiding a row  -> no error at all, just 0 rows
  # Only matching the first two words reported "student CAN set own XP"
  # against a database that had raised an exception and changed nothing.
  echo "$out" | grep -qi "^ERROR" && denied=1
  echo "$out" | grep -qE "^(UPDATE|DELETE) 0$" && denied=1
  if { [ "$want" = allow ] && [ $denied -eq 0 ]; } || { [ "$want" = deny ] && [ $denied -eq 1 ]; }; then
    pass=$((pass+1))
  else
    fails+=("$desc — wanted $want, got $([ $denied -eq 1 ] && echo deny || echo allow)")
  fi
}

# ---- the bug that started this: a normal student must be able to act
check "student can LIKE"            s1 "INSERT INTO post_likes (post_id,user_id) VALUES (9001,'s1');"      allow
check "student can UNLIKE"          s1 "DELETE FROM post_likes WHERE post_id=9001 AND user_id='s1';"       allow
check "student can COMMENT"         s1 "INSERT INTO comments (post_id,user_id,text) VALUES (9001,'s1','hi');" allow
check "student can POST"            s1 "INSERT INTO posts (user_id,text) VALUES ('s1','hello');"           allow
check "student can SAVE"            s1 "INSERT INTO post_saves (post_id,user_id) VALUES (9001,'s1');"      allow
check "student can EDIT BIO"        s1 "UPDATE profiles SET bio='new bio' WHERE id='s1';"                  allow
check "student can SET AVATAR"      s1 "UPDATE profiles SET avatar_url='data:image/jpeg;base64,AA' WHERE id='s1';" allow
check "student can SET BANNER"      s1 "UPDATE profiles SET banner_url='data:image/jpeg;base64,AA' WHERE id='s1';" allow
check "student can FOLLOW"          s1 "INSERT INTO follows (follower_id,followee_id) VALUES ('s1','s2');" allow
check "student can DM"              s1 "INSERT INTO messages (sender_id,receiver_id,text) VALUES ('s1','s2','yo');" allow

# ---- a brand-new signup must be usable IMMEDIATELY
check "new signup can create own row" n1 \
  "INSERT INTO profiles (id,username,full_name,student_card,faculty,status,role)
     VALUES ('n1','newbie','New Bie','CS-201','Informatique','approved','student');" allow
check "new signup can LIKE at once" n1 \
  "INSERT INTO post_likes (post_id,user_id) VALUES (9001,'n1');" allow
check "new signup can POST at once" n1 \
  "INSERT INTO posts (user_id,text) VALUES ('n1','first post');" allow

# ---- admins are not locked out (the thing I wrongly blamed for months)
check "admin can edit own profile"  adm "UPDATE profiles SET bio='admin bio' WHERE id='adm';"              allow
check "admin can LIKE"              adm "INSERT INTO post_likes (post_id,user_id) VALUES (9001,'adm');"    allow

# ---- moderation still bites
check "banned CANNOT like"          ban "INSERT INTO post_likes (post_id,user_id) VALUES (9001,'ban');"    deny
check "banned CANNOT post"          ban "INSERT INTO posts (user_id,text) VALUES ('ban','spam');"          deny

# ---- privilege escalation is still impossible
check "student CANNOT self-promote" s1  "UPDATE profiles SET role='admin' WHERE id='s1';"                  deny
check "student CANNOT edit others"  s1  "UPDATE profiles SET bio='hacked' WHERE id='s2';"                  deny
check "student CANNOT like AS someone else" s1 \
  "INSERT INTO post_likes (post_id,user_id) VALUES (9001,'s2');" deny
check "student CANNOT delete others' posts" s1 "DELETE FROM posts WHERE id=9001;"                          deny

# ---- the game economy must not be forgeable ----------------------
check "student CANNOT set own XP"      s1 "UPDATE profiles SET xp=99999 WHERE id='s1';"                  deny
check "student CANNOT set own streak"  s1 "UPDATE profiles SET streak=365 WHERE id='s1';"                deny
check "student CANNOT forge a quest"   s1 \
  "INSERT INTO quests (user_id,day,quest_id,progress,target) VALUES ('s1',current_date,'visit',99,1);" deny
check "student CANNOT write xp_events" s1 \
  "INSERT INTO xp_events (user_id,kind,amount) VALUES ('s1','post',9999);" deny
check "student CANNOT bump own status" s1 "UPDATE profiles SET status='banned' WHERE id='s1';"           deny

# ---- but the legitimate earning path still works -----------------
check "award_xp() still works"     s1 "SELECT award_xp('post', 8, 'post', '9001');"        allow
check "track_quest() still works"  s1 "SELECT * FROM track_quest('visit', 1, 1);"          allow
check "my_quests() still works"    s1 "SELECT * FROM my_quests();"                         allow
check "resolve_streak() works"     s1 "SELECT * FROM resolve_streak(false);"               allow

# track_quest() used to fail with "column reference quest_id is
# ambiguous" on EVERY call — assert it returns a usable row.
total=$((total+1))
tq=$(run_as s1 "SELECT progress||'/'||target FROM track_quest('visit', 1, 1);")
if echo "$tq" | grep -qE "^[0-9]+/[0-9]+$"; then pass=$((pass+1));
else fails+=("track_quest returned no usable row: $(echo "$tq"|tail -2|tr '\n' ' ')"); fi

# ---- DM privacy ---------------------------------------------------
total=$((total+1))
psql -q -d $DB >/dev/null 2>&1 <<'SQL'
INSERT INTO profiles (id,username,full_name,student_card,faculty,status,role)
  VALUES ('s3','student3','Student Three','CS-103','Informatique','approved','student')
  ON CONFLICT DO NOTHING;
INSERT INTO messages (sender_id,receiver_id,text) VALUES ('s2','s3','TOP SECRET');
SQL
leak=$(run_as s1 "SELECT text FROM messages;")
if echo "$leak" | grep -q "TOP SECRET"; then
  fails+=("s1 can read a DM between s2 and s3 — PRIVACY HOLE")
else pass=$((pass+1)); fi

# ---- no pending accounts may be left behind
total=$((total+1))
left=$(psql -q -d $DB -t -A -c "SELECT count(*) FROM profiles WHERE status='pending';")
if [ "$left" = "0" ]; then pass=$((pass+1)); else fails+=("$left accounts still stuck on status='pending'"); fi

psql -q -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1

for f in "${fails[@]:-}"; do [ -n "$f" ] && echo "FAIL $f"; done
echo "$pass/$total passed"
[ ${#fails[@]} -eq 0 ] || [ -z "${fails[0]:-}" ]
