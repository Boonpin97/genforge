export type ModelKind = "video" | "image" | "text";

export type ModelProvider = "alibaba" | "openrouter";

export type ProviderId = "dashscope" | "qwencloud" | "openrouter";

export type FrameType = "first_frame" | "last_frame";

export type DurationPolicy = { min: number; max: number } | { values: number[] };

export type VideoRefPolicy = {
  maxImages: number;
  maxVideos: number;
  maxVideoTotalSec: number;
  maxAudio: number;
  maxAudioSec: number;
  maxImageMB: number;
  maxVideoMB: number;
  maxAudioMB: number;
  videoCountsTowardDuration: boolean;
  totalBudgetSec: number;
  framesExclusiveWithRefs: boolean;
};

export type VideoPolicy = {
  durations: DurationPolicy;
  smartDuration: boolean;
  resolutions: string[];
  ratios: string[];
  audio: boolean;
  frames: FrameType[];
  framesRequireQwencloud: boolean;
  refs: VideoRefPolicy;
  watermark: boolean;
  seed: boolean;
};

export type ImagePolicy = {
  maxRefs: number;
  maxRefMB: number;
  maxN: number;
  sizes: string[];
  negativePrompt: boolean;
  promptExtend: boolean;
  watermark: boolean;
  seed: boolean;
};

export type TextPolicy = {
  vision: boolean;
  maxTokens: number;
};

export type ModelPricing = {
  perSecond?: Record<string, number>;
  perSecondNoAudio?: Record<string, number>;
  perImage?: Record<string, number>;
  perInputImage?: Record<string, number>;
  per1KInput?: number;
  per1KOutput?: number;
};

type Base = {
  id: string;
  label: string;
  provider: ModelProvider;
  enabled: boolean;
  pricing: ModelPricing;
  notes?: string;
  deprecated?: boolean;
  custom?: boolean;
};

export type VideoModel = Base & { kind: "video"; policy: VideoPolicy };
export type ImageModel = Base & { kind: "image"; policy: ImagePolicy };
export type TextModel = Base & { kind: "text"; policy: TextPolicy };
export type ModelEntry = VideoModel | ImageModel | TextModel;

export type Roles = { director: string; rewrite: string; appearance: string };

export type ProviderConfig = { apiKey: string; baseUrl: string };

export type GenforgeConfig = {
  version: 1;
  providers: Record<ProviderId, ProviderConfig>;
  videoProvider: "dashscope" | "qwencloud";
  roles: Roles;
  models: ModelEntry[];
};

export type PublicProvider = {
  hasKey: boolean;
  last4: string | null;
  baseUrl: string;
};

export type PublicModel = ModelEntry & {
  resolvedProvider: ProviderId;
  available: boolean;
};

export type PublicConfig = {
  providers: Record<ProviderId, PublicProvider>;
  videoProvider: "dashscope" | "qwencloud";
  roles: Roles;
  models: PublicModel[];
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  dashscope: "Alibaba DashScope",
  qwencloud: "Alibaba QwenCloud",
  openrouter: "OpenRouter",
};

export const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  dashscope: "https://dashscope-intl.aliyuncs.com",
  qwencloud: "https://dashscope-intl.aliyuncs.com",
  openrouter: "https://openrouter.ai/api/v1",
};

export function resolveProvider(
  m: Pick<ModelEntry, "provider" | "kind">,
  videoProvider: "dashscope" | "qwencloud"
): ProviderId {
  if (m.provider === "openrouter") return "openrouter";
  return m.kind === "video" ? videoProvider : "dashscope";
}

export function isOpenRouterId(id: string): boolean {
  return id.includes("/");
}

export function durationBounds(d: DurationPolicy): { min: number; max: number } {
  if ("values" in d) {
    const v = [...d.values].sort((a, b) => a - b);
    return { min: v[0] ?? 1, max: v[v.length - 1] ?? 1 };
  }
  return { min: d.min, max: d.max };
}

export function durationAllowed(d: DurationPolicy, sec: number): boolean {
  if ("values" in d) return d.values.includes(sec);
  return sec >= d.min && sec <= d.max;
}

export function snapDuration(d: DurationPolicy, sec: number, cap?: number): number {
  if ("values" in d) {
    const vals = [...d.values]
      .sort((a, b) => a - b)
      .filter((v) => cap === undefined || v <= cap);
    if (!vals.length) return durationBounds(d).min;
    return vals.reduce((best, v) =>
      Math.abs(v - sec) < Math.abs(best - sec) ? v : best
    );
  }
  const max = cap === undefined ? d.max : Math.min(d.max, cap);
  return Math.min(Math.max(sec, d.min), Math.max(d.min, max));
}

export function rateFor(
  table: Record<string, number> | undefined,
  key?: string
): number | undefined {
  if (!table) return undefined;
  if (key) {
    const k = key.toLowerCase();
    for (const [name, v] of Object.entries(table))
      if (name.toLowerCase() === k) return v;
  }
  return table.default;
}

export function policySummary(m: ModelEntry): string {
  if (m.kind === "video") {
    const p = m.policy;
    const d = p.durations;
    const parts = [
      "values" in d ? `${d.values.join(", ")}s` : `${d.min}–${d.max}s`,
      p.resolutions.length > 1
        ? `${p.resolutions[0]}–${p.resolutions[p.resolutions.length - 1]}`
        : p.resolutions[0] || "",
    ];
    if (p.audio) parts.push("audio");
    if (p.frames.length === 2) parts.push("first and last frame");
    else if (p.frames.length === 1) parts.push("first frame");
    const refs: string[] = [];
    if (p.refs.maxImages) refs.push(`${p.refs.maxImages} images`);
    if (p.refs.maxVideos) refs.push(`${p.refs.maxVideos} videos`);
    if (p.refs.maxAudio) refs.push("audio");
    parts.push(refs.length ? `refs: ${refs.join(", ")}` : "no reference media");
    if (p.refs.videoCountsTowardDuration && p.refs.maxVideos)
      parts.push(`reference video counts toward ${p.refs.totalBudgetSec}s`);
    return parts.filter(Boolean).join(", ");
  }
  if (m.kind === "image") {
    const p = m.policy;
    return [
      p.maxRefs ? `${p.maxRefs} reference images` : "text only",
      `up to ${p.maxN} per run`,
      p.negativePrompt ? "negative prompt" : "",
      p.seed ? "seed" : "",
    ]
      .filter(Boolean)
      .join(", ");
  }
  return [m.policy.vision ? "reads images" : "text only", `${m.policy.maxTokens} max output tokens`].join(", ");
}

const QWEN_RATIOS = ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"];
const WIDE_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"];
const QWEN_SIZES = ["auto", "1333*750", "750*1333", "1155*866", "866*1155", "1000*1000"];
const OR_SIZES = ["auto", "1333*750", "750*1333", "1155*866", "866*1155", "1000*1000"];

function orRefs(maxImages: number): VideoRefPolicy {
  return {
    maxImages,
    maxVideos: 0,
    maxVideoTotalSec: 0,
    maxAudio: 0,
    maxAudioSec: 0,
    maxImageMB: 20,
    maxVideoMB: 0,
    maxAudioMB: 0,
    videoCountsTowardDuration: false,
    totalBudgetSec: 0,
    framesExclusiveWithRefs: false,
  };
}

const OR_REF_NOTE =
  "OpenRouter's video API takes images only, so reference video and audio are not sent even where the vendor supports them.";

function orVideo(
  id: string,
  label: string,
  policy: Omit<VideoPolicy, "smartDuration" | "framesRequireQwencloud" | "watermark" | "refs"> & {
    maxImages: number;
  },
  pricing: ModelPricing,
  extra: Partial<Base> = {}
): VideoModel {
  const { maxImages, ...rest } = policy;
  return {
    id,
    label,
    kind: "video",
    provider: "openrouter",
    enabled: false,
    policy: {
      ...rest,
      smartDuration: false,
      framesRequireQwencloud: false,
      watermark: false,
      refs: orRefs(maxImages),
    },
    pricing,
    ...extra,
    notes: [extra.notes, OR_REF_NOTE].filter(Boolean).join(" "),
  };
}

function wan(id: string, label: string, pricing: ModelPricing): VideoModel {
  return {
    id,
    label,
    kind: "video",
    provider: "alibaba",
    enabled: true,
    policy: {
      durations: { min: 2, max: 30 },
      smartDuration: true,
      resolutions: ["480P", "720P", "1080P"],
      ratios: QWEN_RATIOS,
      audio: true,
      frames: ["first_frame", "last_frame"],
      framesRequireQwencloud: true,
      refs: {
        maxImages: 10,
        maxVideos: 5,
        maxVideoTotalSec: 15,
        maxAudio: 1,
        maxAudioSec: 15,
        maxImageMB: 20,
        maxVideoMB: 100,
        maxAudioMB: 15,
        videoCountsTowardDuration: true,
        totalBudgetSec: 30,
        framesExclusiveWithRefs: true,
      },
      watermark: true,
      seed: true,
    },
    pricing,
    notes:
      "Reference video length is taken out of the 30s total, so a 10s reference leaves 20s of output. First and last frame mode needs the QwenCloud endpoint.",
  };
}

function orImage(
  id: string,
  label: string,
  maxRefs: number,
  perImage: number,
  extra: Partial<Base> = {}
): ImageModel {
  return {
    id,
    label,
    kind: "image",
    provider: "openrouter",
    enabled: false,
    policy: {
      maxRefs,
      maxRefMB: 10,
      maxN: 6,
      sizes: OR_SIZES,
      negativePrompt: true,
      promptExtend: false,
      watermark: false,
      seed: false,
    },
    pricing: { perImage: { default: perImage } },
    ...extra,
  };
}

function text(
  id: string,
  label: string,
  provider: ModelProvider,
  vision: boolean,
  per1KInput: number,
  per1KOutput: number,
  enabled = false
): TextModel {
  return {
    id,
    label,
    kind: "text",
    provider,
    enabled,
    policy: { vision, maxTokens: 8000 },
    pricing: { per1KInput, per1KOutput },
  };
}

export const DEFAULT_MODELS: ModelEntry[] = [
  wan("wan3.0-video", "Wan 3.0", {
    perSecond: { "480P": 0.05, "720P": 0.1, "1080P": 0.2 },
  }),
  wan("wan3.0-video-prime", "Wan 3.0 Prime", {
    perSecond: { "480P": 0.068, "720P": 0.14, "1080P": 0.28 },
  }),
  orVideo(
    "alibaba/happyhorse-1.1",
    "HappyHorse 1.1",
    {
      durations: { min: 3, max: 15 },
      resolutions: ["720p", "1080p"],
      ratios: WIDE_RATIOS,
      audio: false,
      frames: ["first_frame"],
      seed: true,
      maxImages: 9,
    },
    { perSecond: { "720p": 0.0988, "1080p": 0.1278 } }
  ),
  orVideo(
    "bytedance/seedance-2.5",
    "Seedance 2.5",
    {
      durations: { min: 4, max: 30 },
      resolutions: ["480p", "720p"],
      ratios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
      audio: true,
      frames: ["first_frame", "last_frame"],
      seed: true,
      maxImages: 9,
    },
    { perSecond: { "480p": 0.1, "720p": 0.23 } },
    { notes: "Priced per video token upstream; the per-second rates here are estimates." }
  ),
  orVideo(
    "bytedance/seedance-2.0",
    "Seedance 2.0",
    {
      durations: { min: 4, max: 15 },
      resolutions: ["480p", "720p", "1080p", "4K"],
      ratios: WIDE_RATIOS,
      audio: true,
      frames: ["first_frame", "last_frame"],
      seed: true,
      maxImages: 9,
    },
    { perSecond: { "480p": 0.067, "720p": 0.15, "1080p": 0.37, "4K": 0.8 } },
    { notes: "Priced per video token upstream; the per-second rates here are estimates." }
  ),
  orVideo(
    "bytedance/seedance-2.0-fast",
    "Seedance 2.0 Fast",
    {
      durations: { min: 4, max: 15 },
      resolutions: ["480p", "720p"],
      ratios: WIDE_RATIOS,
      audio: true,
      frames: ["first_frame", "last_frame"],
      seed: true,
      maxImages: 9,
    },
    { perSecond: { "480p": 0.04, "720p": 0.091 } },
    { notes: "Priced per video token upstream; the per-second rates here are estimates." }
  ),
  orVideo(
    "kwaivgi/kling-v3.0-pro",
    "Kling 3.0 Pro",
    {
      durations: { min: 3, max: 15 },
      resolutions: ["720p"],
      ratios: ["16:9", "9:16", "1:1"],
      audio: true,
      frames: ["first_frame", "last_frame"],
      seed: false,
      maxImages: 7,
    },
    { perSecond: { default: 0.168 }, perSecondNoAudio: { default: 0.112 } }
  ),
  orVideo(
    "kwaivgi/kling-v3.0-std",
    "Kling 3.0 Standard",
    {
      durations: { min: 3, max: 15 },
      resolutions: ["720p"],
      ratios: ["16:9", "9:16", "1:1"],
      audio: true,
      frames: ["first_frame", "last_frame"],
      seed: false,
      maxImages: 7,
    },
    { perSecond: { default: 0.126 }, perSecondNoAudio: { default: 0.084 } }
  ),
  orVideo(
    "google/veo-3.1",
    "Veo 3.1",
    {
      durations: { values: [4, 6, 8] },
      resolutions: ["720p", "1080p", "4K"],
      ratios: ["16:9", "9:16"],
      audio: true,
      frames: ["first_frame", "last_frame"],
      seed: true,
      maxImages: 3,
    },
    {
      perSecond: { default: 0.4, "4K": 0.6 },
      perSecondNoAudio: { default: 0.2, "4K": 0.4 },
    }
  ),
  orVideo(
    "google/veo-3.1-fast",
    "Veo 3.1 Fast",
    {
      durations: { values: [4, 6, 8] },
      resolutions: ["720p", "1080p", "4K"],
      ratios: ["16:9", "9:16"],
      audio: true,
      frames: ["first_frame", "last_frame"],
      seed: true,
      maxImages: 3,
    },
    {
      perSecond: { default: 0.12, "720p": 0.1, "4K": 0.3 },
      perSecondNoAudio: { default: 0.1, "720p": 0.08, "4K": 0.25 },
    }
  ),
  orVideo(
    "google/veo-3.1-lite",
    "Veo 3.1 Lite",
    {
      durations: { values: [4, 6, 8] },
      resolutions: ["720p", "1080p"],
      ratios: ["16:9", "9:16"],
      audio: true,
      frames: ["first_frame", "last_frame"],
      seed: true,
      maxImages: 3,
    },
    {
      perSecond: { default: 0.08, "720p": 0.05 },
      perSecondNoAudio: { default: 0.05, "720p": 0.03 },
    }
  ),
  orVideo(
    "minimax/hailuo-3",
    "Hailuo 3",
    {
      durations: { min: 5, max: 15 },
      resolutions: ["2K"],
      ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
      audio: true,
      frames: ["first_frame", "last_frame"],
      seed: false,
      maxImages: 4,
    },
    { perSecond: { default: 0.13 } }
  ),
  orVideo(
    "minimax/hailuo-3-max",
    "Hailuo 3 Max",
    {
      durations: { min: 5, max: 15 },
      resolutions: ["480p", "768p"],
      ratios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
      audio: false,
      frames: ["first_frame", "last_frame"],
      seed: false,
      maxImages: 4,
    },
    { perSecond: { "480p": 0.05, "768p": 0.08 } }
  ),
  orVideo(
    "runway/gen-4.5",
    "Runway Gen-4.5",
    {
      durations: { min: 2, max: 10 },
      resolutions: ["720p"],
      ratios: ["16:9", "9:16"],
      audio: false,
      frames: ["first_frame"],
      seed: true,
      maxImages: 0,
    },
    { perSecond: { default: 0.12 } }
  ),
  orVideo(
    "x-ai/grok-imagine-video-1.5",
    "Grok Imagine 1.5",
    {
      durations: { min: 1, max: 15 },
      resolutions: ["480p", "720p", "1080p"],
      ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"],
      audio: false,
      frames: ["first_frame"],
      seed: false,
      maxImages: 0,
    },
    { perSecond: { "480p": 0.08, "720p": 0.14, "1080p": 0.25 } },
    { enabled: true }
  ),
  orVideo(
    "openai/sora-2-pro",
    "Sora 2 Pro",
    {
      durations: { values: [4, 8, 12, 16, 20] },
      resolutions: ["720p", "1080p"],
      ratios: ["16:9", "9:16"],
      audio: true,
      frames: [],
      seed: false,
      maxImages: 0,
    },
    { perSecond: { "720p": 0.3, "1080p": 0.5 } },
    {
      deprecated: true,
      notes: "OpenAI deprecated Sora 2 in April 2026 and shut its API down on 24 September 2026.",
    }
  ),

  {
    id: "qwen-image-3.0-pro",
    label: "Qwen Image Pro",
    kind: "image",
    provider: "alibaba",
    enabled: true,
    policy: {
      maxRefs: 3,
      maxRefMB: 10,
      maxN: 6,
      sizes: QWEN_SIZES,
      negativePrompt: true,
      promptExtend: true,
      watermark: true,
      seed: true,
    },
    pricing: {
      perImage: { "1k": 0.05, "2k": 0.1 },
      perInputImage: { "1k": 0.01, "2k": 0.02 },
    },
  },
  {
    id: "qwen-image-3.0",
    label: "Qwen Image Fast",
    kind: "image",
    provider: "alibaba",
    enabled: true,
    policy: {
      maxRefs: 3,
      maxRefMB: 10,
      maxN: 6,
      sizes: QWEN_SIZES,
      negativePrompt: true,
      promptExtend: true,
      watermark: true,
      seed: true,
    },
    pricing: {
      perImage: { "1k": 0.05, "2k": 0.1 },
      perInputImage: { "1k": 0.01, "2k": 0.02 },
    },
  },
  orImage("google/gemini-3.1-flash-image", "Nano Banana 2", 14, 0.134, { enabled: true }),
  orImage("google/gemini-3-pro-image", "Nano Banana Pro", 14, 0.15),
  orImage("openai/gpt-image-2", "GPT Image 2", 10, 0.05),
  orImage("bytedance-seed/seedream-5-0-pro", "Seedream 5 Pro", 10, 0.04),
  orImage("black-forest-labs/flux.2-pro", "FLUX.2 Pro", 8, 0.03),
  orImage("x-ai/grok-imagine-image-2.0", "Grok Imagine Image 2", 1, 0.03),
  orImage("recraft/recraft-v4.1", "Recraft V4.1", 0, 0.04),

  text("qwen3.8-max", "Qwen 3.8 Max", "alibaba", false, 0.002, 0.002, true),
  text("qwen3.8-flash", "Qwen 3.8 Flash", "alibaba", false, 0.002, 0.002, true),
  text("qwen3-vl-flash", "Qwen 3 VL Flash", "alibaba", true, 0.002, 0.002, true),
  text("anthropic/claude-opus-5.5", "Claude Opus 5.5", "openrouter", true, 0.004, 0.02),
  text("anthropic/claude-sonnet-5", "Claude Sonnet 5", "openrouter", true, 0.002, 0.01),
  text("openai/gpt-5.6-sol", "GPT-5.6 Sol", "openrouter", true, 0.002, 0.01),
  text("google/gemini-3.8-flash", "Gemini 3.8 Flash", "openrouter", true, 0.00075, 0.00375),
  text("deepseek/deepseek-v4.1-flash", "DeepSeek V4.1 Flash", "openrouter", true, 0.000035, 0.00029),
  text("moonshotai/kimi-k3", "Kimi K3", "openrouter", true, 0.003, 0.015),
];

export const DEFAULT_ROLES: Roles = {
  director: "qwen3.8-max",
  rewrite: "qwen3.8-flash",
  appearance: "qwen3-vl-flash",
};

export function defaultConfig(): GenforgeConfig {
  return {
    version: 1,
    providers: {
      dashscope: { apiKey: "", baseUrl: DEFAULT_BASE_URLS.dashscope },
      qwencloud: { apiKey: "", baseUrl: DEFAULT_BASE_URLS.qwencloud },
      openrouter: { apiKey: "", baseUrl: DEFAULT_BASE_URLS.openrouter },
    },
    videoProvider: "dashscope",
    roles: { ...DEFAULT_ROLES },
    models: DEFAULT_MODELS.map((m) => structuredClone(m)),
  };
}

export type PublicVideoModel = PublicModel & VideoModel;
export type PublicImageModel = PublicModel & ImageModel;
export type PublicTextModel = PublicModel & TextModel;

export function orderedResolution(list: string[], current: string): string {
  const hit = list.find((r) => r.toLowerCase() === current.toLowerCase());
  return hit ?? list[0] ?? current;
}

export function blankModel(kind: ModelKind, id: string, label?: string): ModelEntry {
  const provider: ModelProvider = isOpenRouterId(id) ? "openrouter" : "alibaba";
  const base = { id, label: label || id, provider, enabled: false, custom: true };
  if (kind === "video")
    return {
      ...base,
      kind,
      policy: {
        durations: { min: 4, max: 10 },
        smartDuration: false,
        resolutions: ["720p"],
        ratios: ["16:9", "9:16", "1:1"],
        audio: false,
        frames: ["first_frame"],
        framesRequireQwencloud: false,
        refs: orRefs(0),
        watermark: false,
        seed: false,
      },
      pricing: { perSecond: { default: 0.1 } },
    };
  if (kind === "image")
    return {
      ...base,
      kind,
      policy: {
        maxRefs: 0,
        maxRefMB: 10,
        maxN: 4,
        sizes: OR_SIZES,
        negativePrompt: true,
        promptExtend: false,
        watermark: false,
        seed: false,
      },
      pricing: { perImage: { default: 0.05 } },
    };
  return {
    ...base,
    kind,
    policy: { vision: false, maxTokens: 8000 },
    pricing: { per1KInput: 0.001, per1KOutput: 0.004 },
  };
}
