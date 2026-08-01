import { NextResponse } from "next/server";
import { createDeck, listDecks } from "@/lib/server/decks";
import type { Deck } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ decks: await listDecks() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    deck?: Deck;
    caption?: string | null;
    hashtags?: string[];
  } | null;

  if (!body?.deck?.slides?.length) {
    return NextResponse.json({ error: "A deck with at least one slide is required." }, { status: 400 });
  }

  const stored = await createDeck({
    deck: body.deck,
    caption: body.caption ?? null,
    hashtags: body.hashtags ?? [],
  });
  return NextResponse.json(stored, { status: 201 });
}
