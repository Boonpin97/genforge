import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { getAssetFileMeta, listAssets } from "@/lib/assets";

export const runtime = "nodejs";

const STAGE_DIR = path.join(process.cwd(), "data", "clipboard");
const KEEP = 20;

function stamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function stage(
  absPath: string,
  filename: string,
  id: string,
  createdAt: number
): Promise<string> {
  const ext = path.extname(filename) || path.extname(absPath) || ".bin";
  // Deliberately says nothing about the content: this name reaches the
  // clipboard and whatever app it is pasted into.
  const name = `genforge-${stamp(createdAt)}-${id.slice(0, 8)}${ext}`;
  const dest = path.join(STAGE_DIR, name);
  await fs.mkdir(STAGE_DIR, { recursive: true });
  try {
    await fs.stat(dest);
    return dest;
  } catch {}
  try {
    await fs.link(absPath, dest);
  } catch {
    await fs.copyFile(absPath, dest);
  }
  try {
    const files = await fs.readdir(STAGE_DIR);
    if (files.length > KEEP) {
      const stats = await Promise.all(
        files.map(async (f) => {
          const p = path.join(STAGE_DIR, f);
          return { p, t: (await fs.stat(p)).mtimeMs };
        })
      );
      stats
        .sort((a, b) => b.t - a.t)
        .slice(KEEP)
        .forEach((s) => void fs.rm(s.p, { force: true }));
    }
  } catch {}
  return dest;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let index = 0;
  try {
    const body = await req.json();
    if (
      typeof body?.index === "number" &&
      Number.isInteger(body.index) &&
      body.index >= 0
    ) {
      index = body.index;
    }
  } catch {}

  if (process.platform !== "win32") {
    return NextResponse.json(
      {
        code: "Unsupported",
        message: "Copying a file to the clipboard is Windows-only.",
      },
      { status: 501 }
    );
  }

  const file = await getAssetFileMeta(id, "result", index);
  if (!file) {
    return NextResponse.json(
      { code: "NotFound", message: "Asset file not found on disk." },
      { status: 404 }
    );
  }

  const asset = (await listAssets()).find((a) => a.id === id);
  let target = file.absPath;
  try {
    target = await stage(
      file.absPath,
      file.filename,
      id,
      asset?.createdAt || Date.now()
    );
  } catch {}

  const quoted = `'${target.replace(/'/g, "''")}'`;
  const code = await new Promise<number>((resolve) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-Command",
        `Set-Clipboard -LiteralPath ${quoted}`,
      ],
      { windowsHide: true, stdio: "ignore" }
    );
    child.on("error", () => resolve(-1));
    child.on("exit", (c) => resolve(c ?? -1));
    const t = setTimeout(() => resolve(-2), 10000);
    t.unref?.();
  });

  if (code !== 0) {
    return NextResponse.json(
      {
        code: "ClipboardFailed",
        message:
          code === -2
            ? "Timed out while writing to the clipboard."
            : "Windows refused the clipboard write.",
      },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, filename: path.basename(target) });
}
