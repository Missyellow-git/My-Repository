import { getTheme, type Theme } from "./themes";
import type {
  AspectId,
  Deck,
  ElementTag,
  GeneratedDeck,
  ImageElement,
  ShapeElement,
  Slide,
  SlideContent,
  SlideElement,
  TextElement,
  TextStyle,
} from "./types";

export function uid(prefix = "el"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Layouts below are authored against the 4:5 portrait canvas. On a square
 * canvas there is ~20% less vertical room, so positions are pulled toward the
 * centre and heights shrink by the same factor rather than being re-authored.
 */
function vscale(aspect: AspectId) {
  return aspect === "square" ? 0.8 : 1;
}

interface Ctx {
  theme: Theme;
  aspect: AspectId;
  index: number;
  total: number;
}

function y(ctx: Ctx, portraitY: number) {
  const k = vscale(ctx.aspect);
  return round(50 + (portraitY - 50) * k);
}

function h(ctx: Ctx, portraitH: number) {
  return round(portraitH * vscale(ctx.aspect));
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

// --- element builders -------------------------------------------------------

interface TextOpts {
  tag: ElementTag;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  style: Partial<TextStyle> & Pick<TextStyle, "fontFamily" | "fontSize" | "color">;
}

function text(o: TextOpts): TextElement {
  return {
    id: uid("tx"),
    type: "text",
    tag: o.tag,
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
    rotation: 0,
    opacity: 1,
    text: o.text,
    style: {
      fontWeight: 400,
      lineHeight: 1.25,
      letterSpacing: 0,
      align: "left",
      vAlign: "top",
      italic: false,
      uppercase: false,
      ...o.style,
    },
  };
}

function shape(o: {
  tag: ElementTag;
  shape: ShapeElement["shape"];
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  radius?: number;
  opacity?: number;
}): ShapeElement {
  return {
    id: uid("sh"),
    type: "shape",
    tag: o.tag,
    shape: o.shape,
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
    rotation: 0,
    opacity: o.opacity ?? 1,
    fill: o.fill,
    radius: o.radius ?? 0,
  };
}

export function imageElement(src: string, opts: Partial<ImageElement> = {}): ImageElement {
  return {
    id: uid("im"),
    type: "image",
    x: 10,
    y: 10,
    w: 50,
    h: 35,
    rotation: 0,
    opacity: 1,
    src,
    fit: "cover",
    radius: 12,
    scrim: 0,
    ...opts,
  };
}

// --- per-role layouts -------------------------------------------------------

const MARGIN = 9; // percent
const COL = 100 - MARGIN * 2;

function kicker(ctx: Ctx, value: string, atY: number): TextElement {
  const { theme } = ctx;
  return text({
    tag: "kicker",
    text: value,
    x: MARGIN,
    y: y(ctx, atY),
    w: COL,
    h: h(ctx, 5),
    style: {
      fontFamily: theme.fonts.body,
      fontSize: 26,
      fontWeight: 600,
      color: theme.palette.accent,
      letterSpacing: 2.4,
      uppercase: true,
      lineHeight: 1.3,
    },
  });
}

function pageNumber(ctx: Ctx): TextElement {
  const { theme, index, total } = ctx;
  return text({
    tag: "page",
    text: `${index + 1} / ${total}`,
    x: MARGIN,
    y: y(ctx, 92),
    w: COL,
    h: h(ctx, 4),
    style: {
      fontFamily: theme.fonts.body,
      fontSize: 22,
      fontWeight: 500,
      color: theme.palette.muted,
      letterSpacing: 1.2,
      align: "right",
      vAlign: "bottom",
    },
  });
}

function headline(ctx: Ctx, value: string, atY: number, size: number, height: number): TextElement {
  const { theme } = ctx;
  return text({
    tag: "headline",
    text: value,
    x: MARGIN,
    y: y(ctx, atY),
    w: COL,
    h: h(ctx, height),
    style: {
      fontFamily: theme.fonts.display,
      fontSize: size,
      fontWeight: theme.weights.display,
      color: theme.palette.ink,
      letterSpacing: theme.displayTracking,
      lineHeight: 1.06,
      uppercase: theme.displayUppercase,
      italic: theme.displayItalic,
    },
  });
}

function body(ctx: Ctx, value: string, atY: number, height = 20, size = 34): TextElement {
  const { theme } = ctx;
  return text({
    tag: "body",
    text: value,
    x: MARGIN,
    y: y(ctx, atY),
    w: COL,
    h: h(ctx, height),
    style: {
      fontFamily: theme.fonts.body,
      fontSize: size,
      fontWeight: theme.weights.body,
      color: theme.palette.muted,
      lineHeight: 1.45,
    },
  });
}

function rule(ctx: Ctx, atY: number): ShapeElement {
  return shape({
    tag: "accent",
    shape: "rect",
    x: MARGIN,
    y: y(ctx, atY),
    w: 14,
    h: h(ctx, 0.9),
    fill: ctx.theme.palette.accent,
    radius: 4,
  });
}

function layoutCover(c: SlideContent, ctx: Ctx): SlideElement[] {
  const { theme } = ctx;
  const els: SlideElement[] = [];
  if (c.kicker) els.push(kicker(ctx, c.kicker, 12));
  els.push(headline(ctx, c.headline, 26, 96, 40));
  if (c.body) els.push(body(ctx, c.body, 68, 16, 36));
  els.push(rule(ctx, 20));
  els.push(
    text({
      tag: "page",
      text: "swipe →",
      x: MARGIN,
      y: y(ctx, 90),
      w: COL,
      h: h(ctx, 5),
      style: {
        fontFamily: theme.fonts.body,
        fontSize: 24,
        fontWeight: 600,
        color: theme.palette.accent,
        letterSpacing: 2,
        uppercase: true,
        vAlign: "bottom",
      },
    })
  );
  return els;
}

function layoutPoint(c: SlideContent, ctx: Ctx): SlideElement[] {
  const els: SlideElement[] = [];
  els.push(kicker(ctx, c.kicker || String(ctx.index).padStart(2, "0"), 12));
  els.push(headline(ctx, c.headline, 22, 68, 26));
  if (c.body) els.push(body(ctx, c.body, 52, 32));
  els.push(pageNumber(ctx));
  return els;
}

function layoutList(c: SlideContent, ctx: Ctx): SlideElement[] {
  const { theme } = ctx;
  const els: SlideElement[] = [];
  if (c.kicker) els.push(kicker(ctx, c.kicker, 12));
  els.push(headline(ctx, c.headline, 20, 58, 18));

  const items = (c.bullets ?? []).slice(0, 5);
  const startY = 40;
  const step = items.length > 4 ? 7.5 : 8.5;
  items.forEach((item, i) => {
    const rowY = startY + i * step;
    els.push(
      shape({
        tag: "accent",
        shape: "ellipse",
        x: MARGIN,
        y: y(ctx, rowY + 1.1),
        w: 1.8,
        h: h(ctx, 1.45),
        fill: theme.palette.accent,
      })
    );
    els.push(
      text({
        tag: "bullet",
        text: item,
        x: MARGIN + 4.5,
        y: y(ctx, rowY),
        w: COL - 4.5,
        h: h(ctx, step),
        style: {
          fontFamily: theme.fonts.body,
          fontSize: 34,
          fontWeight: 500,
          color: theme.palette.ink,
          lineHeight: 1.32,
        },
      })
    );
  });
  els.push(pageNumber(ctx));
  return els;
}

function layoutQuote(c: SlideContent, ctx: Ctx): SlideElement[] {
  const { theme } = ctx;
  const els: SlideElement[] = [];
  els.push(
    text({
      tag: "mark",
      text: "“",
      x: MARGIN,
      y: y(ctx, 16),
      w: 30,
      h: h(ctx, 18),
      style: {
        fontFamily: theme.fonts.display,
        fontSize: 180,
        fontWeight: theme.weights.display,
        color: theme.palette.accent,
        lineHeight: 1,
      },
    })
  );
  els.push(
    text({
      tag: "headline",
      text: c.headline,
      x: MARGIN,
      y: y(ctx, 34),
      w: COL,
      h: h(ctx, 30),
      style: {
        fontFamily: theme.fonts.display,
        fontSize: 56,
        fontWeight: theme.weights.display,
        color: theme.palette.ink,
        lineHeight: 1.22,
        italic: true,
        letterSpacing: -0.5,
      },
    })
  );
  if (c.body) els.push(body(ctx, c.body, 68, 10, 30));
  els.push(pageNumber(ctx));
  return els;
}

function layoutStat(c: SlideContent, ctx: Ctx): SlideElement[] {
  const { theme } = ctx;
  const els: SlideElement[] = [];
  if (c.kicker) els.push(kicker(ctx, c.kicker, 14));
  els.push(
    text({
      tag: "headline",
      text: c.headline,
      x: MARGIN,
      y: y(ctx, 30),
      w: COL,
      h: h(ctx, 26),
      style: {
        fontFamily: theme.fonts.display,
        fontSize: 150,
        fontWeight: theme.weights.display,
        color: theme.palette.accent,
        lineHeight: 1,
        letterSpacing: -4,
      },
    })
  );
  if (c.body) {
    els.push(
      text({
        tag: "body",
        text: c.body,
        x: MARGIN,
        y: y(ctx, 60),
        w: COL,
        h: h(ctx, 24),
        style: {
          fontFamily: theme.fonts.body,
          fontSize: 40,
          fontWeight: 500,
          color: theme.palette.ink,
          lineHeight: 1.35,
        },
      })
    );
  }
  els.push(pageNumber(ctx));
  return els;
}

function layoutCta(c: SlideContent, ctx: Ctx): SlideElement[] {
  const { theme } = ctx;
  const els: SlideElement[] = [];
  /** Mark copy that sits on the accent panel so re-theming keeps it legible. */
  const onPanel = <T extends SlideElement>(el: T): T => ({ ...el, surface: "accent" });
  els.push(
    shape({
      tag: "accent",
      shape: "rect",
      x: MARGIN,
      y: y(ctx, 24),
      w: COL,
      h: h(ctx, 52),
      fill: theme.palette.accent,
      radius: theme.radius,
      opacity: 1,
    })
  );
  if (c.kicker) {
    els.push(
      onPanel(
        text({
          tag: "kicker",
          text: c.kicker,
          x: MARGIN + 6,
          y: y(ctx, 32),
          w: COL - 12,
          h: h(ctx, 5),
          style: {
            fontFamily: theme.fonts.body,
            fontSize: 26,
            fontWeight: 700,
            color: theme.palette.onAccent,
            letterSpacing: 2.4,
            uppercase: true,
          },
        })
      )
    );
  }
  els.push(
    onPanel(
      text({
        tag: "headline",
        text: c.headline,
        x: MARGIN + 6,
        y: y(ctx, 40),
        w: COL - 12,
        h: h(ctx, 22),
        style: {
          fontFamily: theme.fonts.display,
          fontSize: 64,
          fontWeight: theme.weights.display,
          color: theme.palette.onAccent,
          lineHeight: 1.1,
          letterSpacing: theme.displayTracking,
          uppercase: theme.displayUppercase,
          italic: theme.displayItalic,
        },
      })
    )
  );
  if (c.body) {
    els.push(
      onPanel(
        text({
          tag: "body",
          text: c.body,
          x: MARGIN + 6,
          y: y(ctx, 62),
          w: COL - 12,
          h: h(ctx, 12),
          style: {
            fontFamily: theme.fonts.body,
            fontSize: 32,
            fontWeight: 500,
            color: theme.palette.onAccent,
            lineHeight: 1.4,
          },
        })
      )
    );
  }
  return els;
}

const LAYOUTS: Record<SlideContent["role"], (c: SlideContent, ctx: Ctx) => SlideElement[]> = {
  cover: layoutCover,
  point: layoutPoint,
  list: layoutList,
  quote: layoutQuote,
  stat: layoutStat,
  cta: layoutCta,
};

export function layoutSlide(content: SlideContent, ctx: Ctx): Slide {
  const build = LAYOUTS[content.role] ?? layoutPoint;
  return {
    id: uid("sl"),
    role: content.role,
    background: ctx.theme.background(ctx.index, content.role),
    elements: build(content, ctx),
  };
}

export function buildDeck(
  generated: GeneratedDeck,
  themeId: string,
  aspect: AspectId
): Deck {
  const theme = getTheme(themeId);
  const total = generated.slides.length;
  return {
    title: generated.title,
    aspect,
    themeId,
    slides: generated.slides.map((content, index) =>
      layoutSlide(content, { theme, aspect, index, total })
    ),
  };
}

/**
 * Swap the palette and fonts of an existing deck without touching geometry or
 * copy — so a theme change survives hand-editing. Elements the user added by
 * hand carry no tag and are left exactly as they are.
 */
export function recolorDeck(deck: Deck, themeId: string): Deck {
  const theme = getTheme(themeId);
  return {
    ...deck,
    themeId,
    slides: deck.slides.map((slide, index) => ({
      ...slide,
      background:
        slide.background.type === "image"
          ? slide.background
          : theme.background(index, slide.role),
      elements: slide.elements.map((el) => recolorElement(el, theme)),
    })),
  };
}

function recolorElement(el: SlideElement, theme: Theme): SlideElement {
  if (!el.tag) return el;

  if (el.type === "shape") {
    return el.tag === "accent" ? { ...el, fill: theme.palette.accent } : el;
  }
  if (el.type !== "text") return el;

  const p = theme.palette;
  const map: Record<ElementTagKey, Partial<TextStyle>> = {
    headline: {
      fontFamily: theme.fonts.display,
      fontWeight: theme.weights.display,
      color: p.ink,
      uppercase: theme.displayUppercase,
      italic: theme.displayItalic,
      letterSpacing: theme.displayTracking,
    },
    kicker: { fontFamily: theme.fonts.body, color: p.accent },
    body: { fontFamily: theme.fonts.body, color: p.muted },
    bullet: { fontFamily: theme.fonts.body, color: p.ink },
    page: { fontFamily: theme.fonts.body, color: p.muted },
    mark: { fontFamily: theme.fonts.display, color: p.accent },
    accent: { color: p.accent },
  };
  const patch = map[el.tag as ElementTagKey];
  if (!patch) return el;
  // CTA copy sits on an accent-filled panel — keep it readable there.
  const onPanel = el.surface === "accent";
  return { ...el, style: { ...el.style, ...patch, ...(onPanel ? { color: p.onAccent } : {}) } };
}

type ElementTagKey = NonNullable<ElementTag>;
