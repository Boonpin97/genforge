import { NextRequest, NextResponse } from "next/server";
import {
  ApiErrorLike,
  dashscope,
  extractError,
  friendlyError,
} from "@/lib/dashscope";
import {
  buildRewriteUserPrompt,
  REWRITE_MODEL,
  REWRITE_SYSTEM_PROMPT,
} from "@/lib/rewrite";
import { recordDirectorRun } from "@/lib/analytics";
import { estimateDirectorCost } from "@/lib/pricing";

export const maxDuration = 120;

type Body = {
  prompt?: string;
  inventory?: unknown;
  projectId?: string | null;
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
      { code: "BadRequest", message: "A prompt is required." },
      { status: 400 }
    );
  }
  const inventory = Array.isArray(body.inventory)
    ? body.inventory.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : [];

  try {
    const res = await dashscope("/compatible-mode/v1/chat/completions", {
      method: "POST",
      json: {
        model: REWRITE_MODEL,
        messages: [
          { role: "system", content: REWRITE_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildRewriteUserPrompt(prompt, inventory),
          },
        ],
        temperature: 0.4,
        max_tokens: 4000,
      },
    });

    const out = res.body as {
      id?: string;
      error?: { code?: string; message?: string };
      message?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    if (res.status !== 200 || out.error || out.message) {
      const err = friendlyError(
        out.error?.message
          ? {
              code: String(out.error.code || `HTTP_${res.status}`),
              message: out.error.message,
              requestId: out.id,
            }
          : extractError(res.body)
      );
      return NextResponse.json(err, {
        status: res.status >= 400 ? res.status : 502,
      });
    }

    const rewrote = out.choices?.[0]?.message?.content ?? "";
    if (!rewrote.trim()) {
      return NextResponse.json(
        {
          code: "EmptyResult",
          message: "Model returned success but no rewritten prompt.",
          requestId: out.id,
        },
        { status: 502 }
      );
    }

    const usage = out.usage
      ? {
          input_tokens: out.usage.prompt_tokens,
          output_tokens: out.usage.completion_tokens,
        }
      : null;
    const estimate = usage ? estimateDirectorCost(usage) : null;

    await recordDirectorRun({
      model: REWRITE_MODEL,
      premise: prompt,
      estimate,
      tokens: usage
        ? (usage.input_tokens || 0) + (usage.output_tokens || 0)
        : null,
      kind: "rewrite",
      projectId: typeof body.projectId === "string" ? body.projectId : null,
    }).catch(() => null);

    return NextResponse.json({
      rewrote: rewrote.trim(),
      model: REWRITE_MODEL,
      estimate,
      requestId: out.id || null,
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
