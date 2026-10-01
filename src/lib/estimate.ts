import { rateFor, type ModelEntry } from "./model-catalog";
import type { ImageUsage, VideoUsage } from "./types";

function tierFromSR(sr: number | undefined): string | undefined {
  if (typeof sr !== "number") return undefined;
  if (sr <= 480) return "480P";
  if (sr <= 720) return "720P";
  return "1080P";
}

export function estimateVideo(
  model: ModelEntry | undefined,
  opts: { seconds?: number; resolution?: string; audio?: boolean; usage?: VideoUsage }
): number | null {
  if (!model || model.kind !== "video") return null;
  const seconds =
    opts.usage?.output_video_duration ?? opts.usage?.duration ?? opts.seconds;
  if (!seconds) return null;
  const tier = opts.resolution || tierFromSR(opts.usage?.SR);
  const table =
    opts.audio === false && model.pricing.perSecondNoAudio
      ? model.pricing.perSecondNoAudio
      : model.pricing.perSecond;
  const rate = rateFor(table, tier);
  return rate === undefined ? null : seconds * rate;
}

function qwenTier(type: string | undefined): string {
  const m = /(\dk)$/i.exec(type || "");
  return m ? m[1].toLowerCase() : "1k";
}

export function estimateImage(
  model: ModelEntry | undefined,
  opts: { count?: number; usage?: ImageUsage | null }
): number | null {
  if (!model || model.kind !== "image") return null;
  const u = opts.usage;
  const count = u?.output_image_count ?? opts.count ?? 0;
  if (!count) return null;
  const out = rateFor(model.pricing.perImage, qwenTier(u?.output_image_type)) ?? 0;
  let total = count * out;
  if (u?.input_image_count) {
    const inRate =
      rateFor(model.pricing.perInputImage, qwenTier(u.input_image_type)) ?? 0;
    total += u.input_image_count * inRate;
  }
  return total;
}

export function estimateText(
  model: ModelEntry | undefined,
  usage: { input_tokens?: number; output_tokens?: number } | null
): number | null {
  if (!model || !usage) return null;
  const i = usage.input_tokens || 0;
  const o = usage.output_tokens || 0;
  if (!i && !o) return null;
  return (
    (i / 1000) * (model.pricing.per1KInput ?? 0) +
    (o / 1000) * (model.pricing.per1KOutput ?? 0)
  );
}
