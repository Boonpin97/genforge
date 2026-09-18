import { NextRequest, NextResponse } from "next/server";
import { ApiErrorLike, extractError, friendlyError } from "@/lib/dashscope";
import { openrouter } from "@/lib/openrouter";

export const maxDuration = 60;

type Body = {
  prompt?: string;
  model?: string;
  images?: string[];
  duration?: number;
  ratio?: string;
  resolution?: string;
};

const SLUG_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/;
const RESOLUTIONS = ["480p", "720p", "768p", "1080p", "1k", "2k", "4k"];
const ASPECTS = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "21:9",
  "9:21",
];

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
  const model = (body.model || "").trim();
  if (!SLUG_RE.test(model)) {
    return NextResponse.json(
      { code: "BadRequest", message: "Not an OpenRouter model id." },
      { status: 400 }
    );
  }

  try {
    const request: Record<string, unknown> = { model, prompt };
    const urls = (body.images || []).filter(
      (u) =>
        typeof u === "string" && (/^https?:/i.test(u) || /^data:image\//i.test(u))
    );
    if (urls.length) {
      request.frame_images = [
        { type: "image_url", image_url: { url: urls[0] }, frame_type: "first_frame" },
      ];
      if (urls.length > 1 && !model.startsWith("x-ai/"))
        request.input_references = urls
          .slice(1)
          .map((u) => ({ type: "image_url", image_url: { url: u } }));
    }
    if (typeof body.duration === "number" && body.duration >= 1)
      request.duration = Math.round(body.duration);
    if (typeof body.ratio === "string" && ASPECTS.includes(body.ratio))
      request.aspect_ratio = body.ratio;
    const res2 = (body.resolution || "").toLowerCase();
    if (RESOLUTIONS.includes(res2)) request.resolution = res2;

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
