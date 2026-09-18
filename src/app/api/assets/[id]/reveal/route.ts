import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { getAssetFileMeta } from "@/lib/assets";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let index = 0;
  try {
    const body = await req.json();
    if (
      typeof body?.index === "number" &&
      Number.isInteger(body.index) &&
      body.index >= 0
    ) {
      index = body.index;
    }
  } catch {}

  if (process.platform !== "win32") {
    return NextResponse.json(
      { code: "Unsupported", message: "Reveal in Explorer is Windows-only." },
      { status: 501 }
    );
  }

  const file = await getAssetFileMeta(id, "result", index);
  if (!file) {
    return NextResponse.json(
      { code: "NotFound", message: "Asset file not found on disk." },
      { status: 404 }
    );
  }

  const child = spawn("explorer.exe", ["/select,", file.absPath], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();
  return NextResponse.json({ ok: true, filename: file.filename });
}
