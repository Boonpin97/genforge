import { promises as fs } from "fs";
import path from "path";

const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

type Chains = Map<string, Promise<unknown>>;
const globalChains = globalThis as unknown as { __genforgeFileChains?: Chains };
const chains: Chains = (globalChains.__genforgeFileChains ??= new Map());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function code(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException)?.code;
}

async function retrying<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= 12 || !RETRY_CODES.has(code(err) ?? "")) throw err;
      await sleep(15 * (i + 1));
    }
  }
}

export async function readJsonArray<T>(file: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await retrying(() => fs.readFile(file, "utf8"));
  } catch (err) {
    if (code(err) === "ENOENT") return [];
    throw err;
  }
  if (!raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${path.relative(process.cwd(), file)} is not valid JSON (${
        err instanceof Error ? err.message : String(err)
      }). It was left untouched — fix or restore it.`
    );
  }
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  try {
    await retrying(() => fs.rename(tmp, file));
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function acquireLock(lockFile: string): Promise<void> {
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const h = await fs.open(lockFile, "wx");
      await h.close();
      return;
    } catch (err) {
      if (code(err) !== "EEXIST" && !RETRY_CODES.has(code(err) ?? "")) throw err;
    }
    try {
      const st = await fs.stat(lockFile);
      if (Date.now() - st.mtimeMs > LOCK_STALE_MS || Date.now() > deadline) {
        await fs.rm(lockFile, { force: true });
        continue;
      }
    } catch {
      continue;
    }
    await sleep(25);
  }
}

export function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lockFile = `${file}.lock`;
  const run = async () => {
    await acquireLock(lockFile);
    try {
      return await fn();
    } finally {
      await fs.rm(lockFile, { force: true }).catch(() => {});
    }
  };
  const prev = chains.get(file) ?? Promise.resolve();
  const next = prev.then(run, run);
  chains.set(
    file,
    next.then(
      () => undefined,
      () => undefined
    )
  );
  return next;
}
