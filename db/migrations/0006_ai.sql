-- 0006_ai.sql
-- Conversations, messages, and billable generations.
--
-- Three tables because they answer three different questions:
--   ai_conversations  what the user was working on (a thread they can reopen)
--   ai_messages       the exact transcript sent to and returned by the model
--   ai_generations    one billable unit of work, the join point to credits
--
-- Cost is stored in micros — millionths of a currency unit — because per-token
-- prices are fractions of a cent and rounding to cents per call would lose real
-- money at volume.

BEGIN;

CREATE TYPE ai_purpose AS ENUM (
  'deck_generation', 'slide_rewrite', 'caption', 'hashtags',
  'image_prompt', 'image_generation', 'chat'
);
CREATE TYPE ai_role   AS ENUM ('system', 'user', 'assistant', 'tool');
CREATE TYPE ai_status AS ENUM ('pending', 'running', 'succeeded', 'failed', 'refused', 'canceled');

-- ---------------------------------------------------------------------------
-- ai_conversations
-- ---------------------------------------------------------------------------

CREATE TABLE ai_conversations (
  id                   uuid        PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  organization_id      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- A thread can outlive the project it produced, so this is SET NULL and the
  -- conversation stays attached to the organization for audit and billing.
  project_id           uuid        REFERENCES projects(id) ON DELETE SET NULL,
  user_id              uuid        REFERENCES users(id) ON DELETE SET NULL,
  purpose              ai_purpose  NOT NULL DEFAULT 'deck_generation',
  title                text,
  model                text        NOT NULL,
  system_prompt_version text,

  -- Rolling totals, maintained by trigger on ai_messages. Usage dashboards and
  -- per-thread cost read these instead of aggregating the transcript.
  message_count        integer     NOT NULL DEFAULT 0,
  input_tokens         bigint      NOT NULL DEFAULT 0,
  output_tokens        bigint      NOT NULL DEFAULT 0,
  cost_micros          bigint      NOT NULL DEFAULT 0,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,

  CONSTRAINT ai_conversations_totals_non_negative CHECK (
    message_count >= 0 AND input_tokens >= 0 AND output_tokens >= 0 AND cost_micros >= 0
  )
);

CREATE INDEX ai_conversations_org_idx
  ON ai_conversations (organization_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ai_conversations_project_idx
  ON ai_conversations (project_id, created_at DESC) WHERE project_id IS NOT NULL;
CREATE INDEX ai_conversations_user_idx ON ai_conversations (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- ai_messages
-- ---------------------------------------------------------------------------

CREATE TABLE ai_messages (
  id                 uuid        PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  conversation_id    uuid        NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  position           integer     NOT NULL,
  role               ai_role     NOT NULL,
  -- Content blocks as sent to / received from the API: text, image, tool_use,
  -- tool_result, thinking. Stored as the provider shape rather than flattened to
  -- a string so a transcript can be replayed exactly.
  content            jsonb       NOT NULL,
  stop_reason        text,

  input_tokens       integer     NOT NULL DEFAULT 0,
  output_tokens      integer     NOT NULL DEFAULT 0,
  cache_read_tokens  integer     NOT NULL DEFAULT 0,
  cache_write_tokens integer     NOT NULL DEFAULT 0,
  cost_micros        bigint      NOT NULL DEFAULT 0,
  latency_ms         integer,
  -- Provider-side id, for correlating a support ticket with the vendor's logs.
  provider_request_id text,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_messages_content_array CHECK (jsonb_typeof(content) = 'array'),
  CONSTRAINT ai_messages_tokens_non_negative CHECK (
    input_tokens >= 0 AND output_tokens >= 0
    AND cache_read_tokens >= 0 AND cache_write_tokens >= 0 AND cost_micros >= 0
  ),
  CONSTRAINT ai_messages_latency_non_negative CHECK (latency_ms IS NULL OR latency_ms >= 0),
  -- Only assistant turns come back from the model, so only they carry output.
  CONSTRAINT ai_messages_output_on_assistant CHECK (
    role = 'assistant' OR output_tokens = 0
  ),
  CONSTRAINT ai_messages_position_key UNIQUE (conversation_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX ai_messages_thread_idx ON ai_messages (conversation_id, position);
CREATE INDEX ai_messages_provider_idx
  ON ai_messages (provider_request_id) WHERE provider_request_id IS NOT NULL;

CREATE TRIGGER trg_ai_messages_append_only
  BEFORE UPDATE OR DELETE ON ai_messages
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation_unless_service();

CREATE OR REPLACE FUNCTION app.roll_up_conversation_usage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ai_conversations c
     SET message_count  = c.message_count + 1,
         input_tokens   = c.input_tokens  + NEW.input_tokens + NEW.cache_read_tokens,
         output_tokens  = c.output_tokens + NEW.output_tokens,
         cost_micros    = c.cost_micros   + NEW.cost_micros,
         updated_at     = now()
   WHERE c.id = NEW.conversation_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_ai_messages_rollup
  AFTER INSERT ON ai_messages
  FOR EACH ROW EXECUTE FUNCTION app.roll_up_conversation_usage();

-- ---------------------------------------------------------------------------
-- ai_generations — the billable unit
-- ---------------------------------------------------------------------------

CREATE TABLE ai_generations (
  id              uuid        PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id uuid        REFERENCES ai_conversations(id) ON DELETE SET NULL,
  project_id      uuid        REFERENCES projects(id) ON DELETE SET NULL,
  user_id         uuid        REFERENCES users(id) ON DELETE SET NULL,
  purpose         ai_purpose  NOT NULL,
  status          ai_status   NOT NULL DEFAULT 'pending',
  model           text        NOT NULL,

  -- The brief, source text reference, asset ids, slide count, tone.
  input           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- The structured deck the model returned, before layout.
  output          jsonb,
  error_code      text,
  error_message   text,

  credits_charged integer     NOT NULL DEFAULT 0,
  cost_micros     bigint      NOT NULL DEFAULT 0,
  -- Deduplicates retries of the same user action across a flaky network.
  idempotency_key text,

  started_at      timestamptz,
  completed_at    timestamptz,
  duration_ms     integer GENERATED ALWAYS AS (
    CASE WHEN started_at IS NOT NULL AND completed_at IS NOT NULL
         THEN (extract(epoch FROM (completed_at - started_at)) * 1000)::integer END
  ) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_generations_input_obj  CHECK (jsonb_typeof(input) = 'object'),
  CONSTRAINT ai_generations_credits_non_negative CHECK (credits_charged >= 0 AND cost_micros >= 0),
  CONSTRAINT ai_generations_timing_order CHECK (
    started_at IS NULL OR completed_at IS NULL OR completed_at >= started_at
  ),
  CONSTRAINT ai_generations_terminal_shape CHECK (
    status NOT IN ('succeeded', 'failed', 'refused', 'canceled') OR completed_at IS NOT NULL
  ),
  CONSTRAINT ai_generations_success_has_output CHECK (
    status <> 'succeeded' OR output IS NOT NULL
  ),
  CONSTRAINT ai_generations_failure_has_reason CHECK (
    status NOT IN ('failed', 'refused') OR error_code IS NOT NULL
  )
);

CREATE UNIQUE INDEX ai_generations_idempotency_key
  ON ai_generations (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX ai_generations_org_idx ON ai_generations (organization_id, created_at DESC);
CREATE INDEX ai_generations_project_idx
  ON ai_generations (project_id, created_at DESC) WHERE project_id IS NOT NULL;
-- Watchdog for calls that started and never finished.
CREATE INDEX ai_generations_inflight_idx
  ON ai_generations (started_at)
  WHERE status IN ('pending', 'running');
-- Usage analytics: cost by model over time.
CREATE INDEX ai_generations_model_idx ON ai_generations (model, created_at DESC);

-- The FK deferred out of 0004, now that ai_generations exists.
ALTER TABLE images
  ADD CONSTRAINT images_ai_generation_fk
  FOREIGN KEY (ai_generation_id) REFERENCES ai_generations(id) ON DELETE SET NULL;

SELECT app.sync_touch_triggers();

COMMIT;
