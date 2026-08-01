import { drivers, type DeckInput, type DeckSummary, type StoredDeck } from "./store";

/** Deck operations, delegated to whichever storage driver is active. */

export type { DeckSummary, StoredDeck };

export async function listDecks(): Promise<DeckSummary[]> {
  return (await drivers()).decks.list();
}

export async function getDeck(id: string): Promise<StoredDeck | null> {
  return (await drivers()).decks.get(id);
}

export async function createDeck(input: DeckInput): Promise<StoredDeck> {
  return (await drivers()).decks.create(input);
}

export async function updateDeck(id: string, input: DeckInput): Promise<StoredDeck | null> {
  return (await drivers()).decks.update(id, input);
}

export async function duplicateDeck(id: string): Promise<StoredDeck | null> {
  const source = await getDeck(id);
  if (!source) return null;
  return createDeck({
    deck: { ...source.deck, title: `${source.deck.title} copy` },
    caption: source.caption,
    hashtags: source.hashtags,
  });
}

export async function deleteDeck(id: string): Promise<boolean> {
  return (await drivers()).decks.remove(id);
}
