import { NextResponse } from "next/server";
import { getRewriteJob } from "@/lib/rewrite-jobs";

export const maxDuration = 30;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getRewriteJob(id);
  if (!job)
    return NextResponse.json(
      { code: "NotFound", message: "Rewrite job not found." },
      { status: 404 }
    );
  return NextResponse.json({ job });
}
