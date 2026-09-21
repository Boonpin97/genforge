import { NextRequest, NextResponse } from "next/server";
import { copyUpload, deleteUpload, setUploadProject } from "@/lib/uploads";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { projectId?: string | null; action?: string };
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
    const copy = await copyUpload(id, target);
    if (!copy)
      return NextResponse.json(
        { code: "NotFound", message: "Upload not found." },
        { status: 404 }
      );
    return NextResponse.json({ ok: true, copied: true, upload: copy });
  }
  const ok = await setUploadProject(id, target);
  if (!ok)
    return NextResponse.json(
      { code: "NotFound", message: "Upload not found." },
      { status: 404 }
    );
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok = await deleteUpload(id);
  if (!ok) {
    return NextResponse.json(
      { code: "NotFound", message: "Upload not found." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
