"use client";

import { FONTS } from "@/lib/themes";
import type {
  Align,
  Background,
  Deck,
  ImageElement,
  ShapeElement,
  Slide,
  SlideElement,
  TextElement,
  TextStyle,
  VAlign,
} from "@/lib/types";
import type { Asset } from "@/lib/types";
import {
  Button,
  ColorInput,
  Field,
  NumberInput,
  Row,
  Section,
  Segmented,
  Select,
  Slider,
  TextArea,
} from "./ui";

const FONT_OPTIONS = [
  { value: FONTS.sans, label: "Sans" },
  { value: FONTS.serif, label: "Serif" },
  { value: FONTS.mono, label: "Mono" },
  { value: FONTS.condensed, label: "Condensed" },
];

export default function Inspector({
  deck,
  slide,
  selected,
  assets,
  onSlideChange,
  onElementChange,
  onElementOp,
}: {
  deck: Deck;
  slide: Slide;
  selected: SlideElement | null;
  assets: Asset[];
  onSlideChange: (patch: Partial<Slide>) => void;
  onElementChange: (id: string, patch: Partial<SlideElement>) => void;
  onElementOp: (op: "duplicate" | "delete" | "front" | "back" | "forward" | "backward") => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {selected ? (
        <ElementPanel
          element={selected}
          assets={assets}
          onChange={(patch) => onElementChange(selected.id, patch)}
          onOp={onElementOp}
        />
      ) : (
        <div className="border-b border-[#262a32] px-4 py-6 text-center text-[11px] leading-relaxed text-[#5f6674]">
          Click an element to edit it.
          <br />
          Double-click text to retype it in place.
        </div>
      )}

      <SlidePanel slide={slide} assets={assets} onChange={onSlideChange} index={deck.slides.indexOf(slide)} />
    </div>
  );
}

// --- element -----------------------------------------------------------------

function ElementPanel({
  element,
  assets,
  onChange,
  onOp,
}: {
  element: SlideElement;
  assets: Asset[];
  onChange: (patch: Partial<SlideElement>) => void;
  onOp: (op: "duplicate" | "delete" | "front" | "back" | "forward" | "backward") => void;
}) {
  return (
    <>
      <Section
        title={`${element.type}${element.tag ? ` · ${element.tag}` : ""}`}
        actions={
          <div className="flex gap-1">
            <Button variant="ghost" title="Duplicate" onClick={() => onOp("duplicate")}>
              ⧉
            </Button>
            <Button variant="danger" title="Delete" onClick={() => onOp("delete")}>
              ✕
            </Button>
          </div>
        }
      >
        {element.type === "text" && <TextControls element={element} onChange={onChange} />}
        {element.type === "image" && (
          <ImageControls element={element} assets={assets} onChange={onChange} />
        )}
        {element.type === "shape" && <ShapeControls element={element} onChange={onChange} />}
      </Section>

      <Section title="Position & size">
        <Row>
          <Field label="X">
            <NumberInput value={element.x} onChange={(x) => onChange({ x })} step={0.5} suffix="%" />
          </Field>
          <Field label="Y">
            <NumberInput value={element.y} onChange={(y) => onChange({ y })} step={0.5} suffix="%" />
          </Field>
        </Row>
        <Row>
          <Field label="Width">
            <NumberInput value={element.w} onChange={(w) => onChange({ w })} step={0.5} suffix="%" />
          </Field>
          <Field label="Height">
            <NumberInput value={element.h} onChange={(h) => onChange({ h })} step={0.5} suffix="%" />
          </Field>
        </Row>
        <Row>
          <Field label="Rotation">
            <NumberInput
              value={element.rotation}
              onChange={(rotation) => onChange({ rotation })}
              step={1}
              suffix="°"
            />
          </Field>
          <Field label={`Opacity ${Math.round(element.opacity * 100)}%`}>
            <Slider value={element.opacity} onChange={(opacity) => onChange({ opacity })} />
          </Field>
        </Row>
        <Field label="Layer">
          <div className="grid grid-cols-4 gap-1.5">
            <Button onClick={() => onOp("back")} title="Send to back">
              ⤓
            </Button>
            <Button onClick={() => onOp("backward")} title="Send backward">
              ↓
            </Button>
            <Button onClick={() => onOp("forward")} title="Bring forward">
              ↑
            </Button>
            <Button onClick={() => onOp("front")} title="Bring to front">
              ⤒
            </Button>
          </div>
        </Field>
        <label className="flex items-center gap-2 text-[11px] text-[#8b93a1]">
          <input
            type="checkbox"
            checked={!!element.locked}
            onChange={(e) => onChange({ locked: e.target.checked })}
            className="accent-[#7c6bff]"
          />
          Lock (ignore clicks and drags)
        </label>
      </Section>
    </>
  );
}

function TextControls({
  element,
  onChange,
}: {
  element: TextElement;
  onChange: (patch: Partial<SlideElement>) => void;
}) {
  const s = element.style;
  const setStyle = (patch: Partial<TextStyle>) =>
    onChange({ style: { ...s, ...patch } } as Partial<SlideElement>);

  return (
    <>
      <Field label="Text">
        <TextArea
          value={element.text}
          onChange={(text) => onChange({ text } as Partial<SlideElement>)}
          rows={3}
        />
      </Field>
      <Row>
        <Field label="Font">
          <Select value={s.fontFamily} onChange={(fontFamily) => setStyle({ fontFamily })} options={FONT_OPTIONS} />
        </Field>
        <Field label="Weight">
          <Select
            value={String(s.fontWeight)}
            onChange={(v) => setStyle({ fontWeight: Number(v) })}
            options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({
              value: String(w),
              label: String(w),
            }))}
          />
        </Field>
      </Row>
      <Row>
        <Field label="Size">
          <NumberInput value={s.fontSize} onChange={(fontSize) => setStyle({ fontSize })} step={2} min={8} suffix="px" />
        </Field>
        <Field label="Line height">
          <NumberInput
            value={s.lineHeight}
            onChange={(lineHeight) => setStyle({ lineHeight })}
            step={0.05}
            min={0.7}
          />
        </Field>
      </Row>
      <Field label="Letter spacing">
        <NumberInput
          value={s.letterSpacing}
          onChange={(letterSpacing) => setStyle({ letterSpacing })}
          step={0.2}
          suffix="px"
        />
      </Field>
      <Field label="Colour">
        <ColorInput value={s.color} onChange={(color) => setStyle({ color })} />
      </Field>
      <Row>
        <Field label="Align">
          <Segmented
            value={s.align}
            onChange={(align) => setStyle({ align: align as Align })}
            options={[
              { value: "left", label: "◧" },
              { value: "center", label: "▣" },
              { value: "right", label: "◨" },
            ]}
          />
        </Field>
        <Field label="Vertical">
          <Segmented
            value={s.vAlign}
            onChange={(vAlign) => setStyle({ vAlign: vAlign as VAlign })}
            options={[
              { value: "top", label: "⌃" },
              { value: "middle", label: "–" },
              { value: "bottom", label: "⌄" },
            ]}
          />
        </Field>
      </Row>
      <div className="flex gap-4 text-[11px] text-[#8b93a1]">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={s.uppercase}
            onChange={(e) => setStyle({ uppercase: e.target.checked })}
            className="accent-[#7c6bff]"
          />
          Uppercase
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={s.italic}
            onChange={(e) => setStyle({ italic: e.target.checked })}
            className="accent-[#7c6bff]"
          />
          Italic
        </label>
      </div>
      <details className="rounded-md border border-[#333a45] bg-[#1a1d23] p-2.5">
        <summary className="cursor-pointer text-[11px] text-[#8b93a1]">Highlight box</summary>
        <div className="mt-3 space-y-3">
          <Field label="Background">
            <ColorInput
              value={s.background ?? "#00000000"}
              onChange={(background) => setStyle({ background })}
            />
          </Field>
          <Row>
            <Field label="Padding">
              <NumberInput
                value={s.padding ?? 0}
                onChange={(padding) => setStyle({ padding })}
                step={2}
                min={0}
                suffix="px"
              />
            </Field>
            <Field label="Radius">
              <NumberInput
                value={s.radius ?? 0}
                onChange={(radius) => setStyle({ radius })}
                step={2}
                min={0}
                suffix="px"
              />
            </Field>
          </Row>
          <Button variant="ghost" onClick={() => setStyle({ background: undefined, padding: 0, radius: 0 })}>
            Clear highlight
          </Button>
        </div>
      </details>
    </>
  );
}

function ImageControls({
  element,
  assets,
  onChange,
}: {
  element: ImageElement;
  assets: Asset[];
  onChange: (patch: Partial<SlideElement>) => void;
}) {
  return (
    <>
      <div
        className="h-24 w-full rounded-md border border-[#333a45] bg-[#1a1d23]"
        style={{
          backgroundImage: `url(${element.src})`,
          backgroundSize: "contain",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
      {assets.length > 0 && (
        <Field label="Swap for">
          <div className="grid grid-cols-5 gap-1.5">
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onChange({ src: asset.url } as Partial<SlideElement>)}
                className="aspect-square overflow-hidden rounded border border-[#333a45] hover:border-[#7c6bff]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </Field>
      )}
      <Row>
        <Field label="Fit">
          <Segmented
            value={element.fit}
            onChange={(fit) => onChange({ fit } as Partial<SlideElement>)}
            options={[
              { value: "cover", label: "Cover" },
              { value: "contain", label: "Contain" },
            ]}
          />
        </Field>
        <Field label="Radius">
          <NumberInput
            value={element.radius}
            onChange={(radius) => onChange({ radius } as Partial<SlideElement>)}
            step={2}
            min={0}
            suffix="px"
          />
        </Field>
      </Row>
      <Field label={`Darken ${Math.round(element.scrim * 100)}%`}>
        <Slider
          value={element.scrim}
          onChange={(scrim) => onChange({ scrim } as Partial<SlideElement>)}
        />
      </Field>
    </>
  );
}

function ShapeControls({
  element,
  onChange,
}: {
  element: ShapeElement;
  onChange: (patch: Partial<SlideElement>) => void;
}) {
  return (
    <>
      <Field label="Shape">
        <Segmented
          value={element.shape}
          onChange={(shape) => onChange({ shape } as Partial<SlideElement>)}
          options={[
            { value: "rect", label: "Rect" },
            { value: "ellipse", label: "Ellipse" },
            { value: "line", label: "Bar" },
          ]}
        />
      </Field>
      <Field label="Fill">
        <ColorInput value={element.fill} onChange={(fill) => onChange({ fill } as Partial<SlideElement>)} />
      </Field>
      {element.shape !== "ellipse" && (
        <Field label="Radius">
          <NumberInput
            value={element.radius}
            onChange={(radius) => onChange({ radius } as Partial<SlideElement>)}
            step={2}
            min={0}
            suffix="px"
          />
        </Field>
      )}
    </>
  );
}

// --- slide -------------------------------------------------------------------

function SlidePanel({
  slide,
  assets,
  index,
  onChange,
}: {
  slide: Slide;
  assets: Asset[];
  index: number;
  onChange: (patch: Partial<Slide>) => void;
}) {
  const bg = slide.background;

  function setKind(kind: Background["type"]) {
    if (kind === bg.type) return;
    if (kind === "solid") onChange({ background: { type: "solid", color: currentColor(bg) } });
    if (kind === "gradient")
      onChange({
        background: { type: "gradient", from: currentColor(bg), to: "#000000", angle: 150 },
      });
    if (kind === "image")
      onChange({
        background: {
          type: "image",
          src: assets[0]?.url ?? "",
          fit: "cover",
          scrim: 0.35,
          color: currentColor(bg),
        },
      });
  }

  return (
    <Section title={`Slide ${index + 1} background`}>
      <Segmented
        value={bg.type}
        onChange={(v) => setKind(v as Background["type"])}
        options={[
          { value: "solid", label: "Solid" },
          { value: "gradient", label: "Gradient" },
          { value: "image", label: "Image" },
        ]}
      />

      {bg.type === "solid" && (
        <Field label="Colour">
          <ColorInput
            value={bg.color}
            onChange={(color) => onChange({ background: { ...bg, color } })}
          />
        </Field>
      )}

      {bg.type === "gradient" && (
        <>
          <Field label="From">
            <ColorInput value={bg.from} onChange={(from) => onChange({ background: { ...bg, from } })} />
          </Field>
          <Field label="To">
            <ColorInput value={bg.to} onChange={(to) => onChange({ background: { ...bg, to } })} />
          </Field>
          <Field label="Angle">
            <NumberInput
              value={bg.angle}
              onChange={(angle) => onChange({ background: { ...bg, angle } })}
              step={15}
              suffix="°"
            />
          </Field>
        </>
      )}

      {bg.type === "image" && (
        <>
          {assets.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-[#5f6674]">
              Upload an image in the Create panel first, then pick it here.
            </p>
          ) : (
            <Field label="Image">
              <div className="grid grid-cols-5 gap-1.5">
                {assets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => onChange({ background: { ...bg, src: asset.url } })}
                    className={`aspect-square overflow-hidden rounded border ${
                      bg.src === asset.url ? "border-[#7c6bff]" : "border-[#333a45]"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Row>
            <Field label="Fit">
              <Segmented
                value={bg.fit}
                onChange={(fit) => onChange({ background: { ...bg, fit: fit as "cover" | "contain" } })}
                options={[
                  { value: "cover", label: "Cover" },
                  { value: "contain", label: "Contain" },
                ]}
              />
            </Field>
            <Field label="Behind">
              <ColorInput value={bg.color} onChange={(color) => onChange({ background: { ...bg, color } })} />
            </Field>
          </Row>
          <Field label={`Darken ${Math.round(bg.scrim * 100)}%`}>
            <Slider value={bg.scrim} onChange={(scrim) => onChange({ background: { ...bg, scrim } })} />
          </Field>
        </>
      )}
    </Section>
  );
}

function currentColor(bg: Background) {
  if (bg.type === "solid") return bg.color;
  if (bg.type === "gradient") return bg.from;
  return bg.color;
}
