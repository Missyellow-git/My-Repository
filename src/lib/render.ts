import type { CSSProperties } from "react";
import type { Background, Slide, SlideElement, TextElement } from "./types";

/**
 * Single source of truth for how a slide looks.
 *
 * Both consumers — the React canvas in the editor and the static HTML the PNG
 * exporter screenshots — call these functions, so a style tweak lands in the
 * preview and the export at the same time. Geometry stays in percentages;
 * only type-scale values are multiplied by `scale`, which is
 * (rendered width / design width).
 */

export const DESIGN_WIDTH = 1080;

export function backgroundStyle(bg: Background): CSSProperties {
  switch (bg.type) {
    case "solid":
      return { background: bg.color };
    case "gradient":
      return { background: `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})` };
    case "image":
      return { background: bg.color };
  }
}

/** Image backgrounds need their own layer so the scrim can sit above them. */
export function backgroundLayers(bg: Background): CSSProperties[] {
  if (bg.type !== "image") return [];
  return [
    {
      position: "absolute",
      inset: 0,
      backgroundImage: `url(${bg.src})`,
      backgroundSize: bg.fit,
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
    },
    {
      position: "absolute",
      inset: 0,
      background: "#000",
      opacity: bg.scrim,
    },
  ];
}

export function frameStyle(el: SlideElement): CSSProperties {
  return {
    position: "absolute",
    left: `${el.x}%`,
    top: `${el.y}%`,
    width: `${el.w}%`,
    height: `${el.h}%`,
    opacity: el.opacity,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    transformOrigin: "center center",
  };
}

const V_ALIGN: Record<TextElement["style"]["vAlign"], string> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

export function textStyle(el: TextElement, scale: number): CSSProperties {
  const s = el.style;
  return {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: V_ALIGN[s.vAlign],
    alignItems:
      s.align === "center" ? "center" : s.align === "right" ? "flex-end" : "flex-start",
    fontFamily: s.fontFamily,
    fontSize: `${s.fontSize * scale}px`,
    fontWeight: s.fontWeight,
    fontStyle: s.italic ? "italic" : "normal",
    lineHeight: s.lineHeight,
    letterSpacing: `${s.letterSpacing * scale}px`,
    color: s.color,
    textAlign: s.align,
    textTransform: s.uppercase ? "uppercase" : "none",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
    background: s.background ?? "transparent",
    padding: s.padding ? `${s.padding * scale}px` : undefined,
    borderRadius: s.radius ? `${s.radius * scale}px` : undefined,
    boxSizing: "border-box",
  };
}

export function imageStyle(
  el: Extract<SlideElement, { type: "image" }>,
  scale: number
): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    backgroundImage: `url(${el.src})`,
    backgroundSize: el.fit,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    borderRadius: `${el.radius * scale}px`,
  };
}

export function imageScrimStyle(
  el: Extract<SlideElement, { type: "image" }>,
  scale: number
): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    background: "#000",
    opacity: el.scrim,
    borderRadius: `${el.radius * scale}px`,
  };
}

export function shapeStyle(
  el: Extract<SlideElement, { type: "shape" }>,
  scale: number
): CSSProperties {
  const base: CSSProperties = { width: "100%", height: "100%", background: el.fill };
  if (el.shape === "ellipse") return { ...base, borderRadius: "50%" };
  if (el.shape === "line") return { ...base, borderRadius: `${el.radius * scale}px` };
  return { ...base, borderRadius: `${el.radius * scale}px` };
}

// --- HTML serialisation (used by the PNG exporter) --------------------------

function kebab(key: string) {
  return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export function styleToCss(style: CSSProperties): string {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${kebab(k)}:${typeof v === "number" ? v : String(v)}`)
    .join(";");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Font stacks contain double quotes (`"Helvetica Neue", …`). Interpolated raw
 * into `style="…"` they close the attribute and every declaration after
 * font-family is silently dropped — which shows up as unstyled type in the
 * exported PNG but not in the React preview, where styles are set as objects.
 */
function attr(style: CSSProperties): string {
  return escapeHtml(styleToCss(style));
}

/** Renders one slide as a self-contained HTML fragment at `width` x `height`. */
export function slideToHtml(slide: Slide, width: number, height: number): string {
  const scale = width / DESIGN_WIDTH;
  const root = attr({
    position: "relative",
    width: `${width}px`,
    height: `${height}px`,
    overflow: "hidden",
    ...backgroundStyle(slide.background),
  });

  const layers = backgroundLayers(slide.background)
    .map((layer) => `<div style="${attr(layer)}"></div>`)
    .join("");

  const elements = slide.elements
    .map((el) => {
      const frame = attr(frameStyle(el));
      if (el.type === "text") {
        return `<div style="${frame}"><div style="${attr(
          textStyle(el, scale)
        )}">${escapeHtml(el.text)}</div></div>`;
      }
      if (el.type === "image") {
        const scrim =
          el.scrim > 0 ? `<div style="${attr(imageScrimStyle(el, scale))}"></div>` : "";
        return `<div style="${frame}"><div style="${attr(
          imageStyle(el, scale)
        )}"></div>${scrim}</div>`;
      }
      return `<div style="${frame}"><div style="${attr(shapeStyle(el, scale))}"></div></div>`;
    })
    .join("");

  return `<div style="${root}">${layers}${elements}</div>`;
}

export function slideToDocument(slide: Slide, width: number, height: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${width}px;height:${height}px;overflow:hidden;background:#000}
</style></head><body>${slideToHtml(slide, width, height)}</body></html>`;
}
