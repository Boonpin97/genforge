import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { UploadRecord } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "uploads");
const INDEX_FILE = path.join(DATA_DIR, "index.json");
const MAX_BYTES = 20 * 1024 * 1024;

const IMAGE_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
};
const AUDIO_EXT: Record<string, string> = {
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/ogg": ".ogg",
  "audio/aac": ".aac",
  "audio/mp4": ".m4a",
};
const EXT_MIME: Record<string, string> = Object.fromEntries(
  [...Object.entries(IMAGE_EXT), ...Object.entries(AUDIO_EXT)].map(
    ([mime, ext]) => [ext, mime]
  )
);

async function readIndex(): Promise<UploadRecord[]> {
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UploadRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(list: UploadRecord[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INDEX_FILE, JSON.stringify(list, null, 2), "utf8");
}

export function classifyMime(mime: string, name: string): "image" | "audio" | null {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (m.startsWith("video/")) return null;
  if (IMAGE_EXT[m] || AUDIO_EXT[m])
    return IMAGE_EXT[m] ? "image" : "audio";
  const ext = path.extname(name).toLowerCase();
  const byExt: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".aac": "audio/aac",
    ".m4a": "audio/mp4",
  };
  const guessed = byExt[ext];
  if (!guessed) return null;
  return guessed.startsWith("image/") ? "image" : "audio";
}

export async function listUploads(
  project?: string | null
): Promise<UploadRecord[]> {
  const list = await readIndex();
  const filtered =
    project === undefined
      ? list
      : project === null
        ? list.filter((u) => !u.projectId)
        : list.filter((u) => u.projectId === project);
  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}

export async function setUploadProject(
  id: string,
  projectId: string | null
): Promise<boolean> {
  const list = await readIndex();
  const rec = list.find((u) => u.id === id);
  if (!rec) return false;
  rec.projectId = projectId;
  await writeIndex(list);
  return true;
}

export async function copyUpload(
  id: string,
  projectId: string | null
): Promise<UploadRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const list = await readIndex();
  const src = list.find((u) => u.id === id);
  if (!src) return null;
  const newId = randomUUID();
  const ext = path.extname(src.filename);
  const filename = `${newId}${ext}`;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.copyFile(
    path.join(DATA_DIR, src.filename),
    path.join(DATA_DIR, filename)
  );
  const copy: UploadRecord = {
    ...src,
    id: newId,
    filename,
    createdAt: Date.now(),
    projectId,
  };
  const fresh = await readIndex();
  fresh.unshift(copy);
  await writeIndex(fresh);
  return copy;
}

export async function assignAllUploads(projectId: string): Promise<number> {
  const list = await readIndex();
  let n = 0;
  for (const u of list)
    if (!u.projectId) {
      u.projectId = projectId;
      n++;
    }
  if (n) await writeIndex(list);
  return n;
}

export async function createUploads(
  files: { bytes: Buffer; name: string; contentType: string }[],
  projectId?: string | null
): Promise<UploadRecord[]> {
  const created: UploadRecord[] = [];
  for (const f of files) {
    const kind = classifyMime(f.contentType, f.name);
    if (!kind) continue;
    if (f.bytes.byteLength > MAX_BYTES) continue;
    const id = randomUUID();
    const mime =
      f.contentType.split(";")[0].trim() ||
      EXT_MIME[path.extname(f.name).toLowerCase()] ||
      (kind === "image" ? "image/png" : "audio/mpeg");
    const ext =
      (kind === "image" ? IMAGE_EXT[mime] : AUDIO_EXT[mime]) ||
      path.extname(f.name).toLowerCase() ||
      (kind === "image" ? ".png" : ".mp3");
    const filename = `${id}${ext}`;
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(path.join(DATA_DIR, filename), f.bytes);
    created.push({
      id,
      kind,
      filename,
      name: f.name || filename,
      mime,
      size: f.bytes.byteLength,
      createdAt: Date.now(),
      projectId: projectId ?? null,
    });
  }
  if (created.length) {
    const list = await readIndex();
    list.unshift(...created);
    await writeIndex(list);
  }
  return created;
}

export async function deleteUpload(id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const list = await readIndex();
  const next = list.filter((u) => u.id !== id);
  if (next.length === list.length) return false;
  await writeIndex(next);
  const removed = list.find((u) => u.id === id);
  if (removed)
    await fs.rm(path.join(DATA_DIR, removed.filename), { force: true });
  return true;
}

export async function clearUploads(): Promise<number> {
  const list = await readIndex();
  await writeIndex([]);
  await fs.rm(DATA_DIR, { recursive: true, force: true });
  return list.length;
}

export async function getUploadFile(
  id: string
): Promise<{ bytes: Buffer; contentType: string; filename: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const list = await readIndex();
  const rec = list.find((u) => u.id === id);
  if (!rec) return null;
  try {
    const bytes = await fs.readFile(path.join(DATA_DIR, rec.filename));
    return { bytes, contentType: rec.mime, filename: rec.filename };
  } catch {
    return null;
  }
}
