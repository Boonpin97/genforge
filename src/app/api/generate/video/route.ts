import { NextRequest, NextResponse } from "next/server";
import {
  ApiErrorLike,
  extractError,
  getVideoProvider,
  hasOssMedia,
  videoService,
} from "@/lib/dashscope";
import type { MediaPayload, MediaType } from "@/lib/types";

export const maxDuration = 60;

const VIDEO_MODELS = ["wan3.0-video", "wan3.0-video-prime"];
const RESOLUTIONS = ["480P", "720P", "1080P"];
const RATIOS = ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"];
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
  const model = VIDEO_MODELS.includes(body.model || "") ? body.model! : "wan3.0-video";
  const provider = await getVideoProvider();

  try {
    const input: Record<string, unknown> = {};
    if (prompt) input.prompt = prompt;
    if (media.length) {
      input.media = media.map(({ type, url }) => ({ type, url }));
    }

    const parameters: Record<string, unknown> = {
      resolution: RESOLUTIONS.includes(body.resolution || "")
        ? body.resolution
        : "1080P",
      ratio: RATIOS.includes(body.ratio || "") ? body.ratio : "adaptive",
      prompt_extend: body.promptExtend === true,
      watermark: Boolean(body.watermark),
    };
    if (typeof body.duration === "number" && body.duration >= 2 && body.duration <= 30) {
      parameters.duration = body.duration;
    } else if (body.duration === -1) {
      parameters.duration = -1;
    }
    if (typeof body.audio === "boolean") parameters.audio = body.audio;
    if (typeof body.seed === "number") parameters.seed = body.seed;

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
      return NextResponse.json(err.toApiError(), { status: 500 });
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
