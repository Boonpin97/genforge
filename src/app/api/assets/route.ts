import { NextRequest, NextResponse } from "next/server";
import { clearAssets, createAsset, listAssets } from "@/lib/assets";
import { parseProjectParam } from "@/lib/projects";
import type { AssetRefMeta, StoredAsset } from "@/lib/types";

export const maxDuration = 300;

type AssetMeta = Omit<StoredAsset, "results" | "refs"> & {
  results: string[];
  refs: AssetRefMeta[];
};

const REF_FIELD = /^ref-(\d+)$/;

export async function GET(req: NextRequest) {
  const project = parseProjectParam(req.nextUrl.searchParams.get("project"));
  return NextResponse.json({ assets: await listAssets(project) });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const rawMeta = form.get("meta");
    if (typeof rawMeta !== "string") {
      return NextResponse.json(
        { code: "BadRequest", message: "meta JSON field is required." },
        { status: 400 }
      );
    }
    let meta: AssetMeta;
    try {
      meta = JSON.parse(rawMeta);
    } catch {
      return NextResponse.json(
        { code: "BadRequest", message: "meta is not valid JSON." },
        { status: 400 }
      );
    }
    if (!meta?.id || typeof meta.id !== "string") {
      return NextResponse.json(
        { code: "BadRequest", message: "Asset id is required." },
        { status: 400 }
      );
    }
    if (
      Array.isArray(meta.results) &&
      !meta.results.every(
        (u) => /^https?:\/\//i.test(String(u)) || /^data:/i.test(String(u))
      )
    ) {
      return NextResponse.json(
        { code: "BadRequest", message: "Result URLs must be http(s) or data URLs." },
        { status: 400 }
      );
    }

    const refFiles = new Map<
      number,
      { bytes: Buffer; name: string; contentType: string }
    >();
    for (const [key, value] of form.entries()) {
      const m = REF_FIELD.exec(key);
      if (!m || !(value instanceof File)) continue;
      refFiles.set(Number(m[1]), {
        bytes: Buffer.from(await value.arrayBuffer()),
        name: value.name || `ref-${m[1]}`,
        contentType: value.type || "application/octet-stream",
      });
    }

    const asset = await createAsset({
      meta: {
        ...meta,
        results: Array.isArray(meta.results) ? meta.results.slice(0, 8) : [],
        refs: Array.isArray(meta.refs) ? meta.refs.slice(0, 14) : [],
      },
      refFiles,
    });
    return NextResponse.json({ asset }, { status: 201 });
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

export async function DELETE() {
  const removed = await clearAssets();
  return NextResponse.json({ ok: true, removed });
}
