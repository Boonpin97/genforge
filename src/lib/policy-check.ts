import { ApiErrorLike } from "./errors";
import {
  durationAllowed,
  durationBounds,
  longestDurationReasons,
  type ImageModel,
  type VideoModel,
} from "./model-catalog";
import type { MediaPayload } from "./types";

function fail(message: string): never {
  throw new ApiErrorLike("PolicyViolation", message);
}

export function dataUrlBytes(url: string | undefined): number {
  if (!url?.startsWith("data:")) return 0;
  const comma = url.indexOf(",");
  if (comma < 0) return 0;
  const b64 = url.length - comma - 1;
  return Math.floor((b64 * 3) / 4);
}

const MB = 1024 * 1024;

export function checkVideo(
  m: VideoModel,
  req: {
    prompt?: string;
    duration?: number;
    resolution?: string;
    ratio?: string;
    media: Pick<MediaPayload, "type" | "durationSec" | "url">[];
    refVideoSec?: number;
  }
): void {
  const p = m.policy;
  const count = (t: MediaPayload["type"]) => req.media.filter((x) => x.type === t).length;
  const images = count("reference_image");
  const videos = count("reference_video");
  const audios = count("reference_audio");
  const first = count("first_frame");
  const last = count("last_frame");

  if (p.maxPromptChars && (req.prompt?.length ?? 0) > p.maxPromptChars)
    fail(
      `${m.label} takes prompts up to ${p.maxPromptChars} characters (this one is ${req.prompt!.length}).`
    );
  if (images > p.refs.maxImages)
    fail(
      p.refs.maxImages
        ? `${m.label} takes at most ${p.refs.maxImages} reference images (got ${images}).`
        : `${m.label} does not take reference images.`
    );
  if (images < p.refs.minImages)
    fail(
      `${m.label} needs at least ${p.refs.minImages} reference image${p.refs.minImages === 1 ? "" : "s"}.`
    );
  if (videos > p.refs.maxVideos)
    fail(
      p.refs.maxVideos
        ? `${m.label} takes at most ${p.refs.maxVideos} reference videos (got ${videos}).`
        : `${m.label} does not take reference video.`
    );
  if (audios > p.refs.maxAudio)
    fail(
      p.refs.maxAudio
        ? `${m.label} takes at most ${p.refs.maxAudio} reference audio clips.`
        : `${m.label} does not take reference audio.`
    );
  if (first && !p.frames.includes("first_frame"))
    fail(`${m.label} does not take a first frame.`);
  if (last && !p.frames.includes("last_frame"))
    fail(`${m.label} does not take a last frame.`);
  if (last && !first) fail("A last frame needs a first frame too.");
  if (p.firstFrameRequired && !first) fail(`${m.label} needs a first-frame image.`);
  if (p.refs.framesExclusiveWithRefs && first + last > 0 && images + videos + audios > 0)
    fail("First and last frames cannot be combined with reference media for this model.");

  if (p.refs.maxImageMB)
    for (const x of req.media) {
      if (x.type !== "reference_image" && x.type !== "first_frame" && x.type !== "last_frame")
        continue;
      const bytes = dataUrlBytes(x.url);
      if (bytes > p.refs.maxImageMB * MB)
        fail(
          `An image is ${(bytes / MB).toFixed(1)}MB; ${m.label} takes images up to ${p.refs.maxImageMB}MB.`
        );
    }
  if (p.refs.minClipSec)
    for (const x of req.media) {
      if (x.type !== "reference_video" && x.type !== "reference_audio") continue;
      const sec = Number(x.durationSec) || 0;
      if (sec > 0 && sec < p.refs.minClipSec)
        fail(
          `A reference ${x.type === "reference_video" ? "video" : "audio"} clip is ${sec.toFixed(1)}s; ${m.label} needs clips of at least ${p.refs.minClipSec}s.`
        );
    }

  const refSec = req.refVideoSec ?? 0;
  if (p.refs.maxVideos && refSec > p.refs.maxVideoTotalSec + 0.5)
    fail(`Reference video totals ${refSec.toFixed(1)}s; ${m.label} allows ${p.refs.maxVideoTotalSec}s combined.`);

  if (typeof req.duration === "number") {
    if (req.duration === -1) {
      if (!p.smartDuration) fail(`${m.label} needs a fixed duration.`);
    } else {
      if (!durationAllowed(p.durations, req.duration)) {
        const d = p.durations;
        fail(
          "values" in d
            ? `${m.label} makes ${d.values.join(", ")}s clips only (asked for ${req.duration}s).`
            : `${m.label} makes ${d.min}–${d.max}s clips (asked for ${req.duration}s).`
        );
      }
      const longest = durationBounds(p.durations).max;
      const reasons = longestDurationReasons(p.longestDurationOnly, {
        resolution: req.resolution,
        refImages: images,
        lastFrame: last > 0,
      });
      if (reasons.length && req.duration !== longest)
        fail(
          `${m.label} only makes ${longest}s clips with ${reasons.join(" and ")} (asked for ${req.duration}s).`
        );
      if (p.refs.videoCountsTowardDuration && refSec + req.duration > p.refs.totalBudgetSec + 0.5)
        fail(
          `Reference video (${refSec.toFixed(1)}s) plus ${req.duration}s output exceeds the ${p.refs.totalBudgetSec}s total for ${m.label}.`
        );
    }
  }
  if (
    req.resolution &&
    !p.resolutions.some((r) => r.toLowerCase() === req.resolution!.toLowerCase())
  )
    fail(`${m.label} renders ${p.resolutions.join(", ")} only.`);
  if (req.ratio && !p.ratios.includes(req.ratio))
    fail(`${m.label} supports aspect ratios ${p.ratios.join(", ")} only.`);
}

export function checkImage(
  m: ImageModel,
  req: {
    refs: string[];
    n: number;
    prompt?: string;
    negativePrompt?: string;
    size?: string;
  }
): void {
  const p = m.policy;
  const refs = req.refs.length;
  if (refs > p.maxRefs)
    fail(
      p.maxRefs
        ? `${m.label} takes at most ${p.maxRefs} reference images (got ${refs}).`
        : `${m.label} does not take reference images.`
    );
  if (req.n > p.maxN) fail(`${m.label} makes at most ${p.maxN} images per run.`);
  if (p.maxPromptChars && (req.prompt?.length ?? 0) > p.maxPromptChars)
    fail(
      `${m.label} takes prompts up to ${p.maxPromptChars} characters (this one is ${req.prompt!.length}).`
    );
  if (p.maxNegativeChars && (req.negativePrompt?.length ?? 0) > p.maxNegativeChars)
    fail(`${m.label} takes negative prompts up to ${p.maxNegativeChars} characters.`);
  if (
    refs &&
    req.size &&
    p.textOnlySizes.some((s) => s.toLowerCase() === req.size!.toLowerCase())
  )
    fail(
      `${m.label} renders ${req.size} for text-to-image only — pick another size, or remove the reference images.`
    );
  if (p.maxRefMB)
    for (const url of req.refs) {
      const bytes = dataUrlBytes(url);
      if (bytes > p.maxRefMB * MB)
        fail(
          `A reference image is ${(bytes / MB).toFixed(1)}MB; ${m.label} takes images up to ${p.maxRefMB}MB.`
        );
    }
}

export function defaultDuration(m: VideoModel): number {
  return durationBounds(m.policy.durations).min;
}
