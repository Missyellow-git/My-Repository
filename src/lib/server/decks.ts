import { db, newId } from "./db";
import type { Deck, Slide } from "../types";

interface DeckRow {
  id: string;
  title: string;
  aspect: string;
  theme_id: string;
  data: string;
  caption: string | null;
  hashtags: string;
  created_at: number;
  updated_at: number;
}

export interface StoredDeck {
  id: string;
  deck: Deck;
  caption: string | null;
  hashtags: string[];
  createdAt: number;
  updatedAt: number;
}

/** Enough to draw the library without shipping every slide of every deck. */
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

export function listDecks(): DeckSummary[] {
  return db()
    .prepare<[], DeckRow>("SELECT * FROM decks ORDER BY updated_at DESC")
    .all()
    .map((row) => {
      const deck = JSON.parse(row.data) as Deck;
      return {
        id: row.id,
        title: row.title,
        aspect: deck.aspect,
        themeId: deck.themeId,
        slideCount: deck.slides.length,
        cover: deck.slides[0] ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
}

export function getDeck(id: string): StoredDeck | null {
  const row = db().prepare<[string], DeckRow>("SELECT * FROM decks WHERE id = ?").get(id);
  return row ? hydrate(row) : null;
}

export function createDeck(input: {
  deck: Deck;
  caption?: string | null;
  hashtags?: string[];
}): StoredDeck {
  const now = Date.now();
  const row: DeckRow = {
    id: newId("deck"),
    title: input.deck.title || "Untitled carousel",
    aspect: input.deck.aspect,
    theme_id: input.deck.themeId,
    data: JSON.stringify(input.deck),
    caption: input.caption ?? null,
    hashtags: JSON.stringify(input.hashtags ?? []),
    created_at: now,
    updated_at: now,
  };

  db()
    .prepare(
      `INSERT INTO decks (id, title, aspect, theme_id, data, caption, hashtags, created_at, updated_at)
       VALUES (@id, @title, @aspect, @theme_id, @data, @caption, @hashtags, @created_at, @updated_at)`
    )
    .run(row);

  return hydrate(row);
}

export function updateDeck(
  id: string,
  input: { deck: Deck; caption?: string | null; hashtags?: string[] }
): StoredDeck | null {
  const existing = db().prepare<[string], DeckRow>("SELECT * FROM decks WHERE id = ?").get(id);
  if (!existing) return null;

  const row: DeckRow = {
    ...existing,
    title: input.deck.title || "Untitled carousel",
    aspect: input.deck.aspect,
    theme_id: input.deck.themeId,
    data: JSON.stringify(input.deck),
    caption: input.caption === undefined ? existing.caption : input.caption,
    hashtags: input.hashtags ? JSON.stringify(input.hashtags) : existing.hashtags,
    updated_at: Date.now(),
  };

  db()
    .prepare(
      `UPDATE decks
          SET title = @title, aspect = @aspect, theme_id = @theme_id, data = @data,
              caption = @caption, hashtags = @hashtags, updated_at = @updated_at
        WHERE id = @id`
    )
    .run(row);

  return hydrate(row);
}

export function duplicateDeck(id: string): StoredDeck | null {
  const source = getDeck(id);
  if (!source) return null;
  return createDeck({
    deck: { ...source.deck, title: `${source.deck.title} copy` },
    caption: source.caption,
    hashtags: source.hashtags,
  });
}

export function deleteDeck(id: string): boolean {
  return db().prepare("DELETE FROM decks WHERE id = ?").run(id).changes > 0;
}

function hydrate(row: DeckRow): StoredDeck {
  return {
    id: row.id,
    deck: JSON.parse(row.data) as Deck,
    caption: row.caption,
    hashtags: JSON.parse(row.hashtags) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
