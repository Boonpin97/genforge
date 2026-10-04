"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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
import {
  DEFAULT_MODELS,
  type ImagePolicy,
  type PublicImageModel,
} from "@/lib/model-catalog";

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

const FALLBACK_POLICY = (
  DEFAULT_MODELS.find((m) => m.kind === "image") as { policy: ImagePolicy }
).policy;

const SIZE_LABELS: Record<string, string> = {
  auto: "Auto (model decides)",
  "1333*750": "16:9 · 1333×750",
  "750*1333": "9:16 · 750×1333",
  "1155*866": "4:3 · 1155×866",
  "866*1155": "3:4 · 866×1155",
  "1000*1000": "1:1 · 1000×1000",
  "1K": "1K · about 1024×1024",
  "2K": "2K · about 2048×2048",
  "4K": "4K · about 4096×4096 (text to image only)",
  "2048*2048": "1:1 · 2048×2048",
  "2688*1536": "16:9 · 2688×1536",
  "1536*2688": "9:16 · 1536×2688",
  "2368*1728": "4:3 · 2368×1728",
  "1728*2368": "3:4 · 1728×2368",
};

let idCounter = 0;
async function fitRefImage(
  url: string,
  minSide: number,
  maxSide: number,
  noAlpha: boolean
): Promise<{ url: string; size?: [number, number]; to?: [number, number]; flattened?: boolean }> {
  if (!minSide && !maxSide && !noAlpha) return { url };
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
  } catch {
    return { url };
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return { url };
  const scale =
    minSide && Math.min(w, h) < minSide
      ? minSide / Math.min(w, h)
      : maxSide && Math.max(w, h) > maxSide
        ? maxSide / Math.max(w, h)
        : 1;
  const flatten = noAlpha && !/^data:image\/jpe?g/i.test(url);
  if (scale === 1 && !flatten) return { url, size: [w, h] };
  const W = scale > 1 ? Math.ceil(w * scale) : Math.floor(w * scale);
  const H = scale > 1 ? Math.ceil(h * scale) : Math.floor(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { url, size: [w, h] };
  if (flatten) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, W, H);
  try {
    return {
      url: flatten
        ? canvas.toDataURL("image/jpeg", 0.95)
        : canvas.toDataURL("image/png"),
      size: [w, h],
      to: scale === 1 ? undefined : [W, H],
      flattened: flatten,
    };
  } catch {
    return { url, size: [w, h] };
  }
}

const nextId = () => `i${Date.now()}-${idCounter++}`;

export default function ImagePanel({
  onSubmit,
  promptInjection,
  onSavePrompt,
  reuse,
  projectId,
  models,
}: {
  onSubmit: (payload: ImageSubmitPayload) => Promise<boolean>;
  promptInjection?: { text: string; nonce: number } | null;
  onSavePrompt?: (text: string) => Promise<boolean>;
  reuse: { settings: ImageSettings; nonce: number } | null;
  projectId: string | null;
  models: PublicImageModel[];
}) {
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [modelChoice, setModel] = useState("qwen-image-3.0");
  const [size, setSize] = useState("1333*750");
  const [n, setN] = useState(1);
  const [promptExtend, setPromptExtend] = useState(false);
  const [watermark, setWatermark] = useState(false);
  const [seed, setSeed] = useState("");
  const [items, setItems] = useState<ImageItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  const loading = items.some((i) => i.state === "loading");
  const entry = models.find((m) => m.id === modelChoice) ?? models[0] ?? null;
  const model = entry?.id ?? modelChoice;
  const policy = entry?.policy ?? FALLBACK_POLICY;
  const MAX_IMAGES = policy.maxRefs;
  const MAX_BYTES = policy.maxRefMB * 1024 * 1024;
  const MIN_REF_SIDE = policy.minRefSide;
  const MAX_REF_SIDE = policy.maxRefSide;
  const MAX_REF_ASPECT = policy.maxRefAspect;
  const REF_NO_ALPHA = policy.refNoAlpha;
  const modelLabel = entry?.label ?? "This model";
  const overRefs = Math.max(0, items.length - MAX_IMAGES);

  useEffect(() => {
    if (!models.length || models.some((m) => m.id === modelChoice)) return;
    const raf = requestAnimationFrame(() => setModel(models[0].id));
    return () => cancelAnimationFrame(raf);
  }, [models, modelChoice]);

  const sizesKey = policy.sizes.join("|");
  const maxN = policy.maxN;
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const sizes = sizesKey.split("|");
      setSize((cur) => (sizes.includes(cur) ? cur : sizes[0]));
      setN((cur) => Math.min(cur, maxN));
    });
    return () => cancelAnimationFrame(raf);
  }, [sizesKey, maxN]);

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
        setNotice(
          MAX_IMAGES
            ? `At most ${MAX_IMAGES} reference images`
            : `${entry?.label ?? "This model"} does not take reference images`
        );
        continue;
      }
      if (file.size > MAX_BYTES) {
        setNotice(`${file.name}: image exceeds ${policy.maxRefMB}MB limit`);
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
    if (!entry) {
      setNotice("No image model is ready — enable one on the Models page");
      return;
    }
    if (overRefs) {
      setNotice(
        MAX_IMAGES
          ? `${entry.label} takes ${MAX_IMAGES} reference images — remove ${overRefs}`
          : `${entry.label} does not take reference images — remove them or switch model`
      );
      return;
    }
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
        if (MAX_IMAGES === 0) continue;
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
      if (policy.maxPromptChars && finalPrompt.length > policy.maxPromptChars) {
        setNotice(
          `${modelLabel} takes prompts up to ${policy.maxPromptChars} characters — this one is ${finalPrompt.length} with the character lines added.`
        );
        return;
      }
      if (
        policy.negativePrompt &&
        policy.maxNegativeChars &&
        negativePrompt.trim().length > policy.maxNegativeChars
      ) {
        setNotice(
          `${modelLabel} takes negative prompts up to ${policy.maxNegativeChars} characters.`
        );
        return;
      }
      if (
        readyNow.length &&
        policy.textOnlySizes.some((s) => s.toLowerCase() === size.toLowerCase())
      ) {
        setNotice(
          `${modelLabel} renders ${size} for text-to-image only — pick another size, or remove the reference images.`
        );
        return;
      }
      const fittedRefs = new Map<string, string>();
      const fitNotes: string[] = [];
      for (const i of readyNow) {
        const fit = await fitRefImage(
          i.dataUrl!,
          MIN_REF_SIDE,
          MAX_REF_SIDE,
          REF_NO_ALPHA
        );
        if (fit.size && MAX_REF_ASPECT) {
          const [w, h] = fit.size;
          if (Math.max(w, h) / Math.min(w, h) > MAX_REF_ASPECT) {
            setNotice(
              `${i.name} is ${w}×${h} — ${modelLabel} only takes images between 1:${MAX_REF_ASPECT} and ${MAX_REF_ASPECT}:1. Crop it and add it again.`
            );
            return;
          }
        }
        if (fit.to && fit.size)
          fitNotes.push(
            `${i.name} ${fit.to[0] > fit.size[0] ? "upscaled" : "downscaled"} from ${fit.size[0]}×${fit.size[1]} to ${fit.to[0]}×${fit.to[1]}`
          );
        if (fit.flattened) fitNotes.push(`${i.name} flattened onto white (no transparency allowed)`);
        fittedRefs.set(i.id, fit.url);
      }
      if (fitNotes.length)
        setNotice(`Adjusted for ${modelLabel}: ${fitNotes.join("; ")}`);
      await onSubmit({
        kind: "image",
        prompt: finalPrompt,
        userPrompt: text,
        model,
        images: readyNow.map((i) => ({
          name: i.name,
          url: fittedRefs.get(i.id) ?? i.dataUrl!,
          characterId: i.characterId,
        })),
        size,
        n,
        negativePrompt: policy.negativePrompt ? negativePrompt.trim() || undefined : undefined,
        promptExtend: policy.promptExtend && promptExtend,
        watermark: policy.watermark && watermark,
        seed: policy.seed ? seedNum : undefined,
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
        {policy.negativePrompt && (
        <div className="mt-3">
          <Field label="Negative prompt" hint="Optional, up to 500 characters">
            <TextInput
              value={negativePrompt}
              maxLength={policy.maxNegativeChars || 2000}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="low quality, distorted limbs, blurry text…"
            />
          </Field>
        </div>
        )}
      </Panel>

      <Panel title="Reference images" step="02">
        {items.length === 0 && MAX_IMAGES === 0 && (
          <p className="text-sm text-muted">
            {entry?.label ?? "This model"} works from the prompt only. Characters
            you mention are described in text.
          </p>
        )}
        {overRefs > 0 && (
          <p className="mb-3 text-xs text-danger">
            {MAX_IMAGES
              ? `${entry?.label} takes ${MAX_IMAGES} reference images — remove ${overRefs}.`
              : `${entry?.label} does not take reference images — remove them or switch model.`}
          </p>
        )}
        {items.length === 0 && MAX_IMAGES > 0 && (
          <DropZone
            accept="image/*"
            title="Drop images"
            hint={`Or click to browse, or drag one in from the gallery. Up to ${MAX_IMAGES} images, JPG, PNG, BMP or WEBP up to ${policy.maxRefMB}MB.`}
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
          <Field label="Model" hint={entry ? undefined : "none enabled"}>
            {models.length > 0 && models.length <= 3 ? (
              <Seg
                value={model}
                onChange={setModel}
                options={models.map((m) => ({ value: m.id, label: m.label }))}
              />
            ) : models.length > 3 ? (
              <Select
                value={model}
                onChange={setModel}
                options={models.map((m) => ({ value: m.id, label: m.label }))}
              />
            ) : (
              <Link
                href="/models"
                className="flex items-center h-9 px-3 rounded-md border border-line bg-panel2 text-sm text-accent hover:bg-panel2/70"
              >
                Enable an image model on the Models page
              </Link>
            )}
          </Field>
          <Field label="Aspect ratio" hint="Standard 1K">
            <Select
              value={size}
              onChange={setSize}
              options={policy.sizes.map((v) => ({
                value: v,
                label: SIZE_LABELS[v] || v.replace("*", "×"),
              }))}
            />
          </Field>
          <Field label="Images" hint={`1–${policy.maxN}`}>
            <Seg
              value={String(n)}
              onChange={(v) => setN(Number(v))}
              options={Array.from({ length: policy.maxN }, (_, i) => String(i + 1)).map(
                (v) => ({ value: v, label: v })
              )}
            />
          </Field>
          {policy.seed && (
            <Field label="Seed" hint="Optional">
              <TextInput
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="random"
                inputMode="numeric"
              />
            </Field>
          )}
          {(policy.promptExtend || policy.watermark) && (
            <div className="sm:col-span-2 flex flex-wrap gap-x-6 gap-y-3">
              {policy.promptExtend && (
                <Toggle
                  checked={promptExtend}
                  onChange={setPromptExtend}
                  label="Prompt rewrite"
                />
              )}
              {policy.watermark && (
                <Toggle
                  checked={watermark}
                  onChange={setWatermark}
                  label='"Qwen-Image" watermark'
                />
              )}
            </div>
          )}
          {entry?.notes && (
            <p className="sm:col-span-2 text-2xs text-muted leading-snug">
              {entry.notes}
            </p>
          )}
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
