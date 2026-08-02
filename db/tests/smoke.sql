-- smoke.sql — asserts the schema enforces what its comments claim.
--
-- Run against a database with all migrations applied:
--   psql -d carousel -v ON_ERROR_STOP=1 -f db/tests/smoke.sql
--
-- Every check raises on failure, so a clean run means every assertion held.
-- `expect_violation` runs a statement that is supposed to fail and asserts that
-- it did — a constraint nobody has watched reject anything is a constraint you
-- do not actually have.

\set ON_ERROR_STOP on
SET client_min_messages = notice;

CREATE OR REPLACE FUNCTION pg_temp.expect_violation(label text, stmt text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'ok   %  (rejected: %)', rpad(label, 44), left(SQLERRM, 60);
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL %  — statement was accepted but should have been rejected', label;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect(label text, condition boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition THEN
    RAISE NOTICE 'ok   %', label;
  ELSE
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Seed: two tenants, so isolation has something to isolate.
-- ---------------------------------------------------------------------------

INSERT INTO users (id, email, full_name) VALUES
  ('00000000-0000-7000-8000-0000000000a1', 'ada@example.com',  'Ada'),
  ('00000000-0000-7000-8000-0000000000b1', 'grace@example.com','Grace');

INSERT INTO organizations (id, slug, name, kind, owner_user_id) VALUES
  ('00000000-0000-7000-8000-0000000000a0', 'acme',  'Acme',  'team', '00000000-0000-7000-8000-0000000000a1'),
  ('00000000-0000-7000-8000-0000000000b0', 'globex','Globex','team', '00000000-0000-7000-8000-0000000000b1');

INSERT INTO organization_members (organization_id, user_id, role) VALUES
  ('00000000-0000-7000-8000-0000000000a0', '00000000-0000-7000-8000-0000000000a1', 'owner'),
  ('00000000-0000-7000-8000-0000000000b0', '00000000-0000-7000-8000-0000000000b1', 'owner');

INSERT INTO projects (id, organization_id, created_by, title) VALUES
  ('00000000-0000-7000-8000-0000000000a2', '00000000-0000-7000-8000-0000000000a0',
   '00000000-0000-7000-8000-0000000000a1', 'Acme pricing carousel'),
  ('00000000-0000-7000-8000-0000000000b2', '00000000-0000-7000-8000-0000000000b0',
   '00000000-0000-7000-8000-0000000000b1', 'Globex launch carousel');

-- ---------------------------------------------------------------------------
-- Identity + membership constraints
-- ---------------------------------------------------------------------------

SELECT pg_temp.expect_violation('one owner per organization', $$
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES ('00000000-0000-7000-8000-0000000000a0','00000000-0000-7000-8000-0000000000b1','owner')
$$);

SELECT pg_temp.expect_violation('email must be well formed', $$
  INSERT INTO users (email) VALUES ('not-an-email')
$$);

SELECT pg_temp.expect_violation('email is case-insensitively unique', $$
  INSERT INTO users (email) VALUES ('ADA@example.com')
$$);

SELECT pg_temp.expect_violation('invitations cannot grant ownership', $$
  INSERT INTO invitations (organization_id, email, role, token_hash, expires_at)
  VALUES ('00000000-0000-7000-8000-0000000000a0','x@example.com','owner',
          gen_random_bytes(32), now() + interval '7 days')
$$);

-- ---------------------------------------------------------------------------
-- Slides: ordering and the deferred uniqueness that makes reordering possible
-- ---------------------------------------------------------------------------

INSERT INTO slides (project_id, position, role) VALUES
  ('00000000-0000-7000-8000-0000000000a2', 0, 'cover'),
  ('00000000-0000-7000-8000-0000000000a2', 1, 'point'),
  ('00000000-0000-7000-8000-0000000000a2', 2, 'cta');

SELECT pg_temp.expect('slide_count denormalization is maintained',
  (SELECT slide_count FROM projects WHERE id = '00000000-0000-7000-8000-0000000000a2') = 3);

-- Deferred constraints report at COMMIT, not at the offending statement, so this
-- one cannot go through expect_violation — the exception would be raised after
-- the handler had already returned. SET CONSTRAINTS pulls the check forward.
DO $$
BEGIN
  BEGIN
    INSERT INTO slides (project_id, position, role)
    VALUES ('00000000-0000-7000-8000-0000000000a2', 0, 'point');
    SET CONSTRAINTS slides_position_key IMMEDIATE;
    RAISE EXCEPTION 'FAIL duplicate slide position was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ok   %', rpad('duplicate slide position rejected', 44);
  END;
END
$$;

SELECT pg_temp.expect_violation('unknown slide role rejected', $$
  INSERT INTO slides (project_id, position, role)
  VALUES ('00000000-0000-7000-8000-0000000000a2', 9, 'interstitial')
$$);

-- The point of DEFERRABLE: a swap passes through a duplicate state mid-transaction.
BEGIN;
  UPDATE slides SET position = 1 WHERE project_id = '00000000-0000-7000-8000-0000000000a2' AND position = 0;
  UPDATE slides SET position = 0 WHERE project_id = '00000000-0000-7000-8000-0000000000a2' AND position = 2;
  UPDATE slides SET position = 2 WHERE project_id = '00000000-0000-7000-8000-0000000000a2' AND position = 1 AND role = 'point';
COMMIT;

SELECT pg_temp.expect('slides reorder inside one transaction',
  (SELECT string_agg(role, ',' ORDER BY position)
     FROM slides WHERE project_id = '00000000-0000-7000-8000-0000000000a2') = 'cta,cover,point');

-- ---------------------------------------------------------------------------
-- Credits: the ledger is the truth, the balance cannot drift, and you cannot
-- spend what you do not have.
-- ---------------------------------------------------------------------------

INSERT INTO credit_ledger (organization_id, delta, event)
VALUES ('00000000-0000-7000-8000-0000000000a0', 500, 'grant_subscription');

INSERT INTO credit_ledger (organization_id, delta, event)
VALUES ('00000000-0000-7000-8000-0000000000a0', -120, 'spend_generation');

SELECT pg_temp.expect('balance tracks the ledger',
  (SELECT balance FROM credit_balances WHERE organization_id = '00000000-0000-7000-8000-0000000000a0') = 380);

SELECT pg_temp.expect('lifetime_spent accumulates spends only',
  (SELECT lifetime_spent FROM credit_balances WHERE organization_id = '00000000-0000-7000-8000-0000000000a0') = 120);

SELECT pg_temp.expect_violation('overdraft is refused', $$
  INSERT INTO credit_ledger (organization_id, delta, event)
  VALUES ('00000000-0000-7000-8000-0000000000a0', -1000, 'spend_generation')
$$);

SELECT pg_temp.expect('a refused spend leaves the balance untouched',
  (SELECT balance FROM credit_balances WHERE organization_id = '00000000-0000-7000-8000-0000000000a0') = 380);

SELECT pg_temp.expect_violation('ledger history cannot be edited', $$
  UPDATE credit_ledger SET delta = 0
   WHERE organization_id = '00000000-0000-7000-8000-0000000000a0'
$$);

SELECT pg_temp.expect_violation('grant must be positive', $$
  INSERT INTO credit_ledger (organization_id, delta, event)
  VALUES ('00000000-0000-7000-8000-0000000000a0', -5, 'grant_topup')
$$);

SELECT pg_temp.expect_violation('a zero movement is not a movement', $$
  INSERT INTO credit_ledger (organization_id, delta, event)
  VALUES ('00000000-0000-7000-8000-0000000000a0', 0, 'adjustment')
$$);

-- ---------------------------------------------------------------------------
-- Billing arithmetic and idempotency
-- ---------------------------------------------------------------------------

SELECT pg_temp.expect_violation('invoice total must equal its parts', $$
  INSERT INTO invoices (organization_id, number, subtotal_cents, tax_cents, total_cents)
  VALUES ('00000000-0000-7000-8000-0000000000a0', 'INV-BAD', 1000, 200, 9999)
$$);

INSERT INTO invoices (organization_id, number, subtotal_cents, tax_cents, total_cents, status)
VALUES ('00000000-0000-7000-8000-0000000000a0', 'INV-1', 1000, 200, 1200, 'open');

SELECT pg_temp.expect_violation('paid invoices need a paid_at', $$
  UPDATE invoices SET status = 'paid' WHERE number = 'INV-1'
$$);

INSERT INTO payments (organization_id, amount_cents, status, idempotency_key, processed_at)
VALUES ('00000000-0000-7000-8000-0000000000a0', 1200, 'succeeded', 'evt_abc123', now());

SELECT pg_temp.expect_violation('a redelivered payment webhook cannot double-charge', $$
  INSERT INTO payments (organization_id, amount_cents, status, idempotency_key, processed_at)
  VALUES ('00000000-0000-7000-8000-0000000000a0', 1200, 'succeeded', 'evt_abc123', now())
$$);

SELECT pg_temp.expect_violation('refund cannot exceed the payment', $$
  UPDATE payments SET refunded_cents = 99999 WHERE idempotency_key = 'evt_abc123'
$$);

INSERT INTO plans (code, name, tier, price_cents, ai_credits_per_period)
VALUES ('pro', 'Pro', 'pro', 2900, 500);

INSERT INTO subscriptions (organization_id, plan_id, status, current_period_start, current_period_end)
SELECT '00000000-0000-7000-8000-0000000000a0', id, 'active', now(), now() + interval '30 days'
  FROM plans WHERE code = 'pro';

SELECT pg_temp.expect_violation('only one live subscription per organization', $$
  INSERT INTO subscriptions (organization_id, plan_id, status, current_period_start, current_period_end)
  SELECT '00000000-0000-7000-8000-0000000000a0', id, 'trialing', now(), now() + interval '30 days'
    FROM plans WHERE code = 'pro'
$$);

-- ---------------------------------------------------------------------------
-- Assets: dedupe, and the delete guard
-- ---------------------------------------------------------------------------

INSERT INTO assets (id, organization_id, kind, sha256, byte_size, mime_type, storage_key)
VALUES ('00000000-0000-7000-8000-0000000000a3', '00000000-0000-7000-8000-0000000000a0',
        'image', digest('logo-bytes', 'sha256'), 2048, 'image/png', 'acme/logo.png');

SELECT pg_temp.expect_violation('identical bytes are stored once per tenant', $$
  INSERT INTO assets (organization_id, kind, sha256, byte_size, mime_type, storage_key)
  VALUES ('00000000-0000-7000-8000-0000000000a0', 'image', digest('logo-bytes','sha256'),
          2048, 'image/png', 'acme/logo-copy.png')
$$);

-- The same bytes in a different tenant are a different asset, on purpose.
INSERT INTO assets (organization_id, kind, sha256, byte_size, mime_type, storage_key)
VALUES ('00000000-0000-7000-8000-0000000000b0', 'image', digest('logo-bytes','sha256'),
        2048, 'image/png', 'globex/logo.png');

SELECT pg_temp.expect('dedupe is per tenant, not global',
  (SELECT count(*) FROM assets WHERE sha256 = digest('logo-bytes','sha256')) = 2);

INSERT INTO images (asset_id, width, height) VALUES ('00000000-0000-7000-8000-0000000000a3', 1080, 1350);

SELECT pg_temp.expect('aspect_ratio is generated',
  (SELECT round(aspect_ratio, 3) FROM images WHERE asset_id = '00000000-0000-7000-8000-0000000000a3') = 0.800);

SELECT pg_temp.expect_violation('AI images must record their provenance', $$
  INSERT INTO images (asset_id, width, height, source)
  SELECT id, 100, 100, 'ai_generated' FROM assets WHERE storage_key = 'globex/logo.png'
$$);

INSERT INTO project_assets (project_id, asset_id)
VALUES ('00000000-0000-7000-8000-0000000000a2', '00000000-0000-7000-8000-0000000000a3');

SELECT pg_temp.expect_violation('an asset in use cannot be deleted', $$
  DELETE FROM assets WHERE id = '00000000-0000-7000-8000-0000000000a3'
$$);

-- ---------------------------------------------------------------------------
-- Exports: a successful job must have produced something
-- ---------------------------------------------------------------------------

SELECT pg_temp.expect_violation('successful export must have an artifact', $$
  INSERT INTO exports (organization_id, project_id, status, completed_at)
  VALUES ('00000000-0000-7000-8000-0000000000a0','00000000-0000-7000-8000-0000000000a2',
          'succeeded', now())
$$);

SELECT pg_temp.expect_violation('failed export must say why', $$
  INSERT INTO exports (organization_id, project_id, status)
  VALUES ('00000000-0000-7000-8000-0000000000a0','00000000-0000-7000-8000-0000000000a2','failed')
$$);

-- ---------------------------------------------------------------------------
-- AI: usage rolls up, transcripts are immutable
-- ---------------------------------------------------------------------------

INSERT INTO ai_conversations (id, organization_id, project_id, model)
VALUES ('00000000-0000-7000-8000-0000000000a4','00000000-0000-7000-8000-0000000000a0',
        '00000000-0000-7000-8000-0000000000a2','claude-opus-5');

INSERT INTO ai_messages (conversation_id, position, role, content, input_tokens)
VALUES ('00000000-0000-7000-8000-0000000000a4', 0, 'user', '[{"type":"text","text":"hi"}]', 12);
INSERT INTO ai_messages (conversation_id, position, role, content, output_tokens, cost_micros)
VALUES ('00000000-0000-7000-8000-0000000000a4', 1, 'assistant', '[{"type":"text","text":"ok"}]', 40, 2500);

SELECT pg_temp.expect('conversation usage rolls up',
  (SELECT input_tokens = 12 AND output_tokens = 40 AND cost_micros = 2500 AND message_count = 2
     FROM ai_conversations WHERE id = '00000000-0000-7000-8000-0000000000a4'));

SELECT pg_temp.expect_violation('only assistant turns carry output tokens', $$
  INSERT INTO ai_messages (conversation_id, position, role, content, output_tokens)
  VALUES ('00000000-0000-7000-8000-0000000000a4', 2, 'user', '[]', 10)
$$);

SELECT pg_temp.expect_violation('a succeeded generation must have output', $$
  INSERT INTO ai_generations (organization_id, purpose, status, model, completed_at)
  VALUES ('00000000-0000-7000-8000-0000000000a0','deck_generation','succeeded','claude-opus-5', now())
$$);

-- ---------------------------------------------------------------------------
-- Version history
-- ---------------------------------------------------------------------------

INSERT INTO project_versions (project_id, version_number, snapshot)
VALUES ('00000000-0000-7000-8000-0000000000a2', 1, '{"title":"v1","slides":[]}');

SELECT pg_temp.expect('current_version follows the latest snapshot',
  (SELECT current_version FROM projects WHERE id = '00000000-0000-7000-8000-0000000000a2') = 1);

SELECT pg_temp.expect_violation('version numbers are unique per project', $$
  INSERT INTO project_versions (project_id, version_number, snapshot)
  VALUES ('00000000-0000-7000-8000-0000000000a2', 1, '{"slides":[]}')
$$);

SELECT pg_temp.expect_violation('snapshots are immutable to the application', $$
  UPDATE project_versions SET label = 'tampered'
   WHERE project_id = '00000000-0000-7000-8000-0000000000a2'
$$);

-- ---------------------------------------------------------------------------
-- Analytics partitioning
-- ---------------------------------------------------------------------------

INSERT INTO analytics_events (organization_id, event_name, occurred_at)
VALUES ('00000000-0000-7000-8000-0000000000a0', 'project.opened', now());

SELECT pg_temp.expect('events route to the current month partition',
  (SELECT tableoid::regclass::text FROM analytics_events LIMIT 1)
    = 'analytics_events_' || to_char(now(), 'YYYYMM'));

SELECT pg_temp.expect_violation('malformed event names are rejected', $$
  INSERT INTO analytics_events (event_name) VALUES ('Project Opened!')
$$);

-- ---------------------------------------------------------------------------
-- Row-level security — the whole point of 0009
-- ---------------------------------------------------------------------------

-- A public template must stay visible to every tenant.
INSERT INTO templates (slug, name, document, is_public)
VALUES ('bold-five', 'Bold Five', '{"slides":[]}', true);

SET ROLE carousel_app;
SET app.user_id         = '00000000-0000-7000-8000-0000000000a1';
SET app.organization_id = '00000000-0000-7000-8000-0000000000a0';

SELECT pg_temp.expect('tenant sees only its own projects',
  (SELECT count(*) FROM projects) = 1);

SELECT pg_temp.expect('tenant sees its own project, not the other one',
  (SELECT title FROM projects) = 'Acme pricing carousel');

SELECT pg_temp.expect('slides inherit the project policy',
  (SELECT count(*) FROM slides) = 3);

SELECT pg_temp.expect('the system template gallery is visible to tenants',
  (SELECT count(*) FROM templates WHERE organization_id IS NULL) = 1);

SELECT pg_temp.expect('another tenant''s ledger is invisible',
  (SELECT count(*) FROM credit_ledger
    WHERE organization_id = '00000000-0000-7000-8000-0000000000b0') = 0);

-- Claiming to be in an organization you are not a member of gets you nothing:
-- tenant_visible checks membership, not just the session variable.
SET app.organization_id = '00000000-0000-7000-8000-0000000000b0';
SELECT pg_temp.expect('forged tenant context returns no rows',
  (SELECT count(*) FROM projects) = 0);

SET app.organization_id = '00000000-0000-7000-8000-0000000000a0';
SELECT pg_temp.expect_violation('cannot write a row into another tenant', $$
  INSERT INTO projects (organization_id, title)
  VALUES ('00000000-0000-7000-8000-0000000000b0', 'smuggled')
$$);

-- A project created from a system template still bumps that template's counter,
-- which only works because the trigger is SECURITY DEFINER.
INSERT INTO projects (organization_id, title, template_id)
SELECT '00000000-0000-7000-8000-0000000000a0', 'From template', id
  FROM templates WHERE slug = 'bold-five';

RESET ROLE;
SELECT pg_temp.expect('system template usage_count increments under RLS',
  (SELECT usage_count FROM templates WHERE slug = 'bold-five') = 1);

-- The service role bypasses tenant policies for background jobs.
SET ROLE carousel_app;
SET app.service_role = 'on';
SELECT pg_temp.expect('service role sees every tenant',
  (SELECT count(*) FROM projects) = 3);
RESET ROLE;
RESET app.service_role;

DO $$ BEGIN RAISE NOTICE 'ALL SMOKE ASSERTIONS PASSED'; END $$;
