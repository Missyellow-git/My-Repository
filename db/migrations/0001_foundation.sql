-- 0001_foundation.sql
-- Extensions, the `app` helper schema, and primitives every later migration uses.
--
-- Baseline: PostgreSQL 16+.
--   * NULLS NOT DISTINCT unique indexes (15+) are used for system-vs-tenant rows.
--   * Declarative partitioning with FK support (12+) is used by analytics.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_bytes, digest
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email / slug
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy search on names and keywords
CREATE EXTENSION IF NOT EXISTS btree_gin;  -- (tenant_id, jsonb) composite GIN

CREATE SCHEMA IF NOT EXISTS app;
COMMENT ON SCHEMA app IS 'Helper functions and session context. No tables live here.';

-- ---------------------------------------------------------------------------
-- Identifiers
-- ---------------------------------------------------------------------------

-- UUIDv7: time-ordered, so primary key inserts append to the right-hand edge of
-- the btree instead of scattering across it the way v4 does. On a table taking
-- millions of rows that is the difference between a cache-resident index and one
-- that thrashes. On PostgreSQL 18+ replace the body with `RETURN uuidv7();`.
CREATE OR REPLACE FUNCTION app.uuid_generate_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  ts_ms  bytea;
  buffer bytea;
BEGIN
  ts_ms  := substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  buffer := ts_ms || gen_random_bytes(10);
  buffer := set_byte(buffer, 6, (get_byte(buffer, 6) & 15) | 112);   -- version 7
  buffer := set_byte(buffer, 8, (get_byte(buffer, 8) & 63) | 128);   -- variant 10
  RETURN encode(buffer, 'hex')::uuid;
END;
$$;

-- ---------------------------------------------------------------------------
-- Session context (read by row-level security in 0009)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.current_org_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.organization_id', true), '')::uuid;
$$;

-- Background workers (export renderer, billing webhooks, analytics rollups) set
-- this to bypass tenant policies. It is a separate switch from the tenant id so
-- an application connection can never accidentally acquire it.
CREATE OR REPLACE FUNCTION app.is_service_role()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.service_role', true), 'off') = 'on';
$$;

-- ---------------------------------------------------------------------------
-- Shared triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Attaches the updated_at trigger to every public table that has the column and
-- does not already have the trigger. Each migration calls this at the end, so a
-- new table gets the behaviour by declaring the column rather than by an author
-- remembering to write a trigger.
CREATE OR REPLACE FUNCTION app.sync_touch_triggers()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  target text;
BEGIN
  FOR target IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'updated_at' AND a.attnum > 0
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (
         SELECT 1 FROM pg_trigger g
          WHERE g.tgrelid = c.oid AND g.tgname = 'trg_touch_updated_at'
       )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', target);
  END LOOP;
END;
$$;

-- Append-only guard for ledger tables: money and credits are corrected by
-- writing a compensating row, never by editing history.
CREATE OR REPLACE FUNCTION app.forbid_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table %.% is append-only; write a compensating row instead.',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- ---------------------------------------------------------------------------
-- Immutable helpers for generated columns
-- ---------------------------------------------------------------------------

-- array_to_string is only STABLE, because in general it depends on the element
-- type's output function. For text[] that dependence does not exist, so this
-- wrapper is safe to declare IMMUTABLE — and a generated tsvector column needs
-- an immutable expression. Restricted to text[] deliberately: do not widen it to
-- anyarray, where the volatility claim would stop being true.
CREATE OR REPLACE FUNCTION app.join_text(items text[], separator text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT array_to_string(coalesce(items, '{}'::text[]), separator);
$$;

-- ---------------------------------------------------------------------------
-- Domains
-- ---------------------------------------------------------------------------

CREATE DOMAIN app.email AS citext
  CHECK (VALUE ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(VALUE) <= 320);

CREATE DOMAIN app.slug AS citext
  CHECK (VALUE ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$');

CREATE DOMAIN app.hex_color AS text
  CHECK (VALUE ~* '^#[0-9a-f]{6}([0-9a-f]{2})?$');

CREATE DOMAIN app.currency AS char(3)
  CHECK (VALUE ~ '^[A-Z]{3}$');

COMMIT;
