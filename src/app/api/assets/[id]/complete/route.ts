import { NextRequest, NextResponse } from "next/server";
import { completeAsset } from "@/lib/assets";
import type { ImageUsage, VideoUsage } from "@/lib/types";

export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = (await req.json()) as {
      videoUrl?: string;
      imageUrls?: string[];
      usage?: VideoUsage | ImageUsage;
      estimate?: number | null;
      requestId?: string;
    };
    const asset = await completeAsset(id, {
      videoUrl: typeof body.videoUrl === "string" ? body.videoUrl : undefined,
      imageUrls: Array.isArray(body.imageUrls)
        ? body.imageUrls.filter((u) => typeof u === "string")
        : undefined,
      usage: body.usage,
      estimate: body.estimate,
      requestId: body.requestId,
    });
    if (!asset) {
      return NextResponse.json(
        { code: "NotFound", message: "Asset not found or result download failed." },
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
