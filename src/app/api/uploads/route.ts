import { NextRequest, NextResponse } from "next/server";
import { clearUploads, createUploads, listUploads } from "@/lib/uploads";
import { parseProjectParam } from "@/lib/projects";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const project = parseProjectParam(req.nextUrl.searchParams.get("project"));
  return NextResponse.json({ uploads: await listUploads(project) });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const files = form
      .getAll("files")
      .filter((f): f is File => f instanceof File);
    if (!files.length) {
      return NextResponse.json(
        { code: "BadRequest", message: "No files provided." },
        { status: 400 }
      );
    }
    const projectIdRaw = form.get("projectId");
    const created = await createUploads(
      await Promise.all(
        files.map(async (f) => ({
          bytes: Buffer.from(await f.arrayBuffer()),
          name: f.name,
          contentType: f.type,
        }))
      ),
      projectIdRaw ? String(projectIdRaw) : null
    );
    if (!created.length) {
      return NextResponse.json(
        {
          code: "UnsupportedFormat",
          message: "Only png/jpeg/webp/bmp/gif images and wav/mp3/ogg/aac/m4a audio ≤20MB.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ uploads: created }, { status: 201 });
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

export async function DELETE() {
  const removed = await clearUploads();
  return NextResponse.json({ ok: true, removed });
}
