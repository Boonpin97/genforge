import { NextRequest, NextResponse } from "next/server";
import {
  extractError,
  getVideoProvider,
  hasOssMedia,
  videoService,
} from "@/lib/dashscope";
import { ApiErrorLike, errorStatus } from "@/lib/errors";
import { requireModel } from "@/lib/config";
import { checkVideo } from "@/lib/policy-check";
import type { MediaPayload, MediaType } from "@/lib/types";

export const maxDuration = 60;

const REFERENCE_TYPES: MediaType[] = [
  "reference_image",
  "reference_video",
  "reference_audio",
];
const FRAME_TYPES: MediaType[] = ["first_frame", "last_frame"];
const ALLOWED_TYPES = new Set<string>([...REFERENCE_TYPES, ...FRAME_TYPES]);

type Body = {
  prompt?: string;
  model?: string;
  media?: MediaPayload[];
  resolution?: string;
  ratio?: string;
  duration?: number;
  audio?: boolean;
  promptExtend?: boolean;
  watermark?: boolean;
  seed?: number;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "BadRequest", message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const prompt = (body.prompt || "").trim();
  const media = (body.media || []).filter(
    (m) =>
      m &&
      ALLOWED_TYPES.has(m.type) &&
      typeof m.url === "string" &&
      m.url.length > 0
  );

  if (!prompt && media.length === 0) {
    return NextResponse.json(
      { code: "BadRequest", message: "Either a prompt or reference media is required." },
      { status: 400 }
    );
  }
  const hasFrames = media.some((m) => FRAME_TYPES.includes(m.type));
  const hasRefs = media.some((m) => REFERENCE_TYPES.includes(m.type));
  if (hasFrames && hasRefs) {
    return NextResponse.json(
      {
        code: "BadRequest",
        message:
          "first_frame/last_frame cannot be combined with reference_image/reference_video/reference_audio in the same request.",
      },
      { status: 400 }
    );
  }
  try {
    const entry = await requireModel(body.model, "video");
    if (entry.provider !== "alibaba")
      throw new ApiErrorLike("BadRequest", `${entry.label} is an OpenRouter model.`);
    const model = entry.id;
    const provider = await getVideoProvider();
    const policy = entry.policy;
    checkVideo(entry, {
      duration: body.duration,
      resolution: body.resolution,
      ratio: body.ratio,
      media,
      refVideoSec: media
        .filter((m) => m.type === "reference_video")
        .reduce((s, m) => s + (Number(m.durationSec) || 0), 0),
    });

    const input: Record<string, unknown> = {};
    if (prompt) input.prompt = prompt;
    if (media.length) {
      input.media = media.map(({ type, url }) => ({ type, url }));
    }

    const parameters: Record<string, unknown> = {
      resolution: body.resolution || policy.resolutions[policy.resolutions.length - 1],
      ratio: body.ratio || policy.ratios[0],
      prompt_extend: body.promptExtend === true,
      watermark: policy.watermark && Boolean(body.watermark),
    };
    if (typeof body.duration === "number") parameters.duration = body.duration;
    if (typeof body.audio === "boolean") parameters.audio = policy.audio && body.audio;
    if (typeof body.seed === "number" && policy.seed) parameters.seed = body.seed;

    const headers: Record<string, string> = {
      "X-DashScope-Async": "enable",
    };
    if (hasOssMedia(media)) {
      headers["X-DashScope-OssResourceResolve"] = "enable";
    }

    const res = await videoService(
      provider,
      "/api/v1/services/aigc/video-generation/video-synthesis",
      {
        method: "POST",
        headers,
        json: { model, input, parameters },
      }
    );

    const out = res.body as {
      code?: string;
      output?: { task_id?: string; task_status?: string };
      request_id?: string;
    };

    if (res.status !== 200 || out.code || !out.output?.task_id) {
      const err = extractError(res.body);
      return NextResponse.json(err, {
        status: res.status >= 400 ? res.status : 502,
      });
    }

    return NextResponse.json({
      taskId: out.output.task_id,
      status: out.output.task_status || "PENDING",
      requestId: out.request_id || null,
    });
  } catch (err) {
    if (err instanceof ApiErrorLike) {
      return NextResponse.json(err.toApiError(), { status: errorStatus(err) });
    }
    return NextResponse.json(
      {
        code: "InternalError",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
