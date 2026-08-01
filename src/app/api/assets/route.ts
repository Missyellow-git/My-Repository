import { NextResponse } from "next/server";
import { AssetError, listAssets, storeAsset } from "@/lib/server/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ assets: await listAssets() });
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const files = form?.getAll("file").filter((f): f is File => f instanceof File) ?? [];

  if (!files.length) {
    return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
  }

  const stored = [];
  const failed: { name: string; error: string }[] = [];

  for (const file of files) {
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      stored.push(await storeAsset(bytes, file.name, file.type));
    } catch (error) {
      // One bad file shouldn't discard the rest of a multi-file drop.
      failed.push({
        name: file.name,
        error: error instanceof AssetError ? error.message : "Upload failed.",
      });
    }
  }

  if (!stored.length) {
    return NextResponse.json(
      { error: failed[0]?.error ?? "Upload failed.", failed },
      { status: failed[0] instanceof AssetError ? 400 : 400 }
    );
  }

  return NextResponse.json({ assets: stored, failed }, { status: 201 });
}
