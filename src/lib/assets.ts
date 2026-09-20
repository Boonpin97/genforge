import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { AssetRefMeta, StoredAsset } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "assets");
const INDEX_FILE = path.join(DATA_DIR, "index.json");
const MAX_FILE_BYTES = 300 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

async function readIndex(): Promise<StoredAsset[]> {
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredAsset[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(list: StoredAsset[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INDEX_FILE, JSON.stringify(list, null, 2), "utf8");
}

export async function listAssets(
  project?: string | null
): Promise<StoredAsset[]> {
  const list = await readIndex();
  const filtered =
    project === undefined
      ? list
      : project === null
        ? list.filter((a) => !a.projectId)
        : list.filter((a) => a.projectId === project);
  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}

export async function assignAllAssets(projectId: string): Promise<number> {
  const list = await readIndex();
  let n = 0;
  for (const a of list)
    if (!a.projectId) {
      a.projectId = projectId;
      n++;
    }
  if (n) await writeIndex(list);
  return n;
}

export async function setAssetsProject(
  ids: string[],
  projectId: string | null
): Promise<number> {
  const wanted = new Set(ids);
  const list = await readIndex();
  let n = 0;
  for (const a of list)
    if (wanted.has(a.id)) {
      a.projectId = projectId;
      n++;
    }
  if (n) await writeIndex(list);
  return n;
}

export async function copyAssets(
  ids: string[],
  projectId: string | null
): Promise<StoredAsset[]> {
  const wanted = new Set(ids);
  const list = await readIndex();
  const sources = list.filter(
    (a) => wanted.has(a.id) && (a.projectId ?? null) !== projectId
  );
  const copies: StoredAsset[] = [];
  for (const src of sources) {
    const id = randomUUID();
    const srcDir = path.join(DATA_DIR, src.id);
    const dstDir = path.join(DATA_DIR, id);
    await fs.mkdir(dstDir, { recursive: true });
    for (const f of [
      ...src.results.map((r) => r.file),
      ...src.refs.map((r) => r.file).filter((f): f is string => Boolean(f)),
    ]) {
      try {
        await fs.copyFile(path.join(srcDir, f), path.join(dstDir, f));
      } catch {
        await fs.rm(dstDir, { recursive: true, force: true });
        throw new Error(`Could not duplicate file ${f} of asset ${src.id}.`);
      }
    }
    copies.push({
      ...src,
      id,
      createdAt: Date.now(),
      projectId,
      copiedFrom: src.id,
      status: src.status === "pending" ? "succeeded" : src.status,
      taskId: undefined,
    });
  }
  if (copies.length) {
    const fresh = await readIndex();
    fresh.unshift(...copies);
    await writeIndex(fresh);
  }
  return copies;
}

const EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

const MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "audio/wav": ".wav",
  "audio/mpeg": ".mp3",
};

function mimeFor(file: string): string {
  return EXT_MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function extFor(url: string, contentType: string | null): string {
  const m = /\.(png|jpe?g|webp|bmp|gif|mp4|mov|wav|mp3)(\?|#|$)/i.exec(
    url.split("?")[0]
  );
  if (m) return `.${m[1].toLowerCase().replace("jpeg", "jpg")}`;
  return (contentType && MIME_EXT[contentType.split(";")[0].trim()]) || ".bin";
}

async function downloadTo(
  url: string,
  dest: string
): Promise<{ file: string; mime: string } | null> {
  if (/^data:/i.test(url)) {
    const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(url);
    if (!m) return null;
    try {
      const buf = m[2]
        ? Buffer.from(m[3], "base64")
        : Buffer.from(decodeURIComponent(m[3]), "binary");
      if (buf.byteLength > MAX_FILE_BYTES) return null;
      const mime = m[1]?.trim() || "application/octet-stream";
      const full = `${dest}${MIME_EXT[mime] || ".bin"}`;
      await fs.writeFile(full, buf);
      return { file: path.basename(full), mime };
    } catch {
      return null;
    }
  }
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_FILE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_FILE_BYTES) return null;
    const full = `${dest}${extFor(url, res.headers.get("content-type"))}`;
    await fs.writeFile(full, buf);
    return {
      file: path.basename(full),
      mime: mimeFor(full),
    };
  } catch {
    return null;
  }
}

export type CreateAssetInput = {
  meta: Omit<StoredAsset, "results" | "refs"> & {
    results: string[];
    refs: AssetRefMeta[];
  };
  refFiles: Map<number, { bytes: Buffer; name: string; contentType: string }>;
};

export async function createAsset(
  input: CreateAssetInput
): Promise<StoredAsset> {
  const { meta, refFiles } = input;
  if (!ID_RE.test(meta.id)) {
    throw new Error("Invalid asset id.");
  }
  if (meta.kind !== "video" && meta.kind !== "image") {
    throw new Error("Asset kind must be video or image.");
  }
  const dir = path.join(DATA_DIR, meta.id);
  await fs.mkdir(dir, { recursive: true });

  const results: { file: string; mime: string }[] = [];
  for (let i = 0; i < meta.results.length; i++) {
    const dl = await downloadTo(
      meta.results[i],
      path.join(dir, `result-${i}`)
    );
    if (dl) results.push(dl);
  }

  const refs: AssetRefMeta[] = meta.refs.map((r, i) => {
    const f = refFiles.get(i);
    if (!f) return r;
    const ext =
      MIME_EXT[f.contentType.split(";")[0].trim()] ||
      path.extname(f.name).toLowerCase() ||
      ".bin";
    return { ...r, file: `ref-${i}${ext}`, url: undefined };
  });
  for (const [i, f] of refFiles) {
    const ref = refs[i];
    if (!ref.file) continue;
    await fs.writeFile(path.join(dir, ref.file), f.bytes);
  }

  const asset: StoredAsset = {
    id: meta.id,
    kind: meta.kind,
    model: meta.model,
    prompt: meta.prompt,
    createdAt: meta.createdAt,
    status: meta.status ?? (results.length ? "succeeded" : "pending"),
    error: meta.error,
    taskId: meta.taskId,
    requestId: meta.requestId,
    usage: meta.usage,
    estimate: meta.estimate,
    params: meta.params,
    settings: meta.settings,
    results,
    refs,
    projectId: meta.projectId ?? null,
    copiedFrom: meta.copiedFrom,
  };

  const list = await readIndex();
  list.unshift(asset);
  await writeIndex(list);
  return asset;
}

export async function completeAsset(
  id: string,
  input: {
    videoUrl?: string;
    imageUrls?: string[];
    usage?: StoredAsset["usage"];
    estimate?: number | null;
    requestId?: string;
  }
): Promise<StoredAsset | null> {
  if (!ID_RE.test(id)) return null;
  const list = await readIndex();
  const pos = list.findIndex((a) => a.id === id);
  if (pos === -1) return null;
  const asset = list[pos];
  if (asset.results.length > 0) {
    asset.status = "succeeded";
    asset.error = undefined;
    await writeIndex(list);
    return asset;
  }
  const dir = path.join(DATA_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  const urls = asset.kind === "video"
    ? input.videoUrl ? [input.videoUrl] : []
    : (input.imageUrls || []).slice(0, 8);
  const results: { file: string; mime: string }[] = [];
  for (let i = 0; i < urls.length; i++) {
    const dl = await downloadTo(urls[i], path.join(dir, `result-${i}`));
    if (dl) results.push(dl);
  }
  if (!results.length) return null;
  asset.results = results;
  asset.status = "succeeded";
  asset.error = undefined;
  if (input.usage) asset.usage = input.usage;
  if (input.estimate !== undefined && input.estimate !== null)
    asset.estimate = input.estimate;
  if (input.requestId) asset.requestId = input.requestId;
  list[pos] = asset;
  await writeIndex(list);
  return asset;
}

export async function failAsset(
  id: string,
  error: string
): Promise<StoredAsset | null> {
  if (!ID_RE.test(id)) return null;
  const list = await readIndex();
  const pos = list.findIndex((a) => a.id === id);
  if (pos === -1) return null;
  list[pos] = { ...list[pos], status: "failed", error: error.slice(0, 300) };
  await writeIndex(list);
  return list[pos];
}

export async function setAssetHidden(
  id: string,
  hidden: boolean
): Promise<boolean> {
  const list = await readIndex();
  const asset = list.find((a) => a.id === id);
  if (!asset) return false;
  if (hidden) asset.hidden = true;
  else delete asset.hidden;
  await writeIndex(list);
  return true;
}

export async function deleteAsset(id: string): Promise<boolean> {
  if (!ID_RE.test(id)) return false;
  const list = await readIndex();
  const next = list.filter((a) => a.id !== id);
  if (next.length === list.length) return false;
  await writeIndex(next);
  await fs.rm(path.join(DATA_DIR, id), { recursive: true, force: true });
  return true;
}

export async function clearAssets(): Promise<number> {
  const list = await readIndex();
  await writeIndex([]);
  await fs.rm(DATA_DIR, { recursive: true, force: true });
  return list.length;
}

export async function getAssetFileMeta(
  id: string,
  kind: "result" | "ref",
  index: number
): Promise<{
  absPath: string;
  size: number;
  contentType: string;
  filename: string;
} | null> {
  if (!ID_RE.test(id) || !Number.isInteger(index) || index < 0) return null;
  const list = await readIndex();
  const asset = list.find((a) => a.id === id);
  if (!asset) return null;
  const entry = kind === "result" ? asset.results[index] : undefined;
  const refFile = kind === "ref" ? asset.refs[index]?.file : undefined;
  const file = entry?.file || refFile;
  if (!file) return null;
  const absPath = path.join(DATA_DIR, id, file);
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile()) return null;
    return {
      absPath,
      size: stat.size,
      contentType: entry ? entry.mime : mimeFor(file),
      filename: file,
    };
  } catch {
    return null;
  }
}

export async function getAssetFile(
  id: string,
  kind: "result" | "ref",
  index: number
): Promise<{ bytes: Buffer; contentType: string; filename: string } | null> {
  const meta = await getAssetFileMeta(id, kind, index);
  if (!meta) return null;
  try {
    const bytes = await fs.readFile(meta.absPath);
    return { bytes, contentType: meta.contentType, filename: meta.filename };
  } catch {
    return null;
  }
}
