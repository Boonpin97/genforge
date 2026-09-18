import { NextRequest, NextResponse } from "next/server";
import { copyRuns, setRunsProject } from "@/lib/analytics";

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
  if (body.action === "move") {
    const moved = await setRunsProject(ids, projectId);
    return NextResponse.json({ ok: true, moved });
  }
  if (body.action === "copy") {
    const copied = await copyRuns(ids, projectId);
    return NextResponse.json({ ok: true, copied });
  }
  return NextResponse.json(
    { code: "BadRequest", message: "action must be move or copy." },
    { status: 400 }
  );
}
