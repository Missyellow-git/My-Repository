import { del, put } from "@vercel/blob";
import { Pool } from "pg";
import {
  blobToken,
  newId,
  postgresUrl,
  summarise,
  type AssetDriver,
  type AssetRecord,
  type DeckDriver,
  type DeckInput,
  type Drivers,
  type StoredDeck,
} from "../store";
import type { Deck } from "../../types";

/**
 * Postgres + Vercel Blob: the serverless backend.
 *
 * Selected automatically when POSTGRES_URL is set. Blob storage is separate —
 * without BLOB_READ_WRITE_TOKEN, image bytes fall back to the (ephemeral)
 * filesystem while decks still persist, which the status endpoint reports.
 */

let pool: Pool | null = null;
let ready: Promise<void> | null = null;

function db(): Pool {
  if (!pool) {
    const connectionString = postgresUrl();
    if (!connectionString) throw new Error("POSTGRES_URL is not set.");
    pool = new Pool({
      connectionString,
      // Managed Postgres (Neon, Supabase, RDS) terminates TLS with certs that
      // aren't in the lambda trust store; the connection is still encrypted.
      ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}

/** Schema creation runs once per cold start, not per query. */
function migrated(): Promise<void> {
  ready ??= db()
    .query(
      `CREATE TABLE IF NOT EXISTS decks (
         id          TEXT PRIMARY KEY,
         title       TEXT NOT NULL,
         aspect      TEXT NOT NULL,
         theme_id    TEXT NOT NULL,
         data        JSONB NOT NULL,
         caption     TEXT,
         hashtags    JSONB NOT NULL DEFAULT '[]'::jsonb,
         created_at  BIGINT NOT NULL,
         updated_at  BIGINT NOT NULL
       );
       CREATE INDEX IF NOT EXISTS decks_updated_at ON decks (updated_at DESC);

       CREATE TABLE IF NOT EXISTS assets (
         id          TEXT PRIMARY KEY,
         sha256      TEXT NOT NULL UNIQUE,
         media_type  TEXT NOT NULL,
         filename    TEXT NOT NULL,
         size        BIGINT NOT NULL,
         location    TEXT NOT NULL,
         created_at  BIGINT NOT NULL
       );`
    )
    .then(() => undefined);
  return ready;
}

interface DeckRow {
  id: string;
  title: string;
  data: Deck;
  caption: string | null;
  hashtags: string[];
  created_at: string;
  updated_at: string;
}

interface AssetRow {
  id: string;
  sha256: string;
  media_type: string;
  filename: string;
  size: string;
  location: string;
  created_at: string;
}

// BIGINT comes back as a string from pg to avoid precision loss.
const num = (value: string | number) => Number(value);

function hydrate(row: DeckRow): StoredDeck {
  return {
    id: row.id,
    deck: row.data,
    caption: row.caption,
    hashtags: row.hashtags ?? [],
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
  };
}

function toRecord(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    sha256: row.sha256,
    mediaType: row.media_type,
    filename: row.filename,
    size: num(row.size),
    location: row.location,
    createdAt: num(row.created_at),
  };
}

const decks: DeckDriver = {
  async list() {
    await migrated();
    const { rows } = await db().query<DeckRow>(
      "SELECT id, title, data, caption, hashtags, created_at, updated_at FROM decks ORDER BY updated_at DESC"
    );
    return rows.map((row) =>
      summarise(row.id, row.data, num(row.created_at), num(row.updated_at), row.title)
    );
  },

  async get(id) {
    await migrated();
    const { rows } = await db().query<DeckRow>("SELECT * FROM decks WHERE id = $1", [id]);
    return rows[0] ? hydrate(rows[0]) : null;
  },

  async create(input: DeckInput) {
    await migrated();
    const now = Date.now();
    const id = newId("deck");
    const title = input.deck.title || "Untitled carousel";

    await db().query(
      `INSERT INTO decks (id, title, aspect, theme_id, data, caption, hashtags, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        title,
        input.deck.aspect,
        input.deck.themeId,
        JSON.stringify(input.deck),
        input.caption ?? null,
        JSON.stringify(input.hashtags ?? []),
        now,
        now,
      ]
    );

    return {
      id,
      deck: input.deck,
      caption: input.caption ?? null,
      hashtags: input.hashtags ?? [],
      createdAt: now,
      updatedAt: now,
    };
  },

  async update(id, input) {
    await migrated();
    const now = Date.now();
    const { rows } = await db().query<DeckRow>(
      `UPDATE decks
          SET title = $2, aspect = $3, theme_id = $4, data = $5,
              caption = COALESCE($6, caption), hashtags = COALESCE($7, hashtags), updated_at = $8
        WHERE id = $1
        RETURNING *`,
      [
        id,
        input.deck.title || "Untitled carousel",
        input.deck.aspect,
        input.deck.themeId,
        JSON.stringify(input.deck),
        input.caption ?? null,
        input.hashtags ? JSON.stringify(input.hashtags) : null,
        now,
      ]
    );
    return rows[0] ? hydrate(rows[0]) : null;
  },

  async remove(id) {
    await migrated();
    const result = await db().query("DELETE FROM decks WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  },

  async countReferencing(assetUrl) {
    await migrated();
    const { rows } = await db().query<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM decks WHERE data::text LIKE $1",
      [`%${assetUrl}%`]
    );
    return num(rows[0]?.n ?? "0");
  },
};

const assets: AssetDriver = {
  async list() {
    await migrated();
    const { rows } = await db().query<AssetRow>("SELECT * FROM assets ORDER BY created_at DESC");
    return rows.map(toRecord);
  },

  async get(id) {
    await migrated();
    const { rows } = await db().query<AssetRow>("SELECT * FROM assets WHERE id = $1", [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  },

  async findByDigest(sha256) {
    await migrated();
    const { rows } = await db().query<AssetRow>("SELECT * FROM assets WHERE sha256 = $1", [sha256]);
    return rows[0] ? toRecord(rows[0]) : null;
  },

  async create(record, bytes) {
    await migrated();
    const token = blobToken();
    if (!token) {
      throw new Error(
        "BLOB_READ_WRITE_TOKEN is not set — create a Blob store so uploaded images persist."
      );
    }

    const extension = record.mediaType.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
    const uploaded = await put(`carousel/${record.sha256}.${extension}`, bytes, {
      access: "public",
      token,
      contentType: record.mediaType,
      // The digest already makes the path unique; a suffix would break dedupe.
      addRandomSuffix: false,
      cacheControlMaxAge: 31_536_000,
    });

    await db().query(
      `INSERT INTO assets (id, sha256, media_type, filename, size, location, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (sha256) DO NOTHING`,
      [
        record.id,
        record.sha256,
        record.mediaType,
        record.filename,
        record.size,
        uploaded.url,
        record.createdAt,
      ]
    );

    return { ...record, location: uploaded.url };
  },

  async read(record) {
    const response = await fetch(record.location);
    if (!response.ok) throw new Error(`Blob fetch failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  },

  async remove(record, digestStillUsed) {
    await migrated();
    await db().query("DELETE FROM assets WHERE id = $1", [record.id]);
    const token = blobToken();
    if (!digestStillUsed && token) {
      await del(record.location, { token }).catch(() => {
        // The row is gone either way; a stranded blob is not worth failing on.
      });
    }
  },

  publicUrl(record) {
    // Blob URLs are public and CDN-backed, so the API route redirects rather
    // than pulling every image through the function.
    return record.location.startsWith("http") ? record.location : null;
  },
};

export function postgresDrivers(): Drivers {
  return { decks, assets };
}
