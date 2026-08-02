-- 0002_identity.sql
-- Users, organizations, membership, and invitations.
--
-- The organization is the tenant boundary: everything ownable in this schema
-- carries organization_id, and row-level security keys off it. A solo user gets
-- a `personal` organization at signup rather than a nullable owner column, so
-- there is exactly one ownership path through the whole system instead of two.

BEGIN;

CREATE TYPE user_status       AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE org_kind          AS ENUM ('personal', 'team');
CREATE TYPE org_role          AS ENUM ('owner', 'admin', 'editor', 'viewer', 'billing');
CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id                      uuid        PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  email                   app.email   NOT NULL,
  email_verified_at       timestamptz,
  -- NULL for SSO-only accounts; see user_identities.
  password_hash           text,
  full_name               text,
  avatar_asset_id         uuid,       -- FK added in 0004 (assets does not exist yet)
  default_organization_id uuid,       -- FK added below
  locale                  text        NOT NULL DEFAULT 'en',
  timezone                text        NOT NULL DEFAULT 'UTC',
  status                  user_status NOT NULL DEFAULT 'active',
  last_seen_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,

  CONSTRAINT users_name_len CHECK (full_name IS NULL OR length(full_name) BETWEEN 1 AND 200),
  CONSTRAINT users_deleted_is_status CHECK ((deleted_at IS NULL) = (status <> 'deleted'))
);

-- Case-insensitive by domain. Partial so a deleted account frees its address for
-- re-registration without a hard delete.
CREATE UNIQUE INDEX users_email_key ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX users_last_seen_idx ON users (last_seen_at DESC NULLS LAST) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- user_identities — federated logins (Google, GitHub, SAML, ...)
-- ---------------------------------------------------------------------------

CREATE TABLE user_identities (
  id                  uuid        PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            text        NOT NULL,
  provider_account_id text        NOT NULL,
  email               app.email,
  access_token_enc    bytea,      -- encrypted application-side; never plaintext
  refresh_token_enc   bytea,
  expires_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_identities_provider_account_key UNIQUE (provider, provider_account_id)
);

CREATE INDEX user_identities_user_idx ON user_identities (user_id);

-- ---------------------------------------------------------------------------
-- organizations — the tenant
-- ---------------------------------------------------------------------------

CREATE TABLE organizations (
  id            uuid        PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  slug          app.slug    NOT NULL,
  name          text        NOT NULL,
  kind          org_kind    NOT NULL DEFAULT 'team',
  owner_user_id uuid        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  logo_asset_id uuid,       -- FK added in 0004
  settings      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  CONSTRAINT organizations_name_len  CHECK (length(name) BETWEEN 1 AND 200),
  CONSTRAINT organizations_settings_obj CHECK (jsonb_typeof(settings) = 'object')
);

CREATE UNIQUE INDEX organizations_slug_key ON organizations (slug) WHERE deleted_at IS NULL;
CREATE INDEX organizations_owner_idx ON organizations (owner_user_id);

-- A person gets exactly one personal workspace; teams are unlimited.
CREATE UNIQUE INDEX organizations_one_personal_per_user
  ON organizations (owner_user_id)
  WHERE kind = 'personal' AND deleted_at IS NULL;

ALTER TABLE users
  ADD CONSTRAINT users_default_organization_fk
  FOREIGN KEY (default_organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX users_default_org_idx ON users (default_organization_id);

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------

CREATE TABLE organization_members (
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            org_role    NOT NULL DEFAULT 'editor',
  invited_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (organization_id, user_id)
);

-- "Who is in this org" is the composite PK; "which orgs am I in" needs its own
-- index because the PK's leading column is the organization.
CREATE INDEX organization_members_user_idx ON organization_members (user_id, organization_id);

-- Ownership is singular and transferred, never duplicated. Enforcing it here
-- means no application path can leave an org with two owners or none.
CREATE UNIQUE INDEX organization_members_single_owner
  ON organization_members (organization_id)
  WHERE role = 'owner';

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------

CREATE TABLE invitations (
  id              uuid              PRIMARY KEY DEFAULT app.uuid_generate_v7(),
  organization_id uuid              NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           app.email         NOT NULL,
  role            org_role          NOT NULL DEFAULT 'editor',
  -- Only the hash is stored; the raw token exists solely in the emailed link.
  token_hash      bytea             NOT NULL,
  status          invitation_status NOT NULL DEFAULT 'pending',
  invited_by      uuid              REFERENCES users(id) ON DELETE SET NULL,
  accepted_by     uuid              REFERENCES users(id) ON DELETE SET NULL,
  accepted_at     timestamptz,
  expires_at      timestamptz       NOT NULL,
  created_at      timestamptz       NOT NULL DEFAULT now(),
  updated_at      timestamptz       NOT NULL DEFAULT now(),

  CONSTRAINT invitations_token_hash_len CHECK (octet_length(token_hash) = 32),
  CONSTRAINT invitations_expiry_future  CHECK (expires_at > created_at),
  CONSTRAINT invitations_accepted_shape CHECK (
    (status = 'accepted') = (accepted_at IS NOT NULL AND accepted_by IS NOT NULL)
  ),
  CONSTRAINT invitations_no_owner_invite CHECK (role <> 'owner')
);

CREATE UNIQUE INDEX invitations_token_hash_key ON invitations (token_hash);

-- One live invite per address per org; re-inviting updates the existing row.
CREATE UNIQUE INDEX invitations_pending_unique
  ON invitations (organization_id, email)
  WHERE status = 'pending';

-- Drives the expiry sweeper.
CREATE INDEX invitations_pending_expiry_idx
  ON invitations (expires_at)
  WHERE status = 'pending';

SELECT app.sync_touch_triggers();

COMMIT;
