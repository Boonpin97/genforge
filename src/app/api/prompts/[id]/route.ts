import { NextRequest, NextResponse } from "next/server";
import {
  copyPrompt,
  deletePrompt,
  setPromptProject,
  updatePrompt,
} from "@/lib/prompts";

export const maxDuration = 30;

const notFound = () =>
  NextResponse.json(
    { code: "NotFound", message: "Prompt not found." },
    { status: 404 }
  );

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: {
    action?: unknown;
    projectId?: unknown;
    text?: unknown;
    title?: unknown;
    kind?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "BadRequest", message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const raw = typeof body.projectId === "string" ? body.projectId : null;
  const target = raw === "" || raw === "none" ? null : raw;

  if (body.action === "copy") {
    const copy = await copyPrompt(id, target);
    if (!copy) return notFound();
    return NextResponse.json({ ok: true, copied: true, prompt: copy });
  }
  if (body.action === "move") {
    const ok = await setPromptProject(id, target);
    if (!ok) return notFound();
    return NextResponse.json({ ok: true, moved: true });
  }

  try {
    const updated = await updatePrompt(id, {
      text: typeof body.text === "string" ? body.text : undefined,
      title: typeof body.title === "string" ? body.title : undefined,
      kind: body.kind,
    });
    if (!updated) return notFound();
    return NextResponse.json({ ok: true, prompt: updated });
  } catch (err) {
    return NextResponse.json(
      {
        code: "BadRequest",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok = await deletePrompt(id);
  if (!ok) return notFound();
  return NextResponse.json({ ok: true });
}
