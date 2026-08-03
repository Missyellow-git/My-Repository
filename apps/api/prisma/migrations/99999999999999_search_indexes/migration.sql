-- Search and reporting indexes that Prisma's schema language cannot express.
--
-- This migration is deliberately timestamped far in the future so it always
-- sorts *after* the generated table migration, regardless of when the latter
-- was created. Every statement is idempotent, so re-running is safe.
--
-- See docs/DATABASE.md#full-text-and-fuzzy-search for why trigram search is
-- used instead of tsvector: scheme names are short, highly repetitive strings
-- where users routinely mistype or abbreviate ("parag parik flexi"), and
-- trigram similarity degrades far more gracefully than stemmed full text.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Fuzzy scheme search: `normalized_name % :q` and `similarity()` ordering.
CREATE INDEX IF NOT EXISTS idx_mutual_funds_name_trgm
  ON mutual_funds USING gin ("normalizedName" gin_trgm_ops);

-- Fuzzy company-name matching during disclosure import, and the dashboard's
-- in-table stock search.
CREATE INDEX IF NOT EXISTS idx_stocks_name_trgm
  ON stocks USING gin ("normalizedName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_stock_aliases_trgm
  ON stock_aliases USING gin ("normalizedAlias" gin_trgm_ops);

-- Partial index for the hottest query in the product: "latest published
-- snapshot for fund X". Restricting to PUBLISHED keeps the index small.
CREATE INDEX IF NOT EXISTS idx_snapshots_published_latest
  ON portfolio_snapshots ("fundId", "disclosureDate" DESC)
  WHERE status = 'PUBLISHED';

-- Covering index for the dashboard's holdings read. Including the projected
-- columns lets Postgres serve the query index-only.
CREATE INDEX IF NOT EXISTS idx_holdings_snapshot_weight_covering
  ON holdings ("snapshotId", "weightPct" DESC)
  INCLUDE ("stockId", "instrumentName", "instrumentType", "rank");

-- "Which schemes hold this stock" — the reverse-lookup feature.
CREATE INDEX IF NOT EXISTS idx_holdings_stock_snapshot
  ON holdings ("stockId", "snapshotId")
  WHERE "stockId" IS NOT NULL;

-- Provider observability queries are always time-bounded and provider-scoped.
CREATE INDEX IF NOT EXISTS idx_api_call_logs_provider_time
  ON api_call_logs (provider, "createdAt" DESC);

-- Unread-notification badge count.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications ("userId", "createdAt" DESC)
  WHERE "readAt" IS NULL;
