import { NextResponse } from "next/server";
import JSZip from "jszip";
import { chromium, type Browser } from "playwright-core";
import { inlineDeckAssets } from "@/lib/server/inline";
import { slideToDocument } from "@/lib/render";
import { ASPECTS, type Deck } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Renders each slide in headless Chromium and returns a ZIP of PNGs.
 *
 * Screenshotting the same markup the editor draws is what keeps the export
 * pixel-honest — no second rendering path to keep in sync, and web fonts,
 * gradients, and text wrapping all behave exactly as previewed.
 */
export async function POST(request: Request) {
  let deck: Deck;
  let scale = 1;
  try {
    const body = (await request.json()) as { deck: Deck; scale?: number };
    deck = body.deck;
    scale = Math.min(2, Math.max(1, body.scale ?? 1));
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!deck?.slides?.length) {
    return NextResponse.json({ error: "Nothing to export." }, { status: 400 });
  }

  const { w, h } = ASPECTS[deck.aspect];
  let browser: Browser | null = null;

  try {
    // Stored decks reference images by URL; the renderer needs the bytes.
    const renderable = await inlineDeckAssets(deck);
    browser = await launch();
    const context = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: scale,
    });
    const page = await context.newPage();
    const zip = new JSZip();
    const slug = slugify(deck.title);

    for (const [index, slide] of renderable.slides.entries()) {
      await page.setContent(slideToDocument(slide, w, h), { waitUntil: "load" });
      // Background images and <img>-less CSS backgrounds decode asynchronously;
      // give the compositor a frame before capturing.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(60);
      const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: w, height: h } });
      zip.file(`${slug}-${String(index + 1).padStart(2, "0")}.png`, png);
    }

    await context.close();
    const archive = await zip.generateAsync({ type: "nodebuffer" });

    return new NextResponse(new Uint8Array(archive), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${slug}.zip"`,
      },
    });
  } catch (error) {
    console.error("[export]", error);
    const message = error instanceof Error ? error.message : "Export failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await browser?.close().catch(() => {});
  }
}

/**
 * Prefer the bundled Chromium, but fall back to a system one so the app works
 * on hosts where Playwright's browsers aren't installed.
 */
async function launch(): Promise<Browser> {
  const explicit = process.env.CHROMIUM_EXECUTABLE_PATH;
  const args = ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"];
  if (explicit) return chromium.launch({ executablePath: explicit, args });
  try {
    return await chromium.launch({ args });
  } catch (error) {
    for (const path of ["/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/google-chrome"]) {
      try {
        return await chromium.launch({ executablePath: path, args });
      } catch {
        // try the next candidate
      }
    }
    throw error;
  }
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
