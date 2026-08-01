import { getAsset, readAssetBytes } from "./assets";
import type { Deck, Slide, SlideElement } from "../types";

const ASSET_URL = /^\/api\/assets\/([A-Za-z0-9_-]+)$/;

/**
 * Replace `/api/assets/<id>` references with data URLs.
 *
 * The exporter renders slides via `page.setContent`, which has no origin, so a
 * root-relative asset URL would resolve to nothing and the image would render
 * blank. Reading the bytes off disk here keeps the export self-contained and
 * avoids the browser making HTTP calls back into the app mid-render.
 */
export async function inlineDeckAssets(deck: Deck): Promise<Deck> {
  const cache = new Map<string, string | null>();

  const resolve = async (src: string): Promise<string> => {
    const match = ASSET_URL.exec(src);
    if (!match) return src; // already a data URL, or an absolute one

    const id = match[1];
    if (!cache.has(id)) cache.set(id, await toDataUrl(id));
    return cache.get(id) ?? src;
  };

  const slides: Slide[] = [];
  for (const slide of deck.slides) {
    const elements: SlideElement[] = [];
    for (const element of slide.elements) {
      elements.push(
        element.type === "image" ? { ...element, src: await resolve(element.src) } : element
      );
    }

    const background =
      slide.background.type === "image"
        ? { ...slide.background, src: await resolve(slide.background.src) }
        : slide.background;

    slides.push({ ...slide, background, elements });
  }

  return { ...deck, slides };
}

async function toDataUrl(id: string): Promise<string | null> {
  const record = getAsset(id);
  if (!record) return null;
  try {
    const bytes = await readAssetBytes(record);
    return `data:${record.media_type};base64,${bytes.toString("base64")}`;
  } catch {
    // A missing blob shouldn't fail the whole export — that slide renders
    // without the image instead.
    return null;
  }
}
