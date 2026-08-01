"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { THEMES } from "@/lib/themes";
import { ASPECTS, type Asset, type AspectId } from "@/lib/types";
import { Button, Field, Row, Section, Segmented, Select, TextArea, TextInput } from "./ui";

export interface GenerateRequest {
  brief: string;
  sourceText?: string;
  sourceLabel?: string;
  /** Uploads Claude should look at; the server reads the bytes. */
  assetIds?: string[];
  slideCount: number;
  tone: string;
  audience?: string;
  themeId: string;
  aspect: AspectId;
}

type SourceKind = "none" | "text" | "url";

const TONES = [
  "direct and practical",
  "warm and conversational",
  "punchy and contrarian",
  "analytical and precise",
  "playful and irreverent",
];

/** Mirrors the server limit so the failure is immediate and specific. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export default function GeneratePanel({
  assets,
  onAddAssets,
  onRemoveAsset,
  themeId,
  onThemeChange,
  aspect,
  onAspectChange,
  onGenerate,
  busy,
  error,
}: {
  assets: Asset[];
  onAddAssets: (assets: Asset[]) => void;
  onRemoveAsset: (id: string) => void;
  themeId: string;
  onThemeChange: (id: string) => void;
  aspect: AspectId;
  onAspectChange: (aspect: AspectId) => void;
  onGenerate: (request: GenerateRequest) => void;
  busy: boolean;
  error: string | null;
}) {
  const [brief, setBrief] = useState("");
  const [sourceKind, setSourceKind] = useState<SourceKind>("none");
  const [pasted, setPasted] = useState("");
  const [url, setUrl] = useState("");
  const [extracted, setExtracted] = useState<{ title: string; text: string } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [slideCount, setSlideCount] = useState(7);
  const [tone, setTone] = useState(TONES[0]);
  const [audience, setAudience] = useState("");

  async function fetchUrl() {
    if (!url.trim()) return;
    setExtracting(true);
    setExtractError(null);
    setExtracted(null);
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Couldn't read that page.");
      setExtracted({ title: data.title, text: data.text });
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : "Couldn't read that page.");
    } finally {
      setExtracting(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const chosen = Array.from(files).filter((file) => file.type.startsWith("image/"));
    const tooBig = chosen.filter((file) => file.size > MAX_IMAGE_BYTES);
    const uploadable = chosen.filter((file) => file.size <= MAX_IMAGE_BYTES);

    setUploadError(tooBig.length ? `${tooBig[0].name} is over 10 MB — resize it first.` : null);
    if (!uploadable.length) return;

    setUploading(true);
    try {
      const result = await api.uploadAssets(uploadable);
      if (result.assets.length) onAddAssets(result.assets);
      if (result.failed?.length) {
        setUploadError(`${result.failed[0].name}: ${result.failed[0].error}`);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    const sourceText =
      sourceKind === "text" ? pasted.trim() : sourceKind === "url" ? extracted?.text : undefined;
    const sourceLabel =
      sourceKind === "url" && extracted
        ? `Article: ${extracted.title || url}`
        : sourceKind === "text"
          ? "Pasted text"
          : undefined;

    onGenerate({
      brief: brief.trim(),
      sourceText: sourceText || undefined,
      sourceLabel,
      assetIds: assets.map((asset) => asset.id),
      slideCount,
      tone,
      audience: audience.trim() || undefined,
      themeId,
      aspect,
    });
  }

  const ready =
    !busy && (brief.trim().length > 2 || !!extracted || pasted.trim().length > 40 || assets.length > 0);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Section title="Brief">
        <Field label="What's the carousel about?" hint="A topic, an angle, or an instruction.">
          <TextArea
            value={brief}
            onChange={setBrief}
            rows={3}
            placeholder="5 pricing mistakes freelancers make in their first year"
          />
        </Field>
        <Row>
          <Field label="Slides">
            <Select
              value={String(slideCount)}
              onChange={(v) => setSlideCount(Number(v))}
              options={[3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
                value: String(n),
                label: `${n} slides`,
              }))}
            />
          </Field>
          <Field label="Format">
            <Select
              value={aspect}
              onChange={(v) => onAspectChange(v as AspectId)}
              options={(Object.keys(ASPECTS) as AspectId[]).map((id) => ({
                value: id,
                label: ASPECTS[id].label,
              }))}
            />
          </Field>
        </Row>
        <Field label="Tone">
          <Select
            value={tone}
            onChange={setTone}
            options={TONES.map((t) => ({ value: t, label: t }))}
          />
        </Field>
        <Field label="Audience" hint="Optional. Sharpens the language.">
          <TextInput value={audience} onChange={setAudience} placeholder="solo designers" />
        </Field>
      </Section>

      <Section title="Source material">
        <Segmented
          value={sourceKind}
          onChange={(v) => setSourceKind(v)}
          options={[
            { value: "none", label: "None" },
            { value: "text", label: "Paste" },
            { value: "url", label: "Link" },
          ]}
        />

        {sourceKind === "text" && (
          <Field label="Text to repurpose">
            <TextArea
              value={pasted}
              onChange={setPasted}
              rows={8}
              placeholder="Paste a blog post, newsletter, transcript, or your notes…"
            />
            {pasted.trim().length > 0 && (
              <span className="mt-1 block text-[10px] text-[#5f6674]">
                {pasted.trim().split(/\s+/).length.toLocaleString()} words
              </span>
            )}
          </Field>
        )}

        {sourceKind === "url" && (
          <>
            <Field label="Article URL">
              <div className="flex gap-2">
                <TextInput value={url} onChange={setUrl} placeholder="https://…" />
                <Button onClick={fetchUrl} disabled={extracting || !url.trim()}>
                  {extracting ? "Reading…" : "Read"}
                </Button>
              </div>
            </Field>
            {extractError && <p className="text-[11px] text-[#f27b7b]">{extractError}</p>}
            {extracted && (
              <div className="rounded-md border border-[#333a45] bg-[#1a1d23] p-2.5">
                <p className="mb-1 truncate text-[11px] font-medium text-[#e9ecf1]">
                  {extracted.title || "Untitled page"}
                </p>
                <p className="text-[10px] text-[#5f6674]">
                  {extracted.text.split(/\s+/).length.toLocaleString()} words extracted
                </p>
                <p className="mt-2 line-clamp-3 text-[10px] leading-relaxed text-[#8b93a1]">
                  {extracted.text.slice(0, 240)}…
                </p>
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Images">
        <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-[#333a45] bg-[#1a1d23] px-3 py-4 text-[11px] text-[#8b93a1] transition-colors hover:border-[#7c6bff] hover:text-[#e9ecf1]">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {uploading ? "Uploading…" : "Upload images — Claude reads them, and you can drop them on any slide"}
        </label>
        {uploadError && <p className="text-[11px] text-[#f27b7b]">{uploadError}</p>}

        {assets.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="group relative aspect-square overflow-hidden rounded-md border border-[#333a45]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => onRemoveAsset(asset.id)}
                  className="absolute right-1 top-1 hidden rounded bg-black/70 px-1 text-[10px] text-white group-hover:block"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Theme">
        <div className="space-y-2">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              onClick={() => onThemeChange(theme.id)}
              className={`flex w-full items-center gap-3 rounded-md border p-2 text-left transition-colors ${
                themeId === theme.id
                  ? "border-[#7c6bff] bg-[#1e1b34]"
                  : "border-[#333a45] bg-[#1a1d23] hover:border-[#454d5c]"
              }`}
            >
              <span
                className="h-9 w-9 shrink-0 rounded"
                style={{
                  background: theme.palette.bg,
                  boxShadow: `inset 0 -10px 0 ${theme.palette.accent}`,
                  border: "1px solid #333a45",
                }}
              />
              <span className="min-w-0">
                <span className="block text-[12px] font-medium text-[#e9ecf1]">{theme.name}</span>
                <span className="block truncate text-[10px] text-[#5f6674]">{theme.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <div className="sticky bottom-0 mt-auto border-t border-[#262a32] bg-[#131519] p-4">
        {error && <p className="mb-2 text-[11px] leading-relaxed text-[#f27b7b]">{error}</p>}
        <Button variant="primary" onClick={submit} disabled={!ready} className="w-full !py-2 !text-sm">
          {busy ? "Writing slides…" : "Generate carousel"}
        </Button>
        <p className="mt-2 text-center text-[10px] text-[#5f6674]">
          Generating saves a new deck. The current one stays in your library.
        </p>
      </div>
    </div>
  );
}

