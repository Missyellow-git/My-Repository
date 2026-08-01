"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckLibrary from "./DeckLibrary";
import GeneratePanel, { type GenerateRequest } from "./GeneratePanel";
import Inspector from "./Inspector";
import SlideCanvas from "./SlideCanvas";
import SlideStrip from "./SlideStrip";
import { Button } from "./ui";
import { api, type DeckSummary } from "@/lib/api";
import { buildDeck, imageElement, recolorDeck, uid } from "@/lib/layout";
import { SAMPLE_DECK } from "@/lib/sample";
import { getTheme, THEMES, DEFAULT_THEME_ID } from "@/lib/themes";
import { useDeckHistory } from "@/lib/useDeckHistory";
import {
  ASPECTS,
  type Asset,
  type AspectId,
  type Deck,
  type Slide,
  type SlideElement,
} from "@/lib/types";

/** Pre-database autosave key; still read once so old work is migrated, not lost. */
const LEGACY_STORAGE_KEY = "carousel-studio:v1";
const LAST_DECK_KEY = "carousel-studio:last-deck";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export default function Studio() {
  const { deck, commit, live, snapshot, replace, undo, redo, canUndo, canRedo } = useDeckHistory();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID);
  const [aspect, setAspect] = useState<AspectId>("portrait");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState<{ text: string; hashtags: string[] } | null>(null);
  const [showCaption, setShowCaption] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [restored, setRestored] = useState(false);

  /** Serialised copy of what the server last accepted, so autosave can skip
   *  no-op writes (opening a deck, or an edit that lands back where it was). */
  const savedSnapshot = useRef<string>("");

  const [stage, setStage] = useState({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);

  const slide = deck?.slides[Math.min(slideIndex, deck.slides.length - 1)] ?? null;
  const selected = slide?.elements.find((el) => el.id === selectedId) ?? null;

  // --- persistence ----------------------------------------------------------

  const refreshDecks = useCallback(async () => {
    try {
      setDecks(await api.listDecks());
    } catch {
      // The library just stays stale; editing is unaffected.
    }
  }, []);

  const openDeck = useCallback(
    async (id: string) => {
      try {
        const stored = await api.getDeck(id);
        replace(stored.deck);
        setDeckId(stored.id);
        setThemeId(stored.deck.themeId);
        setAspect(stored.deck.aspect);
        setCaption(
          stored.caption ? { text: stored.caption, hashtags: stored.hashtags } : null
        );
        setSlideIndex(0);
        setSelectedId(null);
        savedSnapshot.current = snapshotOf(stored.deck, stored.caption, stored.hashtags);
        setSaveState("saved");
        localStorage.setItem(LAST_DECK_KEY, stored.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't open that deck.");
      }
    },
    [replace]
  );

  // Initial load: assets, the deck list, and whichever deck was last open.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLibraryLoading(true);
      try {
        const [serverAssets, serverDecks] = await Promise.all([
          api.listAssets(),
          api.listDecks(),
        ]);
        if (cancelled) return;
        setAssets(serverAssets);
        setDecks(serverDecks);

        const imported = await importLegacyDeck(serverDecks.length === 0);
        if (cancelled) return;
        if (imported) {
          setDecks(await api.listDecks());
          await openDeck(imported);
        } else {
          const lastId = localStorage.getItem(LAST_DECK_KEY);
          if (lastId && serverDecks.some((d) => d.id === lastId)) await openDeck(lastId);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't reach the server.");
        }
      } finally {
        if (!cancelled) {
          setLibraryLoading(false);
          setRestored(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openDeck]);

  // Autosave: debounce edits, then create-or-update. Skipped when the payload
  // matches what the server already has, so opening a deck doesn't write back.
  useEffect(() => {
    if (!restored || !deck) return;

    const payload = snapshotOf(deck, caption?.text ?? null, caption?.hashtags ?? []);
    if (payload === savedSnapshot.current) return;

    setSaveState("dirty");
    const timer = setTimeout(async () => {
      setSaveState("saving");
      const body = {
        deck,
        caption: caption?.text ?? null,
        hashtags: caption?.hashtags ?? [],
      };
      try {
        const stored = deckId ? await api.updateDeck(deckId, body) : await api.createDeck(body);
        setDeckId(stored.id);
        localStorage.setItem(LAST_DECK_KEY, stored.id);
        savedSnapshot.current = payload;
        setSaveState("saved");
        void refreshDecks();
      } catch {
        setSaveState("error");
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [deck, caption, deckId, restored, refreshDecks]);

  // Don't let a browser close swallow the last few seconds of edits.
  useEffect(() => {
    if (saveState !== "dirty" && saveState !== "saving") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  // --- canvas sizing --------------------------------------------------------

  /**
   * A callback ref rather than an effect: the stage only mounts once a deck
   * exists, so an effect with an empty dependency list would run against a null
   * node and never observe anything.
   */
  const stageRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!node) {
      setStage({ width: 0, height: 0 });
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setStage({ width, height });
    });
    observer.observe(node);
    observerRef.current = observer;
    const rect = node.getBoundingClientRect();
    setStage({ width: rect.width, height: rect.height });
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const canvas = useMemo(() => {
    const ratio = ASPECTS[deck?.aspect ?? aspect];
    const pad = 32;
    const availableW = Math.max(0, stage.width - pad);
    const availableH = Math.max(0, stage.height - pad);
    if (!availableW || !availableH) return { width: 0, height: 0 };
    const width = Math.min(availableW, (availableH * ratio.w) / ratio.h);
    return { width: Math.round(width), height: Math.round((width * ratio.h) / ratio.w) };
  }, [stage, deck?.aspect, aspect]);

  // --- slide + element mutation --------------------------------------------

  const updateSlide = useCallback(
    (updater: (slide: Slide) => Slide, { transient = false } = {}) => {
      const apply = (current: Deck): Deck => ({
        ...current,
        slides: current.slides.map((s, i) => (i === slideIndex ? updater(s) : s)),
      });
      if (transient) live(apply);
      else commit(apply);
    },
    [commit, live, slideIndex]
  );

  const patchElement = useCallback(
    (id: string, patch: Partial<SlideElement>) => {
      updateSlide((s) => ({
        ...s,
        elements: s.elements.map((el) => (el.id === id ? ({ ...el, ...patch } as SlideElement) : el)),
      }));
    },
    [updateSlide]
  );

  const addElement = useCallback(
    (element: SlideElement) => {
      updateSlide((s) => ({ ...s, elements: [...s.elements, element] }));
      setSelectedId(element.id);
    },
    [updateSlide]
  );

  const elementOp = useCallback(
    (op: "duplicate" | "delete" | "front" | "back" | "forward" | "backward") => {
      if (!selectedId) return;
      updateSlide((s) => {
        const index = s.elements.findIndex((el) => el.id === selectedId);
        if (index < 0) return s;
        const elements = [...s.elements];
        const [element] = [elements[index]];

        switch (op) {
          case "delete":
            elements.splice(index, 1);
            break;
          case "duplicate": {
            const copy = { ...element, id: uid("el"), x: element.x + 2, y: element.y + 2 };
            elements.splice(index + 1, 0, copy);
            queueMicrotask(() => setSelectedId(copy.id));
            break;
          }
          case "front":
            elements.splice(index, 1);
            elements.push(element);
            break;
          case "back":
            elements.splice(index, 1);
            elements.unshift(element);
            break;
          case "forward":
            if (index < elements.length - 1) {
              elements.splice(index, 1);
              elements.splice(index + 1, 0, element);
            }
            break;
          case "backward":
            if (index > 0) {
              elements.splice(index, 1);
              elements.splice(index - 1, 0, element);
            }
            break;
        }
        return { ...s, elements };
      });
      if (op === "delete") setSelectedId(null);
    },
    [selectedId, updateSlide]
  );

  // --- slide operations -----------------------------------------------------

  const addSlide = useCallback(() => {
    commit((current) => {
      const theme = getTheme(current.themeId);
      const blank: Slide = {
        id: uid("sl"),
        role: "point",
        background: theme.background(current.slides.length, "point"),
        elements: [],
      };
      return { ...current, slides: [...current.slides, blank] };
    });
    setSlideIndex((i) => (deck ? deck.slides.length : i));
    setSelectedId(null);
  }, [commit, deck]);

  const duplicateSlide = useCallback(
    (index: number) => {
      commit((current) => {
        const copy: Slide = {
          ...current.slides[index],
          id: uid("sl"),
          elements: current.slides[index].elements.map((el) => ({ ...el, id: uid("el") })),
        };
        const slides = [...current.slides];
        slides.splice(index + 1, 0, copy);
        return { ...current, slides };
      });
      setSlideIndex(index + 1);
      setSelectedId(null);
    },
    [commit]
  );

  const deleteSlide = useCallback(
    (index: number) => {
      commit((current) => ({
        ...current,
        slides: current.slides.filter((_, i) => i !== index),
      }));
      setSlideIndex((i) => Math.max(0, Math.min(i, (deck?.slides.length ?? 1) - 2)));
      setSelectedId(null);
    },
    [commit, deck]
  );

  const moveSlide = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      commit((current) => {
        if (target < 0 || target >= current.slides.length) return current;
        const slides = [...current.slides];
        [slides[index], slides[target]] = [slides[target], slides[index]];
        return { ...current, slides };
      });
      setSlideIndex(target);
    },
    [commit]
  );

  // --- generation + export --------------------------------------------------

  async function generate(request: GenerateRequest) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Generation failed.");
      replace(data.deck as Deck);
      setCaption({ text: data.caption, hashtags: data.hashtags });
      setThemeId(request.themeId);
      setAspect(request.aspect);
      setSlideIndex(0);
      setSelectedId(null);
      startNewRow();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }

  /** Point autosave at a fresh row, leaving whatever was open saved as-is. */
  const startNewRow = useCallback(() => {
    setDeckId(null);
    savedSnapshot.current = "";
    setSaveState("dirty");
  }, []);

  const loadSample = useCallback(() => {
    replace(buildDeck(SAMPLE_DECK, themeId, aspect));
    setCaption({ text: SAMPLE_DECK.caption, hashtags: SAMPLE_DECK.hashtags });
    setSlideIndex(0);
    setSelectedId(null);
    startNewRow();
  }, [aspect, replace, themeId, startNewRow]);

  const newDeck = useCallback(() => {
    replace(null);
    setDeckId(null);
    setCaption(null);
    setSlideIndex(0);
    setSelectedId(null);
    savedSnapshot.current = "";
    setSaveState("idle");
    localStorage.removeItem(LAST_DECK_KEY);
    setLibraryOpen(false);
  }, [replace]);

  const duplicateDeck = useCallback(
    async (id: string) => {
      try {
        const copy = await api.duplicateDeck(id);
        await refreshDecks();
        await openDeck(copy.id);
        setLibraryOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't duplicate that deck.");
      }
    },
    [openDeck, refreshDecks]
  );

  const removeDeck = useCallback(
    async (id: string) => {
      try {
        await api.deleteDeck(id);
        // Deleting the deck you're editing clears the canvas rather than
        // leaving an editor pointed at a row that no longer exists.
        if (id === deckId) newDeck();
        await refreshDecks();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't delete that deck.");
      }
    },
    [deckId, newDeck, refreshDecks]
  );

  const removeAsset = useCallback(async (id: string) => {
    try {
      await api.deleteAsset(id);
      setAssets((current) => current.filter((asset) => asset.id !== id));
    } catch (e) {
      // A 409 means a saved deck still uses the image — say so rather than
      // silently leaving it in the tray.
      setError(e instanceof Error ? e.message : "Couldn't delete that image.");
    }
  }, []);

  async function exportZip() {
    if (!deck) return;
    setExporting(true);
    setError(null);
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deck, scale: 1 }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Export failed.");
      }
      const blob = await response.blob();
      downloadBlob(blob, `${slugify(deck.title)}.zip`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  function exportJson() {
    if (!deck) return;
    downloadBlob(
      new Blob([JSON.stringify(deck, null, 2)], { type: "application/json" }),
      `${slugify(deck.title)}.json`
    );
  }

  // --- keyboard -------------------------------------------------------------

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }

      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }
      if (meta && event.key.toLowerCase() === "d") {
        event.preventDefault();
        elementOp("duplicate");
        return;
      }
      if (!selectedId) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        elementOp("delete");
        return;
      }
      if (event.key === "Escape") {
        setSelectedId(null);
        return;
      }

      const step = event.shiftKey ? 2 : 0.25;
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = nudge[event.key];
      if (delta && selected) {
        event.preventDefault();
        patchElement(selectedId, {
          x: round(selected.x + delta[0]),
          y: round(selected.y + delta[1]),
        });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [elementOp, patchElement, redo, selected, selectedId, undo]);

  // --- render ---------------------------------------------------------------

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar
        deck={deck}
        themeId={themeId}
        aspect={aspect}
        canUndo={canUndo}
        canRedo={canRedo}
        exporting={exporting}
        hasCaption={!!caption}
        saveState={saveState}
        deckCount={decks.length}
        onOpenLibrary={() => {
          setLibraryOpen(true);
          void refreshDecks();
        }}
        onTitleChange={(title) => commit((current) => ({ ...current, title }))}
        onThemeChange={(id) => {
          setThemeId(id);
          if (deck) commit((current) => recolorDeck(current, id));
        }}
        onAspectChange={(next) => {
          setAspect(next);
          if (deck) commit((current) => ({ ...current, aspect: next }));
        }}
        onUndo={undo}
        onRedo={redo}
        onExport={exportZip}
        onExportJson={exportJson}
        onShowCaption={() => setShowCaption(true)}
      />

      <div className="flex min-h-0 flex-1">
        <aside className="w-[320px] shrink-0 border-r border-[#262a32] bg-[#131519]">
          <GeneratePanel
            assets={assets}
            onAddAssets={(next) => setAssets((current) => [...current, ...next])}
            onRemoveAsset={removeAsset}
            themeId={themeId}
            onThemeChange={(id) => {
              setThemeId(id);
              if (deck) commit((current) => recolorDeck(current, id));
            }}
            aspect={aspect}
            onAspectChange={(next) => {
              setAspect(next);
              if (deck) commit((current) => ({ ...current, aspect: next }));
            }}
            onGenerate={generate}
            busy={busy}
            error={error}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {deck && slide ? (
            <>
              <InsertBar
                assets={assets}
                themeId={deck.themeId}
                onInsert={addElement}
                disabled={!slide}
              />
              <div ref={stageRef} className="flex min-h-0 flex-1 items-center justify-center p-4">
                {canvas.width > 0 && (
                  <div className="shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
                    <SlideCanvas
                      slide={slide}
                      width={canvas.width}
                      height={canvas.height}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      onSnapshot={snapshot}
                      onLive={(updater) => updateSlide(updater, { transient: true })}
                    />
                  </div>
                )}
              </div>
              <SlideStrip
                deck={deck}
                activeIndex={slideIndex}
                onSelect={(index) => {
                  setSlideIndex(index);
                  setSelectedId(null);
                }}
                onAdd={addSlide}
                onDuplicate={duplicateSlide}
                onDelete={deleteSlide}
                onMove={moveSlide}
              />
            </>
          ) : (
            <EmptyState busy={busy} onLoadSample={loadSample} />
          )}
        </main>

        <aside className="w-[300px] shrink-0 border-l border-[#262a32] bg-[#131519]">
          {deck && slide ? (
            <Inspector
              deck={deck}
              slide={slide}
              selected={selected}
              assets={assets}
              onSlideChange={(patch) => updateSlide((s) => ({ ...s, ...patch }))}
              onElementChange={patchElement}
              onElementOp={elementOp}
            />
          ) : (
            <div className="px-4 py-6 text-[11px] leading-relaxed text-[#5f6674]">
              The inspector appears once you have a deck.
            </div>
          )}
        </aside>
      </div>

      {showCaption && caption && (
        <CaptionDrawer caption={caption} onClose={() => setShowCaption(false)} />
      )}

      {libraryOpen && (
        <DeckLibrary
          decks={decks}
          currentId={deckId}
          loading={libraryLoading}
          onOpen={(id) => {
            void openDeck(id);
            setLibraryOpen(false);
          }}
          onDuplicate={(id) => void duplicateDeck(id)}
          onDelete={(id) => void removeDeck(id)}
          onNew={newDeck}
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </div>
  );
}

// --- sub-components ----------------------------------------------------------

function TopBar({
  deck,
  themeId,
  aspect,
  canUndo,
  canRedo,
  exporting,
  hasCaption,
  saveState,
  deckCount,
  onOpenLibrary,
  onTitleChange,
  onThemeChange,
  onAspectChange,
  onUndo,
  onRedo,
  onExport,
  onExportJson,
  onShowCaption,
}: {
  deck: Deck | null;
  themeId: string;
  aspect: AspectId;
  canUndo: boolean;
  canRedo: boolean;
  exporting: boolean;
  hasCaption: boolean;
  saveState: SaveState;
  deckCount: number;
  onOpenLibrary: () => void;
  onTitleChange: (title: string) => void;
  onThemeChange: (id: string) => void;
  onAspectChange: (aspect: AspectId) => void;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  onExportJson: () => void;
  onShowCaption: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[#262a32] bg-[#131519] px-4">
      <span className="text-[13px] font-semibold tracking-tight">Carousel Studio</span>
      <span className="h-4 w-px bg-[#262a32]" />

      {deck ? (
        <input
          value={deck.title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[#8b93a1] outline-none focus:text-[#e9ecf1]"
        />
      ) : (
        <span className="flex-1 text-[12px] text-[#5f6674]">No deck yet</span>
      )}

      {deck && <SaveIndicator state={saveState} />}

      <Button onClick={onOpenLibrary} title="Open a saved deck">
        Decks{deckCount ? ` (${deckCount})` : ""}
      </Button>

      <select
        value={themeId}
        onChange={(e) => onThemeChange(e.target.value)}
        className="rounded-md border border-[#333a45] bg-[#1a1d23] px-2 py-1 text-[11px] text-[#e9ecf1] outline-none"
      >
        {THEMES.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.name}
          </option>
        ))}
      </select>

      <select
        value={aspect}
        onChange={(e) => onAspectChange(e.target.value as AspectId)}
        className="rounded-md border border-[#333a45] bg-[#1a1d23] px-2 py-1 text-[11px] text-[#e9ecf1] outline-none"
      >
        {(Object.keys(ASPECTS) as AspectId[]).map((id) => (
          <option key={id} value={id}>
            {ASPECTS[id].label}
          </option>
        ))}
      </select>

      <span className="h-4 w-px bg-[#262a32]" />
      <Button variant="ghost" onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)">
        ↶
      </Button>
      <Button variant="ghost" onClick={onRedo} disabled={!canRedo} title="Redo (⇧⌘Z)">
        ↷
      </Button>
      <span className="h-4 w-px bg-[#262a32]" />
      <Button onClick={onShowCaption} disabled={!hasCaption}>
        Caption
      </Button>
      <Button onClick={onExportJson} disabled={!deck} title="Download the deck as JSON">
        .json
      </Button>
      <Button variant="primary" onClick={onExport} disabled={!deck || exporting}>
        {exporting ? "Rendering…" : "Export PNGs"}
      </Button>
    </header>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const label: Record<SaveState, string> = {
    idle: "",
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved",
    error: "Save failed — retrying on next edit",
  };
  const tone =
    state === "error" ? "text-[#f27b7b]" : state === "saved" ? "text-[#5f6674]" : "text-[#8b93a1]";
  if (!label[state]) return null;

  return (
    <span className={`shrink-0 text-[11px] ${tone}`} title="Decks autosave to the local database">
      {label[state]}
    </span>
  );
}

function InsertBar({
  assets,
  themeId,
  onInsert,
  disabled,
}: {
  assets: Asset[];
  themeId: string;
  onInsert: (element: SlideElement) => void;
  disabled: boolean;
}) {
  const theme = getTheme(themeId);

  function addText(kind: "heading" | "body") {
    onInsert({
      id: uid("tx"),
      type: "text",
      x: 12,
      y: 40,
      w: 70,
      h: kind === "heading" ? 14 : 10,
      rotation: 0,
      opacity: 1,
      text: kind === "heading" ? "New headline" : "Supporting line of text",
      style: {
        fontFamily: kind === "heading" ? theme.fonts.display : theme.fonts.body,
        fontSize: kind === "heading" ? 64 : 32,
        fontWeight: kind === "heading" ? theme.weights.display : 400,
        lineHeight: kind === "heading" ? 1.1 : 1.4,
        letterSpacing: kind === "heading" ? theme.displayTracking : 0,
        color: theme.palette.ink,
        align: "left",
        vAlign: "top",
        italic: false,
        uppercase: kind === "heading" ? theme.displayUppercase : false,
      },
    });
  }

  function addShape(shape: "rect" | "ellipse" | "line") {
    onInsert({
      id: uid("sh"),
      type: "shape",
      shape,
      x: 20,
      y: 40,
      w: shape === "line" ? 40 : 30,
      h: shape === "line" ? 1 : 20,
      rotation: 0,
      opacity: 1,
      fill: theme.palette.accent,
      radius: shape === "line" ? 4 : theme.radius,
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[#262a32] bg-[#0f1114] px-4 py-2">
      <span className="mr-1 text-[10px] uppercase tracking-[0.14em] text-[#5f6674]">Insert</span>
      <Button onClick={() => addText("heading")} disabled={disabled}>
        Heading
      </Button>
      <Button onClick={() => addText("body")} disabled={disabled}>
        Text
      </Button>
      <Button onClick={() => addShape("rect")} disabled={disabled}>
        Rect
      </Button>
      <Button onClick={() => addShape("ellipse")} disabled={disabled}>
        Ellipse
      </Button>
      <Button onClick={() => addShape("line")} disabled={disabled}>
        Bar
      </Button>

      {assets.length > 0 && (
        <>
          <span className="mx-1 h-4 w-px bg-[#262a32]" />
          <span className="text-[10px] uppercase tracking-[0.14em] text-[#5f6674]">Images</span>
          <div className="flex gap-1.5">
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                title={`Insert ${asset.name}`}
                onClick={() => onInsert(imageElement(asset.url))}
                className="h-7 w-7 overflow-hidden rounded border border-[#333a45] hover:border-[#7c6bff]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </>
      )}

      <span className="ml-auto text-[10px] text-[#5f6674]">
        Drag to move · ⇧ to constrain · double-click text to edit · ⌫ to delete
      </span>
    </div>
  );
}

function EmptyState({ busy, onLoadSample }: { busy: boolean; onLoadSample: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <div
        className="mb-2 h-28 w-[90px] rounded-lg border border-[#262a32]"
        style={{
          background: "linear-gradient(150deg,#1b2150,#0e1130)",
          boxShadow: "0 20px 50px rgba(0,0,0,.5)",
        }}
      />
      <h2 className="text-lg font-semibold">
        {busy ? "Writing your slides…" : "Start with a brief"}
      </h2>
      <p className="max-w-sm text-[12px] leading-relaxed text-[#5f6674]">
        {busy
          ? "Claude is drafting the hook, the middle slides, and the call to action."
          : "Give Claude a topic, paste an article, drop in a link, or upload images. You'll get an editable deck — every word, colour, and box is yours to change."}
      </p>
      {!busy && (
        <Button onClick={onLoadSample} className="mt-2">
          Load a sample deck
        </Button>
      )}
    </div>
  );
}

function CaptionDrawer({
  caption,
  onClose,
}: {
  caption: { text: string; hashtags: string[] };
  onClose: () => void;
}) {
  const tags = caption.hashtags.map((t) => `#${t}`).join(" ");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-[#262a32] bg-[#131519] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Post caption</h3>
          <Button variant="ghost" onClick={onClose}>
            ✕
          </Button>
        </div>

        <pre className="whitespace-pre-wrap rounded-md border border-[#262a32] bg-[#1a1d23] p-3 text-[12px] leading-relaxed text-[#e9ecf1]">
          {caption.text}
        </pre>
        <div className="mt-2 flex gap-2">
          <Button onClick={() => navigator.clipboard.writeText(caption.text)}>Copy caption</Button>
          <Button onClick={() => navigator.clipboard.writeText(`${caption.text}\n\n${tags}`)}>
            Copy with hashtags
          </Button>
        </div>

        {caption.hashtags.length > 0 && (
          <>
            <h4 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8b93a1]">
              Hashtags
            </h4>
            <p className="rounded-md border border-[#262a32] bg-[#1a1d23] p-3 text-[12px] leading-relaxed text-[#8b93a1]">
              {tags}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// --- helpers -----------------------------------------------------------------

/** What autosave compares against; caption changes count as edits too. */
function snapshotOf(deck: Deck, caption: string | null, hashtags: string[]) {
  return JSON.stringify({ deck, caption, hashtags });
}

/**
 * Decks used to live in localStorage. Import one on first run so upgrading
 * doesn't look like the app lost your work, then drop the old key.
 */
async function importLegacyDeck(serverIsEmpty: boolean): Promise<string | null> {
  if (!serverIsEmpty) return null;
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return null;

  try {
    const saved = JSON.parse(raw) as {
      deck?: Deck;
      caption?: { text: string; hashtags: string[] } | null;
    };
    if (!saved.deck?.slides?.length) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return null;
    }
    const stored = await api.createDeck({
      deck: saved.deck,
      caption: saved.caption?.text ?? null,
      hashtags: saved.caption?.hashtags ?? [],
    });
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return stored.id;
  } catch {
    // Leave the key in place so a later run can try again.
    return null;
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "carousel"
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
