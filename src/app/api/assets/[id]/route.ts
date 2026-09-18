import { NextRequest, NextResponse } from "next/server";
import { deleteAsset } from "@/lib/assets";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ok = await deleteAsset(id);
  if (!ok) {
    return NextResponse.json(
      { code: "NotFound", message: "Asset not found." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
