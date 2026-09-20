import { NextRequest, NextResponse } from "next/server";
import { deleteAsset, setAssetHidden } from "@/lib/assets";

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let hidden: boolean | undefined;
  try {
    const body = await req.json();
    if (typeof body?.hidden === "boolean") hidden = body.hidden;
  } catch {}
  if (hidden === undefined) {
    return NextResponse.json(
      { code: "BadRequest", message: "Body must include a boolean `hidden`." },
      { status: 400 }
    );
  }
  const ok = await setAssetHidden(id, hidden);
  if (!ok) {
    return NextResponse.json(
      { code: "NotFound", message: "Asset not found." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, hidden });
}
