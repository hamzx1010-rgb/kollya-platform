-- ============================================================
-- KOLIYA V19 — migration 19: Documents shelf + Classmates level
--
-- Two features sharing one migration because they both touch the
-- profile/documents side:
--   * documents  — per-user upload shelf (files/media URLs), RLS
--                  gives each user their own shelf plus a public
--                  "shared" view for approved users.
--   * classmates — no new table: profiles.level drives the by-level
--                  grouping, plus indexes for faculty/level queries.
--
-- Safe to run on its own or on top of db/FULL_SCHEMA_sm.sql.
-- Idempotent.
-- ============================================================

-- ----------------------------------------------------------
-- 19.1 PROFILES: add level for classmates grouping
-- ----------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS level text DEFAULT ''::text NOT NULL;

-- Keep the column clean: empty (not set) or a single digit 1..6.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_level_check' AND conrelid = 'profiles'::regclass
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_level_check
      CHECK (level = ''::text OR level ~ '^[1-6]$');
  END IF;
END $$;

-- Indexes that power the Classmates screen (same faculty/level grouping).
CREATE INDEX IF NOT EXISTS idx_profiles_faculty
  ON public.profiles USING btree (faculty, status);
CREATE INDEX IF NOT EXISTS idx_profiles_level
  ON public.profiles USING btree (faculty, level, status);
CREATE INDEX IF NOT EXISTS idx_profiles_university
  ON public.profiles USING btree (university, status);

-- ----------------------------------------------------------
-- 19.2 DOCUMENTS TABLE
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id                    bigserial,
  owner_id              text NOT NULL,
  title                 text NOT NULL,
  description           text NOT NULL DEFAULT ''::text,
  subject               text NOT NULL DEFAULT ''::text,
  level                 text NOT NULL DEFAULT ''::text,
  kind                  text NOT NULL DEFAULT 'pdf'::text,
  file_url              text,
  file_name             text NOT NULL DEFAULT ''::text,
  size_bytes            bigint NOT NULL DEFAULT 0,
  shared_public         boolean NOT NULL DEFAULT false,
  downloads             integer NOT NULL DEFAULT 0,
  created_at            timestamp with time zone NOT NULL DEFAULT now(),
  updated_at            timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT documents_pkey PRIMARY KEY (id),
  CONSTRAINT documents_title_check CHECK (length(btrim(title)) > 0),
  CONSTRAINT documents_size_check CHECK (size_bytes >= 0),
  CONSTRAINT documents_level_check
    CHECK (level = ''::text OR level ~ '^[1-6]$'),
  CONSTRAINT documents_kind_check
    CHECK (kind = ANY (ARRAY['pdf'::text, 'doc'::text, 'docx'::text,
                             'ppt'::text, 'pptx'::text, 'xls'::text,
                             'xlsx'::text, 'txt'::text, 'md'::text,
                             'image'::text, 'zip'::text, 'other'::text])),
  CONSTRAINT documents_file_size CHECK (media_ok(file_url, 15728640))
);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT ''::text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS subject text NOT NULL DEFAULT ''::text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT ''::text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'pdf'::text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_url text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_name text NOT NULL DEFAULT ''::text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS size_bytes bigint NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS shared_public boolean NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS downloads integer NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_documents_owner
  ON public.documents USING btree (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_subject
  ON public.documents USING btree (subject, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_shared
  ON public.documents USING btree (created_at DESC) WHERE (shared_public = true);
CREATE INDEX IF NOT EXISTS idx_documents_level
  ON public.documents USING btree (level, subject);

-- ----------------------------------------------------------
-- 19.3 TRIGGER: keep documents.updated_at fresh
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_document_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_touch_document ON documents;
CREATE TRIGGER trg_touch_document
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.touch_document_updated_at();

-- ----------------------------------------------------------
-- 19.4 ROW LEVEL SECURITY
-- ----------------------------------------------------------
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Owner sees everything; anyone approved sees public shared docs.
DROP POLICY IF EXISTS documents_read ON documents;
CREATE POLICY documents_read ON documents FOR SELECT TO authenticated
  USING (
    is_approved()
    AND (
      owner_id = auth.user_id()
      OR shared_public = true
    )
  );

-- Owners upload onto their own shelf.
DROP POLICY IF EXISTS documents_insert ON documents;
CREATE POLICY documents_insert ON documents FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.user_id()
    AND is_approved()
  );

-- Owners edit their shelf; admins moderate.
DROP POLICY IF EXISTS documents_update ON documents;
CREATE POLICY documents_update ON documents FOR UPDATE TO authenticated
  USING (owner_id = auth.user_id() OR is_admin())
  WITH CHECK (owner_id = auth.user_id() OR is_admin());

-- Owners delete; admins moderate.
DROP POLICY IF EXISTS documents_delete ON documents;
CREATE POLICY documents_delete ON documents FOR DELETE TO authenticated
  USING (owner_id = auth.user_id() OR is_admin());

-- ----------------------------------------------------------
-- 19.5 CHECK (all expected 0 on a fresh run)
-- ----------------------------------------------------------
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'documents'
       AND NOT c.relrowsecurity)                                      AS documents_without_rls,
  (SELECT count(*) FROM pg_policies
     WHERE tablename = 'documents')                                    AS documents_policy_count,
  (SELECT count(*) FROM pg_class c WHERE c.relname = 'profiles_level_check'
     AND c.relkind = 'c')                                              AS level_check_constraints;
