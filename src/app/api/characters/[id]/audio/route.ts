import { NextRequest, NextResponse } from "next/server";
import { getCharacterAudio } from "@/lib/characters";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const audio = await getCharacterAudio(id);
  if (!audio) {
    return NextResponse.json(
      { code: "NotFound", message: "No voice sample for this character." },
      { status: 404 }
    );
  }
  return new NextResponse(new Uint8Array(audio.bytes), {
    headers: {
      "Content-Type": audio.contentType,
      "Cache-Control": "no-store",
    },
  });
}
