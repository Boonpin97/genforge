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
import {
  createRewriteJob,
  latestOpenRewriteJob,
  patchRewriteJob,
} from "@/lib/rewrite-jobs";
import { recordDirectorRun } from "@/lib/analytics";
import { estimateDirectorCost } from "@/lib/pricing";
import type { RewriteJob } from "@/lib/types";

export const maxDuration = 120;

type Body = {
  prompt?: string;
  inventory?: unknown;
  sig?: unknown;
  projectId?: string | null;
};

async function runRewrite(job: RewriteJob): Promise<void> {
  try {
    const res = await dashscope("/compatible-mode/v1/chat/completions", {
      method: "POST",
      json: {
        model: REWRITE_MODEL,
        messages: [
          { role: "system", content: REWRITE_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildRewriteUserPrompt(job.prompt, job.inventory),
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
      await patchRewriteJob(job.id, { status: "failed", error: err.message });
      return;
    }

    const rewrote = (out.choices?.[0]?.message?.content ?? "").trim();
    if (!rewrote) {
      await patchRewriteJob(job.id, {
        status: "failed",
        error: "Model returned success but no rewritten prompt.",
      });
      return;
    }

    const usage = out.usage
      ? {
          input_tokens: out.usage.prompt_tokens,
          output_tokens: out.usage.completion_tokens,
        }
      : null;
    const estimate = usage ? estimateDirectorCost(usage) : null;

    await patchRewriteJob(job.id, {
      status: "succeeded",
      rewrote,
      estimate,
    });

    await recordDirectorRun({
      model: REWRITE_MODEL,
      premise: job.prompt,
      estimate,
      tokens: usage
        ? (usage.input_tokens || 0) + (usage.output_tokens || 0)
        : null,
      kind: "rewrite",
      projectId: job.projectId,
    }).catch(() => null);
  } catch (err) {
    const message =
      err instanceof ApiErrorLike
        ? err.toApiError().message
        : err instanceof Error
          ? err.message
          : String(err);
    await patchRewriteJob(job.id, { status: "failed", error: message });
  }
}

export async function GET(req: NextRequest) {
  const project = req.nextUrl.searchParams.get("project");
  const projectId = !project || project === "none" ? null : project;
  const job = await latestOpenRewriteJob(projectId);
  return NextResponse.json({ job });
}

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

  const job = await createRewriteJob({
    prompt,
    inventory,
    sig: typeof body.sig === "string" ? body.sig : "",
    model: REWRITE_MODEL,
    projectId: typeof body.projectId === "string" ? body.projectId : null,
  });

  void runRewrite(job);

  return NextResponse.json({ job }, { status: 202 });
}
