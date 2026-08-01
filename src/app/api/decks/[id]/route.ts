import { NextResponse } from "next/server";
import { deleteDeck, duplicateDeck, getDeck, updateDeck } from "@/lib/server/decks";
import type { Deck } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const stored = getDeck((await params).id);
  if (!stored) return NextResponse.json({ error: "Deck not found." }, { status: 404 });
  return NextResponse.json(stored);
}

export async function PUT(request: Request, { params }: Params) {
  const body = (await request.json().catch(() => null)) as {
    deck?: Deck;
    caption?: string | null;
    hashtags?: string[];
  } | null;

  if (!body?.deck?.slides?.length) {
    return NextResponse.json({ error: "A deck with at least one slide is required." }, { status: 400 });
  }

  const stored = updateDeck((await params).id, {
    deck: body.deck,
    caption: body.caption,
    hashtags: body.hashtags,
  });
  if (!stored) return NextResponse.json({ error: "Deck not found." }, { status: 404 });
  return NextResponse.json(stored);
}

/** Duplicate lives here rather than on the collection so the source id is in the path. */
export async function POST(_request: Request, { params }: Params) {
  const copy = duplicateDeck((await params).id);
  if (!copy) return NextResponse.json({ error: "Deck not found." }, { status: 404 });
  return NextResponse.json(copy, { status: 201 });
}

export async function DELETE(_request: Request, { params }: Params) {
  const removed = deleteDeck((await params).id);
  if (!removed) return NextResponse.json({ error: "Deck not found." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
