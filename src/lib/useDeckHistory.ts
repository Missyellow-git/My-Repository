"use client";

import { useCallback, useRef, useState } from "react";
import type { Deck } from "./types";

const LIMIT = 60;

/**
 * Undo/redo for the deck.
 *
 * Dragging an element fires a mutation on every pointer move, so edits come in
 * two flavours: `commit` (one discrete change, pushes history) and `live`
 * (mid-gesture, no history). A gesture calls `snapshot()` once on pointer-down
 * and then `live()` freely, which is what makes one drag equal one undo.
 */
export function useDeckHistory() {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [past, setPast] = useState<Deck[]>([]);
  const [future, setFuture] = useState<Deck[]>([]);
  const deckRef = useRef<Deck | null>(null);
  deckRef.current = deck;

  const push = useCallback((snapshotDeck: Deck | null) => {
    if (!snapshotDeck) return;
    setPast((p) => [...p.slice(-LIMIT), snapshotDeck]);
    setFuture([]);
  }, []);

  /** Apply a change and record it as one undoable step. */
  const commit = useCallback(
    (updater: (current: Deck) => Deck) => {
      const current = deckRef.current;
      if (!current) return;
      push(current);
      setDeck(updater(current));
    },
    [push]
  );

  /** Apply a change without touching history — for mid-gesture updates. */
  const live = useCallback((updater: (current: Deck) => Deck) => {
    setDeck((current) => (current ? updater(current) : current));
  }, []);

  /** Record the current state as the undo point for a gesture about to start. */
  const snapshot = useCallback(() => push(deckRef.current), [push]);

  /** Replace the whole deck (new generation, import, reset). */
  const replace = useCallback(
    (next: Deck | null, { keepHistory = false } = {}) => {
      if (keepHistory) push(deckRef.current);
      else {
        setPast([]);
        setFuture([]);
      }
      setDeck(next);
    },
    [push]
  );

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      const previous = p[p.length - 1];
      setFuture((f) => (deckRef.current ? [deckRef.current, ...f] : f));
      setDeck(previous);
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setPast((p) => (deckRef.current ? [...p, deckRef.current] : p));
      setDeck(next);
      return f.slice(1);
    });
  }, []);

  return {
    deck,
    commit,
    live,
    snapshot,
    replace,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
