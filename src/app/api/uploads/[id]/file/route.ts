import { NextRequest, NextResponse } from "next/server";
import { getUploadFile } from "@/lib/uploads";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const file = await getUploadFile(id);
  if (!file) {
    return NextResponse.json(
      { code: "NotFound", message: "Upload not found." },
      { status: 404 }
    );
  }
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `inline; filename="${file.filename}"`,
      "Content-Length": String(file.bytes.byteLength),
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
