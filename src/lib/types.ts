/**
 * The canonical deck format.
 *
 * Geometry is stored in percentages of the canvas (0-100) so a deck can be
 * re-rendered at any pixel size — the browser preview scales down, the PNG
 * export renders at full resolution, and both read the same numbers.
 * Font sizes are the one exception: they're in px against `Deck.size`, and the
 * renderer scales them by the same factor it scales the canvas.
 */

export type AspectId = "portrait" | "square";

export const ASPECTS: Record<AspectId, { label: string; w: number; h: number }> = {
  portrait: { label: "4:5 portrait", w: 1080, h: 1350 },
  square: { label: "1:1 square", w: 1080, h: 1080 },
};

export type Align = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  color: string;
  align: Align;
  vAlign: VAlign;
  italic: boolean;
  uppercase: boolean;
  /** Optional pill/box behind the text. */
  background?: string;
  padding?: number;
  radius?: number;
}

/**
 * What the layout engine meant an element to be. Kept on the element so a
 * theme switch can recolour a deck the user has already hand-edited, instead of
 * throwing their edits away and re-laying out from scratch.
 */
export type ElementTag = "headline" | "kicker" | "body" | "bullet" | "accent" | "page" | "mark";

interface BaseElement {
  id: string;
  /** Percent of canvas width/height. */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  locked?: boolean;
  tag?: ElementTag;
  /** Set when the element sits on top of an accent-filled panel, so a theme
   *  switch knows to colour it with `onAccent` rather than `ink`. */
  surface?: "accent";
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  style: TextStyle;
}

export interface ImageElement extends BaseElement {
  type: "image";
  /** Data URL or absolute URL. */
  src: string;
  fit: "cover" | "contain";
  radius: number;
  /** 0-1 dark scrim drawn over the image, for text legibility. */
  scrim: number;
}

export type ShapeKind = "rect" | "ellipse" | "line";

export interface ShapeElement extends BaseElement {
  type: "shape";
  shape: ShapeKind;
  fill: string;
  radius: number;
}

export type SlideElement = TextElement | ImageElement | ShapeElement;

export type Background =
  | { type: "solid"; color: string }
  | { type: "gradient"; from: string; to: string; angle: number }
  | { type: "image"; src: string; fit: "cover" | "contain"; scrim: number; color: string };

export interface Slide {
  id: string;
  background: Background;
  elements: SlideElement[];
  /** What the generator intended this slide to be — drives nothing at render
   *  time, but lets the UI label slides and re-apply a theme sensibly. */
  role: SlideRole;
}

export type SlideRole = "cover" | "point" | "list" | "quote" | "stat" | "cta";

export interface Deck {
  title: string;
  aspect: AspectId;
  themeId: string;
  slides: Slide[];
}

/** What the model returns — pure content, no geometry. Layout is our job. */
export interface SlideContent {
  role: SlideRole;
  kicker?: string;
  headline: string;
  body?: string;
  bullets?: string[];
}

export interface GeneratedDeck {
  title: string;
  caption: string;
  hashtags: string[];
  slides: SlideContent[];
}

/** An uploaded image, as stored on the server and referenced by decks. */
export interface Asset {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  /** Root-relative URL served by /api/assets/[id]. */
  url: string;
}

export function canvasSize(deck: Deck) {
  return ASPECTS[deck.aspect];
}
