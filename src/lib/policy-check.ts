import { ApiErrorLike } from "./errors";
import {
  durationAllowed,
  durationBounds,
  type ImageModel,
  type VideoModel,
} from "./model-catalog";
import type { MediaPayload } from "./types";

function fail(message: string): never {
  throw new ApiErrorLike("PolicyViolation", message);
}

export function checkVideo(
  m: VideoModel,
  req: {
    duration?: number;
    resolution?: string;
    ratio?: string;
    media: Pick<MediaPayload, "type" | "durationSec">[];
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

  if (images > p.refs.maxImages)
    fail(`${m.label} takes at most ${p.refs.maxImages} reference images (got ${images}).`);
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
  if (p.refs.framesExclusiveWithRefs && first + last > 0 && images + videos + audios > 0)
    fail("First and last frames cannot be combined with reference media for this model.");

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

export function checkImage(m: ImageModel, req: { refs: number; n: number }): void {
  const p = m.policy;
  if (req.refs > p.maxRefs)
    fail(
      p.maxRefs
        ? `${m.label} takes at most ${p.maxRefs} reference images (got ${req.refs}).`
        : `${m.label} does not take reference images.`
    );
  if (req.n > p.maxN) fail(`${m.label} makes at most ${p.maxN} images per run.`);
}

export function defaultDuration(m: VideoModel): number {
  return durationBounds(m.policy.durations).min;
}
