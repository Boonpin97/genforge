import { NextRequest, NextResponse } from "next/server";
import { getCharacterImage } from "@/lib/characters";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> }
) {
  const { id, index } = await params;
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) {
    return NextResponse.json(
      { code: "BadRequest", message: "Invalid image index." },
      { status: 400 }
    );
  }
  const img = await getCharacterImage(id, i);
  if (!img) {
    return NextResponse.json(
      { code: "NotFound", message: "Image not found." },
      { status: 404 }
    );
  }
  return new NextResponse(new Uint8Array(img.bytes), {
    headers: {
      "Content-Type": img.contentType,
      "Cache-Control": "no-store",
    },
  });
}
