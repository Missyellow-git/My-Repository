import { NextResponse } from "next/server";
import {
  assetPublicUrl,
  decksReferencing,
  deleteAsset,
  getAsset,
  readAssetBytes,
} from "@/lib/server/assets";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const record = await getAsset((await params).id);
  if (!record) return NextResponse.json({ error: "Asset not found." }, { status: 404 });

  // Blob-backed images are already on a CDN — redirect instead of pulling every
  // byte back through the function.
  const publicUrl = await assetPublicUrl(record);
  if (publicUrl) return NextResponse.redirect(publicUrl, 307);

  const bytes = await readAssetBytes(record).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "Asset bytes are missing." }, { status: 410 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": record.mediaType,
      "content-length": String(record.size),
      // Assets are content-addressed and an id always maps to the same bytes.
      "cache-control": "public, max-age=31536000, immutable",
      etag: `"${record.sha256}"`,
    },
  });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const force = new URL(request.url).searchParams.get("force") === "true";

  const references = await decksReferencing(id);
  if (references > 0 && !force) {
    return NextResponse.json(
      { error: `Still used by ${references} deck${references === 1 ? "" : "s"}.`, references },
      { status: 409 }
    );
  }

  const removed = await deleteAsset(id);
  if (!removed) return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
