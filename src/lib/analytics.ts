import path from "path";
import { randomUUID } from "crypto";
import { listAssets } from "./assets";
import { listDeletedAssets, videoDurationSec } from "./spend";
import { readJsonArray, withFileLock, writeJsonAtomic } from "./json-file";
import type { CostRecord, DirectorRun } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "analytics");
const RUNS_FILE = path.join(DATA_DIR, "director-runs.json");
const MAX_RUNS = 1000;

function readRuns(): Promise<DirectorRun[]> {
  return readJsonArray<DirectorRun>(RUNS_FILE);
}

function writeRuns(runs: DirectorRun[]): Promise<void> {
  return writeJsonAtomic(RUNS_FILE, runs.slice(0, MAX_RUNS));
}

function locked<T>(fn: () => Promise<T>): Promise<T> {
  return withFileLock(RUNS_FILE, fn);
}

export async function recordDirectorRun(input: {
  model: string;
  premise: string;
  instruction?: string;
  parentId?: string;
  estimate: number | null;
  tokens?: number | null;
  script?: string;
  revised?: boolean;
  kind?: "director" | "rewrite";
  projectId?: string | null;
}): Promise<string> {
  const id = randomUUID();
  const run: DirectorRun = {
    id,
    createdAt: Date.now(),
    model: input.model,
    premise: input.premise.slice(0, 120),
    fullPremise:
      input.premise.length > 120 ? input.premise.slice(0, 4000) : undefined,
    instruction: input.instruction?.slice(0, 4000) || undefined,
    parentId: input.parentId || undefined,
    estimate: input.estimate,
    tokens: input.tokens ?? null,
    script: input.script,
    revised: input.revised,
    kind: input.kind ?? "director",
    projectId: input.projectId ?? null,
  };
  await locked(async () => {
    const runs = await readRuns();
    runs.unshift(run);
    await writeRuns(runs);
  });
  return id;
}

export function assignAllRuns(projectId: string): Promise<number> {
  return locked(async () => {
    const runs = await readRuns();
    let n = 0;
    for (const r of runs)
      if (!r.projectId) {
        r.projectId = projectId;
        n++;
      }
    if (n) await writeRuns(runs);
    return n;
  });
}

export async function setRunsProject(
  ids: string[],
  projectId: string | null
): Promise<number> {
  const wanted = new Set(ids);
  return locked(async () => {
    const runs = await readRuns();
    let n = 0;
    for (const r of runs)
      if (wanted.has(r.id)) {
        r.projectId = projectId;
        n++;
      }
    if (n) await writeRuns(runs);
    return n;
  });
}

export async function copyRuns(
  ids: string[],
  projectId: string | null
): Promise<number> {
  const wanted = new Set(ids);
  return locked(async () => {
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
      await writeRuns(runs);
    }
    return copies.length;
  });
}

export type DirectorScript = {
  id: string;
  createdAt: number;
  premise: string;
  premiseTruncated: boolean;
  instruction?: string;
  parentId?: string;
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
      premise: r.fullPremise ?? r.premise,
      premiseTruncated: !r.fullPremise && r.premise.length >= 120,
      instruction: r.instruction,
      parentId: r.parentId,
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
      used: a.used,
      durationSec: a.kind === "video" ? videoDurationSec(a) : undefined,
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
        used: r.used,
        durationSec: r.durationSec,
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
