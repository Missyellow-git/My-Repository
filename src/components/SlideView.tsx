"use client";

import {
  backgroundLayers,
  backgroundStyle,
  DESIGN_WIDTH,
  frameStyle,
  imageScrimStyle,
  imageStyle,
  shapeStyle,
  textStyle,
} from "@/lib/render";
import type { Slide } from "@/lib/types";

/**
 * Pure, non-interactive rendering of a slide. Used for the editor canvas
 * underlay and for the filmstrip thumbnails, and mirrored exactly by
 * `slideToHtml` on the export path.
 */
export default function SlideView({
  slide,
  width,
  height,
  hiddenElementId,
}: {
  slide: Slide;
  width: number;
  height: number;
  /** Element being edited in place — hidden so the editor can draw over it. */
  hiddenElementId?: string | null;
}) {
  const scale = width / DESIGN_WIDTH;

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        ...backgroundStyle(slide.background),
      }}
    >
      {backgroundLayers(slide.background).map((layer, i) => (
        <div key={i} style={layer} />
      ))}

      {slide.elements.map((el) => (
        <div
          key={el.id}
          style={{
            ...frameStyle(el),
            visibility: hiddenElementId === el.id ? "hidden" : "visible",
          }}
        >
          {el.type === "text" && <div style={textStyle(el, scale)}>{el.text}</div>}
          {el.type === "image" && (
            <>
              <div style={imageStyle(el, scale)} />
              {el.scrim > 0 && <div style={imageScrimStyle(el, scale)} />}
            </>
          )}
          {el.type === "shape" && <div style={shapeStyle(el, scale)} />}
        </div>
      ))}
    </div>
  );
}
