import { NextRequest, NextResponse } from "next/server";
import { ApiErrorLike, errorStatus } from "@/lib/errors";
import { buildUserPrompt, getSystemPrompt } from "@/lib/director";
import { chat } from "@/lib/chat";
import { requireModel, roleModel } from "@/lib/config";
import { estimateText, priced } from "@/lib/estimate";
import { listCharacters } from "@/lib/characters";
import { listDirectorScripts, recordDirectorRun } from "@/lib/analytics";
import { parseProjectParam } from "@/lib/projects";

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
  parentId?: string;
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
  try {
    const entry = body.model
      ? await requireModel(body.model, "text")
      : await roleModel("director");
    const model = entry.id;
    const all = await listCharacters();
    const wanted = new Set(body.characterIds || []);
    const characters = all.filter((c) => wanted.has(c.id));

    const res = await chat(
      entry,
      [
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
      { temperature: 0.9, maxTokens: 8000 }
    );

    if (!res.ok) {
      return NextResponse.json(res.error, { status: res.status });
    }

    const script = res.text;
    if (!script) {
      return NextResponse.json(
        {
          code: "EmptyResult",
          message: "Model returned success but no script text.",
          requestId: res.requestId || undefined,
        },
        { status: 502 }
      );
    }

    const usage = res.usage;
    const estimate = priced(entry, res.cost ?? estimateText(entry, usage));

    const runId = await recordDirectorRun({
      model,
      premise,
      estimate,
      tokens: usage
        ? (usage.input_tokens || 0) + (usage.output_tokens || 0)
        : null,
      script,
      revised: Boolean(baseScript && instruction),
      instruction: baseScript ? instruction : undefined,
      parentId:
        baseScript && typeof body.parentId === "string"
          ? body.parentId
          : undefined,
      projectId: typeof body.projectId === "string" ? body.projectId : null,
    }).catch(() => null);

    return NextResponse.json({
      id: runId,
      script: script.trim(),
      model,
      usage,
      estimate,
      requestId: res.requestId,
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
