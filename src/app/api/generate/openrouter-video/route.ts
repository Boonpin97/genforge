import { NextRequest, NextResponse } from "next/server";
import { extractError, friendlyError } from "@/lib/dashscope";
import { ApiErrorLike, errorStatus } from "@/lib/errors";
import { openrouter } from "@/lib/openrouter";
import { requireModel } from "@/lib/config";
import { checkVideo } from "@/lib/policy-check";
import type { MediaPayload } from "@/lib/types";

export const maxDuration = 60;

type Body = {
  prompt?: string;
  model?: string;
  images?: string[];
  firstFrame?: string;
  lastFrame?: string;
  duration?: number;
  ratio?: string;
  resolution?: string;
  audio?: boolean;
  seed?: number;
};

const isImageUrl = (u: unknown): u is string =>
  typeof u === "string" && (/^https?:/i.test(u) || /^data:image\//i.test(u));

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
  if (!prompt) {
    return NextResponse.json(
      { code: "BadRequest", message: "Prompt is required." },
      { status: 400 }
    );
  }
  try {
    const entry = await requireModel((body.model || "").trim(), "video");
    if (entry.provider !== "openrouter")
      throw new ApiErrorLike("BadRequest", `${entry.label} is not an OpenRouter model.`);
    const policy = entry.policy;
    const urls = (body.images || []).filter(isImageUrl);
    const first = isImageUrl(body.firstFrame) ? body.firstFrame : null;
    const last = isImageUrl(body.lastFrame) ? body.lastFrame : null;
    const media: Pick<MediaPayload, "type" | "url">[] = [
      ...urls.map((url) => ({ type: "reference_image" as const, url })),
      ...(first ? [{ type: "first_frame" as const, url: first }] : []),
      ...(last ? [{ type: "last_frame" as const, url: last }] : []),
    ];
    checkVideo(entry, {
      prompt,
      duration: body.duration,
      resolution: body.resolution,
      ratio: body.ratio,
      media,
    });

    const request: Record<string, unknown> = { model: entry.id, prompt };
    const frames: Record<string, unknown>[] = [];
    if (first)
      frames.push({ type: "image_url", image_url: { url: first }, frame_type: "first_frame" });
    if (last)
      frames.push({ type: "image_url", image_url: { url: last }, frame_type: "last_frame" });
    if (frames.length) request.frame_images = frames;
    if (urls.length)
      request.input_references = urls.map((u) => ({
        type: "image_url",
        image_url: { url: u },
      }));
    if (typeof body.duration === "number" && body.duration >= 1)
      request.duration = Math.round(body.duration);
    if (body.ratio) request.aspect_ratio = body.ratio;
    if (body.resolution) request.resolution = body.resolution;
    if (policy.audio && typeof body.audio === "boolean")
      request.generate_audio = body.audio;
    if (policy.seed && typeof body.seed === "number") request.seed = body.seed;

    const res = await openrouter("/videos", { method: "POST", json: request });
    const out = res.body as {
      id?: string;
      generation_id?: string;
      error?: { code?: string | number; message?: string } | string;
      message?: string;
      data?: { id?: string };
    };

    if (res.status < 200 || res.status >= 300 || out.error) {
      const errObj = typeof out.error === "string" ? { message: out.error } : out.error;
      const err = friendlyError(
        errObj?.message
          ? {
              code: String(errObj.code || `HTTP_${res.status}`),
              message: errObj.message,
              requestId: out.id,
            }
          : extractError(res.body)
      );
      return NextResponse.json(err, {
        status: res.status >= 400 ? res.status : 502,
      });
    }

    const taskId = out.id || out.data?.id;
    if (!taskId) {
      return NextResponse.json(
        {
          code: "EmptyResult",
          message: "OpenRouter accepted the job but returned no video id.",
        },
        { status: 502 }
      );
    }
    return NextResponse.json({
      taskId,
      requestId: out.generation_id || null,
      provider: "openrouter",
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
