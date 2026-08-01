import {
  newId,
  summarise,
  type AssetDriver,
  type AssetRecord,
  type DeckDriver,
  type DeckInput,
  type Drivers,
  type StoredDeck,
} from "../store";

/**
 * In-process storage for a serverless deployment with no database configured.
 *
 * The alternative would be SQLite in /tmp, which means loading a native module
 * to write to a disk that is wiped anyway. This keeps such a deployment usable
 * — generate, edit, and export all work within an instance — without pretending
 * the data is durable. `isEphemeral()` drives the warning the UI shows.
 */

const decksById = new Map<string, StoredDeck>();
const assetsById = new Map<string, { record: AssetRecord; bytes: Buffer }>();

const decks: DeckDriver = {
  async list() {
    return [...decksById.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((entry) =>
        summarise(entry.id, entry.deck, entry.createdAt, entry.updatedAt, entry.deck.title)
      );
  },

  async get(id) {
    return decksById.get(id) ?? null;
  },

  async create(input: DeckInput) {
    const now = Date.now();
    const stored: StoredDeck = {
      id: newId("deck"),
      deck: input.deck,
      caption: input.caption ?? null,
      hashtags: input.hashtags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    decksById.set(stored.id, stored);
    return stored;
  },

  async update(id, input) {
    const existing = decksById.get(id);
    if (!existing) return null;
    const stored: StoredDeck = {
      ...existing,
      deck: input.deck,
      caption: input.caption === undefined ? existing.caption : input.caption,
      hashtags: input.hashtags ?? existing.hashtags,
      updatedAt: Date.now(),
    };
    decksById.set(id, stored);
    return stored;
  },

  async remove(id) {
    return decksById.delete(id);
  },

  async countReferencing(assetUrl) {
    return [...decksById.values()].filter((entry) =>
      JSON.stringify(entry.deck).includes(assetUrl)
    ).length;
  },
};

const assets: AssetDriver = {
  async list() {
    return [...assetsById.values()]
      .map((entry) => entry.record)
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  async get(id) {
    return assetsById.get(id)?.record ?? null;
  },

  async findByDigest(sha256) {
    for (const entry of assetsById.values()) {
      if (entry.record.sha256 === sha256) return entry.record;
    }
    return null;
  },

  async create(record, bytes) {
    assetsById.set(record.id, { record, bytes });
    return record;
  },

  async read(record) {
    const entry = assetsById.get(record.id);
    if (!entry) throw new Error("Asset bytes are no longer in memory.");
    return entry.bytes;
  },

  async remove(record) {
    assetsById.delete(record.id);
  },

  publicUrl() {
    return null;
  },
};

export function memoryDrivers(): Drivers {
  return { decks, assets };
}
