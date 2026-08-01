import { NextResponse } from "next/server";
import { generateDeck, type GenerateInput } from "@/lib/generate";
import { getAsset, readAssetBytes } from "@/lib/server/assets";
import { buildDeck } from "@/lib/layout";
import type { AspectId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body extends Omit<GenerateInput, "images"> {
  themeId: string;
  aspect: AspectId;
  /** Stored uploads to show Claude; the bytes are read server-side. */
  assetIds?: string[];
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server." },
      { status: 500 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.brief?.trim() && !body.sourceText?.trim() && !body.assetIds?.length) {
    return NextResponse.json(
      { error: "Give me something to work with: a topic, some text, a link, or an image." },
      { status: 400 }
    );
  }

  try {
    const images = await loadImages(body.assetIds ?? []);
    const generated = await generateDeck({
      brief: body.brief?.trim() || "Summarise the source material into a carousel.",
      sourceText: body.sourceText,
      sourceLabel: body.sourceLabel,
      images,
      slideCount: clamp(body.slideCount ?? 7, 3, 10),
      tone: body.tone || "direct and practical",
      audience: body.audience,
    });

    const deck = buildDeck(generated, body.themeId, body.aspect);
    return NextResponse.json({ deck, caption: generated.caption, hashtags: generated.hashtags });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed.";
    console.error("[generate]", error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * Read uploads off disk rather than having the client re-send base64 it already
 * uploaded. Capped because every image is billed as input tokens.
 */
async function loadImages(assetIds: string[]) {
  const images: { mediaType: string; data: string }[] = [];
  for (const id of assetIds.slice(0, 6)) {
    const record = getAsset(id);
    if (!record) continue;
    try {
      const bytes = await readAssetBytes(record);
      images.push({ mediaType: record.media_type, data: bytes.toString("base64") });
    } catch {
      // A missing blob just means Claude writes without that image.
    }
  }
  return images;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(n)));
}
