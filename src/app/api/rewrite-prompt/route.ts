import { NextRequest, NextResponse } from "next/server";
import { ApiErrorLike, errorStatus } from "@/lib/errors";
import { buildRewriteUserPrompt, REWRITE_SYSTEM_PROMPT } from "@/lib/rewrite";
import { chat } from "@/lib/chat";
import { getModel, roleModel } from "@/lib/config";
import { estimateText, priced } from "@/lib/estimate";
import {
  createRewriteJob,
  latestOpenRewriteJob,
  patchRewriteJob,
} from "@/lib/rewrite-jobs";
import { recordDirectorRun } from "@/lib/analytics";
import type { RewriteJob } from "@/lib/types";

export const maxDuration = 120;

type Body = {
  prompt?: string;
  inventory?: unknown;
  sig?: unknown;
  thinking?: unknown;
  projectId?: string | null;
};

async function runRewrite(job: RewriteJob): Promise<void> {
  try {
    const entry = await getModel(job.model);
    if (!entry || entry.kind !== "text") {
      await patchRewriteJob(job.id, {
        status: "failed",
        error: `${job.model} is no longer a writing model in the config.`,
      });
      return;
    }
    const res = await chat(
      entry,
      [
        { role: "system", content: REWRITE_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildRewriteUserPrompt(job.prompt, job.inventory),
        },
      ],
      {
        temperature: 0.4,
        maxTokens: 4000,
        enableThinking: job.thinking,
      }
    );

    if (!res.ok) {
      await patchRewriteJob(job.id, { status: "failed", error: res.error.message });
      return;
    }

    const rewrote = res.text;
    if (!rewrote) {
      await patchRewriteJob(job.id, {
        status: "failed",
        error: "Model returned success but no rewritten prompt.",
      });
      return;
    }

    const usage = res.usage;
    const estimate = priced(entry, res.cost ?? estimateText(entry, usage));

    await patchRewriteJob(job.id, {
      status: "succeeded",
      rewrote,
      estimate,
    });

    await recordDirectorRun({
      model: job.model,
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

  let model: string;
  try {
    model = (await roleModel("rewrite")).id;
  } catch (err) {
    if (err instanceof ApiErrorLike)
      return NextResponse.json(err.toApiError(), { status: errorStatus(err) });
    throw err;
  }

  const job = await createRewriteJob({
    prompt,
    inventory,
    sig: typeof body.sig === "string" ? body.sig : "",
    model,
    thinking: body.thinking === true,
    projectId: typeof body.projectId === "string" ? body.projectId : null,
  });

  void runRewrite(job);

  return NextResponse.json({ job }, { status: 202 });
}
