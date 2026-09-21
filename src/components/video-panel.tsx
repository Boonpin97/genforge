"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DropZone, {
  AddTile,
  blobToDataUrl,
  fileToDataUrl,
  formatBytes,
  getVideoDuration,
  trimAudioBlob,
  type AssetDropData,
} from "./drop-zone";
import { alertDone } from "@/lib/notify";
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
  RewriteJob,
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
const SHORT_PROMPT_WARN_CHARS = 200;
const IMAGE_EXT = /\.(jpe?g|png|bmp|webp)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg)$/i;

const PREVIEWABLE = /^(data:|blob:|https?:)/i;

let idCounter = 0;
const nextId = () => `m${Date.now()}-${idCounter++}`;

export default function VideoPanel({
  onSubmit,
  promptInjection,
  onSavePrompt,
  reuse,
  projectId,
  videoProvider = "dashscope",
}: {
  onSubmit: (payload: VideoSubmitPayload) => Promise<boolean>;
  promptInjection?: { text: string; nonce: number } | null;
  onSavePrompt?: (text: string) => Promise<boolean>;
  reuse: { settings: VideoSettings; nonce: number } | null;
  projectId: string | null;
  videoProvider?: "dashscope" | "qwencloud";
}) {
  const [prompt, setPrompt] = useState("");
  const [rewrote, setRewrote] = useState("");
  const [promptTab, setPromptTab] = useState<"prompt" | "rewritten">("prompt");
  const [rewriting, setRewriting] = useState(false);
  const [rewriteJobId, setRewriteJobId] = useState<string | null>(null);
  const [rewriteSig, setRewriteSig] = useState("");
  const [model, setModel] = useState("wan3.0-video");
  const [resolution, setResolution] = useState("480P");
  const [ratio, setRatio] = useState("16:9");
  const [duration, setDuration] = useState(30);
  const [smartDuration, setSmartDuration] = useState(false);
  const [audio, setAudio] = useState(true);
  const [watermark, setWatermark] = useState(false);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [genMode, setGenMode] = useState<"text" | "frame">("text");
  const [firstFrame, setFirstFrame] = useState<MediaItem | null>(null);
  const [lastFrame, setLastFrame] = useState<MediaItem | null>(null);
  const [warnedText, setWarnedText] = useState<string | null>(null);

  const showFrameMode = videoProvider === "qwencloud";
  const frameMode = showFrameMode && genMode === "frame";
  const smartCapable = !model.includes("/") && !frameMode;
  const smartOn = smartDuration && smartCapable;

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

  const ackRewriteJob = (id: string) => {
    void fetch(`/api/rewrite-prompt/${id}/ack`, { method: "POST" }).catch(
      () => {}
    );
  };

  const settleRewriteJob = (job: RewriteJob, restored: boolean) => {
    if (job.status === "succeeded") {
      setRewrote((cur) => (restored && cur.trim() ? cur : job.rewrote || ""));
      setPromptTab("rewritten");
      setRewriteSig(job.sig || "");
      notify(
        restored
          ? "Picked up the rewrite that finished while you were away — review it, then generate"
          : "Rewritten request ready — review it, then generate"
      );
      alertDone({
        channel: "rewrite",
        ok: true,
        title: "Rewritten prompt ready",
        body: (job.rewrote || job.prompt).slice(0, 140),
        tag: `rewrite-${job.id}`,
      });
    } else if (job.status === "failed") {
      notify(`Rewrite failed: ${job.error || "unknown error"}`);
      alertDone({
        channel: "rewrite",
        ok: false,
        title: "Rewrite failed",
        body: job.error || "The rewrite did not finish",
        tag: `rewrite-${job.id}`,
      });
    }
    setRewriting(false);
    setRewriteJobId(null);
    ackRewriteJob(job.id);
  };

  const settleRef = useRef(settleRewriteJob);
  useEffect(() => {
    settleRef.current = settleRewriteJob;
  });

  useEffect(() => {
    if (!rewriteJobId) return;
    let alive = true;
    let timer = 0;
    const poll = async () => {
      try {
        const res = await fetch(`/api/rewrite-prompt/${rewriteJobId}`);
        if (!alive) return;
        if (res.ok) {
          const job = (await res.json()).job as RewriteJob | null;
          if (!alive) return;
          if (job && job.status !== "running") {
            settleRef.current(job, false);
            return;
          }
        }
      } catch {}
      if (alive) timer = window.setTimeout(poll, 2000);
    };
    timer = window.setTimeout(poll, 1500);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [rewriteJobId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/rewrite-prompt?project=${projectId === null ? "none" : projectId}`
        );
        if (!res.ok) return;
        const job = (await res.json()).job as RewriteJob | null;
        if (cancelled || !job) return;
        setPrompt((cur) => (cur.trim() ? cur : job.prompt));
        if (job.status === "running") {
          setRewriting(true);
          setRewriteJobId(job.id);
          setPromptTab("rewritten");
          notify("A rewrite from before was still running — waiting for it");
        } else {
          settleRef.current(job, true);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

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
    setRewrote(s.rewrotePrompt || "");
    setPromptTab(s.promptTab === "rewritten" ? "rewritten" : "prompt");
    setRewriteSig("");
    setModel(s.model);
    setResolution(s.resolution);
    setRatio(s.ratio);
    setSmartDuration(s.duration === -1);
    setDuration((d) => (s.duration === -1 ? d : s.duration));
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

  async function injectCharacter(
    c: Character,
    base?: MediaItem[]
  ): Promise<MediaItem[]> {
    const start = base ?? itemsRef.current;
    if (start.some((i) => i.characterId === c.id)) return start;
    const working = [...start];
    const r = await attachRefs(working, c);
    if (!r.ok) {
      notify(r.msg || `Could not attach ${c.name}`);
      return working;
    }
    r.warnings.forEach(notify);
    notify(
      `Character "${c.name}" references attached — description is added when you generate`
    );
    return working;
  }

  async function findDeferredCharacters(text: string): Promise<Character[]> {
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
    return chars.filter(
      (c) =>
        new RegExp(`(?<![\\w])${escapeRe(c.name)}(?![\\w-])`).test(text) &&
        !itemsRef.current.some((i) => i.characterId === c.id)
    );
  }

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
            if (vidSec > MAX_VIDEO_TOTAL_SEC)
              notify(
                `Combined reference video duration would exceed ${MAX_VIDEO_TOTAL_SEC}s`
              );
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

  async function buildInventory(list?: MediaItem[]): Promise<string[]> {
    if (frameMode) return [];
    const ready = (list ?? itemsRef.current).filter(
      (i) => i.state === "ready" && i.url
    );
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
      let list = itemsRef.current;
      for (const c of await findDeferredCharacters(text))
        list = await injectCharacter(c, list);
      const inventory = await buildInventory(list);
      const res = await fetch("/api/rewrite-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          inventory,
          sig: readySig(list),
          projectId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.job?.id)
        throw new Error(data?.message || `Rewrite failed (HTTP ${res.status})`);
      setRewriteJobId(String(data.job.id));
      notify(
        "Rewriting — this keeps running on the server, so a reload or project switch will not lose it"
      );
    } catch (e) {
      setRewriting(false);
      notify(`Rewrite failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleSubmit(confirmed = false) {
    setNotices([]);
    const useRewritten = promptTab === "rewritten";
    const sourceText = (useRewritten ? rewrote : prompt).trim();
    if (!confirmed && sourceText.length < SHORT_PROMPT_WARN_CHARS) {
      setWarnedText(sourceText);
      return;
    }
    setWarnedText(null);
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
    if (smartOn) {
      if (totalVideoSec > TOTAL_BUDGET_SEC - 2) {
        notify(
          `Reference video already uses ${totalVideoSec.toFixed(1)}s of the ${TOTAL_BUDGET_SEC}s budget — no room left for the model to choose a length`
        );
        return;
      }
    } else if (totalVideoSec + duration > TOTAL_BUDGET_SEC) {
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
      const searchText = useRewritten ? `${prompt}\n${rewrote}` : prompt;
      const newlyAttached: Character[] = [];
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
      const mentioned = chars.filter((c) =>
        new RegExp(`(?<![\\w])${escapeRe(c.name)}(?![\\w-])`).test(searchText)
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
        newlyAttached.push(c);
      }
      if (useRewritten) {
        const extra = newlyAttached
          .filter((c) => !searchText.includes(`${c.name}:`))
          .map((c) => bindingLineFrom(working, c));
        if (extra.length)
          finalPrompt = `${sourceText}\n\n${extra.join("")}`.trim();
      } else {
        const lines: string[] = [];
        for (const c of targets) {
          if (searchText.includes(`${c.name}:`)) continue;
          lines.push(bindingLineFrom(working, c));
        }
        finalPrompt = lines.length ? lines.join("") + sourceText : sourceText;
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
        duration: smartOn ? -1 : duration,
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

  const activeText = (promptTab === "rewritten" ? rewrote : prompt).trim();
  const shortPromptWarn = warnedText !== null && warnedText === activeText;

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!shortPromptWarn) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWarnedText(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortPromptWarn]);

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
            <div className="mt-2 flex items-center justify-between gap-4 text-2xs text-muted">
              <span>
                Type <span className="text-ink font-medium">@</span> to mention
                dropped media or a saved character
              </span>
              <span className="flex items-center gap-3 shrink-0">
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
                <span className="font-mono tabular-nums">
                  {prompt.length}/20000
                </span>
              </span>
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
            <div className="mt-1.5 flex justify-between text-2xs font-mono text-muted">
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
                <p className="mt-1.5 text-xs text-warn">
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
                  { value: "text", label: "Text / reference" },
                  { value: "frame", label: "First + last frame" },
                ]}
              />
            </Field>
            <p className="mt-1.5 text-xs text-muted">
              {genMode === "frame"
                ? "Give a first frame, and optionally a last frame — the model animates between them."
                : "A prompt, plus any reference images, video, audio or saved characters."}
            </p>
          </div>
        )}

        {notices.length > 0 && (
          <div className="mb-3 space-y-1">
            {notices.map((n, i) => (
              <p key={i} className="text-xs text-warn">
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
                  <p className="mb-1.5 text-2xs text-muted">
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
                        <p className="text-2xs truncate" title={item.name}>
                          {item.name}
                        </p>
                        <p className="text-2xs font-mono text-muted">
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
                        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-md bg-black/65 backdrop-blur-sm text-white/75 hover:text-danger hover:bg-black/80 text-xs leading-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
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
            <p className="sm:col-span-2 text-xs text-muted">
              frames: JPEG/PNG/BMP/WEBP ≤20MB · aspect ratio ≤ 8:1 · adaptive ratio recommended
            </p>
          </div>
        ) : (
          <>
            {items.length === 0 && (
              <DropZone
                accept="image/*,video/mp4,video/quicktime,.mp4,.mov,audio/*,.mp3,.wav,.m4a"
                title="Drop images, video or audio"
                hint={`Or click to browse, or drag one in from the gallery. Up to ${MAX_IMAGES} images, ${MAX_VIDEOS} videos (${MAX_VIDEO_TOTAL_SEC}s combined) and audio (first ${MAX_AUDIO_SEC}s used).`}
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
                      <p className="text-2xs truncate" title={item.name}>
                        {item.state === "ready" && item.kind === "image"
                          ? `Image ${imgIdx(item)}`
                          : item.state === "ready" && item.kind === "video"
                            ? `Video ${vidIdx(item)}`
                            : item.kind === "audio"
                              ? "Audio"
                              : item.kind}{" "}
                        · {item.name}
                      </p>
                      <p className="text-2xs font-mono text-muted">
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
                      className="absolute top-1.5 right-1.5 w-7 h-7 rounded-md bg-black/65 backdrop-blur-sm text-white/75 hover:text-danger hover:bg-black/80 text-xs leading-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
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
                className={`mt-2 text-2xs font-mono ${
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
                { value: "wan3.0-video", label: "Wan 3.0" },
                { value: "wan3.0-video-prime", label: "Prime" },
                { value: "x-ai/grok-imagine-video-1.5", label: "Grok 1.5" },
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
            label="Duration"
            hint={
              smartOn
                ? `model picks, up to ${durationMax}s`
                : `2–${durationMax}s`
            }
          >
            <div className="flex flex-col gap-2">
              {smartCapable && (
                <Seg
                  value={smartOn ? "smart" : "fixed"}
                  onChange={(v) => setSmartDuration(v === "smart")}
                  options={[
                    { value: "fixed", label: "Fixed length" },
                    { value: "smart", label: "✦ Smart" },
                  ]}
                />
              )}
              {smartOn ? (
                <p className="text-xs text-warn leading-snug">
                  The model chooses the length, up to {durationMax}s. You are
                  billed for what it produces, so the cost is not known until the
                  video lands.
                </p>
              ) : (
                <Slider
                  value={duration}
                  onChange={setDuration}
                  min={2}
                  max={durationMax}
                  suffix="s"
                />
              )}
              {totalVideoSec > 0 && (
                <p className="text-2xs text-muted">
                  Reference video uses {totalVideoSec.toFixed(1)}s of the{" "}
                  {TOTAL_BUDGET_SEC}s combined budget.
                </p>
              )}
            </div>
          </Field>
          <div className="sm:col-span-2 flex flex-wrap gap-x-6 gap-y-3">
            <Toggle checked={audio} onChange={setAudio} label="Audio" />
          </div>
        </div>
      </Panel>

      {shortPromptWarn &&
        mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="short-prompt-title"
            onClick={() => setWarnedText(null)}
          >
            <div
              ref={dialogRef}
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg border border-warn/50 bg-panel rounded-lg shadow-2xl shadow-black/70 outline-none animate-rise"
            >
              <div className="flex items-center gap-3 px-5 py-3.5 border-b border-warn/30">
                <span className="text-2xl leading-none text-warn" aria-hidden>
                  ⚠
                </span>
                <h2
                  id="short-prompt-title"
                  className="font-semibold text-base  text-warn"
                >
                  Prompt looks too short
                </h2>
              </div>
              <div className="px-5 py-4 space-y-3">
                <p className="text-sm text-ink/90">
                  You are about to generate a{" "}
                  <span className="text-accent font-semibold">video</span> from{" "}
                  <span className="font-mono text-warn">
                    {activeText.length}
                  </span>{" "}
                  characters — under the {SHORT_PROMPT_WARN_CHARS} recommended.
                </p>
                <p className="text-sm text-muted">
                  Short prompts give weak results and still cost credits. Check
                  you are in the right tool: this generates a{" "}
                  <span className="text-ink">video</span>, not an image.
                </p>
                {activeText && (
                  <p className="rounded-md border border-line bg-panel2 px-3 py-2.5 text-xs text-ink/80 break-words line-clamp-3">
                    {activeText}
                  </p>
                )}
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-2 px-5 py-3.5 border-t border-line">
                <Btn
                  variant="ghost"
                  onClick={() => setWarnedText(null)}
                  className="flex-1"
                >
                  ← Back to editing
                </Btn>
                <Btn
                  onClick={() => void handleSubmit(true)}
                  disabled={pending || preparing}
                  className="flex-1"
                >
                  Generate anyway
                </Btn>
              </div>
            </div>
          </div>,
          document.body
        )}

      <Btn
        onClick={() => void handleSubmit()}
        disabled={pending || preparing}
        size="lg"
        className="w-full"
      >
        {preparing
          ? "Preparing media…"
          : pending
            ? "Uploading media…"
            : smartOn
              ? "Generate video · smart length"
              : `Generate video · ${duration}s`}
      </Btn>
    </div>
  );
}
