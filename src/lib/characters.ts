import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Character } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "characters");
const INDEX_FILE = path.join(DATA_DIR, "index.json");

async function readIndex(): Promise<Character[]> {
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Character[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(list: Character[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INDEX_FILE, JSON.stringify(list, null, 2), "utf8");
}

export async function listCharacters(
  project?: string | null
): Promise<Character[]> {
  const list = await readIndex();
  const filtered =
    project === undefined
      ? list
      : project === null
        ? list.filter((c) => !c.projectId)
        : list.filter((c) => c.projectId === project);
  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}

export async function setCharacterProject(
  id: string,
  projectId: string | null
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const list = await readIndex();
  const rec = list.find((c) => c.id === id);
  if (!rec) return false;
  rec.projectId = projectId;
  await writeIndex(list);
  return true;
}

export async function copyCharacter(
  id: string,
  projectId: string | null
): Promise<Character | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const list = await readIndex();
  const src = list.find((c) => c.id === id);
  if (!src) return null;
  const newId = randomUUID();
  const srcDir = path.join(DATA_DIR, src.id);
  const dstDir = path.join(DATA_DIR, newId);
  await fs.mkdir(dstDir, { recursive: true });
  try {
    const entries = await fs.readdir(srcDir);
    for (const f of entries)
      await fs.copyFile(path.join(srcDir, f), path.join(dstDir, f));
  } catch {
    await fs.rm(dstDir, { recursive: true, force: true });
    throw new Error(`Could not duplicate the files of character ${src.id}.`);
  }
  const copy: Character = {
    ...src,
    id: newId,
    createdAt: Date.now(),
    updatedAt: undefined,
    projectId,
  };
  const fresh = await readIndex();
  fresh.push(copy);
  await writeIndex(fresh);
  return copy;
}

export async function assignAllCharacters(projectId: string): Promise<number> {
  const list = await readIndex();
  let n = 0;
  for (const c of list)
    if (!c.projectId) {
      c.projectId = projectId;
      n++;
    }
  if (n) await writeIndex(list);
  return n;
}

export type StoredFile = {
  name: string;
  bytes: Buffer;
  contentType: string;
};

function extFor(contentType: string, fallback: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
  };
  return map[contentType] || fallback;
}

export async function createCharacter(input: {
  name: string;
  description: string;
  images: StoredFile[];
  audio?: StoredFile;
  projectId?: string | null;
}): Promise<Character> {
  const id = randomUUID();
  const dir = path.join(DATA_DIR, id);
  await fs.mkdir(dir, { recursive: true });

  for (let i = 0; i < input.images.length; i++) {
    const img = input.images[i];
    await fs.writeFile(
      path.join(dir, `img-${i}${extFor(img.contentType, ".png")}`),
      img.bytes
    );
  }
  if (input.audio) {
    await fs.writeFile(
      path.join(dir, `audio${extFor(input.audio.contentType, ".mp3")}`),
      input.audio.bytes
    );
  }

  const character: Character = {
    id,
    name: input.name,
    description: input.description,
    imageCount: input.images.length,
    hasAudio: Boolean(input.audio),
    createdAt: Date.now(),
    projectId: input.projectId ?? null,
  };
  const list = await readIndex();
  list.push(character);
  await writeIndex(list);
  return character;
}

export async function deleteCharacter(id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const list = await readIndex();
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) return false;
  await writeIndex(next);
  await fs.rm(path.join(DATA_DIR, id), { recursive: true, force: true });
  return true;
}

export async function updateCharacter(
  id: string,
  input: {
    name?: string;
    description?: string;
    keepImageIndices?: number[];
    newImages?: StoredFile[];
    audio?: StoredFile;
    removeAudio?: boolean;
  }
): Promise<Character | "invalid"> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return "invalid";
  const list = await readIndex();
  const pos = list.findIndex((c) => c.id === id);
  if (pos === -1) return "invalid";
  const current = list[pos];
  const dir = path.join(DATA_DIR, id);

  const existing = await findFiles(id, "img-");
  const keep =
    input.keepImageIndices ?? existing.map((_, i) => i);
  const kept: { bytes: Buffer; contentType: string }[] = [];
  for (const i of keep) {
    if (!Number.isInteger(i) || i < 0 || i >= existing.length) continue;
    kept.push({
      bytes: await fs.readFile(existing[i]),
      contentType: contentTypeFor(existing[i]),
    });
  }
  const finalImages = [...kept, ...(input.newImages || [])];
  if (finalImages.length === 0 || finalImages.length > 6) return "invalid";

  for (const f of existing) await fs.rm(f, { force: true });
  for (let i = 0; i < finalImages.length; i++) {
    const img = finalImages[i];
    await fs.writeFile(
      path.join(dir, `img-${i}${extFor(img.contentType, ".png")}`),
      img.bytes
    );
  }

  let hasAudio = current.hasAudio;
  if (input.removeAudio) {
    for (const f of await findFiles(id, "audio")) await fs.rm(f, { force: true });
    hasAudio = false;
  }
  if (input.audio) {
    for (const f of await findFiles(id, "audio")) await fs.rm(f, { force: true });
    await fs.writeFile(
      path.join(dir, `audio${extFor(input.audio.contentType, ".mp3")}`),
      input.audio.bytes
    );
    hasAudio = true;
  }

  const updated: Character = {
    ...current,
    name: input.name?.trim() || current.name,
    description: input.description?.trim() ?? current.description,
    imageCount: finalImages.length,
    hasAudio,
    updatedAt: Date.now(),
  };
  list[pos] = updated;
  await writeIndex(list);
  return updated;
}

async function findFiles(id: string, prefix: string): Promise<string[]> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return [];
  const dir = path.join(DATA_DIR, id);
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((f) => f.startsWith(prefix))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

export async function getCharacterImage(
  id: string,
  index: number
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const files = await findFiles(id, "img-");
  const file = files[index];
  if (!file) return null;
  const bytes = await fs.readFile(file);
  return { bytes, contentType: contentTypeFor(file) };
}

export async function getCharacterAudio(
  id: string
): Promise<{ bytes: Buffer; contentType: string; filename: string } | null> {
  const files = await findFiles(id, "audio");
  const file = files[0];
  if (!file) return null;
  const bytes = await fs.readFile(file);
  return {
    bytes,
    contentType: contentTypeFor(file),
    filename: path.basename(file),
  };
}

function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
  };
  return map[ext] || "application/octet-stream";
}
