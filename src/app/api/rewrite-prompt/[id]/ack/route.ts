import { NextResponse } from "next/server";
import { patchRewriteJob } from "@/lib/rewrite-jobs";

export const maxDuration = 30;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await patchRewriteJob(id, { consumed: true });
  if (!job)
    return NextResponse.json(
      { code: "NotFound", message: "Rewrite job not found." },
      { status: 404 }
    );
  return NextResponse.json({ job });
}
