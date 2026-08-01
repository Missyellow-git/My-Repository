"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import SlideView from "./SlideView";
import { DESIGN_WIDTH, frameStyle, textStyle } from "@/lib/render";
import type { Slide, SlideElement } from "@/lib/types";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface Gesture {
  mode: "move" | "resize" | "rotate";
  handle?: Handle;
  pointerId: number;
  startX: number;
  startY: number;
  origin: { x: number; y: number; w: number; h: number; rotation: number };
  centerX: number;
  centerY: number;
}

const MIN_SIZE = 2; // percent
const SNAP = 0.7; // percent — how close before an edge grabs a guide

export default function SlideCanvas({
  slide,
  width,
  height,
  selectedId,
  onSelect,
  onSnapshot,
  onLive,
}: {
  slide: Slide;
  width: number;
  height: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSnapshot: () => void;
  onLive: (updater: (slide: Slide) => Slide) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const gesture = useRef<Gesture | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const scale = width / DESIGN_WIDTH;

  /**
   * The in-place editor can be torn down by a blur *or* by the element
   * unmounting (clicking the background clears the selection, which closes the
   * editor). Keeping the draft in a ref means the text is committed either way
   * instead of being silently dropped.
   */
  const draft = useRef<{ id: string; value: string } | null>(null);

  const endEditing = useCallback(() => {
    const pending = draft.current;
    draft.current = null;
    setEditingId(null);
    if (!pending) return;
    onSnapshot();
    onLive((current) => ({
      ...current,
      elements: current.elements.map((el) =>
        el.id === pending.id && el.type === "text" && el.text !== pending.value
          ? { ...el, text: pending.value }
          : el
      ),
    }));
  }, [onLive, onSnapshot]);

  // Selecting something else, or moving to another slide, ends the edit.
  useEffect(() => {
    if (editingId && editingId !== selectedId) endEditing();
  }, [selectedId, editingId, endEditing]);
  useEffect(() => {
    if (editingId) endEditing();
    // Only react to a slide change; endEditing is stable enough for this guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide.id]);

  useLayoutEffect(() => {
    if (!editingId || !editorRef.current) return;
    const node = editorRef.current;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editingId]);

  function patch(id: string, changes: Partial<SlideElement>) {
    onLive((current) => ({
      ...current,
      elements: current.elements.map((el) =>
        el.id === id ? ({ ...el, ...changes } as SlideElement) : el
      ),
    }));
  }

  function startGesture(
    event: React.PointerEvent,
    el: SlideElement,
    mode: Gesture["mode"],
    handle?: Handle
  ) {
    if (el.locked) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(el.id);
    onSnapshot();

    const rect = event.currentTarget.closest("[data-canvas]")!.getBoundingClientRect();
    gesture.current = {
      mode,
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation },
      centerX: rect.left + ((el.x + el.w / 2) / 100) * rect.width,
      centerY: rect.top + ((el.y + el.h / 2) / 100) * rect.height,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent, el: SlideElement) {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;

    const dx = ((event.clientX - g.startX) / width) * 100;
    const dy = ((event.clientY - g.startY) / height) * 100;

    if (g.mode === "rotate") {
      const angle =
        (Math.atan2(event.clientY - g.centerY, event.clientX - g.centerX) * 180) / Math.PI + 90;
      patch(el.id, { rotation: event.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle) });
      return;
    }

    if (g.mode === "move") {
      // Shift locks the drag to whichever axis has moved further.
      const lockX = event.shiftKey && Math.abs(dx) < Math.abs(dy);
      const lockY = event.shiftKey && Math.abs(dy) <= Math.abs(dx);
      const next = {
        x: lockX ? g.origin.x : g.origin.x + dx,
        y: lockY ? g.origin.y : g.origin.y + dy,
      };
      const snapped = applySnap(next.x, next.y, g.origin.w, g.origin.h, setGuides);
      patch(el.id, snapped);
      return;
    }

    const h = g.handle!;
    let { x, y, w, h: hh } = g.origin;
    if (h.includes("w")) {
      x = g.origin.x + dx;
      w = g.origin.w - dx;
    }
    if (h.includes("e")) w = g.origin.w + dx;
    if (h.includes("n")) {
      y = g.origin.y + dy;
      hh = g.origin.h - dy;
    }
    if (h.includes("s")) hh = g.origin.h + dy;

    // Shift preserves the original aspect ratio on corner handles.
    if (event.shiftKey && h.length === 2) {
      const ratio = g.origin.h / g.origin.w;
      hh = w * ratio;
      if (h.includes("n")) y = g.origin.y + (g.origin.h - hh);
    }

    if (w < MIN_SIZE) {
      if (h.includes("w")) x = g.origin.x + g.origin.w - MIN_SIZE;
      w = MIN_SIZE;
    }
    if (hh < MIN_SIZE) {
      if (h.includes("n")) y = g.origin.y + g.origin.h - MIN_SIZE;
      hh = MIN_SIZE;
    }

    patch(el.id, { x: round(x), y: round(y), w: round(w), h: round(hh) });
  }

  function endGesture(event: React.PointerEvent) {
    const g = gesture.current;
    if (g && g.pointerId === event.pointerId) {
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
      gesture.current = null;
      setGuides({ v: [], h: [] });
    }
  }

  const selected = slide.elements.find((el) => el.id === selectedId) ?? null;

  return (
    <div
      data-canvas
      className="relative select-none"
      style={{ width, height }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      <SlideView slide={slide} width={width} height={height} hiddenElementId={editingId} />

      {/* Interaction layer: one transparent hit-box per element. It covers the
          whole canvas, so blank-space clicks land here rather than on the root. */}
      <div
        className="absolute inset-0"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        {slide.elements.map((el) => {
          const isSelected = el.id === selectedId;
          const isEditing = el.id === editingId;
          return (
            <div
              key={el.id}
              style={{ ...frameStyle(el), opacity: 1, cursor: el.locked ? "default" : "move" }}
              onPointerDown={(e) => {
                if (isEditing) return;
                startGesture(e, el, "move");
              }}
              onPointerMove={(e) => onPointerMove(e, el)}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
              onDoubleClick={(e) => {
                if (el.type !== "text" || el.locked) return;
                e.stopPropagation();
                onSelect(el.id);
                setEditingId(el.id);
              }}
            >
              {isEditing && el.type === "text" && (
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  style={{ ...textStyle(el, scale), outline: "none", cursor: "text" }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onInput={(e) => {
                    draft.current = {
                      id: el.id,
                      value: readEditorText(e.currentTarget as HTMLDivElement),
                    };
                  }}
                  onBlur={endEditing}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") {
                      e.preventDefault();
                      editorRef.current?.blur();
                    }
                  }}
                >
                  {el.text}
                </div>
              )}

              {isSelected && !isEditing && (
                <div
                  className="pointer-events-none absolute -inset-px border"
                  style={{ borderColor: el.locked ? "#8b93a1" : "#7c6bff" }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Resize + rotate handles, drawn outside the element so they stay
          clickable on very small elements. */}
      {selected && !selected.locked && editingId !== selected.id && (
        <div style={{ ...frameStyle(selected), opacity: 1 }} className="pointer-events-none">
          {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as Handle[]).map((handle) => (
            <div
              key={handle}
              className="pointer-events-auto absolute"
              style={handleStyle(handle)}
              onPointerDown={(e) => startGesture(e, selected, "resize", handle)}
              onPointerMove={(e) => onPointerMove(e, selected)}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
            />
          ))}
          <div
            className="pointer-events-auto absolute"
            style={{
              left: "50%",
              top: -26,
              width: 12,
              height: 12,
              marginLeft: -6,
              borderRadius: "50%",
              background: "#7c6bff",
              border: "2px solid #fff",
              cursor: "grab",
            }}
            onPointerDown={(e) => startGesture(e, selected, "rotate")}
            onPointerMove={(e) => onPointerMove(e, selected)}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
          />
        </div>
      )}

      {/* Alignment guides, shown only while a drag is snapping. */}
      <div className="pointer-events-none absolute inset-0">
        {guides.v.map((v) => (
          <div
            key={`v${v}`}
            className="absolute top-0 bottom-0 w-px"
            style={{ left: `${v}%`, background: "#7c6bff" }}
          />
        ))}
        {guides.h.map((h) => (
          <div
            key={`h${h}`}
            className="absolute left-0 right-0 h-px"
            style={{ top: `${h}%`, background: "#7c6bff" }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Read the edited copy back out of the contenteditable.
 *
 * `innerText` would be the obvious choice, but it returns text with CSS
 * `text-transform` already applied — editing a headline under an uppercase
 * theme would permanently shout the stored string. Walking text nodes keeps the
 * source casing while still turning the browser's block/`<br>` structure back
 * into newlines.
 */
function readEditorText(root: HTMLElement): string {
  const lines: string[] = [];
  let current = "";

  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        current += child.textContent ?? "";
      } else if (child.nodeName === "BR") {
        lines.push(current);
        current = "";
      } else {
        if (current) {
          lines.push(current);
          current = "";
        }
        const before = lines.length;
        walk(child);
        if (current) {
          lines.push(current);
          current = "";
        } else if (lines.length === before) {
          lines.push("");
        }
      }
    });
  };

  walk(root);
  if (current) lines.push(current);
  return lines.join("\n").replace(/\u00a0/g, " ");
}

/** Canvas guides: the 9% type margins and the two centre lines. */
const V_GUIDES = [9, 50, 91];
const H_GUIDES = [50];

function applySnap(
  x: number,
  y: number,
  w: number,
  h: number,
  setGuides: (g: { v: number[]; h: number[] }) => void
) {
  const hits: { v: number[]; h: number[] } = { v: [], h: [] };
  let nx = x;
  let ny = y;

  for (const guide of V_GUIDES) {
    for (const [edge, offset] of [
      [x, 0],
      [x + w / 2, w / 2],
      [x + w, w],
    ] as const) {
      if (Math.abs(edge - guide) < SNAP) {
        nx = guide - offset;
        hits.v.push(guide);
      }
    }
  }
  for (const guide of H_GUIDES) {
    for (const [edge, offset] of [
      [y, 0],
      [y + h / 2, h / 2],
      [y + h, h],
    ] as const) {
      if (Math.abs(edge - guide) < SNAP) {
        ny = guide - offset;
        hits.h.push(guide);
      }
    }
  }

  setGuides(hits);
  return { x: round(nx), y: round(ny) };
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function handleStyle(handle: Handle): React.CSSProperties {
  const pos: Record<Handle, { left?: string; top?: string; cursor: string }> = {
    nw: { left: "0%", top: "0%", cursor: "nwse-resize" },
    n: { left: "50%", top: "0%", cursor: "ns-resize" },
    ne: { left: "100%", top: "0%", cursor: "nesw-resize" },
    e: { left: "100%", top: "50%", cursor: "ew-resize" },
    se: { left: "100%", top: "100%", cursor: "nwse-resize" },
    s: { left: "50%", top: "100%", cursor: "ns-resize" },
    sw: { left: "0%", top: "100%", cursor: "nesw-resize" },
    w: { left: "0%", top: "50%", cursor: "ew-resize" },
  };
  return {
    ...pos[handle],
    width: 10,
    height: 10,
    marginLeft: -5,
    marginTop: -5,
    background: "#fff",
    border: "1.5px solid #7c6bff",
    borderRadius: 2,
  };
}
