import type { Background } from "./types";

/**
 * Font stacks deliberately end in a generic family. The PNG exporter renders in
 * headless Chromium, which may not have the first choice installed — ending in
 * `sans-serif`/`serif` guarantees something sane instead of a fallback that
 * changes the metrics between preview and export.
 */
export const FONTS = {
  sans: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif',
  serif: 'Georgia, "Times New Roman", "Liberation Serif", "DejaVu Serif", serif',
  mono: '"SF Mono", "Roboto Mono", "Liberation Mono", "DejaVu Sans Mono", monospace',
  condensed: '"Arial Narrow", "Liberation Sans Narrow", Arial, sans-serif',
} as const;

export interface Theme {
  id: string;
  name: string;
  blurb: string;
  palette: {
    /** Slide background. */
    bg: string;
    /** Secondary background used on alternating slides. */
    bgAlt: string;
    /** Primary text. */
    ink: string;
    /** De-emphasised text (kickers, page numbers). */
    muted: string;
    /** Accent fills and rules. */
    accent: string;
    /** Text drawn on top of the accent colour. */
    onAccent: string;
  };
  fonts: { display: string; body: string };
  weights: { display: number; body: number };
  /** Headline case + letter-spacing personality. */
  displayUppercase: boolean;
  displayTracking: number;
  displayItalic: boolean;
  radius: number;
  /** Background for slide `i`. Themes may alternate or use a gradient. */
  background: (index: number, role: string) => Background;
}

const theme = (t: Theme) => t;

export const THEMES: Theme[] = [
  theme({
    id: "punch",
    name: "Punch",
    blurb: "Near-black, heavy type, one loud accent. Reads well at thumbnail size.",
    palette: {
      bg: "#0E0E10",
      bgAlt: "#17171B",
      ink: "#FFFFFF",
      muted: "#9C9CA6",
      accent: "#E8FF5A",
      onAccent: "#0E0E10",
    },
    fonts: { display: FONTS.sans, body: FONTS.sans },
    weights: { display: 800, body: 400 },
    displayUppercase: true,
    displayTracking: -1.5,
    displayItalic: false,
    radius: 14,
    background: (i) => ({ type: "solid", color: i % 2 === 0 ? "#0E0E10" : "#17171B" }),
  }),
  theme({
    id: "paper",
    name: "Paper",
    blurb: "Warm off-white with serif headlines. Calm, editorial, lots of air.",
    palette: {
      bg: "#F6F2EA",
      bgAlt: "#EFE9DD",
      ink: "#1C1A17",
      muted: "#7A7267",
      accent: "#C2542B",
      onAccent: "#FFFFFF",
    },
    fonts: { display: FONTS.serif, body: FONTS.sans },
    weights: { display: 700, body: 400 },
    displayUppercase: false,
    displayTracking: -1,
    displayItalic: false,
    radius: 10,
    background: (i) => ({ type: "solid", color: i % 2 === 0 ? "#F6F2EA" : "#EFE9DD" }),
  }),
  theme({
    id: "midnight",
    name: "Midnight",
    blurb: "Deep indigo gradient, white serif display, italic accents.",
    palette: {
      bg: "#161B3D",
      bgAlt: "#1E2450",
      ink: "#F5F4FF",
      muted: "#A6A9CF",
      accent: "#7C6BFF",
      onAccent: "#FFFFFF",
    },
    fonts: { display: FONTS.serif, body: FONTS.sans },
    weights: { display: 700, body: 400 },
    displayUppercase: false,
    displayTracking: -1,
    displayItalic: true,
    radius: 18,
    background: (i) => ({
      type: "gradient",
      from: i % 2 === 0 ? "#1B2150" : "#161B3D",
      to: i % 2 === 0 ? "#0E1130" : "#221A4A",
      angle: 150,
    }),
  }),
  theme({
    id: "signal",
    name: "Signal",
    blurb: "White ground, mono kickers, a single hot accent. Product-brief energy.",
    palette: {
      bg: "#FFFFFF",
      bgAlt: "#F2F4F7",
      ink: "#0B1220",
      muted: "#667085",
      accent: "#FF4D2E",
      onAccent: "#FFFFFF",
    },
    fonts: { display: FONTS.sans, body: FONTS.sans },
    weights: { display: 700, body: 400 },
    displayUppercase: false,
    displayTracking: -1.8,
    displayItalic: false,
    radius: 20,
    background: (i) => ({ type: "solid", color: i % 2 === 0 ? "#FFFFFF" : "#F2F4F7" }),
  }),
];

export const DEFAULT_THEME_ID = "punch";

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
