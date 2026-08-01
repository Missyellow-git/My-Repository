# Carousel Studio

Generate Instagram carousels with Claude, then edit every slide by hand.

Give it a topic, paste an article, drop in a link, or upload images. Claude writes
the hook, the middle slides, and the call to action; a layout engine turns that
copy into real, editable elements; you drag, restyle, and retype whatever you
want; then export the deck as ready-to-post PNGs.

## Setup

```bash
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000. Without an API key the app still runs — click
**Load a sample deck** to explore the editor and the PNG export.

The PNG exporter renders slides in headless Chromium. `npm install` pulls in
`playwright-core` but not a browser, so install one once:

```bash
npx playwright install chromium
```

If you already have Chromium or Chrome somewhere else, point at it instead:

```bash
CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run dev
```

## How it works

```
brief / text / URL / images
        │
        ▼
  /api/generate ── Claude (claude-opus-5, structured output)
        │            returns slide copy only: role, kicker, headline, body, bullets
        ▼
  src/lib/layout.ts  turns copy + theme into positioned elements
        │
        ▼
  Deck  { slides[] { background, elements[] } }
        │
        ├──▶ editor canvas (React)  ─┐
        │                            ├── both call src/lib/render.ts
        └──▶ /api/export (Chromium) ─┘
                    │
                    ▼
              carousel.zip
```

**One renderer, two consumers.** `src/lib/render.ts` is the only place that
decides how a slide looks. The React canvas applies its output as style objects;
the exporter serialises the same output to HTML and screenshots it in Chromium.
A styling change lands in the preview and the export at once, and what you see
is what you download.

**Geometry is resolution-independent.** Element positions and sizes are stored as
percentages of the canvas, so a deck re-renders correctly at any size — a 86px
filmstrip thumbnail, a 700px editing canvas, a 1080px export. Only type scale is
in pixels, against a 1080px design width, and the renderer scales it to match.

**Claude writes copy, not layout.** The model returns structured content with a
`role` per slide (`cover`, `point`, `list`, `quote`, `stat`, `cta`) and the
layout engine owns every coordinate. That keeps generated decks visually
consistent, keeps the model's job small enough to be reliable, and means a theme
switch can recolour a deck you've already hand-edited instead of regenerating it.

## The editor

| Action | How |
| --- | --- |
| Move | Drag. Hold ⇧ to constrain to one axis. |
| Resize | Drag a handle. Hold ⇧ on a corner to keep the aspect ratio. |
| Rotate | Drag the round handle above the selection. |
| Edit text | Double-click it and type. |
| Nudge | Arrow keys (⇧ for bigger steps). |
| Duplicate / delete | ⌘D / ⌫ |
| Undo / redo | ⌘Z / ⇧⌘Z |

Elements snap to the type margins and the centre lines while you drag.

Slides, elements, backgrounds, and uploaded images all live in one `Deck` object
that autosaves to `localStorage`, so a refresh doesn't cost you work. **.json**
in the toolbar downloads that object if you want to keep or version a deck.

## Themes

Four presets — Punch, Paper, Midnight, Signal — each a palette, a font pairing,
and a background rule. Switching themes **recolours in place**: elements carry a
tag (`headline`, `kicker`, `body`, `accent`…) recording what the layout engine
meant them to be, so the new palette maps onto your edits instead of discarding
them. Elements you add by hand are left alone.

## Project layout

```
src/
  app/
    api/generate/   Claude call + layout, returns a Deck
    api/extract/    fetches a URL and pulls out the article text
    api/export/     renders slides in Chromium, returns a ZIP of PNGs
  components/
    Studio.tsx      state, history, keyboard, orchestration
    SlideCanvas.tsx drag / resize / rotate / in-place text editing
    SlideView.tsx   pure slide rendering (canvas + thumbnails)
    Inspector.tsx   per-element and per-slide controls
  lib/
    types.ts        the Deck format
    render.ts       the single source of truth for how a slide looks
    layout.ts       slide copy + theme -> positioned elements
    themes.ts       palettes, fonts, background rules
    generate.ts     the Claude prompt and response schema
```

## Notes

- Uploaded images are stored as data URLs inside the deck. That keeps export
  self-contained and needs no file storage, but a deck with several large images
  can exceed the `localStorage` quota — autosave fails quietly in that case, so
  export the `.json` if a deck matters.
- Slide fonts use stacks that end in a generic family (`sans-serif`, `serif`), so
  the export doesn't silently change metrics on a machine that's missing the
  first choice.
- `/api/extract` fetches a URL server-side and refuses loopback and private
  address ranges. It reads static HTML only — for a JavaScript-rendered page,
  paste the text instead.
