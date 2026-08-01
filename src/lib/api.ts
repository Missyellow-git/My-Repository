"use client";

import type { Asset, Deck, Slide } from "./types";

/** Thin typed wrapper over the JSON API so components don't hand-roll fetch. */

export interface StoredDeck {
  id: string;
  deck: Deck;
  caption: string | null;
  hashtags: string[];
  createdAt: number;
  updatedAt: number;
}

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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      (payload as { error?: string }).error ?? `Request failed (${response.status})`,
      response.status,
      payload
    );
  }
  return payload as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown = null
  ) {
    super(message);
  }
}

export const api = {
  listDecks: () => request<{ decks: DeckSummary[] }>("/api/decks").then((r) => r.decks),

  getDeck: (id: string) => request<StoredDeck>(`/api/decks/${id}`),

  createDeck: (body: { deck: Deck; caption?: string | null; hashtags?: string[] }) =>
    request<StoredDeck>("/api/decks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),

  updateDeck: (
    id: string,
    body: { deck: Deck; caption?: string | null; hashtags?: string[] },
    signal?: AbortSignal
  ) =>
    request<StoredDeck>(`/api/decks/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),

  duplicateDeck: (id: string) => request<StoredDeck>(`/api/decks/${id}`, { method: "POST" }),

  deleteDeck: (id: string) => request<void>(`/api/decks/${id}`, { method: "DELETE" }),

  listAssets: () => request<{ assets: Asset[] }>("/api/assets").then((r) => r.assets),

  uploadAssets: (files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append("file", file);
    return request<{ assets: Asset[]; failed: { name: string; error: string }[] }>("/api/assets", {
      method: "POST",
      body: form,
    });
  },

  deleteAsset: (id: string, force = false) =>
    request<void>(`/api/assets/${id}${force ? "?force=true" : ""}`, { method: "DELETE" }),
};
