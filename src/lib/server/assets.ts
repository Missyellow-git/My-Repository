import crypto from "node:crypto";
import { drivers, newId, type AssetRecord } from "./store";

/** Image storage: validation, content addressing, and driver dispatch. */

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

export class AssetError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export function assetUrl(id: string) {
  return `/api/assets/${id}`;
}

export function toDto(record: AssetRecord): AssetDto {
  return {
    id: record.id,
    name: record.filename,
    mediaType: record.mediaType,
    size: record.size,
    url: assetUrl(record.id),
  };
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

  const { assets } = await drivers();
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

  // Identical bytes uploaded twice reuse the first asset rather than storing a
  // second copy — decks that share an image share the underlying blob.
  const existing = await assets.findByDigest(sha256);
  if (existing) return toDto(existing);

  const created = await assets.create(
    {
      id: newId("asset"),
      sha256,
      mediaType,
      filename: filename.slice(0, 200) || "image",
      size: bytes.length,
      location: sha256,
      createdAt: Date.now(),
    },
    bytes
  );

  return toDto(created);
}

export async function getAsset(id: string): Promise<AssetRecord | null> {
  return (await drivers()).assets.get(id);
}

export async function listAssets(): Promise<AssetDto[]> {
  return (await drivers()).assets.list().then((records) => records.map(toDto));
}

export async function readAssetBytes(record: AssetRecord): Promise<Buffer> {
  return (await drivers()).assets.read(record);
}

export async function assetPublicUrl(record: AssetRecord): Promise<string | null> {
  return (await drivers()).assets.publicUrl(record);
}

/**
 * Removing the row always succeeds; the stored bytes are only dropped once no
 * asset shares that digest, since uploads are deduplicated by content.
 */
export async function deleteAsset(id: string): Promise<boolean> {
  const { assets } = await drivers();
  const record = await assets.get(id);
  if (!record) return false;

  const sameDigest = await assets.findByDigest(record.sha256);
  const digestStillUsed = Boolean(sameDigest && sameDigest.id !== record.id);
  await assets.remove(record, digestStillUsed);
  return true;
}

/** Decks that still point at this asset — used to refuse a destructive delete. */
export async function decksReferencing(id: string): Promise<number> {
  return (await drivers()).decks.countReferencing(assetUrl(id));
}
