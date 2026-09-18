import { NextRequest, NextResponse } from "next/server";
import { failAsset } from "@/lib/assets";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as { message?: string };
    const asset = await failAsset(id, body.message || "Generation failed");
    if (!asset) {
      return NextResponse.json(
        { code: "NotFound", message: "Asset not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ asset });
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
