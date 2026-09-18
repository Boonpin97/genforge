import { NextRequest, NextResponse } from "next/server";
import {
  ApiErrorLike,
  dashscope,
  extractError,
  friendlyError,
} from "@/lib/dashscope";
import {
  buildUserPrompt,
  DIRECTOR_MODEL,
  DIRECTOR_MODELS,
  getSystemPrompt,
} from "@/lib/director";
import { listCharacters } from "@/lib/characters";
import { listDirectorScripts, recordDirectorRun } from "@/lib/analytics";
import { parseProjectParam } from "@/lib/projects";
import { estimateDirectorCost } from "@/lib/pricing";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const project = parseProjectParam(req.nextUrl.searchParams.get("project"));
  return NextResponse.json({
    scripts: await listDirectorScripts(project),
  });
}

type Body = {
  premise?: string;
  characterIds?: string[];
  extraCast?: string;
  baseScript?: string;
  instruction?: string;
  model?: string;
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

  const premise = (body.premise || "").trim();
  if (!premise) {
    return NextResponse.json(
      { code: "BadRequest", message: "A premise is required." },
      { status: 400 }
    );
  }
  const baseScript = (body.baseScript || "").trim();
  const instruction = (body.instruction || "").trim();
  if (baseScript && !instruction) {
    return NextResponse.json(
      { code: "BadRequest", message: "An instruction is required when revising." },
      { status: 400 }
    );
  }
  const model =
    typeof body.model === "string" &&
    (DIRECTOR_MODELS as readonly string[]).includes(body.model)
      ? body.model
      : DIRECTOR_MODEL;

  try {
    const all = await listCharacters();
    const wanted = new Set(body.characterIds || []);
    const characters = all.filter((c) => wanted.has(c.id));

    const res = await dashscope("/compatible-mode/v1/chat/completions", {
      method: "POST",
      json: {
        model,
        messages: [
          { role: "system", content: getSystemPrompt() },
          {
            role: "user",
                content: buildUserPrompt({
                  premise,
                  characters,
                  extraCast: body.extraCast,
                  baseScript: baseScript || undefined,
                  instruction: instruction || undefined,
                }),
          },
        ],
        temperature: 0.9,
        max_tokens: 8000,
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

    const script = out.choices?.[0]?.message?.content ?? "";
    if (!script.trim()) {
      return NextResponse.json(
        {
          code: "EmptyResult",
          message: "Model returned success but no script text.",
          requestId: out.id,
        },
        { status: 502 }
      );
    }

    const usage = out.usage
      ? { input_tokens: out.usage.prompt_tokens, output_tokens: out.usage.completion_tokens }
      : null;
    const estimate = usage ? estimateDirectorCost(usage) : null;

    const runId = await recordDirectorRun({
      model,
      premise,
      estimate,
      tokens: usage
        ? (usage.input_tokens || 0) + (usage.output_tokens || 0)
        : null,
      script,
      revised: Boolean(baseScript && instruction),
      projectId: typeof body.projectId === "string" ? body.projectId : null,
    }).catch(() => null);

    return NextResponse.json({
      id: runId,
      script: script.trim(),
      model,
      usage,
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
