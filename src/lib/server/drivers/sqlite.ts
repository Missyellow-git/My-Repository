import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db, UPLOAD_DIR } from "../db";
import {
  summarise,
  type AssetDriver,
  type AssetRecord,
  type DeckDriver,
  type DeckInput,
  type DeckSummary,
  type Drivers,
  type StoredDeck,
} from "../store";
import { newId } from "../store";
import type { Deck } from "../../types";

/** SQLite + local disk: the default, and what a self-hosted install uses. */

interface DeckRow {
  id: string;
  title: string;
  aspect: string;
  theme_id: string;
  data: string;
  caption: string | null;
  hashtags: string;
  created_at: number;
  updated_at: number;
}

interface AssetRow {
  id: string;
  sha256: string;
  media_type: string;
  filename: string;
  size: number;
  created_at: number;
}

/** Blobs are sharded by the first byte of the digest to keep directories small. */
function blobPath(sha256: string) {
  return path.join(UPLOAD_DIR, sha256.slice(0, 2), sha256);
}

function hydrate(row: DeckRow): StoredDeck {
  return {
    id: row.id,
    deck: JSON.parse(row.data) as Deck,
    caption: row.caption,
    hashtags: JSON.parse(row.hashtags) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRecord(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    sha256: row.sha256,
    mediaType: row.media_type,
    filename: row.filename,
    size: row.size,
    location: row.sha256,
    createdAt: row.created_at,
  };
}

const decks: DeckDriver = {
  async list(): Promise<DeckSummary[]> {
    return db()
      .prepare<[], DeckRow>("SELECT * FROM decks ORDER BY updated_at DESC")
      .all()
      .map((row) =>
        summarise(row.id, JSON.parse(row.data) as Deck, row.created_at, row.updated_at, row.title)
      );
  },

  async get(id) {
    const row = db().prepare<[string], DeckRow>("SELECT * FROM decks WHERE id = ?").get(id);
    return row ? hydrate(row) : null;
  },

  async create(input: DeckInput) {
    const now = Date.now();
    const row: DeckRow = {
      id: newId("deck"),
      title: input.deck.title || "Untitled carousel",
      aspect: input.deck.aspect,
      theme_id: input.deck.themeId,
      data: JSON.stringify(input.deck),
      caption: input.caption ?? null,
      hashtags: JSON.stringify(input.hashtags ?? []),
      created_at: now,
      updated_at: now,
    };
    db()
      .prepare(
        `INSERT INTO decks (id, title, aspect, theme_id, data, caption, hashtags, created_at, updated_at)
         VALUES (@id, @title, @aspect, @theme_id, @data, @caption, @hashtags, @created_at, @updated_at)`
      )
      .run(row);
    return hydrate(row);
  },

  async update(id, input) {
    const existing = db().prepare<[string], DeckRow>("SELECT * FROM decks WHERE id = ?").get(id);
    if (!existing) return null;

    const row: DeckRow = {
      ...existing,
      title: input.deck.title || "Untitled carousel",
      aspect: input.deck.aspect,
      theme_id: input.deck.themeId,
      data: JSON.stringify(input.deck),
      caption: input.caption === undefined ? existing.caption : input.caption,
      hashtags: input.hashtags ? JSON.stringify(input.hashtags) : existing.hashtags,
      updated_at: Date.now(),
    };
    db()
      .prepare(
        `UPDATE decks
            SET title = @title, aspect = @aspect, theme_id = @theme_id, data = @data,
                caption = @caption, hashtags = @hashtags, updated_at = @updated_at
          WHERE id = @id`
      )
      .run(row);
    return hydrate(row);
  },

  async remove(id) {
    return db().prepare("DELETE FROM decks WHERE id = ?").run(id).changes > 0;
  },

  async countReferencing(assetUrl) {
    const row = db()
      .prepare<[string], { n: number }>("SELECT COUNT(*) AS n FROM decks WHERE data LIKE ?")
      .get(`%${assetUrl}%`);
    return row?.n ?? 0;
  },
};

const assets: AssetDriver = {
  async list() {
    return db()
      .prepare<[], AssetRow>("SELECT * FROM assets ORDER BY created_at DESC")
      .all()
      .map(toRecord);
  },

  async get(id) {
    const row = db().prepare<[string], AssetRow>("SELECT * FROM assets WHERE id = ?").get(id);
    return row ? toRecord(row) : null;
  },

  async findByDigest(sha256) {
    const row = db()
      .prepare<[string], AssetRow>("SELECT * FROM assets WHERE sha256 = ?")
      .get(sha256);
    return row ? toRecord(row) : null;
  },

  async create(record, bytes) {
    const target = blobPath(record.sha256);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);

    db()
      .prepare(
        `INSERT INTO assets (id, sha256, media_type, filename, size, created_at)
         VALUES (@id, @sha256, @media_type, @filename, @size, @created_at)`
      )
      .run({
        id: record.id,
        sha256: record.sha256,
        media_type: record.mediaType,
        filename: record.filename,
        size: record.size,
        created_at: record.createdAt,
      });

    return { ...record, location: record.sha256 };
  },

  async read(record) {
    return fs.readFile(blobPath(record.sha256));
  },

  async remove(record, digestStillUsed) {
    db().prepare("DELETE FROM assets WHERE id = ?").run(record.id);
    if (!digestStillUsed) await fs.rm(blobPath(record.sha256), { force: true });
  },

  publicUrl() {
    return null; // served through the API route, straight off disk
  },
};

export function sqliteDrivers(): Drivers {
  return { decks, assets };
}

export function digest(bytes: Buffer) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
