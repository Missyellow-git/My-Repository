import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * SQLite + a local blob directory, chosen so the app keeps working after a
 * `git clone && npm run dev` with no services to provision. Everything that
 * touches persistence goes through this module and `storage.ts`, so swapping in
 * Postgres or S3 later is a change in two files rather than everywhere.
 */

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? ".data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

let instance: Database.Database | null = null;

export function db(): Database.Database {
  if (instance) return instance;

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const handle = new Database(path.join(DATA_DIR, "carousel.db"));

  // WAL keeps the autosave writes from blocking reads in the dev server.
  handle.pragma("journal_mode = WAL");
  handle.pragma("foreign_keys = ON");
  migrate(handle);

  instance = handle;
  return handle;
}

function migrate(handle: Database.Database) {
  handle.exec(`
    CREATE TABLE IF NOT EXISTS decks (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      aspect      TEXT NOT NULL,
      theme_id    TEXT NOT NULL,
      data        TEXT NOT NULL,
      caption     TEXT,
      hashtags    TEXT NOT NULL DEFAULT '[]',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS decks_updated_at ON decks (updated_at DESC);

    CREATE TABLE IF NOT EXISTS assets (
      id          TEXT PRIMARY KEY,
      sha256      TEXT NOT NULL,
      media_type  TEXT NOT NULL,
      filename    TEXT NOT NULL,
      size        INTEGER NOT NULL,
      created_at  INTEGER NOT NULL
    );

    -- Uploads are content-addressed, so re-uploading the same file reuses the
    -- existing row and the bytes are stored once.
    CREATE UNIQUE INDEX IF NOT EXISTS assets_sha256 ON assets (sha256);
  `);
}

export function newId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}
