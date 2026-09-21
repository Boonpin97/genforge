import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { PromptKind, SavedPrompt } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "prompts");
const INDEX_FILE = path.join(DATA_DIR, "index.json");
const ID_RE = /^[0-9a-f-]{36}$/i;

export const MAX_PROMPT_CHARS = 20000;
export const MAX_TITLE_CHARS = 80;

const KINDS: PromptKind[] = ["video", "image", "any"];

export function normalizeKind(value: unknown): PromptKind {
  return KINDS.includes(value as PromptKind) ? (value as PromptKind) : "any";
}

async function readIndex(): Promise<SavedPrompt[]> {
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedPrompt[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(list: SavedPrompt[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INDEX_FILE, JSON.stringify(list, null, 2), "utf8");
}

function titleFrom(text: string): string {
  const firstLine = text.trim().split(/\r?\n/)[0] || "";
  return firstLine.slice(0, MAX_TITLE_CHARS) || "Untitled prompt";
}

export async function listPrompts(
  project?: string | null
): Promise<SavedPrompt[]> {
  const list = await readIndex();
  const filtered =
    project === undefined
      ? list
      : project === null
        ? list.filter((p) => !p.projectId)
        : list.filter((p) => p.projectId === project);
  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}

export async function createPrompt(input: {
  text: string;
  title?: string;
  kind?: unknown;
  projectId?: string | null;
}): Promise<SavedPrompt> {
  const text = input.text.trim().slice(0, MAX_PROMPT_CHARS);
  if (!text) throw new Error("Prompt text is required.");
  const prompt: SavedPrompt = {
    id: randomUUID(),
    text,
    title: (input.title || "").trim().slice(0, MAX_TITLE_CHARS) || titleFrom(text),
    kind: normalizeKind(input.kind),
    projectId: input.projectId ?? null,
    createdAt: Date.now(),
  };
  const list = await readIndex();
  list.unshift(prompt);
  await writeIndex(list);
  return prompt;
}

export async function updatePrompt(
  id: string,
  input: { text?: string; title?: string; kind?: unknown }
): Promise<SavedPrompt | null> {
  if (!ID_RE.test(id)) return null;
  const list = await readIndex();
  const rec = list.find((p) => p.id === id);
  if (!rec) return null;
  if (input.text !== undefined) {
    const text = input.text.trim().slice(0, MAX_PROMPT_CHARS);
    if (!text) throw new Error("Prompt text cannot be empty.");
    rec.text = text;
  }
  if (input.title !== undefined)
    rec.title =
      input.title.trim().slice(0, MAX_TITLE_CHARS) || titleFrom(rec.text);
  if (input.kind !== undefined) rec.kind = normalizeKind(input.kind);
  rec.updatedAt = Date.now();
  await writeIndex(list);
  return rec;
}

export async function setPromptProject(
  id: string,
  projectId: string | null
): Promise<boolean> {
  if (!ID_RE.test(id)) return false;
  const list = await readIndex();
  const rec = list.find((p) => p.id === id);
  if (!rec) return false;
  rec.projectId = projectId;
  await writeIndex(list);
  return true;
}

export async function copyPrompt(
  id: string,
  projectId: string | null
): Promise<SavedPrompt | null> {
  if (!ID_RE.test(id)) return null;
  const list = await readIndex();
  const src = list.find((p) => p.id === id);
  if (!src) return null;
  const copy: SavedPrompt = {
    ...src,
    id: randomUUID(),
    createdAt: Date.now(),
    updatedAt: undefined,
    projectId,
  };
  const fresh = await readIndex();
  fresh.unshift(copy);
  await writeIndex(fresh);
  return copy;
}

export async function deletePrompt(id: string): Promise<boolean> {
  if (!ID_RE.test(id)) return false;
  const list = await readIndex();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  await writeIndex(next);
  return true;
}

export async function assignAllPrompts(projectId: string): Promise<number> {
  const list = await readIndex();
  let n = 0;
  for (const p of list)
    if (!p.projectId) {
      p.projectId = projectId;
      n++;
    }
  if (n) await writeIndex(list);
  return n;
}
