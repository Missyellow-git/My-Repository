-- 0007_exports.sql
-- Render jobs: a project goes in, a downloadable archive comes out.
--
-- This doubles as the work queue. A dedicated queue system is the right answer
-- once throughput demands it, but rendering is already durable state the user
-- can see ("your export is processing"), so keeping the job and its result in
-- one row means status never disagrees with reality — and `FOR UPDATE SKIP
-- LOCKED` gives safe multi-worker claim semantics without a second system.

BEGIN;

CREATE TYPE export_format AS ENUM ('png_zip', 'jpg_zip', 'pdf', 'mp4');
CREATE TYPE export_status AS ENUM ('queued', 'processing', 'succeeded', 'failed', 'expired', 'canceled');

CREATE TABLE exports (
  id              uuid          PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  organization_id uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      uuid          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Snapshot the export was rendered from, so re-downloading an old archive
  -- shows what was exported rather than what the deck looks like today.
  version_id      uuid          REFERENCES project_versions(id) ON DELETE SET NULL,
  requested_by    uuid          REFERENCES users(id) ON DELETE SET NULL,

  format          export_format NOT NULL DEFAULT 'png_zip',
  status          export_status NOT NULL DEFAULT 'queued',
  -- { "scale": 2, "slides": [0,1,4], "watermark": false }
  options         jsonb         NOT NULL DEFAULT '{}'::jsonb,

  asset_id        uuid          REFERENCES assets(id) ON DELETE SET NULL,
  slide_count     integer,
  byte_size       bigint,

  attempts        smallint      NOT NULL DEFAULT 0,
  max_attempts    smallint      NOT NULL DEFAULT 3,
  error_code      text,
  error_message   text,

  -- Claim bookkeeping for the worker pool.
  locked_by       text,
  locked_at       timestamptz,
  queued_at       timestamptz   NOT NULL DEFAULT now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  -- Archives are large and mostly downloaded once; a sweeper drops the bytes
  -- after this and moves the row to `expired`.
  expires_at      timestamptz,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT exports_options_obj CHECK (jsonb_typeof(options) = 'object'),
  CONSTRAINT exports_attempts_bounded CHECK (attempts >= 0 AND attempts <= max_attempts),
  CONSTRAINT exports_counts_positive CHECK (
    (slide_count IS NULL OR slide_count > 0) AND (byte_size IS NULL OR byte_size > 0)
  ),
  -- A finished export must have produced something. Without this, a bug in the
  -- renderer can mark a job successful with nothing to download, and the user
  -- gets a broken link instead of an error.
  CONSTRAINT exports_success_has_asset CHECK (
    status <> 'succeeded' OR (asset_id IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT exports_failure_has_reason CHECK (
    status <> 'failed' OR error_code IS NOT NULL
  ),
  CONSTRAINT exports_timing_order CHECK (
    (started_at IS NULL OR started_at >= queued_at)
    AND (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
  ),
  CONSTRAINT exports_lock_shape CHECK ((locked_by IS NULL) = (locked_at IS NULL))
);

-- The claim query:
--   SELECT * FROM exports
--    WHERE status = 'queued' ORDER BY queued_at
--    FOR UPDATE SKIP LOCKED LIMIT 1;
-- Partial, so the index holds only the backlog rather than every export ever run
-- — it stays a few pages regardless of table size.
CREATE INDEX exports_queue_idx ON exports (queued_at) WHERE status = 'queued';

-- Reaper for workers that died mid-render.
CREATE INDEX exports_stalled_idx ON exports (locked_at) WHERE status = 'processing';

CREATE INDEX exports_project_idx ON exports (project_id, created_at DESC);
CREATE INDEX exports_org_idx     ON exports (organization_id, created_at DESC);
CREATE INDEX exports_expiry_idx  ON exports (expires_at) WHERE status = 'succeeded';

SELECT app.sync_touch_triggers();

COMMIT;
