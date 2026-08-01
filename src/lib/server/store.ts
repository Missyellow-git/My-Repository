import type { Deck, Slide } from "../types";

/**
 * Storage contracts, plus the driver selection.
 *
 * There are two backends. SQLite + local disk is the default and is what a
 * self-hosted install uses. Postgres + Vercel Blob takes over when the matching
 * environment variables are present, because a serverless filesystem is
 * read-only apart from /tmp and is wiped between invocations — decks written
 * there would appear to save and then vanish.
 *
 * Nothing outside `src/lib/server` knows which one is active.
 */

export interface StoredDeck {
  id: string;
  deck: Deck;
  caption: string | null;
  hashtags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DeckSummary {
  id: string;
  title: string;
  aspect: Deck["aspect"];
  themeId: string;
  slideCount: number;
  cover: Slide | null;
  createdAt: number;
  updatedAt: number;
}

export interface DeckInput {
  deck: Deck;
  caption?: string | null;
  hashtags?: string[];
}

export interface DeckDriver {
  list(): Promise<DeckSummary[]>;
  get(id: string): Promise<StoredDeck | null>;
  create(input: DeckInput): Promise<StoredDeck>;
  update(id: string, input: DeckInput): Promise<StoredDeck | null>;
  remove(id: string): Promise<boolean>;
  /** How many decks still point at an asset URL — guards asset deletion. */
  countReferencing(assetUrl: string): Promise<number>;
}

export interface AssetRecord {
  id: string;
  sha256: string;
  mediaType: string;
  filename: string;
  size: number;
  /** Driver-specific handle: a digest for disk, a blob URL for Vercel Blob. */
  location: string;
  createdAt: number;
}

export interface AssetDriver {
  list(): Promise<AssetRecord[]>;
  get(id: string): Promise<AssetRecord | null>;
  findByDigest(sha256: string): Promise<AssetRecord | null>;
  create(record: AssetRecord, bytes: Buffer): Promise<AssetRecord>;
  read(record: AssetRecord): Promise<Buffer>;
  remove(record: AssetRecord, digestStillUsed: boolean): Promise<void>;
  /** Blob-backed assets can be served by redirect instead of proxying bytes. */
  publicUrl(record: AssetRecord): string | null;
}

export interface Drivers {
  decks: DeckDriver;
  assets: AssetDriver;
}

export type StorageMode = "sqlite" | "postgres" | "memory";

export function postgresUrl(): string | undefined {
  return (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    undefined
  );
}

export function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || undefined;
}

function serverless() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function storageMode(): StorageMode {
  if (postgresUrl()) return "postgres";
  // Serverless has no durable disk, so writing a SQLite file there would mean
  // loading a native module to produce data that is discarded regardless.
  return serverless() ? "memory" : "sqlite";
}

/**
 * True when writes will not outlive the request. Serverless without Postgres
 * falls back to SQLite in a temp directory, which technically works but loses
 * everything — the UI surfaces this rather than pretending decks are saved.
 */
export function isEphemeral(): boolean {
  return storageMode() === "memory";
}

let cached: Drivers | null = null;

export async function drivers(): Promise<Drivers> {
  if (cached) return cached;
  // Imported lazily so the Postgres client is never pulled into a self-hosted
  // process, and better-sqlite3 is never loaded in a serverless one.
  const mode = storageMode();
  const resolved =
    mode === "postgres"
      ? await import("./drivers/postgres").then((m) => m.postgresDrivers())
      : mode === "memory"
        ? await import("./drivers/memory").then((m) => m.memoryDrivers())
        : await import("./drivers/sqlite").then((m) => m.sqliteDrivers());
  cached = resolved;
  return resolved;
}

export function newId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

/** Shared shaping so both drivers return identical summaries. */
export function summarise(
  id: string,
  deck: Deck,
  createdAt: number,
  updatedAt: number,
  title: string
): DeckSummary {
  return {
    id,
    title,
    aspect: deck.aspect,
    themeId: deck.themeId,
    slideCount: deck.slides.length,
    cover: deck.slides[0] ?? null,
    createdAt,
    updatedAt,
  };
}
