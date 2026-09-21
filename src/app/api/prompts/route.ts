import { NextRequest, NextResponse } from "next/server";
import { createPrompt, listPrompts } from "@/lib/prompts";
import { parseProjectParam } from "@/lib/projects";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const project = parseProjectParam(req.nextUrl.searchParams.get("project"));
  return NextResponse.json({ prompts: await listPrompts(project) });
}

export async function POST(req: NextRequest) {
  let body: {
    text?: unknown;
    title?: unknown;
    kind?: unknown;
    projectId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "BadRequest", message: "Invalid JSON body." },
      { status: 400 }
    );
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json(
      { code: "BadRequest", message: "A prompt needs some text." },
      { status: 400 }
    );
  }
  try {
    const prompt = await createPrompt({
      text: body.text,
      title: typeof body.title === "string" ? body.title : undefined,
      kind: body.kind,
      projectId:
        typeof body.projectId === "string" &&
        body.projectId !== "" &&
        body.projectId !== "none"
          ? body.projectId
          : null,
    });
    return NextResponse.json({ prompt }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        code: "InternalError",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
