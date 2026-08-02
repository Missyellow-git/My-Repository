-- 0009_security.sql
-- Application roles, grants, and row-level security.
--
-- Tenant isolation is enforced in the database, not only in application code. A
-- missed WHERE clause in one handler is then a query that returns nothing rather
-- than one that leaks another customer's decks. The application opens a
-- transaction, sets the session context, and runs:
--
--   SET LOCAL app.user_id         = '<uuid>';
--   SET LOCAL app.organization_id = '<uuid>';
--
-- SET LOCAL, so the setting dies with the transaction and cannot leak across a
-- pooled connection.

BEGIN;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'carousel_app') THEN
    CREATE ROLE carousel_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'carousel_readonly') THEN
    CREATE ROLE carousel_readonly NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public, app TO carousel_app, carousel_readonly;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO carousel_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO carousel_app;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA app    TO carousel_app;
GRANT SELECT                         ON ALL TABLES    IN SCHEMA public TO carousel_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO carousel_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO carousel_readonly;

-- Nothing outside the application should be able to rewrite billing history.
REVOKE UPDATE, DELETE ON credit_ledger, payments FROM carousel_app;

-- ---------------------------------------------------------------------------
-- Policy helpers
-- ---------------------------------------------------------------------------

-- Membership check used by the organization policies. SECURITY DEFINER so the
-- lookup itself is not subject to the policy it is helping evaluate.
CREATE OR REPLACE FUNCTION app.is_member_of(target_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app.is_service_role()
      OR EXISTS (
           SELECT 1 FROM organization_members m
            WHERE m.organization_id = target_org
              AND m.user_id = app.current_user_id()
         );
$$;

-- The predicate every tenant-scoped table shares: the row belongs to the active
-- organization, and the caller is actually a member of it. Both halves matter —
-- the first is what the indexes can use, the second is what stops a forged
-- session variable.
CREATE OR REPLACE FUNCTION app.tenant_visible(row_org uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT app.is_service_role()
      OR (row_org = app.current_org_id() AND app.is_member_of(row_org));
$$;

-- ---------------------------------------------------------------------------
-- Directly tenant-scoped tables
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'brand_kits', 'projects', 'ai_conversations', 'ai_generations',
    'exports', 'invoices', 'payments', 'subscriptions', 'credit_ledger',
    'credit_balances', 'invitations', 'daily_project_stats', 'organization_usage_daily'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON public.%I
        USING (app.tenant_visible(organization_id))
        WITH CHECK (app.tenant_visible(organization_id))
    $p$, t);
  END LOOP;
END
$$;

-- assets, icons, templates: organization_id IS NULL means the shared system
-- library — the stock icon sets and the public template gallery. Every tenant
-- reads those rows; only the service role writes them. Putting these tables in
-- the group above instead would make the whole public gallery invisible, since
-- `NULL = current_org_id()` is NULL rather than true.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assets', 'icons', 'templates']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_read ON public.%I FOR SELECT
        USING (organization_id IS NULL OR app.tenant_visible(organization_id))
    $p$, t);
    EXECUTE format($p$
      CREATE POLICY tenant_write ON public.%I FOR ALL
        USING (app.tenant_visible(organization_id))
        WITH CHECK (app.tenant_visible(organization_id))
    $p$, t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Tables scoped through their parent project
-- ---------------------------------------------------------------------------
--
-- These carry no organization_id of their own. The semi-join below is driven by
-- projects_org_recent_idx, so it stays an index probe rather than a scan. If a
-- profile ever shows these policies dominating a query, the fix is to
-- denormalize organization_id onto the child table and switch to
-- app.tenant_visible — not to weaken the policy.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['slides', 'project_versions', 'project_collaborators', 'project_assets']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON public.%I
        USING (
          app.is_service_role() OR EXISTS (
            SELECT 1 FROM public.projects p
             WHERE p.id = %I.project_id
               AND p.organization_id = app.current_org_id()
               AND app.is_member_of(p.organization_id)
          )
        )
        WITH CHECK (
          app.is_service_role() OR EXISTS (
            SELECT 1 FROM public.projects p
             WHERE p.id = %I.project_id
               AND p.organization_id = app.current_org_id()
               AND app.is_member_of(p.organization_id)
          )
        )
    $p$, t, t, t);
  END LOOP;
END
$$;

-- ai_messages hangs off a conversation rather than a project.
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_messages
  USING (
    app.is_service_role() OR EXISTS (
      SELECT 1 FROM ai_conversations c
       WHERE c.id = ai_messages.conversation_id
         AND app.tenant_visible(c.organization_id)
    )
  )
  WITH CHECK (
    app.is_service_role() OR EXISTS (
      SELECT 1 FROM ai_conversations c
       WHERE c.id = ai_messages.conversation_id
         AND app.tenant_visible(c.organization_id)
    )
  );

-- images is a 1:1 extension of assets and inherits its visibility.
ALTER TABLE images ENABLE ROW LEVEL SECURITY;
ALTER TABLE images FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON images
  USING (
    app.is_service_role() OR EXISTS (
      SELECT 1 FROM assets a
       WHERE a.id = images.asset_id
         AND (a.organization_id IS NULL OR app.tenant_visible(a.organization_id))
    )
  )
  WITH CHECK (
    app.is_service_role() OR EXISTS (
      SELECT 1 FROM assets a
       WHERE a.id = images.asset_id AND app.tenant_visible(a.organization_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Identity tables
-- ---------------------------------------------------------------------------

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE  ROW LEVEL SECURITY;
CREATE POLICY member_visibility ON organizations
  USING (app.is_member_of(id))
  WITH CHECK (app.is_member_of(id));

ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members FORCE  ROW LEVEL SECURITY;
CREATE POLICY member_visibility ON organization_members
  USING (app.is_member_of(organization_id))
  WITH CHECK (app.is_member_of(organization_id));

-- A user sees themselves, plus anyone they share an organization with — that is
-- what renders a collaborator avatar without exposing the whole user table.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE  ROW LEVEL SECURITY;
CREATE POLICY self_and_teammates ON users
  USING (
    app.is_service_role()
    OR id = app.current_user_id()
    OR EXISTS (
      SELECT 1 FROM organization_members m
       WHERE m.user_id = users.id
         AND m.organization_id = app.current_org_id()
         AND app.is_member_of(m.organization_id)
    )
  )
  WITH CHECK (app.is_service_role() OR id = app.current_user_id());

ALTER TABLE user_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_identities FORCE  ROW LEVEL SECURITY;
CREATE POLICY own_identities ON user_identities
  USING (app.is_service_role() OR user_id = app.current_user_id())
  WITH CHECK (app.is_service_role() OR user_id = app.current_user_id());

-- plans is a public price book; analytics_events is written by the collector and
-- read only through the rollups. Neither is tenant-scoped.
GRANT SELECT ON plans TO carousel_app, carousel_readonly;
REVOKE INSERT, UPDATE, DELETE ON plans FROM carousel_app;

COMMIT;
