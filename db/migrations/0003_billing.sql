-- 0003_billing.sql
-- Plans, subscriptions, invoices, payments, and the AI credit ledger.
--
-- Two principles run through this file:
--   1. Money is integer minor units plus an explicit currency. No floats, ever.
--   2. Anything that records what happened (payments, credit movements) is
--      append-only. Corrections are compensating rows, so the history a finance
--      team or a chargeback dispute needs is never overwritten.
--
-- The provider is Stripe-shaped but nothing here is Stripe-specific beyond the
-- external id columns; every one of them is nullable so a second processor or a
-- manually-invoiced enterprise account can coexist.

BEGIN;

CREATE TYPE plan_tier           AS ENUM ('free', 'starter', 'pro', 'business', 'enterprise');
CREATE TYPE billing_interval    AS ENUM ('month', 'year');
CREATE TYPE subscription_status AS ENUM (
  'trialing', 'active', 'past_due', 'canceled',
  'incomplete', 'incomplete_expired', 'unpaid', 'paused'
);
CREATE TYPE invoice_status AS ENUM ('draft', 'open', 'paid', 'void', 'uncollectible');
CREATE TYPE payment_status AS ENUM ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded');
CREATE TYPE credit_event   AS ENUM (
  'grant_subscription', 'grant_topup', 'grant_promo', 'grant_trial',
  'spend_generation', 'spend_export', 'spend_image',
  'refund', 'expiry', 'adjustment'
);

-- ---------------------------------------------------------------------------
-- plans — the price book
-- ---------------------------------------------------------------------------

CREATE TABLE plans (
  id                     uuid             PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  code                   app.slug         NOT NULL,
  name                   text             NOT NULL,
  tier                   plan_tier        NOT NULL,
  price_cents            integer          NOT NULL,
  currency               app.currency     NOT NULL DEFAULT 'USD',
  interval               billing_interval NOT NULL DEFAULT 'month',
  trial_days             smallint         NOT NULL DEFAULT 0,

  -- Entitlements. NULL means unlimited; 0 means the feature is off.
  ai_credits_per_period  integer          NOT NULL DEFAULT 0,
  seats_included         smallint         NOT NULL DEFAULT 1,
  max_projects           integer,
  max_storage_bytes      bigint,
  features               jsonb            NOT NULL DEFAULT '{}'::jsonb,

  is_active              boolean          NOT NULL DEFAULT true,
  stripe_price_id        text,
  created_at             timestamptz      NOT NULL DEFAULT now(),
  updated_at             timestamptz      NOT NULL DEFAULT now(),

  CONSTRAINT plans_price_non_negative   CHECK (price_cents >= 0),
  CONSTRAINT plans_credits_non_negative CHECK (ai_credits_per_period >= 0),
  CONSTRAINT plans_seats_positive       CHECK (seats_included > 0),
  CONSTRAINT plans_limits_non_negative  CHECK (
    (max_projects     IS NULL OR max_projects     >= 0) AND
    (max_storage_bytes IS NULL OR max_storage_bytes >= 0)
  ),
  CONSTRAINT plans_trial_sane           CHECK (trial_days BETWEEN 0 AND 90),
  CONSTRAINT plans_features_obj         CHECK (jsonb_typeof(features) = 'object')
);

-- Prices are versioned by creating a new row, so the code is unique only among
-- the plans still on sale. Old rows stay referenced by existing subscriptions.
CREATE UNIQUE INDEX plans_code_active_key ON plans (code) WHERE is_active;
CREATE UNIQUE INDEX plans_stripe_price_key ON plans (stripe_price_id) WHERE stripe_price_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------

CREATE TABLE subscriptions (
  id                     uuid                PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  organization_id        uuid                NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id                uuid                NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status                 subscription_status NOT NULL,
  seats                  smallint            NOT NULL DEFAULT 1,

  current_period_start   timestamptz         NOT NULL,
  current_period_end     timestamptz         NOT NULL,
  trial_end              timestamptz,
  cancel_at_period_end   boolean             NOT NULL DEFAULT false,
  canceled_at            timestamptz,
  ended_at               timestamptz,

  stripe_customer_id     text,
  stripe_subscription_id text,
  created_at             timestamptz         NOT NULL DEFAULT now(),
  updated_at             timestamptz         NOT NULL DEFAULT now(),

  CONSTRAINT subscriptions_period_order   CHECK (current_period_end > current_period_start),
  CONSTRAINT subscriptions_seats_positive CHECK (seats > 0),
  CONSTRAINT subscriptions_canceled_shape CHECK (
    (status = 'canceled') <= (canceled_at IS NOT NULL)
  ),
  CONSTRAINT subscriptions_trial_shape CHECK (
    status <> 'trialing' OR trial_end IS NOT NULL
  )
);

CREATE UNIQUE INDEX subscriptions_stripe_key
  ON subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- An organization may have a history of subscriptions but only one live at a
-- time. Enforced here so a double webhook cannot create a second billing
-- relationship and silently double-charge.
CREATE UNIQUE INDEX subscriptions_one_live_per_org
  ON subscriptions (organization_id)
  WHERE status IN ('trialing', 'active', 'past_due', 'unpaid', 'paused');

CREATE INDEX subscriptions_org_idx ON subscriptions (organization_id, created_at DESC);

-- Drives the renewal and dunning jobs.
CREATE INDEX subscriptions_renewal_idx
  ON subscriptions (current_period_end)
  WHERE status IN ('trialing', 'active', 'past_due');

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------

CREATE TABLE invoices (
  id                 uuid           PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  organization_id    uuid           NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  subscription_id    uuid           REFERENCES subscriptions(id) ON DELETE SET NULL,
  number             text           NOT NULL,
  status             invoice_status NOT NULL DEFAULT 'draft',
  currency           app.currency   NOT NULL DEFAULT 'USD',
  subtotal_cents     integer        NOT NULL DEFAULT 0,
  discount_cents     integer        NOT NULL DEFAULT 0,
  tax_cents          integer        NOT NULL DEFAULT 0,
  total_cents        integer        NOT NULL DEFAULT 0,
  amount_paid_cents  integer        NOT NULL DEFAULT 0,
  period_start       timestamptz,
  period_end         timestamptz,
  due_at             timestamptz,
  paid_at            timestamptz,
  hosted_url         text,
  pdf_url            text,
  line_items         jsonb          NOT NULL DEFAULT '[]'::jsonb,
  stripe_invoice_id  text,
  created_at         timestamptz    NOT NULL DEFAULT now(),
  updated_at         timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT invoices_amounts_non_negative CHECK (
    subtotal_cents >= 0 AND discount_cents >= 0 AND tax_cents >= 0
    AND total_cents >= 0 AND amount_paid_cents >= 0
  ),
  CONSTRAINT invoices_total_math CHECK (
    total_cents = subtotal_cents - discount_cents + tax_cents
  ),
  CONSTRAINT invoices_paid_shape CHECK (
    (status = 'paid') = (paid_at IS NOT NULL AND amount_paid_cents >= total_cents)
  ),
  CONSTRAINT invoices_period_order CHECK (
    period_start IS NULL OR period_end IS NULL OR period_end > period_start
  ),
  CONSTRAINT invoices_line_items_array CHECK (jsonb_typeof(line_items) = 'array')
);

CREATE UNIQUE INDEX invoices_number_key ON invoices (number);
CREATE UNIQUE INDEX invoices_stripe_key ON invoices (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
CREATE INDEX invoices_org_idx ON invoices (organization_id, created_at DESC);
CREATE INDEX invoices_collections_idx ON invoices (due_at) WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- payments — append-only
-- ---------------------------------------------------------------------------

CREATE TABLE payments (
  id                       uuid           PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  organization_id          uuid           NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_id               uuid           REFERENCES invoices(id) ON DELETE SET NULL,
  amount_cents             integer        NOT NULL,
  refunded_cents           integer        NOT NULL DEFAULT 0,
  currency                 app.currency   NOT NULL DEFAULT 'USD',
  status                   payment_status NOT NULL DEFAULT 'pending',
  method                   text,          -- 'card', 'sepa_debit', 'invoice', ...
  card_brand               text,
  card_last4               char(4),
  failure_code             text,
  failure_message          text,
  -- The webhook or retry key. Unique, so a redelivered provider event or a
  -- double-clicked checkout cannot insert a second charge.
  idempotency_key          text           NOT NULL,
  stripe_payment_intent_id text,
  processed_at             timestamptz,
  created_at               timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT payments_amount_positive   CHECK (amount_cents > 0),
  CONSTRAINT payments_refund_bounded    CHECK (refunded_cents BETWEEN 0 AND amount_cents),
  CONSTRAINT payments_card_last4_digits CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  CONSTRAINT payments_failure_shape     CHECK (
    (status = 'failed') <= (failure_code IS NOT NULL)
  ),
  CONSTRAINT payments_settled_shape     CHECK (
    status NOT IN ('succeeded', 'refunded', 'partially_refunded') OR processed_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX payments_idempotency_key ON payments (idempotency_key);
CREATE UNIQUE INDEX payments_stripe_key
  ON payments (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX payments_org_idx     ON payments (organization_id, created_at DESC);
CREATE INDEX payments_invoice_idx ON payments (invoice_id) WHERE invoice_id IS NOT NULL;

CREATE TRIGGER trg_payments_append_only
  BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- AI credits: an append-only ledger plus a trigger-maintained balance
-- ---------------------------------------------------------------------------
--
-- Generation and export both cost real money per call, so metering has to be
-- exact under concurrency. Summing the ledger on every request would be correct
-- but gets slower forever; caching a balance in a column would be fast but
-- drifts. Doing both — ledger as the truth, balance as a derived cache written
-- by the same transaction — keeps reads O(1) and makes drift structurally
-- impossible, because only the trigger can write the balance.

CREATE TABLE credit_ledger (
  id              uuid         PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  organization_id uuid         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Positive grants, negative spends. Never zero: a no-op has nothing to record.
  delta           integer      NOT NULL,
  event           credit_event NOT NULL,
  -- What caused it. Loose references (no FK) because the ledger outlives the
  -- projects and generations it refers to; deleting a project must not rewrite
  -- billing history.
  reference_type  text,
  reference_id    uuid,
  -- Grants can expire at period end; spends never do.
  expires_at      timestamptz,
  idempotency_key text,
  note            text,
  created_by      uuid         REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT credit_ledger_delta_non_zero CHECK (delta <> 0),
  CONSTRAINT credit_ledger_grant_sign CHECK (
    (event::text LIKE 'grant%' AND delta > 0) OR
    (event::text LIKE 'spend%' AND delta < 0) OR
    (event IN ('refund', 'expiry', 'adjustment'))
  ),
  CONSTRAINT credit_ledger_expiry_on_grants CHECK (
    expires_at IS NULL OR delta > 0
  )
);

CREATE UNIQUE INDEX credit_ledger_idempotency_key
  ON credit_ledger (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX credit_ledger_org_time_idx ON credit_ledger (organization_id, created_at DESC);
CREATE INDEX credit_ledger_reference_idx
  ON credit_ledger (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;
CREATE INDEX credit_ledger_expiry_idx
  ON credit_ledger (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TRIGGER trg_credit_ledger_append_only
  BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

CREATE TABLE credit_balances (
  organization_id uuid        PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  balance         integer     NOT NULL DEFAULT 0,
  lifetime_spent  bigint      NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- The overdraft guard. A spend that would go below zero aborts the whole
  -- transaction, which means the AI call it was paying for never happens.
  CONSTRAINT credit_balances_non_negative CHECK (balance >= 0)
);

CREATE OR REPLACE FUNCTION app.apply_credit_delta()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Two statements rather than one upsert carrying the delta. `INSERT ... ON
  -- CONFLICT DO UPDATE` validates CHECK constraints against the *proposed* tuple
  -- before it resolves the conflict, so a spend of -120 against a balance of 500
  -- would be rejected for proposing a row of -120 — the balance it would have
  -- produced never gets evaluated. Seeding at zero and then updating puts the
  -- check where it belongs: on the resulting balance.
  INSERT INTO credit_balances (organization_id, balance)
  VALUES (NEW.organization_id, 0)
  ON CONFLICT (organization_id) DO NOTHING;

  UPDATE credit_balances
     SET balance        = balance + NEW.delta,
         lifetime_spent = lifetime_spent + GREATEST(-NEW.delta, 0),
         updated_at     = now()
   WHERE organization_id = NEW.organization_id;

  RETURN NEW;
END;
$$;

-- The UPDATE takes a row lock on the balance, so concurrent spends for one
-- organization serialize on that row and cannot both pass the check.
CREATE TRIGGER trg_credit_ledger_balance
  AFTER INSERT ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION app.apply_credit_delta();

SELECT app.sync_touch_triggers();

COMMIT;
