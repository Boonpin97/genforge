"use client";

import { useEffect, useRef, useState } from "react";
import DropZone, {
  AddTile,
  blobToDataUrl,
  fileToDataUrl,
  formatBytes,
  type AssetDropData,
} from "./drop-zone";
import MentionTextArea, {
  escapeRe,
  type MediaMention,
} from "./mention-textarea";
import {
  Btn,
  Field,
  Panel,
  Seg,
  Select,
  TextInput,
  Toggle,
} from "./ui";
import type { Character, ImageSettings } from "@/lib/types";
import { charImgUrl } from "@/lib/types";

export type ImageItem = {
  id: string;
  name: string;
  size: number;
  dataUrl?: string;
  state: "loading" | "ready" | "error";
  error?: string;
  characterId?: string;
};

export type ImageSubmitPayload = ImageSettings;

const MAX_IMAGES = 3;
const MAX_BYTES = 10 * 1024 * 1024;

let idCounter = 0;
const nextId = () => `i${Date.now()}-${idCounter++}`;

export default function ImagePanel({
  onSubmit,
  promptInjection,
  onSavePrompt,
  reuse,
  projectId,
}: {
  onSubmit: (payload: ImageSubmitPayload) => Promise<boolean>;
  promptInjection?: { text: string; nonce: number } | null;
  onSavePrompt?: (text: string) => Promise<boolean>;
  reuse: { settings: ImageSettings; nonce: number } | null;
  projectId: string | null;
}) {
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [model, setModel] = useState("qwen-image-3.0");
  const [size, setSize] = useState("1333*750");
  const [n, setN] = useState(1);
  const [promptExtend, setPromptExtend] = useState(false);
  const [watermark, setWatermark] = useState(false);
  const [seed, setSeed] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [items, setItems] = useState<ImageItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  const loading = items.some((i) => i.state === "loading");

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const promptRef = useRef(0);
  const [promptSaved, setPromptSaved] = useState<"ok" | "err" | null>(null);
  useEffect(() => {
    if (!promptInjection || promptInjection.nonce === promptRef.current) return;
    promptRef.current = promptInjection.nonce;
    setPrompt(promptInjection.text);
  }, [promptInjection]);

  async function savePrompt() {
    if (!onSavePrompt) return;
    const ok = await onSavePrompt(prompt);
    setPromptSaved(ok ? "ok" : "err");
    window.setTimeout(() => setPromptSaved(null), 2500);
  }

  const reuseRef = useRef(0);
  useEffect(() => {
    if (!reuse || reuse.nonce === reuseRef.current) return;
    reuseRef.current = reuse.nonce;
    const s = reuse.settings;
    setPrompt(s.prompt);
    setNegativePrompt(s.negativePrompt || "");
    setModel(s.model);
    setCustomModel(s.model.includes("/") ? s.model : "");
    setSize(s.size);
    setN(s.n);
    setPromptExtend(s.promptExtend);
    setWatermark(s.watermark);
    setSeed(s.seed !== undefined ? String(s.seed) : "");
    setItems(
      s.images.map((img) => ({
        id: nextId(),
        name: img.name,
        size: 0,
        dataUrl: img.url,
        state: "ready" as const,
        characterId: img.characterId,
      }))
    );
    setNotice("Previous settings loaded — review and generate again");
  }, [reuse]);

  function bindingLineFrom(list: ImageItem[], c: Character): string {
    const readyList = list.filter((i) => i.state === "ready" && i.dataUrl);
    const parts = readyList
      .map((i, k) => (i.characterId === c.id ? `Image ${k + 1}` : ""))
      .filter(Boolean);
    return `${c.name}: ${c.description || "see reference images"}${
      parts.length ? ` [${parts.join(", ")}]` : ""
    }. Preserve the identity of ${c.name}. `;
  }

  const charRefsCache = useRef(new Map<string, string[]>());

  async function getCharRefs(
    c: Character
  ): Promise<{ refs?: string[]; msg?: string; warnings: string[] }> {
    const key = `${c.id}@${c.updatedAt ?? c.createdAt}`;
    const cached = charRefsCache.current.get(key);
    if (cached) return { refs: cached, warnings: [] };
    const warnings: string[] = [];
    const images: string[] = [];
    for (let i = 0; i < c.imageCount; i++) {
      try {
        const res = await fetch(charImgUrl(c, i));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        images.push(await blobToDataUrl(await res.blob()));
      } catch (e) {
        warnings.push(
          `${c.name} image ${i + 1} failed: ${e instanceof Error ? e.message : "load failed"}`
        );
      }
    }
    if (!images.length)
      return { msg: `Could not load ${c.name}'s reference images`, warnings };
    charRefsCache.current.set(key, images);
    return { refs: images, warnings };
  }

  function updateItem(id: string, patch: Partial<ImageItem>) {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  async function handleFiles(files: File[]) {
    setNotice(null);
    let count = items.length;
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        setNotice(`${file.name}: only image files are supported`);
        continue;
      }
      if (count >= MAX_IMAGES) {
        setNotice(`At most ${MAX_IMAGES} reference images`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setNotice(`${file.name}: image exceeds 10MB limit`);
        continue;
      }
      count++;
      const id = nextId();
      setItems((list) => [
        ...list,
        { id, name: `Image ${count}`, size: file.size, state: "loading" },
      ]);
      try {
        const dataUrl = await fileToDataUrl(file);
        updateItem(id, { dataUrl, state: "ready" });
      } catch {
        updateItem(id, { state: "error", error: "Could not read image" });
      }
    }
  }

  function imageMentions(): MediaMention[] {
    return items
      .filter((i) => i.state === "ready" && i.dataUrl)
      .map((i, idx) => ({
        token: `@Image ${idx + 1}`,
        label: `Image ${idx + 1}`,
        sub: "reference image",
        thumb: i.dataUrl,
      }));
  }

  async function handleAssetDrop(d: AssetDropData) {
    if (d.kind === "video") {
      setNotice("Only image assets can be used as references here");
      return;
    }
    try {
      const res = await fetch(d.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) {
        setNotice("Dropped asset is not an image");
        return;
      }
      const ext = blob.type.includes("png") ? ".png" : ".jpg";
      const base = (d.name || "asset").replace(/[^\w.-]+/g, "_").slice(0, 40);
      await handleFiles([
        new File([blob], `${base}${ext}`, { type: blob.type }),
      ]);
      setNotice("Imported gallery image as reference");
    } catch (e) {
      setNotice(
        `Could not import asset: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  async function handleSubmit() {
    setNotice(null);
    if (!prompt.trim()) {
      setNotice("Enter a prompt");
      return;
    }
    if (loading) {
      setNotice("Wait for images to finish loading");
      return;
    }
    if (items.some((i) => i.state === "error")) {
      setNotice("Remove failed images before generating");
      return;
    }
    const seedNum = seed.trim() ? Number(seed) : undefined;
    if (seedNum !== undefined && (!Number.isInteger(seedNum) || seedNum < 0 || seedNum > 2147483647)) {
      setNotice("Seed must be an integer in [0, 2147483647]");
      return;
    }
    setPreparing(true);
    try {
      const working = [...itemsRef.current];
      let chars: Character[] = [];
      try {
        const res = await fetch(
          `/api/characters?project=${projectId === null ? "none" : projectId}`
        );
        const d = await res.json();
        chars = Array.isArray(d.characters) ? d.characters : [];
      } catch {
        chars = [];
      }
      const text = prompt;
      const mentioned = chars.filter((c) =>
        new RegExp(`(?<![\\w])${escapeRe(c.name)}(?![\\w-])`).test(text)
      );
      const attachedIds = new Set(
        working
          .map((i) => i.characterId)
          .filter((x): x is string => Boolean(x))
      );
      const targets = [
        ...mentioned,
        ...chars.filter(
          (c) =>
            attachedIds.has(c.id) && !mentioned.some((m) => m.id === c.id)
        ),
      ];
      for (const c of targets) {
        if (working.some((i) => i.characterId === c.id)) continue;
        const { refs, msg, warnings } = await getCharRefs(c);
        warnings.forEach(setNotice);
        if (!refs) {
          setNotice(msg || `Could not load ${c.name} references`);
          return;
        }
        const n = Math.min(MAX_IMAGES - working.length, refs.length);
        if (n <= 0) {
          setNotice(
            `Reference slots full (max ${MAX_IMAGES}) — cannot add ${c.name} images`
          );
          return;
        }
        if (n < refs.length)
          setNotice(
            `Only ${n} slot(s) free — using first ${n} of ${refs.length} images for ${c.name}`
          );
        for (let i = 0; i < n; i++)
          working.push({
            id: nextId(),
            name: `Image ${working.length + 1}`,
            size: 0,
            dataUrl: refs[i],
            state: "ready",
            characterId: c.id,
          });
      }
      const lines: string[] = [];
      for (const c of targets) {
        if (text.includes(`${c.name}:`)) continue;
        lines.push(bindingLineFrom(working, c));
      }
      const finalPrompt = lines.length
        ? lines.join("") + text.trim()
        : text.trim();
      const readyNow = working.filter((i) => i.state === "ready" && i.dataUrl);
      await onSubmit({
        kind: "image",
        prompt: finalPrompt,
        userPrompt: text,
        model: customModel.trim() || model,
        images: readyNow.map((i) => ({
          name: i.name,
          url: i.dataUrl!,
          characterId: i.characterId,
        })),
        size,
        n,
        negativePrompt: negativePrompt.trim() || undefined,
        promptExtend,
        watermark,
        seed: seedNum,
      });
    } finally {
      setPreparing(false);
    }
  }

  const mentionSig = items
    .map(
      (i) =>
        `${i.state}:${(i.dataUrl || "").slice(-32)}`
    )
    .join("|");

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Prompt" step="01">
        <MentionTextArea
          rows={5}
          value={prompt}
          onChange={setPrompt}
          projectId={projectId}
          getMediaMentions={imageMentions}
          mediaSignature={mentionSig}
          chipCharacters
        />
        <div className="mt-2 flex items-center justify-end gap-3 text-2xs text-muted">
              {onSavePrompt && (
                <button
                  type="button"
                  onClick={() => void savePrompt()}
                  disabled={!prompt.trim()}
                  title="Save this prompt to the Prompts tab so you can reuse it later"
                  className="text-2xs text-muted hover:text-accent disabled:opacity-40 disabled:hover:text-muted transition-colors"
                >
                  {promptSaved === "ok"
                    ? "✓ Saved to Prompts"
                    : promptSaved === "err"
                      ? "Could not save"
                      : "🔖 Save prompt"}
                </button>
              )}
        </div>
        <div className="mt-3">
          <Field label="Negative prompt" hint="Optional, up to 500 characters">
            <TextInput
              value={negativePrompt}
              maxLength={500}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="low quality, distorted limbs, blurry text…"
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Reference images" step="02">
        {items.length === 0 && (
          <DropZone
            accept="image/*"
            title="Drop images"
            hint={`Or click to browse, or drag one in from the gallery. 1–${MAX_IMAGES} images, jpg/png/bmp/webp up to 10MB.`}
            onFiles={handleFiles}
            onAssetDrop={handleAssetDrop}
          />
        )}
        {notice && (
          <p className="mt-3 text-xs text-warn">⚠ {notice}</p>
        )}
        {items.length > 0 && (
          <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="relative border border-line rounded-md overflow-hidden bg-panel2 group"
              >
                <div className="aspect-square bg-black/40 flex items-center justify-center overflow-hidden">
                  {item.dataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.dataUrl}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-muted text-2xs">
                      {item.state === "error" ? "failed" : "loading…"}
                    </span>
                  )}
                </div>
                <div className="px-1.5 py-1">
                  <p className="text-2xs truncate" title={item.name}>
                    Image {idx + 1} · {formatBytes(item.size)}
                  </p>
                  {item.error && (
                    <p className="text-2xs text-danger truncate">
                      {item.error}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setItems((list) => list.filter((i) => i.id !== item.id))
                  }
                  aria-label={`Remove ${item.name}`}
                  className="absolute top-1.5 right-1.5 w-7 h-7 rounded-md bg-black/65 backdrop-blur-sm text-white/75 hover:text-danger hover:bg-black/80 text-xs leading-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </div>
            ))}
            <AddTile
              accept="image/*"
              onFiles={handleFiles}
              onAssetDrop={handleAssetDrop}
              className="aspect-square min-h-20"
            />
          </div>
        )}
      </Panel>

      <Panel title="Output settings" step="03">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Model">
            <Seg
              value={model}
              onChange={setModel}
              options={[
                { value: "qwen-image-3.0-pro", label: "Qwen Pro" },
                { value: "qwen-image-3.0", label: "Qwen Fast" },
                { value: "google/gemini-3.1-flash-image", label: "Nano Banana" },
              ]}
            />
          </Field>
          <Field label="Aspect ratio" hint="Standard 1K">
            <Select
              value={size}
              onChange={setSize}
              options={[
                { value: "auto", label: "Auto (model decides)" },
                { value: "1333*750", label: "16:9 · 1333×750" },
                { value: "750*1333", label: "9:16 · 750×1333" },
                { value: "1155*866", label: "4:3 · 1155×866" },
                { value: "866*1155", label: "3:4 · 866×1155" },
                { value: "1000*1000", label: "1:1 · 1000×1000" },
              ]}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="Custom model"
              hint="Optional — overrides the choice above"
            >
              <input
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="Any OpenRouter id, e.g. google/gemini-3-pro-image"
                className="w-full h-9 bg-panel2 border border-line rounded-md px-3 text-xs font-mono text-ink placeholder:text-muted/60 outline-none focus:border-accent/50 transition-colors"
              />
            </Field>
          </div>
          <Field label="Images" hint="1–6">
            <Seg
              value={String(n)}
              onChange={(v) => setN(Number(v))}
              options={["1", "2", "3", "4", "5", "6"].map((v) => ({ value: v, label: v }))}
            />
          </Field>
          <Field label="Seed" hint="Optional">
            <TextInput
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="random"
              inputMode="numeric"
            />
          </Field>
          <div className="sm:col-span-2 flex flex-wrap gap-x-6 gap-y-3">
            <Toggle
              checked={promptExtend}
              onChange={setPromptExtend}
              label="Prompt rewrite"
            />
            <Toggle
              checked={watermark}
              onChange={setWatermark}
              label='"Qwen-Image" watermark'
            />
          </div>
        </div>
      </Panel>

      <Btn
        onClick={handleSubmit}
        disabled={loading || preparing}
        size="lg"
        className="w-full"
      >
        {preparing
          ? "Preparing media…"
          : loading
            ? "Loading images…"
            : "Generate image"}
      </Btn>
    </div>
  );
}
