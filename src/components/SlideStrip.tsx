"use client";

import SlideView from "./SlideView";
import { ASPECTS, type Deck } from "@/lib/types";

const THUMB_WIDTH = 86;

export default function SlideStrip({
  deck,
  activeIndex,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onMove,
}: {
  deck: Deck;
  activeIndex: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  const { w, h } = ASPECTS[deck.aspect];
  const thumbHeight = Math.round((THUMB_WIDTH * h) / w);

  return (
    <div className="flex items-start gap-3 overflow-x-auto border-t border-[#262a32] bg-[#131519] px-4 py-3">
      {deck.slides.map((slide, index) => {
        const active = index === activeIndex;
        return (
          <div key={slide.id} className="group shrink-0">
            <button
              type="button"
              onClick={() => onSelect(index)}
              className={`block overflow-hidden rounded-md border-2 transition-colors ${
                active ? "border-[#7c6bff]" : "border-transparent hover:border-[#454d5c]"
              }`}
              style={{ width: THUMB_WIDTH, height: thumbHeight }}
            >
              <SlideView slide={slide} width={THUMB_WIDTH} height={thumbHeight} />
            </button>

            <div className="mt-1 flex items-center justify-between px-0.5">
              <span className={`text-[10px] ${active ? "text-[#e9ecf1]" : "text-[#5f6674]"}`}>
                {index + 1} · {slide.role}
              </span>
              <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <IconButton title="Move left" onClick={() => onMove(index, -1)} disabled={index === 0}>
                  ‹
                </IconButton>
                <IconButton
                  title="Move right"
                  onClick={() => onMove(index, 1)}
                  disabled={index === deck.slides.length - 1}
                >
                  ›
                </IconButton>
                <IconButton title="Duplicate" onClick={() => onDuplicate(index)}>
                  ⧉
                </IconButton>
                <IconButton
                  title="Delete"
                  onClick={() => onDelete(index)}
                  disabled={deck.slides.length === 1}
                >
                  ✕
                </IconButton>
              </span>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onAdd}
        title="Add slide"
        className="shrink-0 rounded-md border border-dashed border-[#333a45] text-lg text-[#5f6674] transition-colors hover:border-[#7c6bff] hover:text-[#e9ecf1]"
        style={{ width: THUMB_WIDTH, height: thumbHeight }}
      >
        +
      </button>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded px-1 text-[10px] leading-4 text-[#8b93a1] hover:bg-[#22262e] hover:text-[#e9ecf1] disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
