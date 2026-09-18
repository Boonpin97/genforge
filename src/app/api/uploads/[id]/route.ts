import { NextRequest, NextResponse } from "next/server";
import { deleteUpload, setUploadProject } from "@/lib/uploads";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { projectId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "BadRequest", message: "Invalid JSON body." },
      { status: 400 }
    );
  }
  const ok = await setUploadProject(
    id,
    typeof body.projectId === "string" ? body.projectId : null
  );
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
