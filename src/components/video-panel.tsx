"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DropZone, {
  AddTile,
  blobToDataUrl,
  fileToDataUrl,
  formatBytes,
  getVideoDuration,
  trimAudioBlob,
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
  Slider,
  Toggle,
} from "./ui";
import type {
  Character,
  MediaPayload,
  VideoSettings,
} from "@/lib/types";
import { charAudioUrl, charImgUrl } from "@/lib/types";

export type MediaItem = {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  size: number;
  url?: string;
  previewUrl: string;
  durationSec?: number;
  state: "uploading" | "ready" | "error";
  error?: string;
  characterId?: string;
};

export type VideoSubmitPayload = VideoSettings;

const MAX_IMAGES = 10;
const MAX_VIDEOS = 5;
const MAX_VIDEO_TOTAL_SEC = 15;
const MAX_AUDIO_SEC = 15;
const TOTAL_BUDGET_SEC = 30;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const IMAGE_EXT = /\.(jpe?g|png|bmp|webp)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg)$/i;

const PREVIEWABLE = /^(data:|blob:|https?:)/i;

let idCounter = 0;
const nextId = () => `m${Date.now()}-${idCounter++}`;

export default function VideoPanel({
  onSubmit,
  injection,
  reuse,
  projectId,
  videoProvider = "dashscope",
}: {
  onSubmit: (payload: VideoSubmitPayload) => Promise<boolean>;
  injection: { characters: Character[]; nonce: number } | null;
  reuse: { settings: VideoSettings; nonce: number } | null;
  projectId: string | null;
  videoProvider?: "dashscope" | "qwencloud";
}) {
  const [prompt, setPrompt] = useState("");
  const [rewrote, setRewrote] = useState("");
  const [promptTab, setPromptTab] = useState<"prompt" | "rewritten">("prompt");
  const [rewriting, setRewriting] = useState(false);
  const [rewriteSig, setRewriteSig] = useState("");
  const [model, setModel] = useState("wan3.0-video");
  const [resolution, setResolution] = useState("480P");
  const [ratio, setRatio] = useState("16:9");
  const [duration, setDuration] = useState(30);
  const [audio, setAudio] = useState(true);
  const [watermark, setWatermark] = useState(false);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [genMode, setGenMode] = useState<"text" | "frame">("text");
  const [firstFrame, setFirstFrame] = useState<MediaItem | null>(null);
  const [lastFrame, setLastFrame] = useState<MediaItem | null>(null);

  const showFrameMode = videoProvider === "qwencloud";
  const frameMode = showFrameMode && genMode === "frame";

  const images = items.filter((i) => i.kind === "image");
  const videos = items.filter((i) => i.kind === "video");
  const totalVideoSec = useMemo(
    () => videos.reduce((s, v) => s + (v.durationSec || 0), 0),
    [videos]
  );
  const pending = items.some((i) => i.state === "uploading");
  const broken = items.some((i) => i.state === "error");
  const durationMax = Math.max(2, TOTAL_BUDGET_SEC - Math.ceil(totalVideoSec));

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setDuration((d) => (d > durationMax ? durationMax : d));
    });
    return () => cancelAnimationFrame(raf);
  }, [durationMax]);

  function notify(msg: string) {
    setNotices((n) => [...n.slice(-3), msg]);
    setTimeout(() => setNotices((n) => n.filter((x) => x !== msg)), 6000);
  }

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const injectionRef = useRef(0);

  const reuseRef = useRef(0);
  useEffect(() => {
    if (!reuse || reuse.nonce === reuseRef.current) return;
    reuseRef.current = reuse.nonce;
    const s = reuse.settings;
    setPrompt(s.prompt);
    setRewrote(s.rewrotePrompt || "");
    setPromptTab(s.promptTab === "rewritten" ? "rewritten" : "prompt");
    setRewriteSig("");
    setModel(s.model);
    setResolution(s.resolution);
    setRatio(s.ratio);
    setDuration(s.duration);
    setAudio(s.audio);
    setWatermark(s.watermark);
    const toItem = (m: MediaPayload, fallback: string): MediaItem => {
      const kind: MediaItem["kind"] =
        m.type === "reference_video" ? "video" : m.type === "reference_audio" ? "audio" : "image";
      const previewUrl =
        kind === "audio" || !m.previewUrl || !PREVIEWABLE.test(m.previewUrl)
          ? ""
          : m.previewUrl;
      return {
        id: nextId(),
        kind,
        name: m.name || fallback,
        size: 0,
        url: m.url,
        previewUrl,
        durationSec: m.durationSec,
        characterId: m.characterId,
        state: "ready",
      };
    };
    const ff = s.media.find((m) => m.type === "first_frame");
    const lf = s.media.find((m) => m.type === "last_frame");
    setGenMode(ff || lf ? "frame" : "text");
    setFirstFrame(ff ? toItem(ff, "first frame") : null);
    setLastFrame(lf ? toItem(lf, "last frame") : null);
    setItems(
      s.media
        .filter((m) => m.type !== "first_frame" && m.type !== "last_frame")
        .map((m) =>
          toItem(
            m,
            m.type === "reference_image"
              ? "reference image"
              : m.type === "reference_video"
                ? "reference video"
                : "reference audio"
          )
        )
    );
    notify("Previous settings loaded — review references and submit again");
  }, [reuse]);

  function bindingLineFrom(list: MediaItem[], c: Character): string {
    const images: string[] = [];
    let n = 0;
    for (const i of list)
      if (i.kind === "image" && i.state === "ready") {
        n += 1;
        if (i.characterId === c.id) images.push(`Image ${n}`);
      }
    const audios: string[] = [];
    let a = 0;
    for (const i of list)
      if (i.kind === "audio" && i.state === "ready") {
        a += 1;
        if (i.characterId === c.id) audios.push(`Audio ${a}`);
      }
    let line = `${c.name}: ${c.description || "see reference images"}`;
    if (images.length) line += ` [${images.join(", ")}]`;
    line += ".";
    if (audios.length) {
      const audioLabel = audios.join(", ");
      line += ` ${audioLabel} is ${c.name}'s voice quality only — whenever ${c.name} speaks, deliver the scene's own dialogue in that voice; never transcribe, repeat, or lip-sync the words spoken in ${audioLabel}.`;
    }
    return `${line} `;
  }

  function patchWorking(
    list: MediaItem[],
    id: string,
    patch: Partial<MediaItem>
  ) {
    const idx = list.findIndex((i) => i.id === id);
    if (idx >= 0) list[idx] = { ...list[idx], ...patch };
  }

  async function attachRefs(
    working: MediaItem[],
    c: Character
  ): Promise<{ ok: boolean; msg?: string; warnings: string[] }> {
    const warnings: string[] = [];
    const currentImages = working.filter(
      (i) => i.kind === "image" && i.state !== "error"
    ).length;
    const slots = MAX_IMAGES - currentImages;
    if (slots <= 0)
      return {
        ok: false,
        msg: `Image slots full (max ${MAX_IMAGES}) — cannot attach ${c.name}`,
        warnings,
      };
    if (slots < c.imageCount)
      warnings.push(
        `Only ${slots} image slot(s) free for ${c.name} — using first ${slots} of ${c.imageCount}`
      );
    const attachCount = Math.min(slots, c.imageCount);
    const audioIdx =
      working.filter((i) => i.kind === "audio" && i.state !== "error").length + 1;

    const imageItems: MediaItem[] = [];
    for (let i = 0; i < attachCount; i++) {
      imageItems.push({
        id: nextId(),
        kind: "image",
        name: `Image ${currentImages + i + 1}`,
        size: 0,
        previewUrl: "",
        state: "uploading",
        characterId: c.id,
      });
    }
    let audioItem: MediaItem | null = null;
    if (c.hasAudio) {
      audioItem = {
        id: nextId(),
        kind: "audio",
        name: `Audio ${audioIdx}`,
        size: 0,
        previewUrl: "",
        state: "uploading",
        characterId: c.id,
      };
    }
    working.push(...imageItems, ...(audioItem ? [audioItem] : []));
    setItems([...working]);

    for (let i = 0; i < attachCount; i++) {
      const item = imageItems[i];
      try {
        const res = await fetch(charImgUrl(c, i));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const dataUrl = await blobToDataUrl(await res.blob());
        patchWorking(working, item.id, {
          url: dataUrl,
          previewUrl: dataUrl,
          state: "ready",
        });
      } catch (e) {
        patchWorking(working, item.id, {
          state: "error",
          error: e instanceof Error ? e.message : "load failed",
        });
      }
      setItems([...working]);
    }

    if (audioItem) {
      try {
        const res = await fetch(charAudioUrl(c));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.blob();
        const { blob, trimmed, durationSec } = await trimAudioBlob(
          raw,
          MAX_AUDIO_SEC
        );
        if (trimmed)
          warnings.push(
            `${c.name} voice is ${durationSec.toFixed(1)}s — using first ${MAX_AUDIO_SEC}s (API max)`
          );
        const previewUrl = URL.createObjectURL(blob);
        const file = new File([blob], `${c.id}-voice`, {
          type: blob.type || "audio/wav",
        });
        const form = new FormData();
        form.append("file", file);
        form.append("model", "wan3.0-video");
        const up = await fetch("/api/upload", { method: "POST", body: form });
        const data = await up.json();
        if (!up.ok) throw new Error(data?.message || `HTTP ${up.status}`);
        patchWorking(working, audioItem.id, {
          url: data.url,
          previewUrl,
          size: blob.size,
          state: "ready",
        });
      } catch (e) {
        patchWorking(working, audioItem.id, {
          state: "error",
          error: e instanceof Error ? e.message : "voice upload failed",
        });
      }
      setItems([...working]);
    }

    return { ok: true, warnings };
  }

  type CharRefs = {
    images: string[];
    audio?: { url: string; previewUrl: string; size: number };
  };
  const charRefsCache = useRef(new Map<string, CharRefs>());

  async function getCharRefs(
    c: Character
  ): Promise<{ refs?: CharRefs; msg?: string; warnings: string[] }> {
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
    let audio: CharRefs["audio"];
    if (c.hasAudio) {
      try {
        const res = await fetch(charAudioUrl(c));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.blob();
        const { blob, trimmed, durationSec } = await trimAudioBlob(
          raw,
          MAX_AUDIO_SEC
        );
        if (trimmed)
          warnings.push(
            `${c.name} voice is ${durationSec.toFixed(1)}s — using first ${MAX_AUDIO_SEC}s (API max)`
          );
        const previewUrl = URL.createObjectURL(blob);
        const file = new File([blob], `${c.id}-voice`, {
          type: blob.type || "audio/wav",
        });
        const form = new FormData();
        form.append("file", file);
        form.append("model", "wan3.0-video");
        const up = await fetch("/api/upload", { method: "POST", body: form });
        const data = await up.json();
        if (!up.ok) throw new Error(data?.message || `HTTP ${up.status}`);
        audio = { url: data.url, previewUrl, size: blob.size };
      } catch (e) {
        warnings.push(
          `${c.name} voice upload failed (${e instanceof Error ? e.message : "error"}) — sending without audio`
        );
      }
    }
    const refs: CharRefs = { images, audio };
    charRefsCache.current.set(key, refs);
    return { refs, warnings };
  }

  async function injectCharacter(c: Character) {
    if (itemsRef.current.some((i) => i.characterId === c.id)) return;
    const working = [...itemsRef.current];
    const r = await attachRefs(working, c);
    if (!r.ok) {
      notify(r.msg || `Could not attach ${c.name}`);
      return;
    }
    r.warnings.forEach(notify);
    notify(
      `Character "${c.name}" references attached — description is added when you generate`
    );
  }

  useEffect(() => {
    if (!injection || injection.nonce === injectionRef.current) return;
    injectionRef.current = injection.nonce;
    void (async () => {
      for (const c of injection.characters) await injectCharacter(c);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injection]);

  function updateItem(id: string, patch: Partial<MediaItem>) {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function removeItem(id: string) {
    setItems((list) => {
      const item = list.find((i) => i.id === id);
      if (item?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
      return list.filter((i) => i.id !== id);
    });
  }

  async function handleFiles(files: File[]) {
    const errs: string[] = [];
    let imgCount = images.length;
    let vidCount = videos.length;
    let vidSec = totalVideoSec;
    let audCount = items.filter(
      (i) => i.kind === "audio" && i.state !== "error"
    ).length;

    for (const file of files) {
      const isAudio =
        file.type.startsWith("audio/") || AUDIO_EXT.test(file.name);
      const isVideo =
        file.type.startsWith("video/") || /\.(mp4|mov)$/i.test(file.name);
      const isImage =
        file.type.startsWith("image/") || IMAGE_EXT.test(file.name);

      if (isAudio) {
        if (file.size > MAX_AUDIO_BYTES) {
          errs.push(`${file.name}: audio exceeds 15MB limit`);
          continue;
        }
        audCount++;
        const id = nextId();
        setItems((list) => [
          ...list,
          {
            id,
            kind: "audio",
            name: `Audio ${audCount}`,
            size: file.size,
            previewUrl: URL.createObjectURL(file),
            state: "uploading",
          },
        ]);
        (async () => {
          try {
            const { blob, trimmed, durationSec } = await trimAudioBlob(
              file,
              MAX_AUDIO_SEC
            );
            if (trimmed)
              notify(
                `${file.name} is ${durationSec.toFixed(1)}s — using first ${MAX_AUDIO_SEC}s (API max)`
              );
            const form = new FormData();
            form.append(
              "file",
              new File([blob], file.name, { type: blob.type || file.type })
            );
            form.append("model", "wan3.0-video");
            const res = await fetch("/api/upload", {
              method: "POST",
              body: form,
            });
            const data = await res.json();
            if (!res.ok)
              throw new Error(data?.message || `Upload failed (HTTP ${res.status})`);
            updateItem(id, { url: data.url, size: blob.size, state: "ready" });
          } catch (e) {
            updateItem(id, {
              state: "error",
              error: e instanceof Error ? e.message : "Upload failed",
            });
          }
        })();
      } else if (isVideo) {
        if (vidCount >= MAX_VIDEOS) {
          errs.push(`${file.name}: max ${MAX_VIDEOS} reference videos`);
          continue;
        }
        if (file.size > MAX_VIDEO_BYTES) {
          errs.push(`${file.name}: video exceeds 100MB limit`);
          continue;
        }
        vidCount++;
        const id = nextId();
        const previewUrl = URL.createObjectURL(file);
        setItems((list) => [
          ...list,
          {
            id,
            kind: "video",
            name: `Video ${vidCount}`,
            size: file.size,
            previewUrl,
            state: "uploading",
          },
        ]);

        (async () => {
          try {
            const dur = await getVideoDuration(previewUrl).catch(() => 0);
            if (dur > MAX_VIDEO_TOTAL_SEC) {
              updateItem(id, {
                state: "error",
                error: `Clip is ${dur.toFixed(1)}s; max ${MAX_VIDEO_TOTAL_SEC}s per clip`,
                durationSec: dur,
              });
              return;
            }
            vidSec += dur;
            if (vidSec > MAX_VIDEO_TOTAL_SEC) {
              errs.push(
                `Combined reference video duration would exceed ${MAX_VIDEO_TOTAL_SEC}s`
              );
            }
            const form = new FormData();
            form.append("file", file);
            form.append("model", "wan3.0-video");
            const res = await fetch("/api/upload", { method: "POST", body: form });
            const data = await res.json();
            if (!res.ok) {
              updateItem(id, {
                state: "error",
                error: data?.message || `Upload failed (HTTP ${res.status})`,
                durationSec: dur,
              });
              return;
            }
            updateItem(id, { url: data.url, state: "ready", durationSec: dur });
          } catch (e) {
            updateItem(id, {
              state: "error",
              error: e instanceof Error ? e.message : "Upload failed",
            });
          }
        })();
      } else if (isImage) {
        if (imgCount >= MAX_IMAGES) {
          errs.push(`${file.name}: max ${MAX_IMAGES} reference images`);
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          errs.push(`${file.name}: image exceeds 20MB limit`);
          continue;
        }
        imgCount++;
        const id = nextId();
        setItems((list) => [
          ...list,
          {
            id,
            kind: "image",
            name: `Image ${imgCount}`,
            size: file.size,
            previewUrl: "",
            state: "uploading",
          },
        ]);
        try {
          const dataUrl = await fileToDataUrl(file);
          updateItem(id, { url: dataUrl, previewUrl: dataUrl, state: "ready" });
        } catch {
          updateItem(id, { state: "error", error: "Could not read image" });
        }
      } else {
        errs.push(`${file.name}: unsupported file type`);
      }
    }
    errs.forEach(notify);
  }

  function mediaMentions(): MediaMention[] {
    const out: MediaMention[] = [];
    let n = 0;
    for (const it of items)
      if (it.kind === "image" && it.state === "ready")
        out.push({
          token: `@Image ${++n}`,
          label: `Image ${n}`,
          sub: "reference image",
          thumb: it.previewUrl || undefined,
        });
    n = 0;
    for (const it of items)
      if (it.kind === "video" && it.state === "ready")
        out.push({
          token: `@Video ${++n}`,
          label: `Video ${n}`,
          sub: "reference video",
          thumb: it.previewUrl || undefined,
        });
    n = 0;
    for (const it of items)
      if (it.kind === "audio" && it.state === "ready")
        out.push({ token: `@Audio ${++n}`, label: `Audio ${n}`, sub: "reference audio" });
    return out;
  }

  async function handleAssetDrop(d: AssetDropData) {
    try {
      const res = await fetch(d.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const isVid = d.kind === "video" || blob.type.startsWith("video/");
      const ext = isVid ? ".mp4" : blob.type.includes("png") ? ".png" : ".jpg";
      const base = (d.name || "asset").replace(/[^\w.-]+/g, "_").slice(0, 40);
      await handleFiles([
        new File([blob], `${base}${ext}`, {
          type: blob.type || (isVid ? "video/mp4" : "image/png"),
        }),
      ]);
      notify(`Imported gallery ${isVid ? "video" : "image"} as reference`);
    } catch (e) {
      notify(
        `Could not import asset: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  function setFrameSlot(
    slot: "first" | "last",
    item: MediaItem | null
  ) {
    if (slot === "first") setFirstFrame(item);
    else setLastFrame(item);
  }

  async function setFrameFromFile(slot: "first" | "last", file: File) {
    const isImage = file.type.startsWith("image/") || IMAGE_EXT.test(file.name);
    if (!isImage) {
      notify("Frames must be image files");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      notify(`${file.name}: frame image exceeds 20MB limit`);
      return;
    }
    const item: MediaItem = {
      id: nextId(),
      kind: "image",
      name: file.name,
      size: file.size,
      previewUrl: "",
      state: "uploading",
    };
    setFrameSlot(slot, item);
    try {
      const dataUrl = await fileToDataUrl(file);
      setFrameSlot(slot, {
        ...item,
        url: dataUrl,
        previewUrl: dataUrl,
        state: "ready",
      });
    } catch {
      setFrameSlot(slot, { ...item, state: "error", error: "Could not read image" });
    }
  }

  async function setFrameFromAsset(slot: "first" | "last", d: AssetDropData) {
    if (d.kind === "video") {
      notify("Frames must be images, not videos");
      return;
    }
    try {
      const res = await fetch(d.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ext = blob.type.includes("png") ? ".png" : ".jpg";
      const base = (d.name || "frame").replace(/[^\w.-]+/g, "_").slice(0, 40);
      await setFrameFromFile(
        slot,
        new File([blob], `${base}${ext}`, { type: blob.type || "image/png" })
      );
    } catch (e) {
      notify(
        `Could not import asset: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  function readySig(list: MediaItem[]): string {
    return list
      .filter((i) => i.state === "ready" && i.url)
      .map((i) => `${i.kind}:${i.url!.slice(-28)}`)
      .join("|");
  }

  async function buildInventory(): Promise<string[]> {
    if (frameMode) return [];
    const ready = itemsRef.current.filter((i) => i.state === "ready" && i.url);
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
    const lines: string[] = [];
    let n = 0;
    for (const i of ready)
      if (i.kind === "image") {
        n++;
        const c = chars.find((x) => x.id === i.characterId);
        lines.push(
          `Image ${n} = ${i.name}${
            c
              ? ` (character: ${c.name}${c.description ? ` — ${c.description}` : ""})`
              : ""
          }`
        );
      }
    n = 0;
    for (const i of ready)
      if (i.kind === "video") {
        n++;
        lines.push(`Video ${n} = ${i.name}`);
      }
    n = 0;
    for (const i of ready)
      if (i.kind === "audio") {
        n++;
        const c = chars.find((x) => x.id === i.characterId);
        lines.push(
          `Audio ${n} = ${i.name}${c ? ` (character: ${c.name} — voice sample)` : ""}`
        );
      }
    return lines;
  }

  async function handleRewrite() {
    setNotices([]);
    const text = prompt.trim();
    if (!text) {
      notify("Write a prompt first");
      return;
    }
    if (pending) {
      notify("Wait for uploads to finish");
      return;
    }
    setRewriting(true);
    try {
      const inventory = await buildInventory();
      const res = await fetch("/api/rewrite-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, inventory, projectId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(data?.message || `Rewrite failed (HTTP ${res.status})`);
      setRewrote(String(data.rewrote || ""));
      setPromptTab("rewritten");
      setRewriteSig(readySig(itemsRef.current));
      notify("Rewritten request ready — review it, then generate");
    } catch (e) {
      notify(`Rewrite failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRewriting(false);
    }
  }

  async function handleSubmit() {
    setNotices([]);
    const useRewritten = promptTab === "rewritten";
    const sourceText = (useRewritten ? rewrote : prompt).trim();
    const effectiveModel = model;
    if (frameMode) {
      if (effectiveModel.includes("/")) {
        notify("Frame mode needs a wan3.0 model — clear the OpenRouter id first");
        return;
      }
      const ff = firstFrame?.state === "ready" && firstFrame.url ? firstFrame : null;
      const lf = lastFrame?.state === "ready" && lastFrame.url ? lastFrame : null;
      if (!ff) {
        notify("Add a first-frame image");
        return;
      }
      if (firstFrame?.state === "uploading" || lastFrame?.state === "uploading") {
        notify("Wait for the frame images to finish loading");
        return;
      }
      setPreparing(true);
      try {
        const media: MediaPayload[] = [
          {
            type: "first_frame",
            url: ff.url!,
            name: ff.name,
            previewUrl: ff.previewUrl,
          },
        ];
        if (lf)
          media.push({
            type: "last_frame",
            url: lf.url!,
            name: lf.name,
            previewUrl: lf.previewUrl,
          });
        await onSubmit({
          kind: "video",
          prompt: sourceText,
          userPrompt: prompt.trim(),
          rewrotePrompt: rewrote || undefined,
          promptTab,
          model: effectiveModel,
          resolution,
          ratio,
          duration,
          audio,
          watermark,
          media,
        });
      } finally {
        setPreparing(false);
      }
      return;
    }
    if (useRewritten) {
      if (!sourceText) {
        notify("Rewritten tab is empty — press Rewrite first or switch to Prompt");
        return;
      }
    } else if (!prompt.trim() && items.length === 0) {
      notify("Enter a prompt or add reference media");
      return;
    }
    if (pending) {
      notify("Wait for uploads to finish");
      return;
    }
    if (broken) {
      notify("Remove failed media before generating");
      return;
    }
    if (totalVideoSec + duration > TOTAL_BUDGET_SEC) {
      notify(
        `Reference video (${totalVideoSec.toFixed(1)}s) + duration (${duration}s) exceeds the ${TOTAL_BUDGET_SEC}s combined limit`
      );
      return;
    }
    setPreparing(true);
    try {
      const working = [...itemsRef.current];
      if (
        useRewritten &&
        rewriteSig &&
        readySig(working) !== rewriteSig
      )
        notify(
          "Media changed since the rewrite — Image/Video numbers in the rewritten text may no longer match"
        );
      let finalPrompt = sourceText;
      if (!useRewritten) {
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
        warnings.forEach(notify);
        if (!refs) {
          notify(msg || `Could not load ${c.name} references`);
          return;
        }
        const usedImgs = working.filter(
          (i) => i.kind === "image" && i.state !== "error"
        ).length;
        const n = Math.min(MAX_IMAGES - usedImgs, refs.images.length);
        if (n <= 0) {
          notify(
            `Image slots full (max ${MAX_IMAGES}) — cannot add ${c.name} references`
          );
          return;
        }
        if (n < refs.images.length)
          notify(
            `Only ${n} image slot(s) free — using first ${n} of ${refs.images.length} for ${c.name}`
          );
        const audUsed = working.filter(
          (i) => i.kind === "audio" && i.state !== "error"
        ).length;
        for (let i = 0; i < n; i++)
          working.push({
            id: nextId(),
            kind: "image",
            name: `Image ${usedImgs + i + 1}`,
            size: 0,
            url: refs.images[i],
            previewUrl: refs.images[i],
            state: "ready",
            characterId: c.id,
          });
        if (refs.audio)
          working.push({
            id: nextId(),
            kind: "audio",
            name: `Audio ${audUsed + 1}`,
            size: refs.audio.size,
            url: refs.audio.url,
            previewUrl: refs.audio.previewUrl,
            state: "ready",
            characterId: c.id,
          });
      }
        const lines: string[] = [];
        for (const c of targets) {
          if (text.includes(`${c.name}:`)) continue;
          lines.push(bindingLineFrom(working, c));
        }
        finalPrompt = lines.length ? lines.join("") + text.trim() : text.trim();
      }
      const ready = working.filter((i) => i.state === "ready" && i.url);
      const media: MediaPayload[] = ready.map((i) => ({
        type:
          i.kind === "image"
            ? "reference_image"
            : i.kind === "video"
              ? "reference_video"
              : "reference_audio",
        url: i.url!,
        name: i.name,
        previewUrl: i.kind === "audio" ? "" : i.previewUrl,
        durationSec: i.durationSec,
        characterId: i.characterId,
      }));
      await onSubmit({
        kind: "video",
        prompt: finalPrompt,
        userPrompt: useRewritten ? prompt.trim() : prompt,
        rewrotePrompt: rewrote || undefined,
        promptTab,
        model,
        resolution,
        ratio,
        duration,
        audio,
        watermark,
        media,
      });
    } finally {
      setPreparing(false);
    }
  }

  const imgIdx = (item: MediaItem) =>
    images.filter((i) => i.state === "ready").indexOf(item) + 1;
  const vidIdx = (item: MediaItem) =>
    videos.filter((i) => i.state === "ready").indexOf(item) + 1;

  const mentionSig = items
    .map(
      (i) =>
        `${i.kind}:${i.state}:${i.previewUrl.slice(0, 40)}:${
          i.url ? i.url.slice(-32) : ""
        }`
    )
    .join("|");

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Prompt" step="01">
        <div className="flex items-center gap-2 mb-2.5">
          <div className="flex-1 min-w-0">
            <Seg
              value={promptTab}
              onChange={setPromptTab}
              options={[
                { value: "prompt", label: "Prompt" },
                { value: "rewritten", label: "Rewritten" },
              ]}
            />
          </div>
          <Btn
            variant="ghost"
            onClick={handleRewrite}
            disabled={rewriting || preparing}
          >
            {rewriting ? "Rewriting…" : "✦ Rewrite"}
          </Btn>
        </div>

        {promptTab === "prompt" ? (
          <>
            <MentionTextArea
              rows={5}
              maxLength={20000}
              value={prompt}
              onChange={setPrompt}
              projectId={projectId}
              getMediaMentions={mediaMentions}
              mediaSignature={mentionSig}
              chipCharacters
              placeholder='Describe the video. Type "@" to reference Image N / Video N / Audio N or a saved character…'
            />
            <div className="mt-1.5 flex justify-between text-[11px] font-mono text-muted">
              <span>
                Tip: type <span className="text-accent">@</span> to mention dropped
                media or characters
              </span>
              <span>{prompt.length}/20000</span>
            </div>
          </>
        ) : (
          <>
            <textarea
              rows={8}
              maxLength={20000}
              value={rewrote}
              onChange={(e) => setRewrote(e.target.value)}
              placeholder="Press ✦ Rewrite to structure your Prompt into a five-section R2V request… this text is sent while the Rewritten tab is active."
              className="w-full bg-panel2 border border-line rounded-md px-3 py-2.5 text-sm font-mono text-ink placeholder:text-muted/50 outline-none focus:border-accent/60 transition-colors resize-y"
            />
            <div className="mt-1.5 flex justify-between text-[11px] font-mono text-muted">
              <span>
                {rewriting
                  ? "structuring with qwen3.8-flash…"
                  : "edited rewrite is sent as-is · press ✦ Rewrite to regenerate"}
              </span>
              <span>{rewrote.length}/20000</span>
            </div>
            {rewriteSig &&
              readySig(items) !== rewriteSig &&
              !frameMode && (
                <p className="mt-1.5 text-[11px] font-mono text-warn">
                  ⚠ media changed since the rewrite — press ✦ Rewrite again to
                  re-bind Image/Video numbers
                </p>
              )}
          </>
        )}
      </Panel>

      <Panel title={frameMode ? "First / last frame" : "Reference media"} step="02">
        {showFrameMode && (
          <div className="mb-3">
            <Field label="Generation mode">
              <Seg
                value={genMode}
                onChange={(v) => setGenMode(v)}
                options={[
                  { value: "text", label: "text / reference" },
                  { value: "frame", label: "first + last frame" },
                ]}
              />
            </Field>
            <p className="mt-1.5 text-[11px] font-mono text-muted">
              {genMode === "frame"
                ? "frame mode: give a first frame (and optional last frame); the model animates between them"
                : "text mode: prompt + optional reference images / videos / audio / characters"}
            </p>
          </div>
        )}

        {notices.length > 0 && (
          <div className="mb-3 space-y-1">
            {notices.map((n, i) => (
              <p key={i} className="text-xs text-warn font-mono">
                ⚠ {n}
              </p>
            ))}
          </div>
        )}

        {frameMode ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(["first", "last"] as const).map((slot) => {
              const item = slot === "first" ? firstFrame : lastFrame;
              return (
                <div key={slot}>
                  <p className="mb-1.5 text-[11px] font-mono text-muted">
                    {slot === "first"
                      ? "First frame (required)"
                      : "Last frame (optional)"}
                  </p>
                  {item ? (
                    <div className="relative border border-line rounded-md overflow-hidden bg-panel2 group">
                      <div className="aspect-video bg-black/40 flex items-center justify-center overflow-hidden">
                        {item.previewUrl || item.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.previewUrl || item.url}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-muted text-xs font-mono">…</span>
                        )}
                      </div>
                      <div className="px-2 py-1.5">
                        <p className="text-[11px] font-mono truncate" title={item.name}>
                          {item.name}
                        </p>
                        <p className="text-[10px] font-mono text-muted">
                          {item.state === "uploading" && "loading…"}
                          {item.state === "ready" &&
                            (item.size ? formatBytes(item.size) : "attached")}
                          {item.state === "error" && (
                            <span className="text-danger">{item.error}</span>
                          )}
                        </p>
                      </div>
                      {item.state === "uploading" && (
                        <span className="absolute top-1.5 left-1.5 w-2 h-2 rounded-full bg-warn animate-pulse-dot" />
                      )}
                      {item.state === "error" && (
                        <span className="absolute top-1.5 left-1.5 w-2 h-2 rounded-full bg-danger" />
                      )}
                      <button
                        type="button"
                        onClick={() => setFrameSlot(slot, null)}
                        aria-label={`Remove ${slot} frame`}
                        className="absolute top-1 right-1 w-5 h-5 rounded bg-black/70 text-muted hover:text-danger text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <AddTile
                      accept="image/*"
                      onFiles={(files) => files[0] && void setFrameFromFile(slot, files[0])}
                      onAssetDrop={(d) => void setFrameFromAsset(slot, d)}
                      className="aspect-video min-h-20"
                    />
                  )}
                </div>
              );
            })}
            <p className="sm:col-span-2 text-[11px] font-mono text-muted">
              frames: JPEG/PNG/BMP/WEBP ≤20MB · aspect ratio ≤ 8:1 · adaptive ratio recommended
            </p>
          </div>
        ) : (
          <>
            {items.length === 0 && (
              <DropZone
                accept="image/*,video/mp4,video/quicktime,.mp4,.mov,audio/*,.mp3,.wav,.m4a"
                title="Drag & drop images / videos / audio"
                hint={`…or drag a gallery asset here · images ≤20MB (max ${MAX_IMAGES}) · videos: mp4/mov ≤100MB, ≤15s each (max ${MAX_VIDEOS}, ${MAX_VIDEO_TOTAL_SEC}s combined) · audio: mp3/wav/m4a ≤15MB (first ${MAX_AUDIO_SEC}s used)`}
                onFiles={handleFiles}
                onAssetDrop={handleAssetDrop}
              />
            )}

            {items.length > 0 && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="relative border border-line rounded-md overflow-hidden bg-panel2 group"
                  >
                    <div className="aspect-video bg-black/40 flex items-center justify-center overflow-hidden">
                      {item.kind === "audio" ? (
                        item.previewUrl ? (
                          <audio src={item.previewUrl} controls className="w-full px-1" />
                        ) : (
                          <span className="text-muted text-xs font-mono">voice…</span>
                        )
                      ) : item.previewUrl ? (
                        item.kind === "video" ? (
                          <video
                            src={item.previewUrl}
                            muted
                            playsInline
                            preload="metadata"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.previewUrl}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        )
                      ) : (
                        <span className="text-muted text-xs font-mono">…</span>
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="text-[11px] font-mono truncate" title={item.name}>
                        {item.state === "ready" && item.kind === "image"
                          ? `Image ${imgIdx(item)}`
                          : item.state === "ready" && item.kind === "video"
                            ? `Video ${vidIdx(item)}`
                            : item.kind === "audio"
                              ? "Audio"
                              : item.kind}{" "}
                        · {item.name}
                      </p>
                      <p className="text-[10px] font-mono text-muted">
                        {item.state === "uploading" && "uploading…"}
                        {item.state === "ready" &&
                          `${item.size ? formatBytes(item.size) : "attached"}${
                            item.durationSec ? ` · ${item.durationSec.toFixed(1)}s` : ""
                          }`}
                        {item.state === "error" && (
                          <span className="text-danger">{item.error}</span>
                        )}
                      </p>
                    </div>
                    {item.state === "uploading" && (
                      <span className="absolute top-1.5 left-1.5 w-2 h-2 rounded-full bg-warn animate-pulse-dot" />
                    )}
                    {item.state === "error" && (
                      <span className="absolute top-1.5 left-1.5 w-2 h-2 rounded-full bg-danger" />
                    )}
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      aria-label={`Remove ${item.name}`}
                      className="absolute top-1 right-1 w-5 h-5 rounded bg-black/70 text-muted hover:text-danger text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <AddTile
                  accept="image/*,video/mp4,video/quicktime,.mp4,.mov,audio/*,.mp3,.wav,.m4a"
                  onFiles={handleFiles}
                  onAssetDrop={handleAssetDrop}
                  className="aspect-video min-h-20"
                />
              </div>
            )}
            {videos.length > 0 && (
              <p
                className={`mt-2 text-[11px] font-mono ${
                  totalVideoSec > MAX_VIDEO_TOTAL_SEC ? "text-danger" : "text-muted"
                }`}
              >
                combined reference video duration: {totalVideoSec.toFixed(1)}s / {MAX_VIDEO_TOTAL_SEC}s
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel title="Output settings" step="03">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Model">
            <Seg
              value={model}
              onChange={setModel}
              options={[
                { value: "wan3.0-video", label: "wan3.0-video" },
                { value: "wan3.0-video-prime", label: "prime (fast)" },
                { value: "x-ai/grok-imagine-video-1.5", label: "grok imagine 1.5" },
              ]}
            />
          </Field>
          <Field label="Resolution">
            <Seg
              value={resolution}
              onChange={setResolution}
              options={[
                { value: "480P", label: "480P" },
                { value: "720P", label: "720P" },
                { value: "1080P", label: "1080P" },
              ]}
            />
          </Field>
          <Field label="Aspect ratio">
            <Select
              value={ratio}
              onChange={setRatio}
              options={[
                { value: "adaptive", label: "adaptive (auto)" },
                { value: "16:9", label: "16:9" },
                { value: "4:3", label: "4:3" },
                { value: "1:1", label: "1:1" },
                { value: "3:4", label: "3:4" },
                { value: "9:16", label: "9:16" },
              ]}
            />
          </Field>
          <Field
            label="Duration (seconds)"
            hint={`2–${durationMax} · refs use ${totalVideoSec.toFixed(1)}s of the ${TOTAL_BUDGET_SEC}s combined budget`}
          >
            <Slider
              value={duration}
              onChange={setDuration}
              min={2}
              max={durationMax}
              suffix="s"
            />
          </Field>
          <div className="sm:col-span-2 flex flex-wrap gap-x-6 gap-y-3">
            <Toggle checked={audio} onChange={setAudio} label="Audio" />
          </div>
        </div>
      </Panel>

      <Btn
        onClick={handleSubmit}
        disabled={pending || preparing}
        className="w-full py-3 font-display tracking-[0.2em] uppercase"
      >
        {preparing
          ? "Preparing media…"
          : pending
            ? "Uploading media…"
            : "Generate video"}
      </Btn>
    </div>
  );
}
