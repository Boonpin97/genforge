import { NextRequest, NextResponse } from "next/server";
import { deleteProject, updateProject } from "@/lib/projects";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { name?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "BadRequest", message: "Invalid JSON body." },
      { status: 400 }
    );
  }
  try {
    const project = await updateProject(id, body);
    if (!project)
      return NextResponse.json(
        { code: "NotFound", message: "Project not found." },
        { status: 404 }
      );
    return NextResponse.json({ project });
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
  const ok = await deleteProject(id);
  if (!ok)
    return NextResponse.json(
      { code: "NotFound", message: "Project not found." },
      { status: 404 }
    );
  return NextResponse.json({ ok: true });
}
