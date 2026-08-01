import Anthropic from "@anthropic-ai/sdk";
import type { GeneratedDeck, SlideRole } from "./types";

export const MODEL = "claude-opus-5";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export interface GenerateInput {
  /** The topic or angle. Always present, even when source material is supplied. */
  brief: string;
  /** Pasted long-form text or extracted article body, if any. */
  sourceText?: string;
  /** Where the source text came from, for provenance in the prompt. */
  sourceLabel?: string;
  /** Base64 image parts the user uploaded, for Claude to read and reference. */
  images?: { mediaType: string; data: string }[];
  slideCount: number;
  tone: string;
  audience?: string;
}

const ROLES: SlideRole[] = ["cover", "point", "list", "quote", "stat", "cta"];

const DECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "caption", "hashtags", "slides"],
  properties: {
    title: { type: "string", description: "Short internal name for the carousel." },
    caption: {
      type: "string",
      description:
        "The Instagram caption to post alongside the carousel. 2-4 short paragraphs, ending with a question or CTA.",
    },
    hashtags: {
      type: "array",
      items: { type: "string" },
      description: "8-12 relevant hashtags, without the # prefix.",
    },
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "headline"],
        properties: {
          role: { type: "string", enum: ROLES },
          kicker: {
            type: "string",
            description: "Tiny label above the headline. 1-4 words. Omit if not useful.",
          },
          headline: {
            type: "string",
            description:
              "The dominant line on the slide. For 'stat' this is the number itself.",
          },
          body: { type: "string", description: "One or two supporting sentences." },
          bullets: {
            type: "array",
            items: { type: "string" },
            description: "Only for role 'list'. 3-5 items, each under 10 words.",
          },
        },
      },
    },
  },
} as const;

function systemPrompt(count: number) {
  return `You write Instagram carousels that people actually swipe through.

You are given a brief and optionally some source material (an article, pasted notes, or images). You return the copy for a ${count}-slide carousel plus the post caption.

How the slides work:
- Slide 1 is always role "cover": a hook that earns the swipe. Make a specific promise or name a specific tension. No throat-clearing, no "in this post we will".
- The middle slides carry the substance. Vary the roles so the deck has rhythm — a "list" of takeaways, a "stat" when you have a real number, a "quote" for a sharp line, "point" for everything else. Never use the same role more than twice in a row.
- The final slide is always role "cta": tell the reader exactly what to do next.

Writing rules that matter more than anything else:
- Headlines are display type set very large. Keep them under 9 words. Long headlines break the layout.
- Write concrete sentences. "Cut onboarding from 12 steps to 3" beats "streamline your onboarding process".
- Never invent statistics, quotes, dates, or names. If you use a "stat" slide, the number must come from the source material the user gave you. With no source material, do not use the "stat" role at all.
- No emoji in slide copy. The caption may use them sparingly.
- Body text is optional. A slide with a strong headline and nothing else is often better than one padded with filler.

The caption is separate from the slides: write it as a real post, not a summary of the slides.`;
}

function userPrompt(input: GenerateInput) {
  const parts = [`Brief: ${input.brief}`, `Slides: ${input.slideCount}`, `Tone: ${input.tone}`];
  if (input.audience) parts.push(`Audience: ${input.audience}`);
  if (input.sourceText) {
    const label = input.sourceLabel ?? "Source material";
    parts.push(
      `\n${label} — build the carousel from this, do not go beyond what it supports:\n"""\n${input.sourceText.slice(0, 60_000)}\n"""`
    );
  }
  if (input.images?.length) {
    parts.push(
      `\n${input.images.length} image(s) are attached. Read them and use what they actually show — data in a chart, text in a screenshot, the subject of a photo. Do not describe an image you cannot read clearly.`
    );
  }
  return parts.join("\n");
}

export async function generateDeck(input: GenerateInput): Promise<GeneratedDeck> {
  const content: Anthropic.ContentBlockParam[] = [];

  for (const image of input.images ?? []) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType as never, data: image.data },
    });
  }
  content.push({ type: "text", text: userPrompt(input) });

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system: systemPrompt(input.slideCount),
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: DECK_SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      "Claude declined to generate this carousel. Try rewording the brief or removing the source material."
    );
  }

  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("The model returned no usable content. Try again.");
  }

  const deck = JSON.parse(text.text) as GeneratedDeck;
  return normalise(deck, input.slideCount);
}

/** Guard the layout engine against a deck that drifts from the house rules. */
function normalise(deck: GeneratedDeck, requested: number): GeneratedDeck {
  const slides = (deck.slides ?? []).filter((s) => s?.headline?.trim());
  if (!slides.length) throw new Error("The model returned an empty deck. Try again.");

  slides[0].role = "cover";
  if (slides.length > 1) slides[slides.length - 1].role = "cta";

  return {
    title: deck.title?.trim() || "Untitled carousel",
    caption: deck.caption?.trim() ?? "",
    hashtags: (deck.hashtags ?? []).map((h) => h.replace(/^#/, "").trim()).filter(Boolean),
    slides: slides.slice(0, Math.max(requested, 3)).map((s) => ({
      ...s,
      role: ROLES.includes(s.role) ? s.role : "point",
      bullets: s.role === "list" ? (s.bullets ?? []).slice(0, 5) : undefined,
    })),
  };
}
