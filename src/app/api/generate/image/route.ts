import { NextRequest, NextResponse } from "next/server";
import {
  ApiErrorLike,
  dashscope,
  extractError,
} from "@/lib/dashscope";
import { estimateImageCost } from "@/lib/pricing";
import type { ImageUsage } from "@/lib/types";

export const maxDuration = 300;

type Body = {
  prompt?: string;
  model?: string;
  images?: string[];
  size?: string;
  n?: number;
  negativePrompt?: string;
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
  if (!prompt) {
    return NextResponse.json(
      { code: "BadRequest", message: "Prompt is required." },
      { status: 400 }
    );
  }
  const images = (body.images || []).filter(
    (u) => typeof u === "string" && u.length > 0
  );
  if (images.length > 3) {
    return NextResponse.json(
      { code: "BadRequest", message: "At most 3 reference images allowed." },
      { status: 400 }
    );
  }

  try {
    const content: Record<string, string>[] = [
      ...images.map((image) => ({ image })),
      { text: prompt },
    ];

    const parameters: Record<string, unknown> = {};
    if (body.size && body.size !== "auto") parameters.size = body.size;
    if (typeof body.n === "number") parameters.n = body.n;
    if (body.negativePrompt) parameters.negative_prompt = body.negativePrompt;
    parameters.prompt_extend = body.promptExtend !== false;
    if (typeof body.watermark === "boolean") parameters.watermark = body.watermark;
    if (typeof body.seed === "number") parameters.seed = body.seed;

    const res = await dashscope(
      "/api/v1/services/aigc/multimodal-generation/generation",
      {
        method: "POST",
        json: {
          model: body.model === "qwen-image-3.0" ? "qwen-image-3.0" : "qwen-image-3.0-pro",
          input: { messages: [{ role: "user", content }] },
          parameters,
        },
      }
    );

    const out = res.body as {
      code?: string;
      output?: {
        choices?: {
          message?: { content?: { image?: string }[] };
        }[];
      };
      usage?: ImageUsage;
      request_id?: string;
    };

    if (res.status !== 200 || out.code) {
      const err = extractError(res.body);
      return NextResponse.json(err, { status: res.status >= 400 ? res.status : 502 });
    }

    const imageUrls = (out.output?.choices?.[0]?.message?.content || [])
      .map((c) => c.image)
      .filter((u): u is string => Boolean(u));

    if (!imageUrls.length) {
      return NextResponse.json(
        {
          code: "EmptyResult",
          message: "API returned success but no image URLs.",
          requestId: out.request_id,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      images: imageUrls,
      usage: out.usage || null,
      requestId: out.request_id || null,
      estimate: estimateImageCost(out.usage),
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
