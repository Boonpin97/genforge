"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  OSS_TTL_MS,
  draftKey,
  loadBlob,
  ossUploadedAt,
  readDraft,
  stashMedia,
  writeDraft,
} from "@/lib/draft";
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
  TextInput,
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
  characterStamp?: string;
  characterIndex?: number;
};

export type VideoSubmitPayload = VideoSettings;

const MB = 1024 * 1024;
const MAX_SEED = 2147483647;
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

const VOICE_TTL_MS = 47 * 3600 * 1000;

const charStamp = (c: Character) => `${activeLook(c).id}:${c.updatedAt ?? c.createdAt}`;

function nameIndex(text: string, name: string): number {
  const n = name.trim();
  if (!n) return -1;
  const m = new RegExp(`(?<![\w])${escapeRe(n)}(?![\w-])`).exec(text);
  return m ? m.index : -1;
}

type Exclusion = { stamp: string; images: number[]; voice: boolean };

type SyncEnv = {
  chars: Character[];
  charsFor: string | null | undefined;
  projectId: string | null;
  searchText: string;
  pinned: string[];
  suppressed: string[];
  excluded: Record<string, Exclusion>;
  frameMode: boolean;
  maxImages: number;
  maxAudio: number;
  label: string;
};

type DraftItem = Omit<MediaItem, "url" | "previewUrl" | "state" | "error"> & {
  url?: string;
  preview?: string;
  blob?: boolean;
  at?: number;
};

type VideoDraft = {
  prompt: string;
  rewrote: string;
  promptTab: "prompt" | "rewritten";
  rewriting: boolean;
  model: string;
  resolution: string;
  ratio: string;
  duration: number;
  smartDuration: boolean;
  audio: boolean;
  watermark: boolean;
  seed?: string;
  retry?: boolean;
  retryMax?: string;
  genMode: "text" | "frame";
  pinnedChars?: string[];
  suppressedChars?: string[];
  excludedChars?: Record<string, Exclusion>;
  items: DraftItem[];
  firstFrame: DraftItem | null;
  lastFrame: DraftItem | null;
};

async function toDraftItem(it: MediaItem | null): Promise<DraftItem | null> {
  if (!it || it.state !== "ready" || !it.url) return null;
  const { url, previewUrl } = it;
  const meta: DraftItem = {
    id: it.id,
    kind: it.kind,
    name: it.name,
    size: it.size,
    durationSec: it.durationSec,
    characterId: it.characterId,
    characterLookId: it.characterLookId,
    characterStamp: it.characterStamp,
    characterIndex: it.characterIndex,
  };
  if (url.startsWith("data:"))
    return (await stashMedia(it.id, url)) ? { ...meta, blob: true } : null;
  if (url.startsWith("oss://")) {
    const at = ossUploadedAt(it.id);
    const blob = previewUrl.startsWith("blob:") && (await stashMedia(it.id, previewUrl));
    return { ...meta, url, at, blob: blob || undefined };
  }
  return {
    ...meta,
    url,
    preview: /^(blob:|data:)/i.test(previewUrl) ? undefined : previewUrl,
  };
}

async function fromDraftItem(
  d: DraftItem,
  maxAudioSec: number
): Promise<MediaItem | null> {
  const { url, preview, blob: hasBlob, at, ...meta } = d;
  if (!url) {
    const blob = await loadBlob(d.id);
    if (!blob) return null;
    const dataUrl = await blobToDataUrl(blob);
    return { ...meta, url: dataUrl, previewUrl: dataUrl, state: "ready" };
  }
  if (!url.startsWith("oss://"))
    return { ...meta, url, previewUrl: preview || "", state: "ready" };
  const blob = hasBlob ? await loadBlob(d.id) : null;
  let ossUrl = url;
  let uploadedAt = at || 0;
  if (Date.now() - uploadedAt > OSS_TTL_MS) {
    if (!blob) return null;
    try {
      const body =
        d.kind === "audio" ? (await trimAudioBlob(blob, maxAudioSec)).blob : blob;
      const form = new FormData();
      form.append("file", new File([body], d.name, { type: body.type || blob.type }));
      form.append("model", "wan3.0-video");
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || typeof data?.url !== "string") return null;
      ossUrl = data.url;
      uploadedAt = Date.now();
    } catch {
      return null;
    }
  }
  ossUploadedAt(d.id, uploadedAt);
  return {
    ...meta,
    url: ossUrl,
    previewUrl: blob ? URL.createObjectURL(blob) : "",
    state: "ready",
  };
}

export default function VideoPanel({
  onSubmit,
  promptInjection,
  onSavePrompt,
  reuse,
  projectId,
  models,
  active = true,
}: {
  onSubmit: (payload: VideoSubmitPayload) => Promise<boolean>;
  promptInjection?: { text: string; nonce: number } | null;
  onSavePrompt?: (text: string) => Promise<boolean>;
  reuse: { settings: VideoSettings; nonce: number; characterIds?: string[] } | null;
  active?: boolean;
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
  const [seed, setSeed] = useState("");
  const [retryOn, setRetryOn] = useState(false);
  const [retryMax, setRetryMax] = useState("");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [genMode, setGenMode] = useState<"text" | "frame">("text");
  const [firstFrame, setFirstFrame] = useState<MediaItem | null>(null);
  const [lastFrame, setLastFrame] = useState<MediaItem | null>(null);
  const [warnedText, setWarnedText] = useState<string | null>(null);
  const [chars, setChars] = useState<Character[]>([]);
  const [pinnedChars, setPinnedChars] = useState<string[]>([]);
  const [suppressedChars, setSuppressedChars] = useState<string[]>([]);
  const [excludedChars, setExcludedChars] = useState<Record<string, Exclusion>>({});
  const [charNotes, setCharNotes] = useState<string[]>([]);

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

  const searchText = promptTab === "rewritten" ? `${prompt}\n${rewrote}` : prompt;
  const syncEnv = useRef<SyncEnv>({
    chars: [],
    charsFor: undefined,
    projectId,
    searchText: "",
    pinned: [],
    suppressed: [],
    excluded: {},
    frameMode: false,
    maxImages: 0,
    maxAudio: 0,
    label: "",
  });
  useEffect(() => {
    syncEnv.current = {
      ...syncEnv.current,
      projectId,
      searchText,
      pinned: pinnedChars,
      suppressed: suppressedChars,
      excluded: excludedChars,
      frameMode,
      maxImages: MAX_IMAGES,
      maxAudio: MAX_AUDIO,
      label: modelLabel,
    };
  });

  const charsSig = useRef("");
  const loadCharacters = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/characters?project=${projectId === null ? "none" : projectId}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const d = await res.json();
      const list: Character[] = Array.isArray(d.characters) ? d.characters : [];
      const sig = `${projectId}|${list
        .map(
          (c) =>
            `${c.id}:${c.name}:${c.hidden ? 1 : 0}:${charStamp(c)}:${c.imageCount}:${c.hasAudio ? 1 : 0}`
        )
        .join("|")}`;
      if (sig === charsSig.current && syncEnv.current.charsFor === projectId) return;
      charsSig.current = sig;
      syncEnv.current = { ...syncEnv.current, chars: list, charsFor: projectId };
      setChars(list);
    } catch {}
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (alive && document.visibilityState === "visible") void loadCharacters();
    };
    const first = window.setTimeout(() => {
      if (alive) void loadCharacters();
    }, 0);
    if (!active)
      return () => {
        alive = false;
        window.clearTimeout(first);
      };
    const iv = window.setInterval(tick, 1000);
    window.addEventListener("focus", tick);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(iv);
      window.removeEventListener("focus", tick);
    };
  }, [active, loadCharacters]);

  const mediaOrder = useRef<Record<"Image" | "Video" | "Audio", string[]> | null>(null);
  useEffect(() => {
    const ids = (k: MediaItem["kind"]) =>
      items.filter((i) => i.kind === k && i.state === "ready").map((i) => i.id);
    const order = { Image: ids("image"), Video: ids("video"), Audio: ids("audio") };
    const prev = mediaOrder.current;
    mediaOrder.current = order;
    if (!prev) return;
    const maps: Record<string, Map<number, number>> = {};
    let changed = false;
    for (const k of ["Image", "Video", "Audio"] as const) {
      const m = new Map<number, number>();
      prev[k].forEach((id, i) => {
        const j = order[k].indexOf(id);
        if (j >= 0 && j !== i) m.set(i + 1, j + 1);
      });
      if (m.size) changed = true;
      maps[k] = m;
    }
    if (!changed) return;
    const raf = requestAnimationFrame(() =>
      setPrompt((p) =>
        p.replace(/@(Image|Video|Audio) (\d+)(?!\d)/g, (all, k: string, n: string) => {
          const to = maps[k]?.get(Number(n));
          return to ? `@${k} ${to}` : all;
        })
      )
    );
    return () => cancelAnimationFrame(raf);
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
        once: `rewrite-${job.id}`,
      });
    } else if (job.status === "failed") {
      notify(`Rewrite failed: ${job.error || "unknown error"}`);
      alertDone({
        channel: "rewrite",
        ok: false,
        title: "Rewrite failed",
        body: job.error || "The rewrite did not finish",
        tag: `rewrite-${job.id}`,
        once: `rewrite-${job.id}`,
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
    setSeed(s.seed !== undefined ? String(s.seed) : "");
    setRetryOn(Boolean(s.retry));
    setRetryMax(s.retryMax ? String(s.retryMax) : "");
    setPinnedChars(reuse.characterIds ?? []);
    setSuppressedChars([]);
    setExcludedChars({});
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

  const draftId = draftKey(projectId, "video");
  const draftReady = useRef<string | null>(null);
  const draftSeq = useRef(0);
  const draftEnv = useRef({ notify, maxAudioSec: MAX_AUDIO_SEC });
  useEffect(() => {
    draftEnv.current = { notify, maxAudioSec: MAX_AUDIO_SEC };
  });

  useEffect(() => {
    let cancelled = false;
    draftReady.current = null;
    (async () => {
      await Promise.resolve();
      const d = readDraft<VideoDraft>(draftId);
      if (cancelled) return;
      if (!d) {
        draftReady.current = draftId;
        return;
      }
      setPrompt(d.prompt ?? "");
      if (!d.rewriting) setRewrote(d.rewrote ?? "");
      setPromptTab(d.promptTab === "rewritten" ? "rewritten" : "prompt");
      if (d.model) setModel(d.model);
      if (d.resolution) setResolution(d.resolution);
      if (d.ratio) setRatio(d.ratio);
      if (typeof d.duration === "number") setDuration(d.duration);
      setSmartDuration(Boolean(d.smartDuration));
      setAudio(d.audio !== false);
      setWatermark(Boolean(d.watermark));
      setSeed(d.seed ?? "");
      setRetryOn(Boolean(d.retry));
      setRetryMax(d.retryMax ?? "");
      setPinnedChars(Array.isArray(d.pinnedChars) ? d.pinnedChars : []);
      setSuppressedChars(Array.isArray(d.suppressedChars) ? d.suppressedChars : []);
      setExcludedChars(d.excludedChars && typeof d.excludedChars === "object" ? d.excludedChars : {});
      setGenMode(d.genMode === "frame" ? "frame" : "text");
      const { maxAudioSec } = draftEnv.current;
      const wanted = [...(d.items ?? []), d.firstFrame, d.lastFrame].filter(
        (x): x is DraftItem => Boolean(x)
      );
      const restore = (x: DraftItem | null) =>
        x ? fromDraftItem(x, maxAudioSec) : Promise.resolve(null);
      const [list, ff, lf] = await Promise.all([
        Promise.all((d.items ?? []).map((x) => restore(x))),
        restore(d.firstFrame),
        restore(d.lastFrame),
      ]);
      if (cancelled) return;
      const restored = list.filter((x): x is MediaItem => Boolean(x));
      const ids = new Set(restored.map((x) => x.id));
      setItems((cur) => [...restored, ...cur.filter((x) => !ids.has(x.id))]);
      setFirstFrame((cur) => cur ?? ff);
      setLastFrame((cur) => cur ?? lf);
      const lost = wanted.length - restored.length - (ff ? 1 : 0) - (lf ? 1 : 0);
      if (lost > 0)
        draftEnv.current.notify(
          `${lost} attached file${lost === 1 ? "" : "s"} could not be restored — add ${lost === 1 ? "it" : "them"} again`
        );
      draftReady.current = draftId;
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  useEffect(() => {
    if (draftReady.current !== draftId) return;
    const seq = ++draftSeq.current;
    const timer = window.setTimeout(async () => {
      const [list, ff, lf] = await Promise.all([
        Promise.all(items.map(toDraftItem)),
        toDraftItem(firstFrame),
        toDraftItem(lastFrame),
      ]);
      if (seq !== draftSeq.current || draftReady.current !== draftId) return;
      const value: VideoDraft = {
        prompt,
        rewrote,
        promptTab,
        rewriting,
        model: modelChoice,
        resolution,
        ratio,
        duration,
        smartDuration,
        audio,
        watermark,
        seed,
        retry: retryOn,
        retryMax,
        pinnedChars,
        suppressedChars,
        excludedChars,
        genMode,
        items: list.filter((x): x is DraftItem => Boolean(x)),
        firstFrame: ff,
        lastFrame: lf,
      };
      writeDraft(draftId, value);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    draftId,
    prompt,
    rewrote,
    promptTab,
    rewriting,
    modelChoice,
    resolution,
    ratio,
    duration,
    smartDuration,
    audio,
    watermark,
    seed,
    retryOn,
    retryMax,
    pinnedChars,
    suppressedChars,
    excludedChars,
    genMode,
    items,
    firstFrame,
    lastFrame,
  ]);

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

  type CharRefs = {
    images: (string | null)[];
    audio?: { url: string; previewUrl: string; size: number };
    at: number;
  };
  const charRefsCache = useRef(new Map<string, CharRefs>());
  const refsKey = (c: Character, voice: boolean) =>
    `${c.id}@${charStamp(c)}@${voice ? "a" : ""}`;

  async function getCharRefs(
    c: Character,
    withVoice: boolean
  ): Promise<{ refs?: CharRefs; warnings: string[] }> {
    const key = refsKey(c, withVoice);
    const cached = charRefsCache.current.get(key);
    if (cached && (!cached.audio || Date.now() - cached.at < VOICE_TTL_MS))
      return { refs: cached, warnings: [] };
    const warnings: string[] = [];
    const images: (string | null)[] = [];
    for (let i = 0; i < c.imageCount; i++) {
      try {
        const res = await fetch(charImgUrl(c, i));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        images.push(await blobToDataUrl(await res.blob()));
      } catch (e) {
        images.push(null);
        warnings.push(
          `${c.name} image ${i + 1} failed: ${e instanceof Error ? e.message : "load failed"}`
        );
      }
    }
    let audio: CharRefs["audio"];
    if (withVoice) {
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
    if (!images.some(Boolean) && !audio && c.imageCount > 0) return { warnings };
    const refs: CharRefs = { images, audio, at: Date.now() };
    charRefsCache.current.set(key, refs);
    return { refs, warnings };
  }

  type CharPlan = { c: Character; stamp: string; indexes: number[]; voice: boolean };

  function charTargets(env: SyncEnv): { targets: Character[]; notes: string[] } {
    const notes: string[] = [];
    const named = env.chars
      .filter((c) => !c.hidden && !env.suppressed.includes(c.id))
      .map((c) => ({ c, at: nameIndex(env.searchText, c.name) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((x) => x.c);
    const targets = [...named];
    let missing = 0;
    for (const id of env.pinned) {
      if (targets.some((c) => c.id === id) || env.suppressed.includes(id)) continue;
      const c = env.chars.find((x) => x.id === id);
      if (!c) missing++;
      else if (c.hidden)
        notes.push(
          `${c.name} is hidden, so the reused references are not attached. Unhide it in Characters to use it.`
        );
      else targets.push(c);
    }
    if (missing && env.charsFor === env.projectId)
      notes.push(
        missing === 1
          ? "A character from the reused video no longer exists, so its references are not attached."
          : `${missing} characters from the reused video no longer exist, so their references are not attached.`
      );
    return { targets, notes };
  }

  function planCharacters(
    list: MediaItem[],
    targets: Character[],
    env: SyncEnv
  ): { plans: CharPlan[]; notes: string[] } {
    const notes: string[] = [];
    const plans: CharPlan[] = [];
    const own = list.filter((i) => !i.characterId && i.state !== "error");
    let freeImg = env.maxImages - own.filter((i) => i.kind === "image").length;
    let freeAud = env.maxAudio - own.filter((i) => i.kind === "audio").length;
    for (const c of targets) {
      const stamp = charStamp(c);
      const ex = env.excluded[c.id]?.stamp === stamp ? env.excluded[c.id] : null;
      const wanted = Array.from({ length: c.imageCount }, (_, i) => i).filter(
        (i) => !ex?.images.includes(i)
      );
      if (!env.maxImages) {
        notes.push(
          `${c.name} is described in the prompt only: ${env.label} takes no reference images.`
        );
        continue;
      }
      const n = Math.max(0, Math.min(freeImg, wanted.length));
      if (wanted.length && !n) {
        notes.push(
          `${c.name} is not attached: all ${env.maxImages} image slots are in use. Remove an image to make room.`
        );
        continue;
      }
      if (n < wanted.length)
        notes.push(
          `${c.name}: only ${n} of ${wanted.length} images fit, because ${env.label} takes ${env.maxImages}.`
        );
      freeImg -= n;
      let voice = false;
      if (c.hasAudio && !env.maxAudio && !ex?.voice)
        notes.push(`${c.name}'s voice is not attached: ${env.label} takes no reference audio.`);
      if (c.hasAudio && env.maxAudio > 0 && !ex?.voice) {
        if (freeAud > 0) {
          voice = true;
          freeAud--;
        } else
          notes.push(
            `${c.name}'s voice is not attached: ${env.label} takes ${env.maxAudio} audio clip${env.maxAudio === 1 ? "" : "s"}, already in use.`
          );
      }
      plans.push({ c, stamp, indexes: wanted.slice(0, n), voice });
    }
    return { plans, notes };
  }

  function planIsCurrent(list: MediaItem[], p: CharPlan): boolean {
    const mine = list.filter((i) => i.characterId === p.c.id);
    const imgs = mine.filter((i) => i.kind === "image");
    return (
      mine.length > 0 &&
      mine.every((i) => i.characterStamp === p.stamp && i.state === "ready") &&
      imgs.map((i) => i.characterIndex).join() === p.indexes.join() &&
      mine.some((i) => i.kind === "audio") === p.voice
    );
  }

  function reconcile(
    cur: MediaItem[],
    plans: CharPlan[],
    refsFor: (p: CharPlan) => CharRefs | undefined
  ): MediaItem[] {
    const out = cur.filter((i) => !i.characterId);
    for (const p of plans) {
      const mine = cur.filter((i) => i.characterId === p.c.id);
      if (planIsCurrent(cur, p)) {
        out.push(
          ...mine.filter((i) => i.kind === "image"),
          ...mine.filter((i) => i.kind === "audio")
        );
        continue;
      }
      const refs = refsFor(p);
      if (!refs) {
        out.push(...mine);
        continue;
      }
      for (const idx of p.indexes) {
        const url = refs.images[idx];
        if (!url) continue;
        out.push({
          id: nextId(),
          kind: "image",
          name: `${p.c.name} ${idx + 1}`,
          size: 0,
          url,
          previewUrl: url,
          state: "ready",
          characterId: p.c.id,
          characterLookId: activeLook(p.c).id,
          characterStamp: p.stamp,
          characterIndex: idx,
        });
      }
      if (p.voice && refs.audio)
        out.push({
          id: nextId(),
          kind: "audio",
          name: `${p.c.name} voice`,
          size: refs.audio.size,
          url: refs.audio.url,
          previewUrl: refs.audio.previewUrl,
          state: "ready",
          characterId: p.c.id,
          characterLookId: activeLook(p.c).id,
          characterStamp: p.stamp,
        });
    }
    const same = out.length === cur.length && out.every((x, i) => x === cur[i]);
    return same ? cur : out;
  }

  const syncChain = useRef<Promise<unknown>>(Promise.resolve());

  async function runCharacterSync(): Promise<MediaItem[]> {
    const showNotes = (notes: string[]) =>
      setCharNotes((cur) => (cur.join("\n") === notes.join("\n") ? cur : notes));
    const env = syncEnv.current;
    if (env.charsFor !== env.projectId) return itemsRef.current;
    if (env.frameMode) {
      const named = charTargets(env).targets.map((c) => c.name);
      showNotes(
        named.length
          ? [
              `First + last frame mode does not use character references, so ${named.join(", ")} ${named.length === 1 ? "is" : "are"} not attached.`,
            ]
          : []
      );
      return itemsRef.current;
    }
    const draft = planCharacters(itemsRef.current, charTargets(env).targets, env);
    for (const p of draft.plans) {
      if (planIsCurrent(itemsRef.current, p)) continue;
      const { refs, warnings } = await getCharRefs(p.c, p.voice);
      warnings.forEach(notify);
      if (!refs) notify(`Could not load ${p.c.name}'s references`);
    }
    const now = syncEnv.current;
    if (now.frameMode) return itemsRef.current;
    const { targets, notes: targetNotes } = charTargets(now);
    const { plans, notes } = planCharacters(itemsRef.current, targets, now);
    const next = reconcile(itemsRef.current, plans, (p) =>
      charRefsCache.current.get(refsKey(p.c, p.voice))
    );
    if (next !== itemsRef.current) {
      itemsRef.current = next;
      setItems(next);
    }
    showNotes([...targetNotes, ...notes]);
    return next;
  }

  function syncCharacters(): Promise<MediaItem[]> {
    const run = syncChain.current.then(runCharacterSync, runCharacterSync);
    syncChain.current = run.catch(() => undefined);
    return run;
  }

  async function syncCharactersNow(): Promise<MediaItem[]> {
    await loadCharacters();
    await new Promise((r) => requestAnimationFrame(r));
    return syncCharacters();
  }

  const syncRef = useRef(syncCharacters);
  useEffect(() => {
    syncRef.current = syncCharacters;
  });
  const charSyncKey = [
    searchText,
    chars.map((c) => `${c.id}:${c.name}:${c.hidden ? 1 : 0}:${charStamp(c)}`).join("|"),
    pinnedChars.join(),
    suppressedChars.join(),
    JSON.stringify(excludedChars),
    frameMode,
    MAX_IMAGES,
    MAX_AUDIO,
    items
      .map((i) => `${i.id}:${i.kind}:${i.state}:${i.characterId ?? ""}`)
      .join("|"),
  ].join("\u0000");
  useEffect(() => {
    const t = window.setTimeout(() => void syncRef.current(), 300);
    return () => window.clearTimeout(t);
  }, [charSyncKey]);

  function pickCharacter(c: Character, via: "menu" | "typed") {
    if (via !== "menu") return;
    setSuppressedChars((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : s));
    setExcludedChars((ex) => {
      if (!ex[c.id]) return ex;
      const next = { ...ex };
      delete next[c.id];
      return next;
    });
  }

  function updateItem(id: string, patch: Partial<MediaItem>) {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function removeItem(id: string) {
    const item = itemsRef.current.find((i) => i.id === id);
    const cid = item?.characterId;
    if (item && cid) {
      const rest = itemsRef.current.filter((i) => i.characterId === cid && i.id !== id);
      if (!rest.length) {
        setSuppressedChars((s) => (s.includes(cid) ? s : [...s, cid]));
        setPinnedChars((s) => s.filter((x) => x !== cid));
        setExcludedChars((ex) => {
          if (!ex[cid]) return ex;
          const next = { ...ex };
          delete next[cid];
          return next;
        });
      } else {
        const stamp = item.characterStamp ?? "";
        setExcludedChars((ex) => {
          const prev = ex[cid]?.stamp === stamp ? ex[cid] : { stamp, images: [], voice: false };
          return {
            ...ex,
            [cid]:
              item.kind === "audio"
                ? { ...prev, voice: true }
                : { ...prev, images: [...prev.images, item.characterIndex ?? -1] },
          };
        });
      }
    }
    setItems((list) => {
      const it = list.find((i) => i.id === id);
      if (it && !it.characterId && it.previewUrl.startsWith("blob:"))
        URL.revokeObjectURL(it.previewUrl);
      return list.filter((i) => i.id !== id);
    });
  }

  async function handleFiles(files: File[]) {
    const errs: string[] = [];
    let imgCount = images.filter((i) => !i.characterId).length;
    let vidCount = videos.length;
    let vidSec = totalVideoSec;
    let audCount = items.filter(
      (i) => i.kind === "audio" && i.state !== "error" && !i.characterId
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
    for (const it of items) {
      if (it.kind !== "image" || it.state !== "ready") continue;
      n++;
      if (!it.characterId)
        out.push({
          token: `@Image ${n}`,
          label: `Image ${n}`,
          sub: "reference image",
          thumb: it.previewUrl || undefined,
        });
    }
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
    for (const it of items) {
      if (it.kind !== "audio" || it.state !== "ready") continue;
      n++;
      if (!it.characterId)
        out.push({ token: `@Audio ${n}`, label: `Audio ${n}`, sub: "reference audio" });
    }
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
      const list = await syncCharactersNow();
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
    const typedSeed = policy.seed && seed.trim() ? Number(seed) : undefined;
    if (typedSeed !== undefined && (!Number.isInteger(typedSeed) || typedSeed < 0 || typedSeed > MAX_SEED)) {
      notify(`Seed must be an integer in [0, ${MAX_SEED}]`);
      return;
    }
    const retrying = policy.seed && retryOn;
    const maxTries = retrying && retryMax.trim() ? Number(retryMax) : undefined;
    if (maxTries !== undefined && (!Number.isInteger(maxTries) || maxTries < 1 || maxTries > 10000)) {
      notify("Max attempts must be a whole number from 1 to 10000, or empty for no limit");
      return;
    }
    const seedNum =
      typedSeed ?? (retrying ? Math.floor(Date.now() / 1000) % (MAX_SEED + 1) : undefined);
    const retryFields = retrying ? { retry: true, retryMax: maxTries } : {};
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
          seed: seedNum,
          ...retryFields,
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
      const working = [...(await syncCharactersNow())];
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
      const env = syncEnv.current;
      const firstAt = (c: Character) => working.findIndex((i) => i.characterId === c.id);
      const attached = env.chars
        .filter((c) => firstAt(c) >= 0)
        .sort((a, b) => firstAt(a) - firstAt(b));
      const describedOnly = charTargets(env).targets;
      const targets = [
        ...attached,
        ...describedOnly.filter((c) => !attached.some((a) => a.id === c.id)),
      ].filter((c) => !searchText.includes(`${c.name}:`));
      if (useRewritten) {
        const extra = targets
          .filter((c) => nameIndex(rewrote, c.name) < 0)
          .map((c) => bindingLineFrom(working, c));
        if (extra.length)
          finalPrompt = `${sourceText}\n\n${extra.join("")}`.trim();
      } else {
        const lines = targets.map((c) => bindingLineFrom(working, c));
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
        seed: seedNum,
        ...retryFields,
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
              onPickCharacter={pickCharacter}
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

        {charNotes.length > 0 && (
          <div className="mb-3 space-y-1" aria-live="polite">
            {charNotes.map((n) => (
              <p key={n} className="text-xs text-warn">
                {n}
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
                {items.map((item) => {
                  const owner = item.characterId
                    ? chars.find((c) => c.id === item.characterId)?.name ?? "a character"
                    : null;
                  return (
                  <div
                    key={item.id}
                    title={
                      owner
                        ? `Sent with ${owner} when you generate. Mention ${owner} by name to use it; it is not offered in @ mentions.`
                        : undefined
                    }
                    className={`relative border rounded-md overflow-hidden bg-panel2 group ${
                      owner ? "border-dashed border-line" : "border-line"
                    }`}
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
                            className={`w-full h-full object-cover ${
                              owner ? "saturate-[.35] brightness-75" : ""
                            }`}
                          />
                        )
                      ) : (
                        <span className="text-muted text-xs font-mono">…</span>
                      )}
                    </div>
                    {owner && item.kind !== "audio" && (
                      <span className="absolute top-1.5 left-1.5 max-w-[calc(100%-2.75rem)] truncate rounded-full bg-black/70 backdrop-blur-sm px-2 py-0.5 text-2xs font-medium text-ink">
                        {owner}
                      </span>
                    )}
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
                      <p className={`text-2xs text-muted truncate ${owner ? "" : "font-mono"}`}>
                        {item.state === "uploading" && "uploading…"}
                        {item.state === "ready" &&
                          (owner
                            ? `Sent with ${owner}`
                            : `${item.size ? formatBytes(item.size) : "attached"}${
                                item.durationSec ? ` · ${item.durationSec.toFixed(1)}s` : ""
                              }`)}
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
                  );
                })}
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
          {policy.seed && (
            <Field label="Seed" hint="Optional">
              <TextInput
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder={retryOn ? "from the current time" : "random"}
                inputMode="numeric"
              />
            </Field>
          )}
          {policy.seed && (
            <div role="group" aria-label="Retry on fail">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <span className="text-xs font-medium text-ink/80">Retry on fail</span>
                {retryOn && <span className="text-2xs text-muted">next seed each try</span>}
              </div>
              <div className="flex items-center gap-3 min-h-9">
                <Toggle checked={retryOn} onChange={setRetryOn} label="Retry" />
                {retryOn && (
                  <div className="flex items-center gap-2 flex-1 min-w-0 text-xs text-muted">
                    <span className="shrink-0">Max attempts</span>
                    <TextInput
                    value={retryMax}
                    onChange={(e) => setRetryMax(e.target.value)}
                    placeholder="no limit"
                    inputMode="numeric"
                    aria-label="Max attempts"
                    title="Leave empty to keep trying until one succeeds or you stop it from the card."
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          {policy.seed && retryOn && (
            <p className="sm:col-span-2 -mt-2 text-2xs text-muted leading-snug">
              If the video fails, it is sent again with seed +1, until one
              succeeds{retryMax.trim() ? ` or ${retryMax.trim()} attempts have run` : ""}. Leave
              Max attempts empty for no limit. Every attempt and its seed show on
              the card, with a Stop retrying button. Retries only continue while
              GenForge is open in a tab.
            </p>
          )}
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
