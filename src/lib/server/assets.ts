import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db, newId, UPLOAD_DIR } from "./db";

export interface AssetRecord {
  id: string;
  sha256: string;
  media_type: string;
  filename: string;
  size: number;
  created_at: number;
}

export interface AssetDto {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  /** What the deck stores and the browser loads. */
  url: string;
}

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function assetUrl(id: string) {
  return `/api/assets/${id}`;
}

export function toDto(row: AssetRecord): AssetDto {
  return {
    id: row.id,
    name: row.filename,
    mediaType: row.media_type,
    size: row.size,
    url: assetUrl(row.id),
  };
}

/** Blobs are sharded by the first byte of the digest to keep directories small. */
function blobPath(sha256: string) {
  return path.join(UPLOAD_DIR, sha256.slice(0, 2), sha256);
}

export async function storeAsset(
  bytes: Buffer,
  filename: string,
  mediaType: string
): Promise<AssetDto> {
  if (!ALLOWED.has(mediaType)) {
    throw new AssetError(`Unsupported image type: ${mediaType}`, 415);
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new AssetError("That image is larger than 10 MB.", 413);
  }

  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

  // Identical bytes uploaded twice reuse the first asset rather than writing a
  // second copy — decks that share an image share the underlying blob.
  const existing = db()
    .prepare<[string], AssetRecord>("SELECT * FROM assets WHERE sha256 = ?")
    .get(sha256);
  if (existing) return toDto(existing);

  const target = blobPath(sha256);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);

  const row: AssetRecord = {
    id: newId("asset"),
    sha256,
    media_type: mediaType,
    filename: filename.slice(0, 200) || "image",
    size: bytes.length,
    created_at: Date.now(),
  };

  db()
    .prepare(
      `INSERT INTO assets (id, sha256, media_type, filename, size, created_at)
       VALUES (@id, @sha256, @media_type, @filename, @size, @created_at)`
    )
    .run(row);

  return toDto(row);
}

export function getAsset(id: string): AssetRecord | undefined {
  return db().prepare<[string], AssetRecord>("SELECT * FROM assets WHERE id = ?").get(id);
}

export function listAssets(): AssetDto[] {
  return db()
    .prepare<[], AssetRecord>("SELECT * FROM assets ORDER BY created_at DESC")
    .all()
    .map(toDto);
}

export function readAssetBytes(record: AssetRecord): Promise<Buffer> {
  return fs.readFile(blobPath(record.sha256));
}

/**
 * Deleting the row always succeeds; the blob is only removed once no asset
 * references that digest, since uploads are deduplicated by content.
 */
export async function deleteAsset(id: string): Promise<boolean> {
  const record = getAsset(id);
  if (!record) return false;

  db().prepare("DELETE FROM assets WHERE id = ?").run(id);

  const stillUsed = db()
    .prepare<[string], { n: number }>("SELECT COUNT(*) AS n FROM assets WHERE sha256 = ?")
    .get(record.sha256);
  if (!stillUsed?.n) {
    await fs.rm(blobPath(record.sha256), { force: true });
  }
  return true;
}

/** Decks that still point at this asset — used to warn before deleting. */
export function decksReferencing(id: string): number {
  const row = db()
    .prepare<[string], { n: number }>("SELECT COUNT(*) AS n FROM decks WHERE data LIKE ?")
    .get(`%${assetUrl(id)}%`);
  return row?.n ?? 0;
}

export class AssetError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}
