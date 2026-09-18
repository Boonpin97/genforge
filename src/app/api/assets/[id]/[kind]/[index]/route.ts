import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import type { FileHandle } from "fs/promises";
import { getAssetFileMeta } from "@/lib/assets";

const CHUNK = 256 * 1024;

function fileStream(
  absPath: string,
  start: number,
  end: number
): ReadableStream<Uint8Array> {
  let handle: FileHandle | null = null;
  let pos = start;
  const buf = Buffer.alloc(CHUNK);
  const closeHandle = async () => {
    const h = handle;
    handle = null;
    if (h) await h.close().catch(() => {});
  };
  const close = (c: ReadableStreamDefaultController<Uint8Array>) => {
    try {
      c.close();
    } catch {}
  };
  const fail = (c: ReadableStreamDefaultController<Uint8Array>, e: unknown) => {
    try {
      c.error(e);
    } catch {}
  };
  return new ReadableStream<Uint8Array>({
    async start(c) {
      try {
        handle = await fs.open(absPath, "r");
      } catch (e) {
        fail(c, e);
      }
    },
    async pull(c) {
      try {
        if (!handle) {
          close(c);
          return;
        }
        const remaining = end - pos + 1;
        const len = Math.min(CHUNK, remaining);
        if (len <= 0) {
          await closeHandle();
          close(c);
          return;
        }
        const { bytesRead } = await handle.read(buf, 0, len, pos);
        if (!bytesRead) {
          await closeHandle();
          close(c);
          return;
        }
        pos += bytesRead;
        c.enqueue(new Uint8Array(buf.subarray(0, bytesRead)));
      } catch (e) {
        await closeHandle();
        fail(c, e);
      }
    },
    async cancel() {
      await closeHandle();
    },
  });
}

export async function GET(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; kind: string; index: string }> }
) {
  const { id, kind, index } = await params;
  if (kind !== "result" && kind !== "ref") {
    return NextResponse.json(
      { code: "BadRequest", message: "kind must be result or ref." },
      { status: 400 }
    );
  }
  const file = await getAssetFileMeta(id, kind, Number(index));
  if (!file) {
    return NextResponse.json(
      { code: "NotFound", message: "Asset file not found." },
      { status: 404 }
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": file.contentType,
    "Content-Disposition": `inline; filename="${file.filename}"`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400, immutable",
  };

  const range = req.headers.get("range");
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : 0;
    let end = m[2] ? Number(m[2]) : file.size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      start = 0;
      end = file.size - 1;
    }
    if (!m[1] && m[2]) {
      start = Math.max(0, file.size - Number(m[2]));
      end = file.size - 1;
    }
    if (start >= file.size || end >= file.size || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          ...headers,
          "Content-Range": `bytes */${file.size}`,
        },
      });
    }
    const size = end - start + 1;
    return new NextResponse(fileStream(file.absPath, start, end), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${file.size}`,
        "Content-Length": String(size),
      },
    });
  }

  return new NextResponse(fileStream(file.absPath, 0, file.size - 1), {
    headers: { ...headers, "Content-Length": String(file.size) },
  });
}

export async function HEAD(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; kind: string; index: string }> }
) {
  const res = await GET(req as unknown as NextRequest, ctx);
  return new NextResponse(null, { status: res.status, headers: res.headers });
}
