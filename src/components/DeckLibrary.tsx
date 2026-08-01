"use client";

import { useState } from "react";
import SlideView from "./SlideView";
import { Button } from "./ui";
import type { DeckSummary } from "@/lib/api";
import { ASPECTS } from "@/lib/types";

const THUMB = 72;

export default function DeckLibrary({
  decks,
  currentId,
  loading,
  onOpen,
  onDuplicate,
  onDelete,
  onNew,
  onClose,
}: {
  decks: DeckSummary[];
  currentId: string | null;
  loading: boolean;
  onOpen: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-8"
      onClick={onClose}
    >
      <div
        className="flex max-h-[82vh] w-full max-w-4xl flex-col rounded-lg border border-[#262a32] bg-[#131519]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[#262a32] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Your decks</h2>
            <p className="mt-0.5 text-[11px] text-[#5f6674]">
              {decks.length} saved · every edit autosaves
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={onNew}>New deck</Button>
            <Button variant="ghost" onClick={onClose}>
              ✕
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="py-10 text-center text-[12px] text-[#5f6674]">Loading…</p>
          ) : decks.length === 0 ? (
            <p className="py-10 text-center text-[12px] leading-relaxed text-[#5f6674]">
              Nothing saved yet.
              <br />
              Generate a carousel and it will appear here.
            </p>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
              {decks.map((summary) => {
                const ratio = ASPECTS[summary.aspect];
                const thumbHeight = Math.round((THUMB * ratio.h) / ratio.w);
                const isCurrent = summary.id === currentId;

                return (
                  <li
                    key={summary.id}
                    className={`group rounded-md border p-3 transition-colors ${
                      isCurrent
                        ? "border-[#7c6bff] bg-[#1e1b34]"
                        : "border-[#262a32] bg-[#1a1d23] hover:border-[#454d5c]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(summary.id)}
                      className="flex w-full gap-3 text-left"
                    >
                      <span
                        className="shrink-0 overflow-hidden rounded border border-[#262a32]"
                        style={{ width: THUMB, height: thumbHeight }}
                      >
                        {summary.cover && (
                          <SlideView
                            slide={summary.cover}
                            width={THUMB}
                            height={thumbHeight}
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium text-[#e9ecf1]">
                          {summary.title}
                        </span>
                        <span className="mt-1 block text-[10px] text-[#5f6674]">
                          {summary.slideCount} slide{summary.slideCount === 1 ? "" : "s"} ·{" "}
                          {ratio.label}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-[#5f6674]">
                          {relativeTime(summary.updatedAt)}
                        </span>
                        {isCurrent && (
                          <span className="mt-1 inline-block text-[10px] font-medium text-[#7c6bff]">
                            Open now
                          </span>
                        )}
                      </span>
                    </button>

                    <div className="mt-3 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button variant="ghost" onClick={() => onDuplicate(summary.id)}>
                        Duplicate
                      </Button>
                      {confirming === summary.id ? (
                        <>
                          <Button
                            variant="danger"
                            onClick={() => {
                              onDelete(summary.id);
                              setConfirming(null);
                            }}
                          >
                            Really delete
                          </Button>
                          <Button variant="ghost" onClick={() => setConfirming(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button variant="danger" onClick={() => setConfirming(summary.id)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function relativeTime(timestamp: number) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(timestamp).toLocaleDateString();
}
