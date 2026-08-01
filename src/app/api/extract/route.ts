import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BLOCKED_HOSTS = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;

export async function POST(request: Request) {
  const { url } = (await request.json().catch(() => ({}))) as { url?: string };
  if (!url) return NextResponse.json({ error: "No URL provided." }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "That doesn't look like a URL." }, { status: 400 });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Only http and https URLs are supported." }, { status: 400 });
  }
  // This endpoint fetches a user-supplied URL from the server, so keep it off
  // the loopback and private ranges.
  if (BLOCKED_HOSTS.test(parsed.hostname)) {
    return NextResponse.json({ error: "That host isn't allowed." }, { status: 400 });
  }

  try {
    const response = await fetch(parsed, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; CarouselStudio/1.0; +https://example.com/bot)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `The page returned ${response.status}.` },
        { status: 502 }
      );
    }

    const html = (await response.text()).slice(0, 3_000_000);
    const { title, text } = extractArticle(html);

    if (text.length < 200) {
      return NextResponse.json(
        {
          error:
            "Couldn't find much readable text there — the page may be JavaScript-rendered. Paste the text instead.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({ title, text: text.slice(0, 60_000), url: parsed.toString() });
  } catch (error) {
    console.error("[extract]", error);
    return NextResponse.json({ error: "Couldn't fetch that page." }, { status: 502 });
  }
}

/**
 * Deliberately dependency-free: strip the chrome, keep block-level structure,
 * and prefer <article>/<main> when the page marks it up. Good enough to feed a
 * language model, which is the only consumer.
 */
function extractArticle(html: string): { title: string; text: string } {
  const title =
    match(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
    match(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ??
    "";

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|header|footer|aside|form|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const main =
    match(body, /<article[^>]*>([\s\S]*?)<\/article>/i) ??
    match(body, /<main[^>]*>([\s\S]*?)<\/main>/i);
  if (main && main.length > 500) body = main;

  const text = body
    .replace(/<\/(p|div|section|li|h[1-6]|tr|blockquote)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title: decodeEntities(title).trim(), text };
}

function match(source: string, re: RegExp): string | null {
  const m = source.match(re);
  return m?.[1] ?? null;
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
