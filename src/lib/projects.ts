import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Project, ProjectCounts } from "./types";
import { assignAllAssets, listAssets, setAssetsProject } from "./assets";
import {
  assignAllCharacters,
  listCharacters,
  setCharacterProject,
} from "./characters";
import { assignAllUploads, listUploads, setUploadProject } from "./uploads";
import { assignAllPrompts, listPrompts, setPromptProject } from "./prompts";
import {
  assignAllRuns,
  listDirectorScripts,
  setRunsProject,
} from "./analytics";

const DATA_DIR = path.join(process.cwd(), "data", "projects");
const INDEX_FILE = path.join(DATA_DIR, "index.json");
const ID_RE = /^[0-9a-f-]{36}$/i;

async function readIndex(): Promise<Project[]> {
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Project[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(list: Project[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INDEX_FILE, JSON.stringify(list, null, 2), "utf8");
}

export function parseProjectParam(
  value: string | null
): string | null | undefined {
  if (value === null || value === "") return undefined;
  if (value === "none") return null;
  return value;
}

export async function ensureSeed(): Promise<void> {
  const list = await readIndex();
  if (list.length) return;
  const [assets, scripts, chars, uploads] = await Promise.all([
    listAssets(),
    listDirectorScripts(undefined, 100000),
    listCharacters(),
    listUploads(),
  ]);
  if (!assets.length && !scripts.length && !chars.length && !uploads.length)
    return;
  const now = Date.now();
  const project: Project = {
    id: randomUUID(),
    name: "Project 1",
    createdAt: now,
    updatedAt: now,
  };
  await writeIndex([project]);
  await Promise.all([
    assignAllAssets(project.id),
    assignAllRuns(project.id),
    assignAllCharacters(project.id),
    assignAllUploads(project.id),
    assignAllPrompts(project.id),
  ]);
}

export async function listProjects(): Promise<
  (Project & { counts: ProjectCounts; unassigned?: undefined })[]
> {
  await ensureSeed();
  const list = await readIndex();
  const [assets, scripts, chars, uploads, prompts] = await Promise.all([
    listAssets(),
    listDirectorScripts(undefined, 100000),
    listCharacters(),
    listUploads(),
    listPrompts(),
  ]);
  const countFor = (pid: string | null): ProjectCounts => ({
    assets: assets.filter((a) => (a.projectId ?? null) === pid).length,
    scripts: scripts.filter((s) => (s.projectId ?? null) === pid).length,
    characters: chars.filter((c) => (c.projectId ?? null) === pid).length,
    uploads: uploads.filter((u) => (u.projectId ?? null) === pid).length,
    prompts: prompts.filter((p) => (p.projectId ?? null) === pid).length,
  });
  return list
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => ({ ...p, counts: countFor(p.id) }));
}

export async function unassignedCounts(): Promise<ProjectCounts> {
  const [assets, scripts, chars, uploads, prompts] = await Promise.all([
    listAssets(null),
    listDirectorScripts(null, 100000),
    listCharacters(null),
    listUploads(null),
    listPrompts(null),
  ]);
  return {
    assets: assets.length,
    scripts: scripts.length,
    characters: chars.length,
    uploads: uploads.length,
    prompts: prompts.length,
  };
}

export async function getProject(id: string): Promise<Project | null> {
  if (!ID_RE.test(id)) return null;
  const list = await readIndex();
  return list.find((p) => p.id === id) || null;
}

export async function createProject(input: {
  name: string;
  description?: string;
}): Promise<Project> {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new Error("Project name is required.");
  const now = Date.now();
  const project: Project = {
    id: randomUUID(),
    name,
    description: input.description?.trim().slice(0, 300) || undefined,
    createdAt: now,
    updatedAt: now,
  };
  const list = await readIndex();
  list.unshift(project);
  await writeIndex(list);
  return project;
}

export async function updateProject(
  id: string,
  input: { name?: string; description?: string }
): Promise<Project | null> {
  if (!ID_RE.test(id)) return null;
  const list = await readIndex();
  const pos = list.findIndex((p) => p.id === id);
  if (pos === -1) return null;
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new Error("Project name is required.");
    list[pos].name = name;
  }
  if (input.description !== undefined)
    list[pos].description = input.description.trim().slice(0, 300) || undefined;
  list[pos].updatedAt = Date.now();
  await writeIndex(list);
  return list[pos];
}

export async function deleteProject(id: string): Promise<boolean> {
  if (!ID_RE.test(id)) return false;
  const list = await readIndex();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  await writeIndex(next);
  await Promise.all([
    assignAllToNullAssets(id),
    assignAllToNullRuns(id),
    assignAllToNullChars(id),
    assignAllToNullUploads(id),
    assignAllToNullPrompts(id),
  ]);
  return true;
}

async function assignAllToNullAssets(id: string) {
  const list = await listAssets(id);
  if (!list.length) return;
  await setAssetsProject(
    list.map((a) => a.id),
    null
  );
}

async function assignAllToNullRuns(id: string) {
  const scripts = await listDirectorScripts(id, 100000);
  if (!scripts.length) return;
  await setRunsProject(
    scripts.map((s) => s.id),
    null
  );
}

async function assignAllToNullChars(id: string) {
  const chars = await listCharacters(id);
  for (const c of chars) await setCharacterProject(c.id, null);
}

async function assignAllToNullUploads(id: string) {
  const ups = await listUploads(id);
  for (const u of ups) await setUploadProject(u.id, null);
}

async function assignAllToNullPrompts(id: string) {
  const list = await listPrompts(id);
  for (const p of list) await setPromptProject(p.id, null);
}
