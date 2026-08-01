import { NextResponse } from "next/server";
import { generateDeck, type GenerateInput } from "@/lib/generate";
import { buildDeck } from "@/lib/layout";
import type { AspectId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Body extends GenerateInput {
  themeId: string;
  aspect: AspectId;
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

  if (!body.brief?.trim() && !body.sourceText?.trim() && !body.images?.length) {
    return NextResponse.json(
      { error: "Give me something to work with: a topic, some text, a link, or an image." },
      { status: 400 }
    );
  }

  try {
    const generated = await generateDeck({
      brief: body.brief?.trim() || "Summarise the source material into a carousel.",
      sourceText: body.sourceText,
      sourceLabel: body.sourceLabel,
      images: body.images,
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

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(n)));
}
