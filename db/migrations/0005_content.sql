-- 0005_content.sql
-- Templates, projects (carousels), slides, collaborators, and version history.
--
-- The live document is normalized: one row per slide, ordered by `position`, with
-- the element tree in JSONB. Version history is the opposite — an immutable
-- whole-document snapshot per version. That split is deliberate. Editing needs
-- per-slide writes and per-slide locking; restoring needs one atomic object that
-- is guaranteed self-consistent, and that no later schema change can reinterpret.

BEGIN;

CREATE TYPE aspect_ratio   AS ENUM ('portrait_4_5', 'square_1_1', 'story_9_16', 'landscape_16_9');
CREATE TYPE project_status AS ENUM ('draft', 'in_progress', 'ready', 'published', 'archived');
CREATE TYPE project_role   AS ENUM ('owner', 'editor', 'commenter', 'viewer');

-- ---------------------------------------------------------------------------
-- templates
-- ---------------------------------------------------------------------------

CREATE TABLE templates (
  id                uuid         PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  organization_id   uuid         REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = system template
  slug              app.slug     NOT NULL,
  name              text         NOT NULL,
  description       text,
  category          text,
  aspect            aspect_ratio NOT NULL DEFAULT 'portrait_4_5',
  -- The deck skeleton: slides, roles, placeholder copy, element geometry.
  document          jsonb        NOT NULL,
  preview_asset_id  uuid         REFERENCES assets(id) ON DELETE SET NULL,
  is_public         boolean      NOT NULL DEFAULT false,
  is_featured       boolean      NOT NULL DEFAULT false,
  -- Denormalized counter, maintained by trigger on projects. The gallery sorts
  -- by it on every page load; counting projects per template would not scale.
  usage_count       bigint       NOT NULL DEFAULT 0,
  created_by        uuid         REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  search tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(category, ''))
  ) STORED,

  CONSTRAINT templates_document_obj    CHECK (jsonb_typeof(document) = 'object'),
  CONSTRAINT templates_has_slides      CHECK (jsonb_typeof(document -> 'slides') = 'array'),
  CONSTRAINT templates_usage_non_negative CHECK (usage_count >= 0),
  -- A system template is public by definition; a private one must have an owner.
  CONSTRAINT templates_visibility CHECK (organization_id IS NOT NULL OR is_public)
);

CREATE UNIQUE INDEX templates_slug_key
  ON templates (organization_id, slug) NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

CREATE INDEX templates_search_idx ON templates USING gin (search);
CREATE INDEX templates_gallery_idx
  ON templates (category, usage_count DESC)
  WHERE is_public AND deleted_at IS NULL;
CREATE INDEX templates_featured_idx
  ON templates (usage_count DESC)
  WHERE is_featured AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

CREATE TABLE projects (
  id               uuid           PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  organization_id  uuid           NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by       uuid           REFERENCES users(id) ON DELETE SET NULL,
  title            text           NOT NULL DEFAULT 'Untitled carousel',
  status           project_status NOT NULL DEFAULT 'draft',
  aspect           aspect_ratio   NOT NULL DEFAULT 'portrait_4_5',
  theme_id         text           NOT NULL DEFAULT 'punch',

  brand_kit_id     uuid           REFERENCES brand_kits(id) ON DELETE SET NULL,
  -- Provenance only: deleting a template must not delete the work made from it.
  template_id      uuid           REFERENCES templates(id) ON DELETE SET NULL,

  caption          text,
  hashtags         text[]         NOT NULL DEFAULT '{}',
  settings         jsonb          NOT NULL DEFAULT '{}'::jsonb,

  -- Denormalized for list views, maintained by triggers on slides and
  -- project_versions. The library screen renders these without touching either.
  slide_count      integer        NOT NULL DEFAULT 0,
  current_version  integer        NOT NULL DEFAULT 0,

  last_edited_at   timestamptz    NOT NULL DEFAULT now(),
  last_edited_by   uuid           REFERENCES users(id) ON DELETE SET NULL,
  published_at     timestamptz,
  created_at       timestamptz    NOT NULL DEFAULT now(),
  updated_at       timestamptz    NOT NULL DEFAULT now(),
  deleted_at       timestamptz,

  search tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(caption, ''))
  ) STORED,

  CONSTRAINT projects_title_len       CHECK (length(title) BETWEEN 1 AND 300),
  CONSTRAINT projects_counts_non_negative CHECK (slide_count >= 0 AND current_version >= 0),
  CONSTRAINT projects_hashtag_count   CHECK (cardinality(hashtags) <= 30),
  CONSTRAINT projects_settings_obj    CHECK (jsonb_typeof(settings) = 'object'),
  CONSTRAINT projects_published_shape CHECK ((status = 'published') <= (published_at IS NOT NULL))
);

-- The primary list query: this org's live projects, most recently edited first.
CREATE INDEX projects_org_recent_idx
  ON projects (organization_id, last_edited_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX projects_org_status_idx
  ON projects (organization_id, status, last_edited_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX projects_search_idx ON projects USING gin (search);
CREATE INDEX projects_hashtags_idx ON projects USING gin (hashtags);
CREATE INDEX projects_template_idx ON projects (template_id) WHERE template_id IS NOT NULL;
CREATE INDEX projects_brand_kit_idx ON projects (brand_kit_id) WHERE brand_kit_id IS NOT NULL;
CREATE INDEX projects_creator_idx ON projects (created_by, last_edited_at DESC);

-- Retention sweeper: purge soft-deleted projects after the grace period.
CREATE INDEX projects_deleted_idx ON projects (deleted_at) WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- slides
-- ---------------------------------------------------------------------------

CREATE TABLE slides (
  id         uuid        PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  project_id uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position   integer     NOT NULL,
  -- A CHECK rather than an enum: slide roles track the layout engine and change
  -- with the product. Widening a CHECK is one transactional statement; adding an
  -- enum value cannot be done in the same transaction that uses it.
  role       text        NOT NULL DEFAULT 'point',
  background jsonb       NOT NULL DEFAULT '{"type":"solid","color":"#0E0E10"}'::jsonb,
  elements   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT slides_role_known CHECK (role IN ('cover','point','list','quote','stat','cta')),
  CONSTRAINT slides_position_non_negative CHECK (position >= 0),
  CONSTRAINT slides_background_obj CHECK (jsonb_typeof(background) = 'object'),
  CONSTRAINT slides_elements_array CHECK (jsonb_typeof(elements) = 'array'),
  CONSTRAINT slides_element_budget CHECK (jsonb_array_length(elements) <= 200),

  -- DEFERRABLE so a reorder can shuffle positions inside one transaction without
  -- an interim gap or a temporary out-of-range value.
  CONSTRAINT slides_position_key UNIQUE (project_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX slides_project_order_idx ON slides (project_id, position);
-- Finds every slide referencing a given asset id inside the element tree.
CREATE INDEX slides_elements_gin ON slides USING gin (elements jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- project_assets — which files a project actually uses
-- ---------------------------------------------------------------------------
--
-- Derivable by scanning slides.elements, but "is this image safe to delete" runs
-- on every asset deletion and every storage sweep. A junction table turns that
-- from a JSONB scan across the tenant into one index lookup.

CREATE TABLE project_assets (
  project_id uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id   uuid        NOT NULL REFERENCES assets(id)   ON DELETE RESTRICT,
  usage      text        NOT NULL DEFAULT 'element',
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (project_id, asset_id, usage),
  CONSTRAINT project_assets_usage_known CHECK (usage IN ('element', 'background', 'logo', 'watermark'))
);

-- ON DELETE RESTRICT above plus this index is what makes the guard cheap:
-- deleting an asset checks for referencing projects with a single index probe.
CREATE INDEX project_assets_asset_idx ON project_assets (asset_id);

-- ---------------------------------------------------------------------------
-- project_collaborators — per-project access on top of org membership
-- ---------------------------------------------------------------------------

CREATE TABLE project_collaborators (
  project_id uuid         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       project_role NOT NULL DEFAULT 'editor',
  added_by   uuid         REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now(),

  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX project_collaborators_user_idx ON project_collaborators (user_id, project_id);

CREATE UNIQUE INDEX project_collaborators_single_owner
  ON project_collaborators (project_id)
  WHERE role = 'owner';

-- ---------------------------------------------------------------------------
-- project_versions — immutable snapshots
-- ---------------------------------------------------------------------------

CREATE TABLE project_versions (
  id             uuid        PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  project_id     uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number integer     NOT NULL,
  -- The whole deck at that moment: project fields plus an ordered slides array.
  -- Self-contained on purpose, so a restore never depends on rows that may since
  -- have been edited or deleted.
  snapshot       jsonb       NOT NULL,
  label          text,
  -- Autosaves are pruned on a retention schedule; labelled versions are kept.
  is_autosave    boolean     NOT NULL DEFAULT true,
  created_by     uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_versions_number_positive CHECK (version_number > 0),
  CONSTRAINT project_versions_snapshot_obj    CHECK (jsonb_typeof(snapshot) = 'object'),
  CONSTRAINT project_versions_has_slides      CHECK (jsonb_typeof(snapshot -> 'slides') = 'array'),
  CONSTRAINT project_versions_labelled_is_kept CHECK (NOT (is_autosave AND label IS NOT NULL)),
  CONSTRAINT project_versions_number_key UNIQUE (project_id, version_number)
);

CREATE INDEX project_versions_history_idx ON project_versions (project_id, version_number DESC);
CREATE INDEX project_versions_pruning_idx
  ON project_versions (project_id, created_at)
  WHERE is_autosave;

CREATE TRIGGER trg_project_versions_append_only
  BEFORE UPDATE OR DELETE ON project_versions
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- Restores and retention pruning run as the service role, which bypasses the
-- guard above via a session flag rather than by dropping the trigger.
CREATE OR REPLACE FUNCTION app.forbid_mutation_unless_service()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app.is_service_role() THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'Table %.% is append-only for application connections.',
    TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER trg_project_versions_append_only ON project_versions;
CREATE TRIGGER trg_project_versions_append_only
  BEFORE UPDATE OR DELETE ON project_versions
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation_unless_service();

-- ---------------------------------------------------------------------------
-- Denormalization triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.refresh_project_slide_count()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid := coalesce(NEW.project_id, OLD.project_id);
BEGIN
  UPDATE projects p
     SET slide_count    = (SELECT count(*) FROM slides s WHERE s.project_id = target),
         last_edited_at = now()
   WHERE p.id = target;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_slides_recount
  AFTER INSERT OR DELETE ON slides
  FOR EACH ROW EXECUTE FUNCTION app.refresh_project_slide_count();

-- SECURITY DEFINER: a project built from a *system* template must still bump that
-- template's counter, and row-level security would otherwise make the UPDATE
-- match zero rows — silently, since an UPDATE that filters everything out is not
-- an error. The function touches exactly one column on one row by primary key.
CREATE OR REPLACE FUNCTION app.bump_template_usage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.template_id IS NOT NULL THEN
    UPDATE templates SET usage_count = usage_count + 1 WHERE id = NEW.template_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_projects_template_usage
  AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION app.bump_template_usage();

CREATE OR REPLACE FUNCTION app.advance_project_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE projects SET current_version = NEW.version_number WHERE id = NEW.project_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_project_versions_advance
  AFTER INSERT ON project_versions
  FOR EACH ROW EXECUTE FUNCTION app.advance_project_version();

SELECT app.sync_touch_triggers();

COMMIT;
