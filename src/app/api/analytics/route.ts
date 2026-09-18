import { NextRequest, NextResponse } from "next/server";
import { listCostRecords } from "@/lib/analytics";
import { parseProjectParam } from "@/lib/projects";

export async function GET(req: NextRequest) {
  const project = parseProjectParam(req.nextUrl.searchParams.get("project"));
  return NextResponse.json({ records: await listCostRecords(project) });
}
