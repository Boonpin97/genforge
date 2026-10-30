import { NextRequest, NextResponse } from "next/server";
import { deleteAsset, listAssets, setAssetHidden, setAssetPinned } from "@/lib/assets";
import { stopBeforeDelete } from "@/lib/video-retry";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const asset = (await listAssets()).find((a) => a.id === id);
  if (asset) await stopBeforeDelete(asset);
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
  let pinned: boolean | undefined;
  try {
    const body = await req.json();
    if (typeof body?.hidden === "boolean") hidden = body.hidden;
    if (typeof body?.pinned === "boolean") pinned = body.pinned;
  } catch {}
  if (hidden === undefined && pinned === undefined) {
    return NextResponse.json(
      {
        code: "BadRequest",
        message: "Body must include a boolean `hidden` or `pinned`.",
      },
      { status: 400 }
    );
  }
  let ok = true;
  if (hidden !== undefined) ok = await setAssetHidden(id, hidden);
  if (ok && pinned !== undefined) ok = await setAssetPinned(id, pinned);
  if (!ok) {
    return NextResponse.json(
      { code: "NotFound", message: "Asset not found." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, hidden, pinned });
}
