import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { RewriteJob } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "rewrites");
const INDEX_FILE = path.join(DATA_DIR, "index.json");
const ID_RE = /^[0-9a-f-]{36}$/i;
const KEEP = 40;
const STALE_MS = 5 * 60 * 1000;

export const INTERRUPTED_MESSAGE =
  "The rewrite was interrupted before it finished — the server restarted or the request was dropped. Press Rewrite again.";

let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function readIndex(): Promise<RewriteJob[]> {
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RewriteJob[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(list: RewriteJob[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(INDEX_FILE, JSON.stringify(list, null, 2), "utf8");
}

function expire(list: RewriteJob[]): boolean {
  const cutoff = Date.now() - STALE_MS;
  let changed = false;
  for (const job of list) {
    if (job.status === "running" && job.updatedAt < cutoff) {
      job.status = "failed";
      job.error = INTERRUPTED_MESSAGE;
      job.updatedAt = Date.now();
      changed = true;
    }
  }
  return changed;
}

async function load(): Promise<RewriteJob[]> {
  const list = await readIndex();
  if (expire(list)) await writeIndex(list);
  return list;
}

export async function createRewriteJob(input: {
  prompt: string;
  inventory: string[];
  sig: string;
  model: string;
  projectId: string | null;
}): Promise<RewriteJob> {
  return serialize(async () => {
    const now = Date.now();
    const job: RewriteJob = {
      id: randomUUID(),
      projectId: input.projectId,
      status: "running",
      prompt: input.prompt,
      inventory: input.inventory,
      sig: input.sig,
      model: input.model,
      estimate: null,
      createdAt: now,
      updatedAt: now,
      consumed: false,
    };
    const list = await load();
    list.unshift(job);
    await writeIndex(list.slice(0, KEEP));
    return job;
  });
}

export async function patchRewriteJob(
  id: string,
  patch: Partial<Omit<RewriteJob, "id" | "createdAt">>
): Promise<RewriteJob | null> {
  if (!ID_RE.test(id)) return null;
  return serialize(async () => {
    const list = await load();
    const job = list.find((j) => j.id === id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: Date.now() });
    await writeIndex(list);
    return job;
  });
}

export async function getRewriteJob(id: string): Promise<RewriteJob | null> {
  if (!ID_RE.test(id)) return null;
  const list = await load();
  return list.find((j) => j.id === id) || null;
}

export async function latestOpenRewriteJob(
  projectId: string | null
): Promise<RewriteJob | null> {
  const list = await load();
  return (
    list
      .filter((j) => (j.projectId ?? null) === projectId && !j.consumed)
      .sort((a, b) => b.createdAt - a.createdAt)[0] || null
  );
}
