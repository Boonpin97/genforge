import type { ImageUsage, VideoUsage } from "./types";

/**
 * Estimated price rates in USD. These are placeholders - edit them (or set the
 * matching env vars) to reflect your contract pricing from
 * https://www.alibabacloud.com/help/en/model-studio/models
 */
function num(envVal: string | undefined, fallback: number): number {
  const n = envVal !== undefined ? Number(envVal) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const RATES = {
  // wan3.0-video: USD per second of output video, by resolution tier
  videoPerSec: {
    "480P": num(process.env.PRICE_VIDEO_480P_PER_SEC, 0.05),
    "720P": num(process.env.PRICE_VIDEO_720P_PER_SEC, 0.1),
    "1080P": num(process.env.PRICE_VIDEO_1080P_PER_SEC, 0.2),
  } as Record<string, number>,
  // wan3.0-video-prime: USD per second of output video, by resolution tier
  videoPrimePerSec: {
    "480P": num(process.env.PRICE_VIDEO_PRIME_480P_PER_SEC, 0.068),
    "720P": num(process.env.PRICE_VIDEO_PRIME_720P_PER_SEC, 0.14),
    "1080P": num(process.env.PRICE_VIDEO_PRIME_1080P_PER_SEC, 0.28),
  } as Record<string, number>,
  // wan3.0-video via QwenCloud: USD per second of output video
  qcVideoPerSec: {
    "480P": num(process.env.PRICE_QC_VIDEO_480P_PER_SEC, 0.05),
    "720P": num(process.env.PRICE_QC_VIDEO_720P_PER_SEC, 0.1),
    "1080P": num(process.env.PRICE_QC_VIDEO_1080P_PER_SEC, 0.2),
  } as Record<string, number>,
  // wan3.0-video-prime via QwenCloud: USD per second of output video
  qcVideoPrimePerSec: {
    "480P": num(process.env.PRICE_QC_VIDEO_PRIME_480P_PER_SEC, 0.068),
    "720P": num(process.env.PRICE_QC_VIDEO_PRIME_720P_PER_SEC, 0.14),
    "1080P": num(process.env.PRICE_QC_VIDEO_PRIME_1080P_PER_SEC, 0.28),
  } as Record<string, number>,
  // qwen-image-3.0: USD per image, by billing tier returned in `usage`
  imageOutput: {
    qima_output_1k: num(process.env.PRICE_IMAGE_OUTPUT_1K, 0.05),
    qima_output_2k: num(process.env.PRICE_IMAGE_OUTPUT_2K, 0.1),
  } as Record<string, number>,
  imageInput: {
    qima_input_1k: num(process.env.PRICE_IMAGE_INPUT_1K, 0.01),
    qima_input_2k: num(process.env.PRICE_IMAGE_INPUT_2K, 0.02),
  } as Record<string, number>,
  // openrouter nano banana 2: USD per generated image
  openRouterPerImage: num(process.env.PRICE_OPENROUTER_IMAGE, 0.134),
  // openrouter grok-imagine-video: USD per output second, by resolution
  openRouterVideoPerSec: {
    "480p": num(process.env.PRICE_OR_VIDEO_480P_PER_SEC, 0.08),
    "720p": num(process.env.PRICE_OR_VIDEO_720P_PER_SEC, 0.14),
    "1080p": num(process.env.PRICE_OR_VIDEO_1080P_PER_SEC, 0.25),
  } as Record<string, number>,
  // director (qwen text): USD per 1K tokens (total of input + output)
  directorPer1K: num(process.env.PRICE_DIRECTOR_PER_1K, 0.002),
};

export function estimateDirectorCost(usage: {
  input_tokens?: number;
  output_tokens?: number;
}): number | null {
  const total = (usage.input_tokens || 0) + (usage.output_tokens || 0);
  if (!total) return null;
  return (total / 1000) * RATES.directorPer1K;
}

export function estimateOpenRouterImageCost(count: number): number | null {
  if (!count) return null;
  return count * RATES.openRouterPerImage;
}

export function estimateOpenRouterVideoCost(
  durationSec: number,
  resolution?: string
): number | null {
  if (!durationSec) return null;
  const rate =
    RATES.openRouterVideoPerSec[(resolution || "720p").toLowerCase()];
  if (rate === undefined) return null;
  return durationSec * rate;
}

function videoRateTable(
  model?: string,
  provider?: string
): Record<string, number> {
  const prime = (model || "").includes("prime");
  if (provider === "qwencloud")
    return prime ? RATES.qcVideoPrimePerSec : RATES.qcVideoPerSec;
  return prime ? RATES.videoPrimePerSec : RATES.videoPerSec;
}

function videoTier(
  sr: number | undefined,
  table: Record<string, number>,
  requested?: string
): string {
  if (requested && table[requested] !== undefined) {
    return requested;
  }
  if (typeof sr === "number") {
    if (sr <= 480) return "480P";
    if (sr <= 720) return "720P";
    return "1080P";
  }
  return "1080P";
}

export function estimateVideoCost(
  usage: VideoUsage | undefined,
  requestedResolution?: string,
  opts?: { model?: string; provider?: string }
): number | null {
  const seconds = usage?.output_video_duration ?? usage?.duration;
  if (!seconds) return null;
  const table = videoRateTable(opts?.model, opts?.provider);
  const tier = videoTier(usage?.SR, table, requestedResolution);
  const rate = table[tier];
  if (rate === undefined) return null;
  return seconds * rate;
}

export function estimateImageCost(usage: ImageUsage | undefined): number | null {
  if (!usage || !usage.output_image_count) return null;
  let total = 0;
  const outRate =
    RATES.imageOutput[usage.output_image_type || "qima_output_1k"] ?? 0;
  total += usage.output_image_count * outRate;
  if (usage.input_image_count) {
    const inRate =
      RATES.imageInput[usage.input_image_type || "qima_input_1k"] ?? 0;
    total += usage.input_image_count * inRate;
  }
  return total;
}

export function formatUSD(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export const SGD_RATE = 1.3;

export function formatSGD(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  const v = n * SGD_RATE;
  return `S$${v.toFixed(v < 1 ? 4 : 2)}`;
}
