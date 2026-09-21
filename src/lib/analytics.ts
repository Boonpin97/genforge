import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { listAssets } from "./assets";
import { listDeletedAssets } from "./spend";
import type { CostRecord, DirectorRun } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "analytics");
const RUNS_FILE = path.join(DATA_DIR, "director-runs.json");
const MAX_RUNS = 1000;

async function readRuns(): Promise<DirectorRun[]> {
  try {
    const raw = await fs.readFile(RUNS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DirectorRun[]) : [];
  } catch {
    return [];
  }
}

export async function recordDirectorRun(input: {
  model: string;
  premise: string;
  estimate: number | null;
  tokens?: number | null;
  script?: string;
  revised?: boolean;
  kind?: "director" | "rewrite";
  projectId?: string | null;
}): Promise<string> {
  const runs = await readRuns();
  const id = randomUUID();
  runs.unshift({
    id,
    createdAt: Date.now(),
    model: input.model,
    premise: input.premise.slice(0, 120),
    estimate: input.estimate,
    tokens: input.tokens ?? null,
    script: input.script,
    revised: input.revised,
    kind: input.kind ?? "director",
    projectId: input.projectId ?? null,
  });
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    RUNS_FILE,
    JSON.stringify(runs.slice(0, MAX_RUNS), null, 2),
    "utf8"
  );
  return id;
}

export async function assignAllRuns(projectId: string): Promise<number> {
  const runs = await readRuns();
  let n = 0;
  for (const r of runs)
    if (!r.projectId) {
      r.projectId = projectId;
      n++;
    }
  if (n)
    await fs.writeFile(
      RUNS_FILE,
      JSON.stringify(runs.slice(0, MAX_RUNS), null, 2),
      "utf8"
    );
  return n;
}

export async function setRunsProject(
  ids: string[],
  projectId: string | null
): Promise<number> {
  const wanted = new Set(ids);
  const runs = await readRuns();
  let n = 0;
  for (const r of runs)
    if (wanted.has(r.id)) {
      r.projectId = projectId;
      n++;
    }
  if (n)
    await fs.writeFile(
      RUNS_FILE,
      JSON.stringify(runs.slice(0, MAX_RUNS), null, 2),
      "utf8"
    );
  return n;
}

export async function copyRuns(
  ids: string[],
  projectId: string | null
): Promise<number> {
  const wanted = new Set(ids);
  const runs = await readRuns();
  const copies: DirectorRun[] = runs
    .filter((r) => wanted.has(r.id) && (r.projectId ?? null) !== projectId)
    .map((r) => ({
      ...r,
      id: randomUUID(),
      createdAt: Date.now(),
      projectId,
      copied: true,
    }));
  if (copies.length) {
    runs.unshift(...copies);
    await fs.writeFile(
      RUNS_FILE,
      JSON.stringify(runs.slice(0, MAX_RUNS), null, 2),
      "utf8"
    );
  }
  return copies.length;
}

export type DirectorScript = {
  id: string;
  createdAt: number;
  premise: string;
  script: string;
  estimate: number | null;
  revised: boolean;
  projectId?: string | null;
};

export async function listDirectorScripts(
  project?: string | null,
  limit = 200
): Promise<DirectorScript[]> {
  const runs = await readRuns();
  return runs
    .filter((r) => r.kind !== "rewrite")
    .filter((r) => typeof r.script === "string" && r.script.length > 0)
    .filter((r) =>
      project === undefined ? true : project === null ? !r.projectId : r.projectId === project
    )
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      premise: r.premise,
      script: r.script as string,
      estimate: r.estimate ?? null,
      revised: Boolean(r.revised),
      projectId: r.projectId ?? null,
    }));
}

export async function listCostRecords(
  project?: string | null
): Promise<CostRecord[]> {
  const [assets, runs, deleted] = await Promise.all([
    listAssets(project),
    readRuns(),
    listDeletedAssets(project),
  ]);
  const live = new Set(assets.map((a) => a.id));
  const scopedRuns =
    project === undefined
      ? runs
      : project === null
        ? runs.filter((r) => !r.projectId)
        : runs.filter((r) => r.projectId === project);
  const records: CostRecord[] = [
    ...assets
      .filter((a) => (a.status ?? "succeeded") !== "pending")
      .filter((a) => !a.copiedFrom)
      .map((a) => ({
      id: a.id,
      kind: a.kind as "video" | "image",
      model: a.model,
      prompt: a.prompt.slice(0, 100),
      createdAt: a.createdAt,
      estimate: a.estimate ?? null,
    })),
    ...deleted
      .filter((r) => !live.has(r.id))
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        model: r.model,
        prompt: r.prompt,
        createdAt: r.createdAt,
        estimate: r.estimate ?? null,
        deleted: true,
      })),
    ...scopedRuns
      .filter((r) => !r.copied)
      .map((r) => ({
      id: r.id,
      kind: (r.kind === "rewrite" ? "rewrite" : "director") as
        | "director"
        | "rewrite",
      model: r.model,
      prompt: r.premise,
      createdAt: r.createdAt,
      estimate: r.estimate ?? null,
    })),
  ];
  return records.sort((a, b) => b.createdAt - a.createdAt);
}
