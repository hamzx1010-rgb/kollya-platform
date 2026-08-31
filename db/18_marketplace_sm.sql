-- ============================================================
-- KOLIYA V19 — migration 18: Marketplace
--
-- Adds the student flea market as the 5th campus tab.
-- One table only; all other behavior is the existing app
-- (RLS, approved-gate, media guard, admin powers).
--
-- Safe to run on its own or on top of db/FULL_SCHEMA_sm.sql.
-- Idempotent: every statement is IF NOT EXISTS / OR REPLACE /
-- DROP ... IF EXISTS first.
-- ============================================================

-- ----------------------------------------------------------
-- 18.1 TABLE
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_items (
  id                    bigserial,
  seller_id             text NOT NULL,
  title                 text NOT NULL,
  description           text NOT NULL DEFAULT ''::text,
  price_cents           integer NOT NULL DEFAULT 0,
  currency              text NOT NULL DEFAULT 'DZD'::text,
  category              text NOT NULL DEFAULT 'other'::text,
  condition             text NOT NULL DEFAULT 'used'::text,
  image_url             text,
  status                text NOT NULL DEFAULT 'available'::text,
  created_at            timestamp with time zone NOT NULL DEFAULT now(),
  updated_at            timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_items_pkey PRIMARY KEY (id),
  CONSTRAINT marketplace_items_title_check CHECK (length(btrim(title)) > 0),
  CONSTRAINT marketplace_items_price_check CHECK (price_cents >= 0),
  CONSTRAINT marketplace_items_currency_check
    CHECK (currency = ANY (ARRAY['DZD'::text, 'EUR'::text, 'USD'::text])),
  CONSTRAINT marketplace_items_condition_check
    CHECK (condition = ANY (ARRAY['new'::text, 'like-new'::text, 'used'::text, 'for-parts'::text])),
  CONSTRAINT marketplace_items_status_check
    CHECK (status = ANY (ARRAY['available'::text, 'reserved'::text, 'sold'::text, 'removed'::text])),
  CONSTRAINT marketplace_items_media_size CHECK (media_ok(image_url, 2000000))
);

-- Allow ALTER-style upgrades if the table already exists.
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS seller_id text;
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT ''::text;
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS price_cents integer NOT NULL DEFAULT 0;
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'DZD'::text;
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other'::text;
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS condition text NOT NULL DEFAULT 'used'::text;
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'available'::text;
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

-- ----------------------------------------------------------
-- 18.2 INDEXES
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_marketplace_seller
  ON public.marketplace_items USING btree (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_category
  ON public.marketplace_items USING btree (category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_available
  ON public.marketplace_items USING btree (created_at DESC) WHERE (status = 'available'::text);
CREATE INDEX IF NOT EXISTS idx_marketplace_status
  ON public.marketplace_items USING btree (status);

-- ----------------------------------------------------------
-- 18.3 TRIGGER: keep updated_at fresh
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_marketplace_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_touch_marketplace_item ON marketplace_items;
CREATE TRIGGER trg_touch_marketplace_item
  BEFORE UPDATE ON public.marketplace_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_marketplace_updated_at();

-- ----------------------------------------------------------
-- 18.4 ROW LEVEL SECURITY
-- ----------------------------------------------------------
ALTER TABLE marketplace_items ENABLE ROW LEVEL SECURITY;

-- Everyone approved can browse available listings (and their own).
DROP POLICY IF EXISTS marketplace_items_read ON marketplace_items;
CREATE POLICY marketplace_items_read ON marketplace_items FOR SELECT TO authenticated
  USING (
    is_approved()
    AND (
      seller_id = auth.user_id()
      OR status = 'available'::text
    )
  );

-- Only the seller, and only if approved, may list an item.
DROP POLICY IF EXISTS marketplace_items_insert ON marketplace_items;
CREATE POLICY marketplace_items_insert ON marketplace_items FOR INSERT TO authenticated
  WITH CHECK (
    seller_id = auth.user_id()
    AND is_approved()
    AND status IN ('available'::text, 'reserved'::text)
  );

-- Sellers may update price/photo/status; an admin may moderate anything.
DROP POLICY IF EXISTS marketplace_items_update ON marketplace_items;
CREATE POLICY marketplace_items_update ON marketplace_items FOR UPDATE TO authenticated
  USING (seller_id = auth.user_id() OR is_admin())
  WITH CHECK (seller_id = auth.user_id() OR is_admin());

-- Sellers remove their own listings; admins moderate.
DROP POLICY IF EXISTS marketplace_items_delete ON marketplace_items;
CREATE POLICY marketplace_items_delete ON marketplace_items FOR DELETE TO authenticated
  USING (seller_id = auth.user_id() OR is_admin());

-- ----------------------------------------------------------
-- 18.5 CHECK (all expected 0 on a fresh run)
-- ----------------------------------------------------------
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'marketplace_items'
       AND NOT c.relrowsecurity)                                      AS marketplace_without_rls,
  (SELECT count(*) FROM pg_policies
     WHERE tablename = 'marketplace_items')                            AS marketplace_policy_count;
