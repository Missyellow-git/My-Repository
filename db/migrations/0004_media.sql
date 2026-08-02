-- 0004_media.sql
-- Assets, images, icons, and brand kits.
--
-- `assets` is the physical file: one row per stored blob, content-addressed by
-- SHA-256. `images` and `icons` are 1:1 and 1:0..1 specializations that carry the
-- metadata only that media type has. Splitting them this way keeps the columns
-- honest — an icon has no blurhash, a font has no alt text — while every kind of
-- file still has exactly one storage record, one size to meter, and one place to
-- delete from.

BEGIN;

CREATE TYPE storage_provider AS ENUM ('s3', 'r2', 'gcs', 'vercel_blob', 'local');
CREATE TYPE asset_kind       AS ENUM ('image', 'icon', 'font', 'video', 'export_archive', 'document', 'other');
CREATE TYPE image_source     AS ENUM ('upload', 'ai_generated', 'stock', 'screenshot');
CREATE TYPE icon_style       AS ENUM ('outline', 'solid', 'duotone', 'color');

-- ---------------------------------------------------------------------------
-- assets
-- ---------------------------------------------------------------------------

CREATE TABLE assets (
  id                 uuid             PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  -- NULL marks a system asset (stock icon sets, template previews) shared by
  -- every tenant. Row-level security in 0009 reads it as "visible to all".
  organization_id    uuid             REFERENCES organizations(id) ON DELETE CASCADE,
  kind               asset_kind       NOT NULL,
  sha256             bytea            NOT NULL,
  byte_size          bigint           NOT NULL,
  mime_type          text             NOT NULL,
  original_filename  text,

  storage_provider   storage_provider NOT NULL DEFAULT 's3',
  storage_key        text             NOT NULL,
  public_url         text,

  uploaded_by        uuid             REFERENCES users(id) ON DELETE SET NULL,
  -- Set when the row is no longer referenced; a sweeper deletes the bytes and
  -- then the row, so an orphaned blob is never invisible to the cleanup job.
  purge_after        timestamptz,
  created_at         timestamptz      NOT NULL DEFAULT now(),
  updated_at         timestamptz      NOT NULL DEFAULT now(),
  deleted_at         timestamptz,

  CONSTRAINT assets_sha256_len     CHECK (octet_length(sha256) = 32),
  CONSTRAINT assets_size_positive  CHECK (byte_size > 0),
  CONSTRAINT assets_mime_shape     CHECK (mime_type ~ '^[a-z]+/[a-zA-Z0-9.+_-]+$'),
  CONSTRAINT assets_storage_key_len CHECK (length(storage_key) BETWEEN 1 AND 1024)
);

-- Deduplication is per tenant, not global. Global dedupe would be cheaper but it
-- couples tenants: deleting your upload would have to check whether someone
-- else's account still points at the same bytes, and a GDPR erasure could not be
-- honoured without auditing every other organization. NULLS NOT DISTINCT so the
-- system library dedupes against itself.
CREATE UNIQUE INDEX assets_org_digest_key
  ON assets (organization_id, sha256) NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

CREATE INDEX assets_org_kind_idx
  ON assets (organization_id, kind, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX assets_purge_idx ON assets (purge_after) WHERE purge_after IS NOT NULL;

-- Storage-usage metering: sum(byte_size) per organization.
CREATE INDEX assets_org_size_idx
  ON assets (organization_id) INCLUDE (byte_size)
  WHERE deleted_at IS NULL;

-- The FKs deferred out of 0002, now that assets exists.
ALTER TABLE users
  ADD CONSTRAINT users_avatar_asset_fk
  FOREIGN KEY (avatar_asset_id) REFERENCES assets(id) ON DELETE SET NULL;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_logo_asset_fk
  FOREIGN KEY (logo_asset_id) REFERENCES assets(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- images — 1:1 specialization of an asset
-- ---------------------------------------------------------------------------

CREATE TABLE images (
  asset_id         uuid          PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  width            integer       NOT NULL,
  height           integer       NOT NULL,
  -- Stored, not computed on read: the editor sorts and filters by orientation.
  aspect_ratio     numeric(10,6) GENERATED ALWAYS AS (width::numeric / NULLIF(height, 0)) STORED,
  has_alpha        boolean       NOT NULL DEFAULT false,
  blurhash         text,
  dominant_color   app.hex_color,
  palette          jsonb         NOT NULL DEFAULT '[]'::jsonb,
  source           image_source  NOT NULL DEFAULT 'upload',
  alt_text         text,

  -- Provenance for AI-generated imagery. Kept because a customer will ask what
  -- produced an image, and because generated assets may carry different usage
  -- rights from uploads.
  ai_prompt        text,
  ai_model         text,
  ai_generation_id uuid,          -- FK added in 0006
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT images_dimensions_positive CHECK (width > 0 AND height > 0),
  CONSTRAINT images_dimensions_sane     CHECK (width <= 20000 AND height <= 20000),
  CONSTRAINT images_palette_array       CHECK (jsonb_typeof(palette) = 'array'),
  CONSTRAINT images_ai_provenance CHECK (
    source <> 'ai_generated' OR (ai_model IS NOT NULL AND ai_prompt IS NOT NULL)
  )
);

CREATE INDEX images_source_idx       ON images (source);
CREATE INDEX images_orientation_idx  ON images (aspect_ratio);
CREATE INDEX images_generation_idx   ON images (ai_generation_id) WHERE ai_generation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- icons
-- ---------------------------------------------------------------------------

CREATE TABLE icons (
  id              uuid        PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  organization_id uuid        REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = system library
  set_slug        app.slug    NOT NULL,
  name            app.slug    NOT NULL,
  style           icon_style  NOT NULL DEFAULT 'outline',
  -- Icons are small enough that inlining the SVG beats a storage round-trip on
  -- every render; asset_id is for the rare raster or oversized custom upload.
  svg_body        text,
  asset_id        uuid        REFERENCES assets(id) ON DELETE SET NULL,
  view_box        text        NOT NULL DEFAULT '0 0 24 24',
  keywords        text[]      NOT NULL DEFAULT '{}',
  license         text,
  attribution     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,

  search tsvector GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(name, '') || ' ' ||
      coalesce(set_slug, '') || ' ' ||
      app.join_text(keywords, ' '))
  ) STORED,

  CONSTRAINT icons_has_body CHECK (svg_body IS NOT NULL OR asset_id IS NOT NULL),
  CONSTRAINT icons_svg_len  CHECK (svg_body IS NULL OR length(svg_body) <= 100000),
  CONSTRAINT icons_view_box_shape CHECK (view_box ~ '^-?[0-9.]+( -?[0-9.]+){3}$')
);

CREATE UNIQUE INDEX icons_identity_key
  ON icons (organization_id, set_slug, name, style) NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

CREATE INDEX icons_search_idx   ON icons USING gin (search);
CREATE INDEX icons_keywords_idx ON icons USING gin (keywords);
-- Typeahead over a few thousand icon names: trigram beats tsvector for prefixes
-- and typos, which is what an icon picker actually receives.
CREATE INDEX icons_name_trgm_idx ON icons USING gin (name gin_trgm_ops);
CREATE INDEX icons_set_idx ON icons (set_slug, style) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- brand_kits
-- ---------------------------------------------------------------------------

CREATE TABLE brand_kits (
  id                  uuid        PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  organization_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  is_default          boolean     NOT NULL DEFAULT false,

  -- { "primary": "#0E0E10", "accent": "#E8FF5A", "ink": "#FFF", "muted": "#9C9CA6",
  --   "surfaces": ["#0E0E10", "#17171B"] }
  colors              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- { "display": { "family": "...", "weight": 800, "asset_id": "..." },
  --   "body":    { "family": "...", "weight": 400 } }
  fonts               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Fed into the generation prompt, so a brand's carousels sound like the brand.
  tone                jsonb       NOT NULL DEFAULT '{}'::jsonb,

  logo_asset_id       uuid        REFERENCES assets(id) ON DELETE SET NULL,
  logo_dark_asset_id  uuid        REFERENCES assets(id) ON DELETE SET NULL,
  watermark_asset_id  uuid        REFERENCES assets(id) ON DELETE SET NULL,

  created_by          uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,

  CONSTRAINT brand_kits_name_len   CHECK (length(name) BETWEEN 1 AND 120),
  CONSTRAINT brand_kits_colors_obj CHECK (jsonb_typeof(colors) = 'object'),
  CONSTRAINT brand_kits_fonts_obj  CHECK (jsonb_typeof(fonts) = 'object'),
  CONSTRAINT brand_kits_tone_obj   CHECK (jsonb_typeof(tone) = 'object')
);

CREATE UNIQUE INDEX brand_kits_name_per_org
  ON brand_kits (organization_id, lower(name)) WHERE deleted_at IS NULL;

-- Exactly one default per organization, so "which kit do I apply" is answered by
-- the database rather than by whichever row a query happened to return first.
CREATE UNIQUE INDEX brand_kits_one_default_per_org
  ON brand_kits (organization_id)
  WHERE is_default AND deleted_at IS NULL;

CREATE INDEX brand_kits_org_idx ON brand_kits (organization_id) WHERE deleted_at IS NULL;

SELECT app.sync_touch_triggers();

COMMIT;
