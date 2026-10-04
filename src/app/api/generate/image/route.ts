import { NextRequest, NextResponse } from "next/server";
import { dashscope, extractError, tokenplan } from "@/lib/dashscope";
import { ApiErrorLike, errorStatus } from "@/lib/errors";
import { requireModel } from "@/lib/config";
import { checkImage } from "@/lib/policy-check";
import { estimateImage } from "@/lib/estimate";
import { upstreamModelId } from "@/lib/model-catalog";
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
  try {
    const entry = await requireModel(body.model, "image");
    if (entry.provider === "openrouter")
      throw new ApiErrorLike("BadRequest", `${entry.label} is an OpenRouter model.`);
    const call = entry.provider === "tokenplan" ? tokenplan : dashscope;
    const policy = entry.policy;
    const n = typeof body.n === "number" ? body.n : 1;
    checkImage(entry, {
      refs: images,
      n,
      prompt,
      negativePrompt: body.negativePrompt,
      size: body.size,
    });
    const content: Record<string, string>[] = [
      ...images.map((image) => ({ image })),
      { text: prompt },
    ];

    const parameters: Record<string, unknown> = {};
    if (body.size && body.size !== "auto") parameters.size = body.size;
    parameters.n = n;
    if (body.negativePrompt && policy.negativePrompt)
      parameters.negative_prompt = body.negativePrompt;
    if (policy.promptExtend) parameters.prompt_extend = body.promptExtend !== false;
    if (typeof body.watermark === "boolean" && policy.watermark)
      parameters.watermark = body.watermark;
    if (typeof body.seed === "number" && policy.seed) parameters.seed = body.seed;

    const res = await call(
      "/api/v1/services/aigc/multimodal-generation/generation",
      {
        method: "POST",
        json: {
          model: upstreamModelId(entry),
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
      estimate: estimateImage(entry, { usage: out.usage, count: imageUrls.length }),
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
