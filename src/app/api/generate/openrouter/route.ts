import { NextRequest, NextResponse } from "next/server";
import { extractError, friendlyError } from "@/lib/dashscope";
import { ApiErrorLike, errorStatus } from "@/lib/errors";
import { openrouter } from "@/lib/openrouter";
import { requireModel } from "@/lib/config";
import { checkImage } from "@/lib/policy-check";
import { estimateImage } from "@/lib/estimate";

export const maxDuration = 300;

const ASPECTS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

function aspectFor(size: string | undefined): string | null {
  if (!size || size === "auto") return null;
  const m = /^(\d+)\*(\d+)$/.exec(size);
  if (!m) return null;
  const target = Number(m[1]) / Number(m[2]);
  let best = "1:1";
  let bestDiff = Infinity;
  for (const a of ASPECTS) {
    const [w, h] = a.split(":").map(Number);
    const d = Math.abs(w / h - target);
    if (d < bestDiff) {
      bestDiff = d;
      best = a;
    }
  }
  return best;
}

type Body = {
  prompt?: string;
  model?: string;
  images?: string[];
  size?: string;
  n?: number;
  negativePrompt?: string;
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
  const refs = (body.images || []).filter(
    (u) => typeof u === "string" && (u.startsWith("data:") || /^https?:\/\//i.test(u))
  );
  const n = Math.max(1, Number(body.n) || 1);
  const text = body.negativePrompt
    ? `${prompt}\nAvoid in the output: ${body.negativePrompt}.`
    : prompt;
  const aspect = aspectFor(body.size);

  try {
    const entry = await requireModel(body.model, "image");
    if (entry.provider !== "openrouter")
      throw new ApiErrorLike("BadRequest", `${entry.label} is not an OpenRouter model.`);
    checkImage(entry, {
      refs,
      n,
      prompt,
      negativePrompt: body.negativePrompt,
      size: body.size,
    });
    const model = entry.id;
    const images: string[] = [];
    let cost: number | null = null;
    let lastBody: Record<string, unknown> | null = null;

    for (let i = 0; i < n; i++) {
      const request: Record<string, unknown> = {
        model,
        modalities: ["image", "text"],
        usage: { include: true },
        messages: [
          {
            role: "user",
            content: [
              ...refs.map((url) => ({ type: "image_url", image_url: { url } })),
              { type: "text", text },
            ],
          },
        ],
      };
      if (aspect) request.image = { image_config: { aspect_ratio: aspect } };

      const res = await openrouter("/chat/completions", {
        method: "POST",
        json: request,
      });
      lastBody = res.body;
      const out = res.body as {
        error?: unknown;
        choices?: {
          message?: { images?: { image_url?: { url?: string } }[] };
          finish_reason?: string;
          error_message?: string;
        }[];
      };
      const choice = out.choices?.[0];
      if (
        choice?.finish_reason === "content_filter" ||
        /content.{0,20}(policy|filter)|inappropr|nsfw|safety/i.test(
          choice?.error_message || ""
        )
      ) {
        return NextResponse.json(
          friendlyError({
            code: "ContentPolicyViolation",
            message:
              choice?.error_message ||
              "The provider's content policy flagged this prompt or one of the reference images.",
          }),
          { status: 400 }
        );
      }
      if (res.status !== 200 || out.error) {
        const errBody = out.error as
          | { message?: string; code?: string }
          | undefined;
        const err = friendlyError(
          errBody?.message
            ? {
                code: String(errBody.code || `HTTP_${res.status}`),
                message: errBody.message,
              }
            : extractError(res.body)
        );
        return NextResponse.json(err, {
          status: res.status >= 400 ? res.status : 502,
        });
      }
      const c = (res.body.usage as { cost?: unknown } | undefined)?.cost;
      if (typeof c === "number") cost = (cost ?? 0) + c;
      const urls = (out.choices?.[0]?.message?.images || [])
        .map((im) => im.image_url?.url)
        .filter((u): u is string => Boolean(u));
      images.push(...urls);
      if (!urls.length) break;
    }

    if (!images.length) {
      return NextResponse.json(
        {
          code: "EmptyResult",
          message: `OpenRouter returned no images (finish_reason: ${
            (
              lastBody as {
                choices?: { finish_reason?: string }[];
              } | null
            )?.choices?.[0]?.finish_reason || "unknown"
          }). The model may have refused the prompt, or the request timed out.`,
          requestId: (lastBody?.id as string) || undefined,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      images,
      usage: null,
      requestId: (lastBody?.id as string) || null,
      estimate: cost ?? estimateImage(entry, { count: images.length }),
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
