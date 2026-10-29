import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { readJsonArray, withFileLock, writeJsonAtomic } from "./json-file";
import type { Character, CharacterLook } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "characters");
const INDEX_FILE = path.join(DATA_DIR, "index.json");
const LOOK_ID = /^[a-z0-9]{1,16}$/i;
export const MAX_LOOKS = 12;

function syncFromLooks(c: Character): Character {
  const looks = c.looks?.length ? c.looks : [];
  const active = looks.find((l) => l.id === c.activeLookId) ?? looks[0];
  if (!active) return c;
  return {
    ...c,
    activeLookId: active.id,
    description: active.description,
    imageCount: active.imageCount,
  };
}

function normalize(c: Character): Character {
  if (!Array.isArray(c.looks) || !c.looks.length)
    return syncFromLooks({
      ...c,
      looks: [
        {
          id: "main",
          name: "Default",
          description: c.description || "",
          imageCount: c.imageCount || 0,
        },
      ],
    });
  const found = c.looks.find((l) => l.id === c.activeLookId) ?? c.looks[0];
  const active: CharacterLook = {
    ...found,
    description: c.description ?? found.description,
    imageCount: c.imageCount ?? found.imageCount,
  };
  return syncFromLooks({
    ...c,
    looks: c.looks.map((l) => (l.id === active.id ? active : l)),
    activeLookId: active.id,
  });
}

function imagePrefix(lookId: string): string {
  return lookId === "main" ? "img-" : `look-${lookId}-img-`;
}

async function readIndex(): Promise<Character[]> {
  return (await readJsonArray<Character>(INDEX_FILE)).map(normalize);
}

function writeIndex(list: Character[]): Promise<void> {
  return writeJsonAtomic(INDEX_FILE, list);
}

function locked<T>(fn: () => Promise<T>): Promise<T> {
  return withFileLock(INDEX_FILE, fn);
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
  return locked(async () => {
    const list = await readIndex();
    const rec = list.find((c) => c.id === id);
    if (!rec) return false;
    rec.projectId = projectId;
    await writeIndex(list);
    return true;
  });
}

export async function setCharacterHidden(
  id: string,
  hidden: boolean
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  return locked(async () => {
    const list = await readIndex();
    const rec = list.find((c) => c.id === id);
    if (!rec) return false;
    rec.hidden = hidden || undefined;
    await writeIndex(list);
    return true;
  });
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
  await locked(async () => {
    const fresh = await readIndex();
    fresh.push(copy);
    await writeIndex(fresh);
  });
  return copy;
}

export async function assignAllCharacters(projectId: string): Promise<number> {
  return locked(async () => {
    const list = await readIndex();
    let n = 0;
    for (const c of list)
      if (!c.projectId) {
        c.projectId = projectId;
        n++;
      }
    if (n) await writeIndex(list);
    return n;
  });
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
  lookName?: string;
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

  const character: Character = syncFromLooks({
    id,
    name: input.name,
    description: input.description,
    imageCount: input.images.length,
    hasAudio: Boolean(input.audio),
    createdAt: Date.now(),
    projectId: input.projectId ?? null,
    looks: [
      {
        id: "main",
        name: input.lookName?.trim() || "Default",
        description: input.description,
        imageCount: input.images.length,
      },
    ],
    activeLookId: "main",
  });
  await locked(async () => {
    const list = await readIndex();
    list.push(character);
    await writeIndex(list);
  });
  return character;
}

export async function deleteCharacter(id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  return locked(async () => {
    const list = await readIndex();
    const next = list.filter((c) => c.id !== id);
    if (next.length === list.length) return false;
    await writeIndex(next);
    await fs.rm(path.join(DATA_DIR, id), { recursive: true, force: true });
    return true;
  });
}

export async function updateCharacter(
  id: string,
  input: {
    name?: string;
    description?: string;
    lookId?: string;
    lookName?: string;
    keepImageIndices?: number[];
    newImages?: StoredFile[];
    audio?: StoredFile;
    removeAudio?: boolean;
  }
): Promise<Character | "invalid"> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return "invalid";
  return locked(async () => {
    const list = await readIndex();
    const pos = list.findIndex((c) => c.id === id);
    if (pos === -1) return "invalid";
    const current = list[pos];
    const dir = path.join(DATA_DIR, id);
    const looks = [...(current.looks ?? [])];

    let look: CharacterLook | undefined;
    if (input.lookId === "new") {
      if (looks.length >= MAX_LOOKS) return "invalid";
      look = {
        id: randomUUID().replace(/-/g, "").slice(0, 10),
        name: "",
        description: "",
        imageCount: 0,
      };
      looks.push(look);
    } else {
      look = looks.find((l) => l.id === (input.lookId ?? current.activeLookId));
    }
    if (!look) return "invalid";
    const prefix = imagePrefix(look.id);

    const existing = await findFiles(id, prefix);
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
        path.join(dir, `${prefix}${i}${extFor(img.contentType, ".png")}`),
        img.bytes
      );
    }

    const now = Date.now();
    const lookPos = looks.findIndex((l) => l.id === look.id);
    looks[lookPos] = {
      ...look,
      name:
        input.lookName?.trim() || look.name || `Look ${lookPos + 1}`,
      description: input.description?.trim() ?? look.description,
      imageCount: finalImages.length,
      updatedAt: now,
    };

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

    const updated: Character = syncFromLooks({
      ...current,
      name: input.name?.trim() || current.name,
      looks,
      activeLookId:
        input.lookId === "new" ? look.id : current.activeLookId,
      hasAudio,
      updatedAt: now,
    });
    list[pos] = updated;
    await writeIndex(list);
    return updated;
  });
}

export async function setActiveLook(
  id: string,
  lookId: string
): Promise<Character | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !LOOK_ID.test(lookId)) return null;
  return locked(async () => {
    const list = await readIndex();
    const pos = list.findIndex((c) => c.id === id);
    if (pos === -1) return null;
    if (!list[pos].looks?.some((l) => l.id === lookId)) return null;
    list[pos] = syncFromLooks({
      ...list[pos],
      activeLookId: lookId,
      updatedAt: Date.now(),
    });
    await writeIndex(list);
    return list[pos];
  });
}

export async function deleteLook(
  id: string,
  lookId: string
): Promise<Character | "last" | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !LOOK_ID.test(lookId)) return null;
  return locked(async () => {
    const list = await readIndex();
    const pos = list.findIndex((c) => c.id === id);
    if (pos === -1) return null;
    const looks = list[pos].looks ?? [];
    if (!looks.some((l) => l.id === lookId)) return null;
    if (looks.length <= 1) return "last";
    for (const f of await findFiles(id, imagePrefix(lookId)))
      await fs.rm(f, { force: true });
    list[pos] = syncFromLooks({
      ...list[pos],
      looks: looks.filter((l) => l.id !== lookId),
      updatedAt: Date.now(),
    });
    await writeIndex(list);
    return list[pos];
  });
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
  index: number,
  lookId?: string | null
): Promise<{ bytes: Buffer; contentType: string } | null> {
  let look = lookId;
  if (!look) {
    const rec = (await readIndex()).find((c) => c.id === id);
    if (!rec) return null;
    look = rec.activeLookId ?? "main";
  }
  if (!LOOK_ID.test(look)) return null;
  const files = await findFiles(id, imagePrefix(look));
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
