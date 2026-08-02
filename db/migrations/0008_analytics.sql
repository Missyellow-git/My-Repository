-- 0008_analytics.sql
-- Event capture and rollups.
--
-- analytics_events is the only table here expected to reach nine figures, and it
-- is shaped for that rather than for elegance:
--
--   * Range-partitioned by month. Dropping a partition retires a month of data
--     in milliseconds; DELETE on a table that size would run for hours and leave
--     the heap bloated.
--   * No foreign keys. Every FK is an index probe on every insert, on the
--     highest-volume write path in the system, to protect a column nothing joins
--     on transactionally. Referential drift is reconciled by the rollup job.
--   * BRIN on the timestamp. Inserts are append-only and time-ordered, so a BRIN
--     index gives range-scan pruning for a few dozen kilobytes where a btree
--     would cost gigabytes.
--
-- Dashboards read the rollup tables, never the event table.

BEGIN;

CREATE TABLE analytics_events (
  id              uuid        NOT NULL DEFAULT app.uuid_generate_v7(),
  occurred_at     timestamptz NOT NULL DEFAULT now(),

  -- Denormalized tenant/actor keys; no FK, by design (see header).
  organization_id uuid,
  user_id         uuid,
  project_id      uuid,

  event_name      text        NOT NULL,
  properties      jsonb       NOT NULL DEFAULT '{}'::jsonb,

  session_id      uuid,
  ip              inet,
  user_agent      text,
  country         char(2),
  referrer        text,

  CONSTRAINT analytics_events_name_shape CHECK (event_name ~ '^[a-z][a-z0-9_.]{2,63}$'),
  CONSTRAINT analytics_events_props_obj  CHECK (jsonb_typeof(properties) = 'object'),
  CONSTRAINT analytics_events_country_shape CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),

  -- The partition key has to be in the primary key.
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

-- Defined on the parent, so every partition inherits them.
CREATE INDEX analytics_events_org_time_idx   ON analytics_events (organization_id, occurred_at DESC);
CREATE INDEX analytics_events_name_time_idx  ON analytics_events (event_name, occurred_at DESC);
CREATE INDEX analytics_events_project_idx    ON analytics_events (project_id, occurred_at DESC);
CREATE INDEX analytics_events_props_gin      ON analytics_events USING gin (properties jsonb_path_ops);
CREATE INDEX analytics_events_time_brin      ON analytics_events USING brin (occurred_at)
  WITH (pages_per_range = 32);

-- ---------------------------------------------------------------------------
-- Partition management
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.ensure_analytics_partition(target date)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  from_ts date := date_trunc('month', target)::date;
  to_ts   date := (date_trunc('month', target) + interval '1 month')::date;
  part    text := format('analytics_events_%s', to_char(from_ts, 'YYYYMM'));
BEGIN
  IF to_regclass(format('public.%I', part)) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.analytics_events
         FOR VALUES FROM (%L) TO (%L)', part, from_ts, to_ts);
  END IF;
  RETURN part;
END;
$$;

-- Runs monthly from cron, keeping three months of headroom so an insert never
-- races partition creation.
CREATE OR REPLACE FUNCTION app.maintain_analytics_partitions(months_ahead integer DEFAULT 3)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  offset_months integer;
BEGIN
  FOR offset_months IN 0..months_ahead LOOP
    PERFORM app.ensure_analytics_partition((current_date + (offset_months || ' months')::interval)::date);
  END LOOP;
END;
$$;

SELECT app.maintain_analytics_partitions(3);
SELECT app.ensure_analytics_partition((current_date - interval '1 month')::date);

-- Safety net for a clock skew or a backfill outside the provisioned window.
-- Kept small on purpose: rows landing here are a monitoring alert, because
-- attaching a new partition has to scan the default to prove no row belongs in it.
CREATE TABLE analytics_events_default PARTITION OF analytics_events DEFAULT;

-- ---------------------------------------------------------------------------
-- Rollups — what dashboards actually query
-- ---------------------------------------------------------------------------

CREATE TABLE daily_project_stats (
  project_id      uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  day             date        NOT NULL,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  views           integer     NOT NULL DEFAULT 0,
  edits           integer     NOT NULL DEFAULT 0,
  exports         integer     NOT NULL DEFAULT 0,
  ai_generations  integer     NOT NULL DEFAULT 0,
  unique_editors  integer     NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (project_id, day),
  CONSTRAINT daily_project_stats_non_negative CHECK (
    views >= 0 AND edits >= 0 AND exports >= 0
    AND ai_generations >= 0 AND unique_editors >= 0
  )
);

CREATE INDEX daily_project_stats_org_day_idx ON daily_project_stats (organization_id, day DESC);

CREATE TABLE organization_usage_daily (
  organization_id  uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  day              date        NOT NULL,
  ai_credits_spent integer     NOT NULL DEFAULT 0,
  ai_cost_micros   bigint      NOT NULL DEFAULT 0,
  generations      integer     NOT NULL DEFAULT 0,
  exports          integer     NOT NULL DEFAULT 0,
  projects_created integer     NOT NULL DEFAULT 0,
  active_users     integer     NOT NULL DEFAULT 0,
  storage_bytes    bigint      NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (organization_id, day),
  CONSTRAINT organization_usage_daily_non_negative CHECK (
    ai_credits_spent >= 0 AND ai_cost_micros >= 0 AND generations >= 0
    AND exports >= 0 AND projects_created >= 0 AND active_users >= 0 AND storage_bytes >= 0
  )
);

CREATE INDEX organization_usage_daily_day_idx ON organization_usage_daily (day DESC);

-- Idempotent upsert, so the rollup job can be re-run for a day after a fix
-- without double counting.
CREATE OR REPLACE FUNCTION app.roll_up_usage_for_day(target date)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  touched integer;
BEGIN
  INSERT INTO organization_usage_daily AS u (
    organization_id, day, ai_credits_spent, ai_cost_micros, generations, exports, projects_created
  )
  SELECT org_id, target,
         coalesce(sum(credits), 0), coalesce(sum(cost), 0),
         coalesce(sum(gens), 0), coalesce(sum(exps), 0), coalesce(sum(projs), 0)
    FROM (
      SELECT organization_id AS org_id, credits_charged AS credits, cost_micros AS cost,
             1 AS gens, 0 AS exps, 0 AS projs
        FROM ai_generations
       WHERE created_at >= target AND created_at < target + 1
         AND status = 'succeeded'
      UNION ALL
      SELECT organization_id, 0, 0, 0, 1, 0
        FROM exports
       WHERE created_at >= target AND created_at < target + 1
         AND status = 'succeeded'
      UNION ALL
      SELECT organization_id, 0, 0, 0, 0, 1
        FROM projects
       WHERE created_at >= target AND created_at < target + 1
    ) source
   GROUP BY org_id
  ON CONFLICT (organization_id, day) DO UPDATE
    SET ai_credits_spent = EXCLUDED.ai_credits_spent,
        ai_cost_micros   = EXCLUDED.ai_cost_micros,
        generations      = EXCLUDED.generations,
        exports          = EXCLUDED.exports,
        projects_created = EXCLUDED.projects_created,
        updated_at       = now();

  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched;
END;
$$;

SELECT app.sync_touch_triggers();

COMMIT;
