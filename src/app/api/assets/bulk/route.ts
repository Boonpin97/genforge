import { NextRequest, NextResponse } from "next/server";
import { copyAssets, setAssetsProject } from "@/lib/assets";

export const maxDuration = 300;

type Body = {
  action?: string;
  ids?: string[];
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
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x) => typeof x === "string").slice(0, 200)
    : [];
  if (!ids.length)
    return NextResponse.json(
      { code: "BadRequest", message: "ids array is required." },
      { status: 400 }
    );
  const projectId =
    typeof body.projectId === "string" ? body.projectId : null;
  try {
    if (body.action === "move") {
      const moved = await setAssetsProject(ids, projectId);
      return NextResponse.json({ ok: true, moved });
    }
    if (body.action === "copy") {
      const copies = await copyAssets(ids, projectId);
      return NextResponse.json({ ok: true, copied: copies.length, copies });
    }
    return NextResponse.json(
      { code: "BadRequest", message: "action must be move or copy." },
      { status: 400 }
    );
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
