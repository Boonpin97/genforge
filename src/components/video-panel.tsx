"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
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
import { activeLook, charAudioUrl, charImgUrl } from "@/lib/types";
import {
  DEFAULT_MODELS,
  durationBounds,
  longestDurationReasons,
  orderedResolution,
  snapDuration,
  type DurationPolicy,
  type PublicVideoModel,
  type VideoPolicy,
} from "@/lib/model-catalog";

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
  characterLookId?: string;
};

export type VideoSubmitPayload = VideoSettings;

const MB = 1024 * 1024;
const FALLBACK_POLICY = (
  DEFAULT_MODELS.find((m) => m.kind === "video") as { policy: VideoPolicy }
).policy;
const SHORT_PROMPT_WARN_CHARS = 200;
const IMAGE_EXT = /\.(jpe?g|png|bmp|webp)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg)$/i;

const PREVIEWABLE = /^(data:|blob:|https?:)/i;

function acceptFor(img: number, vid: number, aud: number): string {
  return [
    img ? "image/*" : "",
    vid ? "video/mp4,video/quicktime,.mp4,.mov" : "",
    aud ? "audio/*,.mp3,.wav,.m4a" : "",
  ]
    .filter(Boolean)
    .join(",");
}

function kindsLabel(img: number, vid: number, aud: number): string {
  const k = [img ? "images" : "", vid ? "video" : "", aud ? "audio" : ""].filter(Boolean);
  return k.length > 1 ? `${k.slice(0, -1).join(", ")} or ${k[k.length - 1]}` : k[0] || "media";
}

function refHint(r: VideoPolicy["refs"]): string {
  const parts: string[] = [];
  if (r.maxImages) parts.push(`${r.maxImages} image${r.maxImages === 1 ? "" : "s"}`);
  if (r.maxVideos)
    parts.push(`${r.maxVideos} video${r.maxVideos === 1 ? "" : "s"} (${r.maxVideoTotalSec}s combined)`);
  if (r.maxAudio) parts.push(`audio (first ${r.maxAudioSec}s used)`);
  return parts.length ? `Up to ${parts.join(", ")}.` : "";
}

let idCounter = 0;
async function fitImage(
  url: string,
  minSide: number,
  maxSide: number,
  maxAspect: number
): Promise<{ url: string; size?: [number, number]; to?: [number, number] }> {
  if (!minSide && !maxSide && !maxAspect) return { url };
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
  if (scale === 1) return { url, size: [w, h] };
  const W = scale > 1 ? Math.ceil(w * scale) : Math.floor(w * scale);
  const H = scale > 1 ? Math.ceil(h * scale) : Math.floor(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { url, size: [w, h] };
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, W, H);
  try {
    return { url: canvas.toDataURL("image/png"), size: [w, h], to: [W, H] };
  } catch {
    return { url, size: [w, h] };
  }
}

const nextId = () => `m${Date.now()}-${idCounter++}`;

export default function VideoPanel({
  onSubmit,
  promptInjection,
  onSavePrompt,
  reuse,
  projectId,
  models,
}: {
  onSubmit: (payload: VideoSubmitPayload) => Promise<boolean>;
  promptInjection?: { text: string; nonce: number } | null;
  onSavePrompt?: (text: string) => Promise<boolean>;
  reuse: { settings: VideoSettings; nonce: number } | null;
  projectId: string | null;
  models: PublicVideoModel[];
}) {
  const [prompt, setPrompt] = useState("");
  const [rewrote, setRewrote] = useState("");
  const [promptTab, setPromptTab] = useState<"prompt" | "rewritten">("prompt");
  const [rewriting, setRewriting] = useState(false);
  const [rewriteJobId, setRewriteJobId] = useState<string | null>(null);
  const [rewriteThinking, setRewriteThinking] = useState(false);
  const [autoRewrite, setAutoRewrite] = useState(false);
  const [autoSendJob, setAutoSendJob] = useState<string | null>(null);
  const [autoSendReady, setAutoSendReady] = useState(false);
  const thinkLoadedRef = useRef(false);
  const [rewriteSig, setRewriteSig] = useState("");
  const [modelChoice, setModel] = useState("wan3.0-video");
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

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      thinkLoadedRef.current = true;
      try {
        if (localStorage.getItem("genforge.rewriteThinking") === "1")
          setRewriteThinking(true);
        if (localStorage.getItem("genforge.autoRewrite") === "1")
          setAutoRewrite(true);
      } catch {}
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    if (!thinkLoadedRef.current) return;
    try {
      localStorage.setItem("genforge.rewriteThinking", rewriteThinking ? "1" : "0");
    } catch {}
  }, [rewriteThinking]);
  useEffect(() => {
    if (!thinkLoadedRef.current) return;
    try {
      localStorage.setItem("genforge.autoRewrite", autoRewrite ? "1" : "0");
    } catch {}
  }, [autoRewrite]);

  const entry = models.find((m) => m.id === modelChoice) ?? models[0] ?? null;
  const model = entry?.id ?? modelChoice;
  const policy = entry?.policy ?? FALLBACK_POLICY;
  const refPolicy = policy.refs;
  const MAX_IMAGES = refPolicy.maxImages;
  const MIN_IMAGES = refPolicy.minImages;
  const MIN_CLIP_SEC = refPolicy.minClipSec;
  const MIN_SIDE = refPolicy.minImageSide;
  const MAX_SIDE = refPolicy.maxImageSide;
  const MAX_ASPECT = refPolicy.maxImageAspect;
  const LONGEST_RULES = policy.longestDurationOnly.join("|");
  const MAX_VIDEOS = refPolicy.maxVideos;
  const MAX_AUDIO = refPolicy.maxAudio;
  const MAX_VIDEO_TOTAL_SEC = refPolicy.maxVideoTotalSec;
  const MAX_AUDIO_SEC = refPolicy.maxAudioSec;
  const MAX_IMAGE_BYTES = refPolicy.maxImageMB * MB;
  const MAX_VIDEO_BYTES = refPolicy.maxVideoMB * MB;
  const MAX_AUDIO_BYTES = refPolicy.maxAudioMB * MB;
  const budgetApplies = refPolicy.videoCountsTowardDuration && MAX_VIDEOS > 0;
  const TOTAL_BUDGET_SEC = refPolicy.totalBudgetSec;
  const hasLastFrame = policy.frames.includes("last_frame");

  const showFrameMode =
    policy.frames.length > 0 &&
    (!policy.framesRequireQwencloud || entry?.resolvedProvider === "qwencloud");
  const frameMode = showFrameMode && genMode === "frame";
  const takesRefs = MAX_IMAGES + MAX_VIDEOS + MAX_AUDIO > 0;
  const smartCapable = policy.smartDuration && !frameMode;
  const smartOn = smartDuration && smartCapable;
  const longestReasons = longestDurationReasons(LONGEST_RULES.split("|").filter(Boolean), {
    resolution,
    refImages: frameMode
      ? 0
      : items.filter((i) => i.kind === "image" && i.state !== "error").length,
    lastFrame: frameMode && hasLastFrame && Boolean(lastFrame),
  });
  const effDurations: DurationPolicy = longestReasons.length
    ? { values: [durationBounds(policy.durations).max] }
    : policy.durations;
  const bounds = durationBounds(effDurations);
  const discrete = "values" in effDurations ? effDurations.values : null;

  useEffect(() => {
    if (!showFrameMode || takesRefs) return;
    const raf = requestAnimationFrame(() => setGenMode("frame"));
    return () => cancelAnimationFrame(raf);
  }, [showFrameMode, takesRefs]);

  const images = items.filter((i) => i.kind === "image");
  const videos = items.filter((i) => i.kind === "video");
  const totalVideoSec = useMemo(
    () => videos.reduce((s, v) => s + (v.durationSec || 0), 0),
    [videos]
  );
  const pending = items.some((i) => i.state === "uploading");
  const broken = items.some((i) => i.state === "error");
  const durationMax = budgetApplies
    ? Math.min(bounds.max, Math.max(bounds.min, TOTAL_BUDGET_SEC - Math.ceil(totalVideoSec)))
    : bounds.max;

  const durationsKey = JSON.stringify(effDurations);
  const resolutionsKey = policy.resolutions.join("|");
  const ratiosKey = policy.ratios.join("|");
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const d: DurationPolicy = JSON.parse(durationsKey);
      setDuration((cur) => snapDuration(d, cur, durationMax));
      const res = resolutionsKey.split("|");
      setResolution((cur) => orderedResolution(res, cur));
      const ratios = ratiosKey.split("|");
      setRatio((cur) =>
        ratios.includes(cur) ? cur : ratios.includes("16:9") ? "16:9" : ratios[0]
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [durationMax, durationsKey, resolutionsKey, ratiosKey]);

  useEffect(() => {
    if (!models.length || models.some((m) => m.id === modelChoice)) return;
    const raf = requestAnimationFrame(() => setModel(models[0].id));
    return () => cancelAnimationFrame(raf);
  }, [models, modelChoice]);

  const chooseModel = (id: string) => {
    setModel(id);
    setAudio(true);
  };

  const audioCount = items.filter((i) => i.kind === "audio" && i.state !== "error").length;
  const modelLabel = entry?.label ?? "This model";
  const limitIssues = useMemo(() => {
    if (frameMode) return [];
    const out: string[] = [];
    const label = modelLabel;
    const imgs = items.filter((i) => i.kind === "image" && i.state !== "error").length;
    const vids = items.filter((i) => i.kind === "video" && i.state !== "error").length;
    if (imgs > MAX_IMAGES)
      out.push(
        MAX_IMAGES
          ? `${label} takes ${MAX_IMAGES} reference images — remove ${imgs - MAX_IMAGES}.`
          : `${label} does not take reference images — remove them or switch model.`
      );
    if (vids > MAX_VIDEOS)
      out.push(
        MAX_VIDEOS
          ? `${label} takes ${MAX_VIDEOS} reference videos — remove ${vids - MAX_VIDEOS}.`
          : `${label} does not take reference video — remove it or switch model.`
      );
    if (audioCount > MAX_AUDIO)
      out.push(
        MAX_AUDIO
          ? `${label} takes ${MAX_AUDIO} audio clip${MAX_AUDIO === 1 ? "" : "s"} — remove ${audioCount - MAX_AUDIO}.`
          : `${label} does not take reference audio — remove it or switch model.`
      );
    if (imgs < MIN_IMAGES)
      out.push(
        `${label} needs at least ${MIN_IMAGES} reference image${MIN_IMAGES === 1 ? "" : "s"} — add one, or @ a character.`
      );
    if (MIN_CLIP_SEC)
      for (const i of items)
        if (
          (i.kind === "video" || i.kind === "audio") &&
          i.state !== "error" &&
          (i.durationSec ?? 0) > 0 &&
          (i.durationSec ?? 0) < MIN_CLIP_SEC
        )
          out.push(
            `${i.name} is ${(i.durationSec ?? 0).toFixed(1)}s — ${label} needs clips of at least ${MIN_CLIP_SEC}s.`
          );
    return out;
  }, [items, frameMode, modelLabel, MAX_IMAGES, MAX_VIDEOS, MAX_AUDIO, audioCount, MIN_IMAGES, MIN_CLIP_SEC]);

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
    const autoSend = !restored && autoSendJob === job.id;
    if (autoSendJob === job.id) setAutoSendJob(null);
    if (job.status === "succeeded") {
      setRewrote((cur) => (restored && cur.trim() ? cur : job.rewrote || ""));
      setPromptTab("rewritten");
      setRewriteSig(job.sig || "");
      if (autoSend) setAutoSendReady(true);
      notify(
        autoSend
          ? "Rewritten request ready — generating with it now"
          : restored
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
    const raf = requestAnimationFrame(() => {
      setAutoSendJob(null);
      setAutoSendReady(false);
    });
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
      cancelAnimationFrame(raf);
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

  function tooLong(text: string): boolean {
    const max = policy.maxPromptChars;
    if (!max || text.length <= max) return false;
    notify(
      `${modelLabel} takes prompts up to ${max} characters — this one is ${text.length} with the character lines added. Shorten it or switch model.`
    );
    return true;
  }

  async function fitForModel(url: string, name: string): Promise<string | null> {
    const fit = await fitImage(url, MIN_SIDE, MAX_SIDE, MAX_ASPECT);
    const label = modelLabel;
    const max = MAX_ASPECT;
    if (fit.size && max) {
      const [w, h] = fit.size;
      if (Math.max(w, h) / Math.min(w, h) > max) {
        notify(
          `${name} is ${w}×${h} — ${label} only takes images between 1:${max} and ${max}:1. Crop it and add it again.`
        );
        return null;
      }
    }
    if (fit.to && fit.size)
      notify(
        fit.to[0] > fit.size[0]
          ? `${name} was ${fit.size[0]}×${fit.size[1]} — upscaled to ${fit.to[0]}×${fit.to[1]} because ${label} needs at least ${MIN_SIDE}px per side`
          : `${name} was ${fit.size[0]}×${fit.size[1]} — downscaled to ${fit.to[0]}×${fit.to[1]} because ${label} takes at most ${MAX_SIDE}px per side`
      );
    return fit.url;
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
        characterLookId: activeLook(c).id,
      });
    }
    let audioItem: MediaItem | null = null;
    if (c.hasAudio && audioIdx <= MAX_AUDIO) {
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
    const key = `${c.id}@${c.updatedAt ?? c.createdAt}@${MAX_AUDIO > 0 ? "a" : ""}`;
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
    if (c.hasAudio && MAX_AUDIO > 0) {
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

  async function refreshLooks(list: MediaItem[]): Promise<MediaItem[]> {
    if (!list.some((i) => i.characterLookId)) return list;
    let chars: Character[] = [];
    try {
      const res = await fetch(
        `/api/characters?project=${projectId === null ? "none" : projectId}`
      );
      const d = await res.json();
      chars = Array.isArray(d.characters) ? d.characters : [];
    } catch {
      return list;
    }
    const stale = chars.filter((c) =>
      list.some(
        (i) =>
          i.characterId === c.id &&
          i.characterLookId &&
          i.characterLookId !== activeLook(c).id
      )
    );
    if (!stale.length) return list;
    let next = list.filter(
      (i) => !stale.some((c) => c.id === i.characterId)
    );
    setItems(next);
    for (const c of stale) {
      next = await injectCharacter(c, next);
      notify(`${c.name} switched to the "${activeLook(c).name}" look`);
    }
    return next;
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
        !c.hidden &&
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
        if (audCount >= MAX_AUDIO) {
          errs.push(
            MAX_AUDIO
              ? `${file.name}: ${entry?.label ?? "this model"} takes ${MAX_AUDIO} audio clip${MAX_AUDIO === 1 ? "" : "s"}`
              : `${file.name}: ${entry?.label ?? "this model"} does not take reference audio`
          );
          continue;
        }
        if (file.size > MAX_AUDIO_BYTES) {
          errs.push(`${file.name}: audio exceeds ${refPolicy.maxAudioMB}MB limit`);
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
          errs.push(
            MAX_VIDEOS
              ? `${file.name}: max ${MAX_VIDEOS} reference videos`
              : `${file.name}: ${entry?.label ?? "this model"} does not take reference video`
          );
          continue;
        }
        if (file.size > MAX_VIDEO_BYTES) {
          errs.push(`${file.name}: video exceeds ${refPolicy.maxVideoMB}MB limit`);
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
          errs.push(
            MAX_IMAGES
              ? `${file.name}: max ${MAX_IMAGES} reference images`
              : `${file.name}: ${entry?.label ?? "this model"} does not take reference images`
          );
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          errs.push(`${file.name}: image exceeds ${refPolicy.maxImageMB}MB limit`);
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
      notify(`${file.name}: frame image exceeds ${refPolicy.maxImageMB}MB limit`);
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

  async function handleRewrite(thenGenerate = false) {
    setNotices([]);
    const text = prompt.trim();
    if (!text) {
      notify("Write a prompt first");
      return;
    }
    if (rewriting) {
      notify("A rewrite is already running — wait for it to finish");
      return;
    }
    if (pending) {
      notify("Wait for uploads to finish");
      return;
    }
    setRewriting(true);
    try {
      let list = await refreshLooks(itemsRef.current);
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
          thinking: rewriteThinking,
          projectId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.job?.id)
        throw new Error(data?.message || `Rewrite failed (HTTP ${res.status})`);
      setRewriteJobId(String(data.job.id));
      if (thenGenerate) setAutoSendJob(String(data.job.id));
      notify(
        thenGenerate
          ? "Rewriting — the video is generated as soon as the rewrite is ready"
          : "Rewriting — this keeps running on the server, so a reload or project switch will not lose it"
      );
    } catch (e) {
      setRewriting(false);
      notify(`Rewrite failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleSubmit(confirmed = false) {
    if (autoRewrite && promptTab === "prompt") {
      await handleRewrite(true);
      return;
    }
    setNotices([]);
    const useRewritten = promptTab === "rewritten";
    const sourceText = (useRewritten ? rewrote : prompt).trim();
    if (!confirmed && sourceText.length < SHORT_PROMPT_WARN_CHARS) {
      setWarnedText(sourceText);
      return;
    }
    setWarnedText(null);
    if (!entry) {
      notify("No video model is ready — enable one on the Models page");
      return;
    }
    const effectiveModel = model;
    const sendAudio = policy.audio && audio;
    if (frameMode) {
      const ff = firstFrame?.state === "ready" && firstFrame.url ? firstFrame : null;
      const lf =
        hasLastFrame && lastFrame?.state === "ready" && lastFrame.url ? lastFrame : null;
      if (firstFrame?.state === "uploading" || lastFrame?.state === "uploading") {
        notify("Wait for the frame images to finish loading");
        return;
      }
      if (!ff) {
        notify("Add a first-frame image");
        return;
      }
      setPreparing(true);
      try {
        if (tooLong(sourceText)) return;
        const ffUrl = await fitForModel(ff.url!, "The first frame");
        const lfUrl = lf ? await fitForModel(lf.url!, "The last frame") : null;
        if (!ffUrl || (lf && !lfUrl)) return;
        const media: MediaPayload[] = [
          {
            type: "first_frame",
            url: ffUrl,
            name: ff.name,
            previewUrl: ff.previewUrl,
          },
        ];
        if (lf)
          media.push({
            type: "last_frame",
            url: lfUrl!,
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
          audio: sendAudio,
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
    if (limitIssues.length) {
      limitIssues.forEach(notify);
      return;
    }
    if (budgetApplies && smartOn && totalVideoSec > TOTAL_BUDGET_SEC - bounds.min) {
      notify(
        `Reference video already uses ${totalVideoSec.toFixed(1)}s of the ${TOTAL_BUDGET_SEC}s budget — no room left for the model to choose a length`
      );
      return;
    }
    if (budgetApplies && !smartOn && totalVideoSec + duration > TOTAL_BUDGET_SEC) {
      notify(
        `Reference video (${totalVideoSec.toFixed(1)}s) + duration (${duration}s) exceeds the ${TOTAL_BUDGET_SEC}s combined limit`
      );
      return;
    }
    setPreparing(true);
    try {
      const working = [...(await refreshLooks(itemsRef.current))];
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
      const mentioned = chars.filter(
        (c) =>
          !c.hidden &&
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
        if (MAX_IMAGES === 0) {
          notify(
            `${entry.label} takes no reference images — ${c.name} is described in the prompt only`
          );
          newlyAttached.push(c);
          continue;
        }
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
            characterLookId: activeLook(c).id,
          });
        if (refs.audio && audUsed < MAX_AUDIO)
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
      if (tooLong(finalPrompt)) return;
      const ready = working.filter((i) => i.state === "ready" && i.url);
      const fitted = new Map<string, string>();
      for (const i of ready)
        if (i.kind === "image") {
          const url = await fitForModel(i.url!, i.name);
          if (!url) return;
          fitted.set(i.id, url);
        }
      const media: MediaPayload[] = ready.map((i) => ({
        type:
          i.kind === "image"
            ? "reference_image"
            : i.kind === "video"
              ? "reference_video"
              : "reference_audio",
        url: fitted.get(i.id) ?? i.url!,
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
        audio: sendAudio,
        watermark,
        media,
      });
    } finally {
      setPreparing(false);
    }
  }

  const submitRef = useRef(handleSubmit);
  useEffect(() => {
    submitRef.current = handleSubmit;
  });
  useEffect(() => {
    if (!autoSendReady || promptTab !== "rewritten") return;
    const raf = requestAnimationFrame(() => {
      setAutoSendReady(false);
      void submitRef.current();
    });
    return () => cancelAnimationFrame(raf);
  }, [autoSendReady, promptTab, rewrote]);

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
          <span
            title="Thinking mode: the rewrite model reasons before it answers — occasionally better on tangled prompts, but takes 40–160s instead of 5–15s and costs more. Off is fine for normal rewrites."
            className="shrink-0"
          >
            <Toggle
              checked={rewriteThinking}
              onChange={setRewriteThinking}
              label="Think"
            />
          </span>
          <span
            title="Auto rewrite: Generate on the Prompt tab rewrites the prompt first and generates with the rewritten text as soon as it is ready. On the Rewritten tab, Generate sends that text as it is."
            className="shrink-0"
          >
            <Toggle
              checked={autoRewrite}
              onChange={setAutoRewrite}
              label="Auto"
            />
          </span>
          <Btn
            variant="ghost"
            onClick={() => void handleRewrite()}
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
                  { value: "text", label: takesRefs ? "Text / reference" : "Text only" },
                  {
                    value: "frame",
                    label: hasLastFrame ? "First + last frame" : "Start from an image",
                  },
                ]}
              />
            </Field>
            <p className="mt-1.5 text-xs text-muted">
              {genMode === "frame"
                ? hasLastFrame
                  ? "Give a first frame, and optionally a last frame — the model animates between them."
                  : "Give a first frame — the model animates from it."
                : takesRefs
                  ? "A prompt, plus any reference images, video, audio or saved characters."
                  : "A prompt only — this model takes no reference media."}
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
            {(hasLastFrame ? (["first", "last"] as const) : (["first"] as const)).map((slot) => {
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
              Frames can be JPEG, PNG, BMP or WEBP up to {refPolicy.maxImageMB}MB.
            </p>
          </div>
        ) : (
          <>
            {limitIssues.length > 0 && (
              <div className="mb-3 space-y-1">
                {limitIssues.map((n) => (
                  <p key={n} className="text-xs text-danger">
                    {n}
                  </p>
                ))}
              </div>
            )}
            {items.length === 0 && !takesRefs && (
              <p className="text-sm text-muted">
                {entry?.label ?? "This model"} takes no reference media.
                {showFrameMode ? " Switch to image mode above to start from a picture." : ""}{" "}
                Characters you mention are described in the prompt.
              </p>
            )}
            {items.length === 0 && takesRefs && (
              <DropZone
                accept={acceptFor(MAX_IMAGES, MAX_VIDEOS, MAX_AUDIO)}
                title={`Drop ${kindsLabel(MAX_IMAGES, MAX_VIDEOS, MAX_AUDIO)}`}
                hint={`Or click to browse, or drag one in from the gallery. ${refHint(refPolicy)}`}
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
                  accept={acceptFor(MAX_IMAGES, MAX_VIDEOS, MAX_AUDIO)}
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
          <Field label="Model" hint={entry ? undefined : "none enabled"}>
            {models.length > 0 && models.length <= 3 ? (
              <Seg
                value={model}
                onChange={chooseModel}
                options={models.map((m) => ({ value: m.id, label: m.label }))}
              />
            ) : models.length > 3 ? (
              <Select
                value={model}
                onChange={chooseModel}
                options={models.map((m) => ({ value: m.id, label: m.label }))}
              />
            ) : (
              <Link
                href="/models"
                className="flex items-center h-9 px-3 rounded-md border border-line bg-panel2 text-sm text-accent hover:bg-panel2/70"
              >
                Enable a video model on the Models page
              </Link>
            )}
          </Field>
          <Field label="Resolution">
            {policy.resolutions.length > 1 ? (
              <Seg
                value={resolution}
                onChange={setResolution}
                options={policy.resolutions.map((r) => ({ value: r, label: r }))}
              />
            ) : (
              <p className="h-9 flex items-center text-sm text-ink">
                {policy.resolutions[0]}
              </p>
            )}
          </Field>
          <Field label="Aspect ratio">
            <Select
              value={ratio}
              onChange={setRatio}
              options={policy.ratios.map((r) => ({
                value: r,
                label: r === "adaptive" ? "adaptive (auto)" : r,
              }))}
            />
          </Field>
          <Field
            label="Duration"
            hint={
              smartOn
                ? `model picks, up to ${durationMax}s`
                : longestReasons.length
                  ? `${discrete?.[0]}s only with ${longestReasons.join(" and ")}`
                  : discrete
                    ? `${discrete.join(", ")}s`
                    : `${bounds.min}–${durationMax}s`
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
              ) : discrete ? (
                <Seg
                  value={String(duration)}
                  onChange={(v) => setDuration(Number(v))}
                  options={discrete
                    .filter((v) => v <= durationMax)
                    .map((v) => ({ value: String(v), label: `${v}s` }))}
                />
              ) : (
                <Slider
                  value={duration}
                  onChange={setDuration}
                  min={bounds.min}
                  max={durationMax}
                  suffix="s"
                />
              )}
              {budgetApplies && totalVideoSec > 0 && (
                <p className="text-2xs text-muted">
                  Reference video uses {totalVideoSec.toFixed(1)}s of the{" "}
                  {TOTAL_BUDGET_SEC}s combined budget.
                </p>
              )}
            </div>
          </Field>
          {policy.audio && (
            <div className="sm:col-span-2 flex flex-wrap gap-x-6 gap-y-3">
              <Toggle checked={audio} onChange={setAudio} label="Audio" />
            </div>
          )}
          {entry?.notes && (
            <p className="sm:col-span-2 text-2xs text-muted leading-snug">
              {entry.notes}
            </p>
          )}
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
        disabled={
          pending ||
          preparing ||
          autoSendJob !== null ||
          (autoRewrite && promptTab === "prompt" && rewriting)
        }
        size="lg"
        className="w-full"
      >
        {preparing
          ? "Preparing media…"
          : pending
            ? "Uploading media…"
            : autoSendJob !== null
              ? "Rewriting, then generating…"
              : autoRewrite && promptTab === "prompt"
                ? smartOn
                  ? "Rewrite and generate · smart length"
                  : `Rewrite and generate · ${duration}s`
                : smartOn
              ? "Generate video · smart length"
              : `Generate video · ${duration}s`}
      </Btn>
    </div>
  );
}
