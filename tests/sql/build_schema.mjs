/**
 * build_schema.mjs — write db/FULL_SCHEMA_sm.sql
 *
 * Not a concatenation of the ten migration files. That approach ships
 * every mistake alongside its own fix: three different versions of
 * profiles_update_self, a track_quest() that raises "column reference
 * quest_id is ambiguous" followed by a corrected one, a status default
 * of 'pending' followed by an ALTER changing it to 'approved'. Anyone
 * reading it cannot tell which line wins.
 *
 * Instead: load every migration into a throwaway PostgreSQL, let the
 * database resolve the final state, then read that state back out of
 * the catalog and print it ONCE, in dependency order. What you get is
 * the database as it actually ends up — no history, no contradictions.
 *
 * Run: node tests/sql/build_schema.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PG = '/usr/lib/postgresql/17/bin';
const CONN = ['-h', '/tmp', '-p', '5433', '-U', 'postgres'];
const DB = 'schema_build';
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);

const psql = (args, db = DB) =>
  execFileSync(`${PG}/psql`, [...CONN, '-d', db, '-t', '-A', ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Function bodies and policy expressions contain newlines, so rows
// cannot be split on '\n'. Ask psql for an explicit record separator
// (RS) as well as a field separator (US) — both control characters
// that cannot appear in SQL source.
const RS = '\u001e', US = '\u001f';
const q = (sql) =>
  psql(['-R', RS, '-F', US, '-c', sql])
    .split(RS)
    .map(r => r.replace(/^\n/, ''))
    .filter(r => r.trim() !== '')
    // psql appends a newline after the LAST record, so without this the
    // final row of every query came back as "xp_events\n" and compared
    // unequal to "xp_events" — which is how that table got emitted twice.
    .map(r => r.split(US).map((f, i, a) => i === a.length - 1 ? f.replace(/\n$/, '') : f));

const one = sql => psql(['-c', sql]).trim();

/* ---------- 1. build the real thing ---------- */
console.log('loading migrations into a throwaway database…');
execFileSync(`${PG}/psql`, [...CONN, '-d', 'postgres', '-q', '-c',
  `DROP DATABASE IF EXISTS ${DB}`], { stdio: 'ignore' });
execFileSync(`${PG}/psql`, [...CONN, '-d', 'postgres', '-q', '-c',
  `CREATE DATABASE ${DB}`], { stdio: 'ignore' });

execFileSync(`${PG}/psql`, [...CONN, '-d', DB, '-q', '-c', `
CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS neon_auth;
CREATE OR REPLACE FUNCTION auth.user_id() RETURNS TEXT AS $fn$
  SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::text;
$fn$ LANGUAGE sql STABLE;
DO $do$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $do$;
DO $do$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $do$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;`], { stdio: 'ignore' });

const MIGRATIONS = ['01_schema.sql', '02_policies.sql', '05_upgrade_sm.sql',
  '06_game_sm.sql', '07_privacy_sm.sql', '08_fixes_sm.sql',
  '09_requests_sm.sql', '10_open_signup_sm.sql', '11_antifraud_sm.sql'];
for (const m of MIGRATIONS) {
  execFileSync(`${PG}/psql`, [...CONN, '-d', DB, '-q', '-v', 'ON_ERROR_STOP=1',
    '-f', path.join(ROOT, 'db', m)], { stdio: 'ignore' });
}

/* ---------- 2. read the final state back ---------- */
// tables in FK dependency order, so the file runs top to bottom
// The recursive query can return the same table at several depths
// (xp_events reaches profiles both directly and through posts), so the
// result must be de-duplicated keeping the FIRST occurrence.
const order = q(`
WITH RECURSIVE fk AS (
  SELECT c.oid, c.relname::text AS t, 0 AS lvl
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r'
),
lvl AS (
  SELECT t, 0 AS d FROM fk WHERE t = 'profiles'
  UNION ALL
  SELECT fk.t, lvl.d + 1
  FROM fk
  JOIN pg_constraint con ON con.conrelid = fk.oid AND con.contype = 'f'
  JOIN pg_class ref ON ref.oid = con.confrelid
  JOIN lvl ON lvl.t = ref.relname AND lvl.d < 6
  WHERE fk.t <> ref.relname
)
SELECT t, max(d) FROM lvl GROUP BY t ORDER BY 2, 1;`)
  .map(r => r[0])
  .filter((t, i, a) => a.indexOf(t) === i);

const allTables = q(`SELECT c.relname FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1;`).map(r => r[0]);
const tables = [...new Set([...order, ...allTables])];

const colsOf = t => q(`
  SELECT a.attname,
         format_type(a.atttypid, a.atttypmod),
         a.attnotnull,
         coalesce(pg_get_expr(d.adbin, d.adrelid), '')
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid='public.${t}'::regclass AND a.attnum>0 AND NOT a.attisdropped
  ORDER BY a.attnum;`);

// pg_get_constraintdef() already prints "NOT VALID" when the
// constraint was added that way. Emitting it inside CREATE TABLE
// silently drops that flag, which would force a full-table validation
// of every media column on an existing database.
const consOf = (t, type) => q(`
  SELECT con.conname, pg_get_constraintdef(con.oid)
  FROM pg_constraint con
  WHERE con.conrelid='public.${t}'::regclass AND con.contype='${type}'
  ORDER BY con.conname;`);

const indexesOf = t => q(`
  SELECT indexdef FROM pg_indexes
  WHERE schemaname='public' AND tablename='${t}'
    AND indexname NOT IN (
      SELECT con.conname FROM pg_constraint con
      WHERE con.conrelid='public.${t}'::regclass AND con.contype IN ('p','u'))
  ORDER BY indexname;`).map(r => r[0]);

const policiesOf = t => q(`
  SELECT policyname, cmd, coalesce(qual,''), coalesce(with_check,''),
         array_to_string(roles, ',')
  FROM pg_policies WHERE schemaname='public' AND tablename='${t}'
  ORDER BY policyname;`);

const triggersOf = t => q(`
  SELECT tgname, pg_get_triggerdef(t.oid)
  FROM pg_trigger t WHERE tgrelid='public.${t}'::regclass AND NOT tgisinternal
  ORDER BY tgname;`);

// functions, dependency-ordered: helpers other functions call must exist first
const HELPERS = ['media_ok', 'is_admin', 'is_approved', 'blocked_between',
                 'can_view', 'dm_connected'];
const funcRows = q(`
  SELECT p.proname, pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' ORDER BY p.proname;`);
const funcs = [
  ...HELPERS.map(h => funcRows.filter(r => r[0] === h)).flat(),
  ...funcRows.filter(r => !HELPERS.includes(r[0]))
];

const seqs = q(`SELECT c.relname FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='S' ORDER BY 1;`).map(r => r[0]);

/* ---------- 3. human notes, so the file explains itself ---------- */
const TABLE_NOTE = {
  profiles:    'The app profile. Identity itself lives in neon_auth."user";\nthis row is keyed by the same id, filled from the JWT by default.',
  posts:       'Feed posts. A repost is an ordinary post whose repost_id\npoints at the original — that is how the repost counter is derived.',
  post_likes:  'Composite primary key, no id column: counting must name a\nreal column (see db_sm.js COUNT_KEY).',
  post_saves:  'Private to you. Nobody can see what you saved.',
  comments:    null,
  poll_votes:  'One row per voter per post. The options themselves live in\nposts.poll as JSONB.',
  follows:     "state='pending' is a follow REQUEST to a private account;\n'accepted' is a real follow.",
  blocks:      null,
  messages:    'One flat table. Filtering DMs in JavaScript is how the old\napp leaked every conversation to every device — RLS does it here.',
  message_reactions: null,
  dm_requests: 'Instagram-style message requests. A first message from\nsomeone you do not follow lands here instead of your inbox.',
  chat_folders:'Which folder you filed a conversation under.',
  typing:      'Ephemeral typing indicators.',
  stories:     '24-hour stories; expires_at is enforced by purge_expired_stories().',
  story_views: null,
  channels:    null,
  channel_members: null,
  events:      null,
  event_attendees: null,
  qa:          'Anonymous questions.',
  qa_answers:  null,
  qa_answer_votes: null,
  notifications: 'pushed_at stops a browser notification firing on every poll.',
  reports:     null,
  quests:      'Daily quests. WRITABLE ONLY through track_quest() — there is\ndeliberately no INSERT or UPDATE policy for students.',
  xp_events:   'Append-only XP ledger. Written ONLY by award_xp().'
};

const FUNC_NOTE = {
  is_approved:  "Gate for every write. Only 'rejected' and 'banned' are refused —\nan account is usable the moment it is created.",
  can_view:     'Private-account logic, used by the read policies.',
  track_quest:  'The ONLY way quest progress can move.\nNOTE the `#variable_conflict use_column`: the RETURNS TABLE output\nnames (quest_id, progress, target) collide with the table\'s own\ncolumns, and without this every call failed with\n"column reference quest_id is ambiguous".',
  award_xp:     'The ONLY way XP can move. SECURITY DEFINER, so it bypasses the\nguard trigger that blocks students writing profiles.xp by hand.',
  guard_profile_progress:
                'Blocks a student setting their own xp / streak / role / status.\nKeyed on current_user = \'authenticated\' (the role PostgREST switches\ninto), NOT on current_user = session_user — those are never equal\nunder PostgREST, so the old test skipped exactly the people it was\nmeant to stop.',
  route_new_message: 'Sends a first message from a stranger to dm_requests\ninstead of the inbox.',
  profile_counts: 'SECURITY DEFINER so follower counts are correct even on a\nprivate account whose follow rows RLS hides from you.'
};

/* ---------- 4. write it ---------- */
const L = [];
const w = s => L.push(s);
const rule = t => w(`-- ${'-'.repeat(58)}\n-- ${t}\n-- ${'-'.repeat(58)}`);

w(`-- ============================================================
-- KOLIYA — FULL_SCHEMA_sm.sql
-- The entire database in ONE file. Nothing else to run.
--
--   Neon Console -> SQL Editor -> paste this whole file -> Run
--   then: Data API page -> "Refresh schema cache"
--
-- This is NOT the migration files glued together. Those contain
-- their own history: three different versions of the profile update
-- policy, a track_quest() that crashes followed by a fixed one, a
-- status default of 'pending' followed by an ALTER that changes it to
-- 'approved'. Reading them, you cannot tell which line wins.
--
-- This file is the FINAL STATE, read back out of a real PostgreSQL 17
-- after every migration had been applied. Each object appears exactly
-- once, already correct, in dependency order.
--
-- Safe to run twice: every statement is IF NOT EXISTS / OR REPLACE /
-- DROP ... IF EXISTS first.
--
--   ${tables.length} tables · ${funcs.length} functions · ${q(`SELECT count(*) FROM pg_policies WHERE schemaname='public'`)[0][0]} policies
--
-- Generated by tests/sql/build_schema.mjs on ${new Date().toISOString().slice(0, 10)}
-- ============================================================
`);

rule('0. PREREQUISITES\n--\n-- Neon provides auth.user_id() and the `authenticated` role when the\n-- Data API is enabled with Managed Better Auth. These guards let the\n-- file also run on a plain PostgreSQL for testing.');
w(`CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS neon_auth;

DO $$
BEGIN
  IF to_regprocedure('auth.user_id()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION auth.user_id() RETURNS TEXT AS $body$
        SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::text;
      $body$ LANGUAGE sql STABLE;
    $fn$;
  END IF;
END $$;

DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon          NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
`);

// media_ok must exist before the CHECK constraints that call it
rule('1. MEDIA SIZE GUARD\n--\n-- Media is stored in Postgres as data: URLs, so every media column\n-- carries a CHECK that calls this. It must exist before the tables.');
const mediaOk = funcs.find(f => f[0] === 'media_ok');
if (mediaOk) w(mediaOk[1].replace(/^CREATE OR REPLACE FUNCTION/, 'CREATE OR REPLACE FUNCTION') + ';\n');

rule('2. TABLES');
for (const t of tables) {
  const cols = colsOf(t);
  const pk = consOf(t, 'p');
  const uq = consOf(t, 'u');
  const ck = consOf(t, 'c');

  w('');
  if (TABLE_NOTE[t]) w(`-- ${t} — ` + TABLE_NOTE[t].split('\n').join('\n-- '));
  const lines = cols.map(([name, type, notnull, def]) => {
    // A DEFAULT of nextval('x_id_seq') means the column was declared
    // bigserial. Emitting the nextval() literally fails on an empty
    // database — the sequence does not exist yet ("relation
    // channels_id_seq does not exist"). Write bigserial and let
    // Postgres create and own the sequence.
    const serial = /^nextval\('[^']+'::regclass\)$/.test(def);
    if (serial) {
      const st = type === 'integer' ? 'serial'
               : type === 'smallint' ? 'smallserial' : 'bigserial';
      return `  ${name.padEnd(16)} ${st}`;
    }
    let s = `  ${name.padEnd(16)} ${type}`;
    if (def) s += ` DEFAULT ${def}`;
    if (notnull === 't') s += ' NOT NULL';
    return s;
  });
  for (const [n, def] of pk) lines.push(`  CONSTRAINT ${n} ${def}`);
  for (const [n, def] of uq) lines.push(`  CONSTRAINT ${n} ${def}`);
  for (const [n, def] of ck) lines.push(`  CONSTRAINT ${n} ${def}`);
  w(`CREATE TABLE IF NOT EXISTS ${t} (\n${lines.join(',\n')}\n);`);

  // columns added by later migrations: ADD COLUMN IF NOT EXISTS so the
  // file also upgrades a database that already has the old shape
  for (const [name, type, notnull, def] of cols) {
    if (/^nextval\('[^']+'::regclass\)$/.test(def)) continue;   // serial, already there
    w(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS ${name} ${type}` +
      (def ? ` DEFAULT ${def}` : '') + ';');
  }
}

rule('3. FOREIGN KEYS\n--\n-- Added after every table exists, so the order above cannot matter.');
for (const t of tables) {
  for (const [n, def] of consOf(t, 'f')) {
    w(`DO $$ BEGIN
  ALTER TABLE ${t} ADD CONSTRAINT ${n} ${def};
EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  }
}

rule('4. INDEXES');
for (const t of tables) {
  const ix = indexesOf(t);
  if (!ix.length) continue;
  for (const def of ix) w(def.replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS ') + ';');
}

rule('5. FUNCTIONS\n--\n-- Helpers first: the policies below call them.');
for (const [name, def] of funcs) {
  if (name === 'media_ok') continue;              // already emitted
  w('');
  if (FUNC_NOTE[name]) w(`-- ${name}() — ` + FUNC_NOTE[name].split('\n').join('\n-- '));
  w(def.trimEnd() + ';');
}

rule('6. VIEWS\n--\n-- security_invoker = true so the CALLER\'s RLS applies, not the\n-- view owner\'s. Without it a view is a hole straight through RLS.');
const views = q(`
  SELECT c.relname,
         pg_get_viewdef(c.oid, true),
         coalesce((SELECT option_value FROM pg_options_to_table(c.reloptions)
                   WHERE option_name='security_invoker'), 'false')
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='v' ORDER BY c.relname;`);
for (const [name, def, invoker] of views) {
  w('');
  w(`CREATE OR REPLACE VIEW ${name} AS`);
  w(def.trimEnd().replace(/;$/, '') + ';');
  if (invoker === 'true') w(`ALTER VIEW ${name} SET (security_invoker = true);`);
  w(`GRANT SELECT ON ${name} TO authenticated;`);
}
w('');

rule('7. ROW LEVEL SECURITY\n--\n-- Every table is protected. The browser can send anything it likes;\n-- these rules are what actually decides.');
for (const t of tables) w(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);

w('');
for (const t of tables) {
  const pol = policiesOf(t);
  if (!pol.length) continue;
  w(`\n-- ${t}`);
  for (const [name, cmd, qual, check, roles] of pol) {
    w(`DROP POLICY IF EXISTS ${name} ON ${t};`);
    let s = `CREATE POLICY ${name} ON ${t} FOR ${cmd} TO ${roles || 'authenticated'}`;
    if (qual)  s += `\n  USING (${qual})`;
    if (check) s += `\n  WITH CHECK (${check})`;
    w(s + ';');
  }
}

rule('8. TRIGGERS');
for (const t of tables) {
  for (const [name, def] of triggersOf(t)) {
    w(`DROP TRIGGER IF EXISTS ${name} ON ${t};`);
    w(def + ';');
  }
}

rule('9. GRANTS\n--\n-- RLS decides the rows; these decide that the role may ask at all.');
w(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT                   ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE                         ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT                  ON SEQUENCES TO authenticated;
`);

rule('10. REPAIR AN EXISTING DATABASE\n--\n-- If you already ran the old migrations, these accounts are frozen at\n-- status=\'pending\' and cannot like, comment or post. This unfreezes\n-- them. On a fresh database it matches zero rows.');
w(`UPDATE profiles SET status = 'approved' WHERE status = 'pending';\n`);

rule('11. CHECK\n--\n-- Every number must be 0.');
w(`SELECT
  (SELECT count(*) FROM profiles WHERE status='pending')                    AS frozen_accounts,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity)   AS tables_without_rls,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r'
       AND NOT EXISTS (SELECT 1 FROM pg_policies p
                       WHERE p.schemaname='public' AND p.tablename=c.relname)) AS tables_without_policy,
  (SELECT count(*) FROM pg_policies
     WHERE tablename IN ('quests','xp_events')
       AND cmd IN ('INSERT','UPDATE','ALL'))                                AS forgeable_game_tables;`);

const outPath = path.join(ROOT, 'db', 'FULL_SCHEMA_sm.sql');
fs.writeFileSync(outPath, L.join('\n') + '\n');
console.log(`wrote db/FULL_SCHEMA_sm.sql — ${L.join('\n').split('\n').length} lines`);
console.log(`  ${tables.length} tables, ${funcs.length} functions, ${seqs.length} sequences`);
