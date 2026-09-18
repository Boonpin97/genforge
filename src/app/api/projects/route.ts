import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects, unassignedCounts } from "@/lib/projects";

export const runtime = "nodejs";

export async function GET() {
  const [projects, unassigned] = await Promise.all([
    listProjects(),
    unassignedCounts(),
  ]);
  return NextResponse.json({ projects, unassigned });
}

export async function POST(req: NextRequest) {
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
    const project = await createProject({
      name: body.name || "",
      description: body.description,
    });
    return NextResponse.json({ project }, { status: 201 });
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
