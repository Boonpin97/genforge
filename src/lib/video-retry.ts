import { promises as fs } from "fs";
import path from "path";
import {
  extractError,
  friendlyError,
  videoService,
  type DashService,
} from "./dashscope";
import { openrouter } from "./openrouter";
import { withFileLock, writeJsonAtomic } from "./json-file";
import { assetDir, failAsset, setAssetRetry } from "./assets";
import type { ApiError, RetryAttempt, RetryInfo, StoredAsset } from "./types";

export const MAX_SEED = 2147483647;
const ADVANCE_STALE_MS = 90_000;

export type UpstreamVideoRequest = {
  service: DashService | "openrouter";
  path: string;
  headers?: Record<string, string>;
  json: Record<string, unknown>;
};

export type SendResult =
  | { ok: true; taskId: string; requestId: string | null; status: string }
  | { ok: false; status: number; error: ApiError };

export async function sendVideo(req: UpstreamVideoRequest): Promise<SendResult> {
  if (req.service === "openrouter") {
    const res = await openrouter(req.path, { method: "POST", json: req.json });
    const out = res.body as {
      id?: string;
      generation_id?: string;
      error?: { code?: string | number; message?: string } | string;
      data?: { id?: string };
    };
    if (res.status < 200 || res.status >= 300 || out.error) {
      const errObj = typeof out.error === "string" ? { message: out.error } : out.error;
      return {
        ok: false,
        status: res.status >= 400 ? res.status : 502,
        error: friendlyError(
          errObj?.message
            ? {
                code: String(errObj.code || `HTTP_${res.status}`),
                message: errObj.message,
                requestId: out.id,
              }
            : extractError(res.body)
        ),
      };
    }
    const taskId = out.id || out.data?.id;
    if (!taskId)
      return {
        ok: false,
        status: 502,
        error: {
          code: "EmptyResult",
          message: "OpenRouter accepted the job but returned no video id.",
        },
      };
    return { ok: true, taskId, requestId: out.generation_id || null, status: "PENDING" };
  }
  const res = await videoService(req.service, req.path, {
    method: "POST",
    headers: req.headers,
    json: req.json,
  });
  const out = res.body as {
    code?: string;
    output?: { task_id?: string; task_status?: string };
    request_id?: string;
  };
  if (res.status !== 200 || out.code || !out.output?.task_id)
    return {
      ok: false,
      status: res.status >= 400 ? res.status : 502,
      error: extractError(res.body),
    };
  return {
    ok: true,
    taskId: out.output.task_id,
    requestId: out.request_id || null,
    status: out.output.task_status || "PENDING",
  };
}

function withSeed(req: UpstreamVideoRequest, seed: number): UpstreamVideoRequest {
  if (req.service === "openrouter") return { ...req, json: { ...req.json, seed } };
  const parameters = (req.json.parameters || {}) as Record<string, unknown>;
  return { ...req, json: { ...req.json, parameters: { ...parameters, seed } } };
}

type RetryState = {
  request: UpstreamVideoRequest | null;
  max: number | null;
  stopped: boolean;
  done: boolean;
  advancing?: { from: string; at: number };
  attempts: RetryAttempt[];
};

function stateFile(id: string): string | null {
  const dir = assetDir(id);
  return dir ? path.join(dir, "retry.json") : null;
}

async function readState(file: string): Promise<RetryState | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as RetryState;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function hasState(file: string | null): Promise<boolean> {
  if (!file) return false;
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function dropEmptyDir(file: string): Promise<void> {
  await fs.rmdir(path.dirname(file)).catch(() => {});
}

async function writeState(file: string, state: RetryState): Promise<void> {
  await writeJsonAtomic(file, state);
}

function info(s: RetryState): RetryInfo {
  return { max: s.max, stopped: s.stopped, done: s.done, attempts: s.attempts };
}

const FINAL_CODES = new Set([
  "InvalidApiKey",
  "missing_api_key",
  "Arrearage",
  "Throttling.AllocationQuota",
  "unsupported_model",
  "UnknownTask",
  "IPInfringementSuspect",
  "ip_infringement_suspect",
  "AccessDenied",
  "BadRequest",
]);

function seedCanHelp(code: string | undefined): boolean {
  if (!code) return true;
  if (FINAL_CODES.has(code)) return false;
  return !code.startsWith("InvalidParameter") && !code.startsWith("AccessDenied");
}

function submitCanRetryLater(status: number, code: string | undefined): boolean {
  return status === 429 || status >= 500 || Boolean(code && code.startsWith("Throttling") && code !== "Throttling.AllocationQuota");
}

const nextSeed = (seed: number) => (seed >= MAX_SEED ? 0 : seed + 1);

const CANCELLABLE = new Set(["dashscope", "qwencloud", "tokenplan"]);

export async function cancelUpstreamTask(
  service: string | undefined,
  taskId: string | undefined
): Promise<boolean> {
  if (!service || !taskId || !CANCELLABLE.has(service)) return false;
  try {
    const res = await videoService(
      service as DashService,
      `/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`,
      { method: "POST" }
    );
    return res.status === 200 && !(res.body as { code?: string }).code;
  } catch {
    return false;
  }
}

export async function stopBeforeDelete(asset: StoredAsset): Promise<void> {
  if (asset.status !== "pending" || asset.results.length) return;
  const stopped = await stopRetry(asset.id).catch(() => ({ state: "missing" as const }));
  if (stopped.state === "missing")
    await cancelUpstreamTask(asset.pollProvider, asset.taskId);
}

export async function startRetry(
  id: string,
  request: UpstreamVideoRequest,
  max: number | null,
  seed: number,
  taskId: string
): Promise<RetryInfo | null> {
  const file = stateFile(id);
  if (!file) return null;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const state: RetryState = {
    request,
    max,
    stopped: false,
    done: false,
    attempts: [{ seed, taskId, status: "running", at: Date.now() }],
  };
  await withFileLock(file, () => writeState(file, state));
  return info(state);
}

export async function retryRequest(
  ask: { id?: string; max?: number | null } | undefined,
  seed: unknown,
  request: UpstreamVideoRequest,
  taskId: string
): Promise<RetryInfo | null> {
  if (!ask || typeof ask.id !== "string" || typeof seed !== "number") return null;
  const max =
    typeof ask.max === "number" && Number.isInteger(ask.max) && ask.max >= 1
      ? Math.min(ask.max, 10_000)
      : null;
  try {
    return await startRetry(ask.id, request, max, seed, taskId);
  } catch {
    return null;
  }
}

export type RetryStep =
  | { state: "next"; taskId: string; seed: number; retry: RetryInfo }
  | { state: "busy"; retry: RetryInfo }
  | { state: "done"; retry: RetryInfo; error: ApiError }
  | { state: "missing" };

function finalError(s: RetryState, last: ApiError, reason: "stopped" | "max" | "final" | "submit"): ApiError {
  const n = s.attempts.length;
  const tries = `${n} attempt${n === 1 ? "" : "s"}`;
  const prefix =
    reason === "stopped"
      ? `Stopped by you after ${tries}.`
      : reason === "max"
        ? `Gave up after ${tries}, the limit you set.`
        : reason === "submit"
          ? `Gave up after ${tries}: the next attempt was rejected when it was sent.`
          : `Gave up after ${tries}: a new seed cannot fix this error.`;
  return { ...last, message: `${prefix} Last error: ${last.message}` };
}

export async function reportFailure(
  id: string,
  taskId: string,
  error: ApiError
): Promise<RetryStep> {
  const file = stateFile(id);
  if (!file || !(await hasState(file))) return { state: "missing" };

  const plan = await withFileLock(file, async () => {
    const s = await readState(file);
    if (!s) return { kind: "missing" as const };
    const last = s.attempts[s.attempts.length - 1];
    if (!last || last.taskId !== taskId) {
      if (s.done || !last?.taskId)
        return { kind: "done" as const, s, error: { code: "Failed", message: last?.error || error.message } };
      return { kind: "current" as const, s, taskId: last.taskId, seed: last.seed };
    }
    if (s.advancing && Date.now() - s.advancing.at < ADVANCE_STALE_MS)
      return { kind: "busy" as const, s };
    if (last.status === "running") {
      last.status = "failed";
      last.error = error.message.slice(0, 300);
    }
    const reason = s.stopped
      ? ("stopped" as const)
      : s.max !== null && s.attempts.length >= s.max
        ? ("max" as const)
        : !seedCanHelp(error.code)
          ? ("final" as const)
          : null;
    if (reason || !s.request) {
      s.done = true;
      s.request = null;
      delete s.advancing;
      await writeState(file, s);
      return { kind: "done" as const, s, error: finalError(s, error, reason ?? "final") };
    }
    s.advancing = { from: taskId, at: Date.now() };
    await writeState(file, s);
    return { kind: "send" as const, s, request: s.request, seed: nextSeed(last.seed) };
  });

  if (plan.kind === "missing") {
    await dropEmptyDir(file);
    return { state: "missing" };
  }
  if (plan.kind === "busy") return { state: "busy", retry: info(plan.s) };
  if (plan.kind === "current")
    return { state: "next", taskId: plan.taskId, seed: plan.seed, retry: info(plan.s) };
  if (plan.kind === "done") {
    await setAssetRetry(id, { retry: info(plan.s) });
    return { state: "done", retry: info(plan.s), error: plan.error };
  }

  let sent: SendResult;
  try {
    sent = await sendVideo(withSeed(plan.request, plan.seed));
  } catch (e) {
    sent = {
      ok: false,
      status: 503,
      error: { code: "NetworkError", message: e instanceof Error ? e.message : String(e) },
    };
  }

  const result = await withFileLock(file, async () => {
    const s = await readState(file);
    if (!s) return { state: "missing" as const };
    delete s.advancing;
    if (!sent.ok) {
      if (submitCanRetryLater(sent.status, sent.error.code) && !s.stopped) {
        await writeState(file, s);
        return { state: "busy" as const, retry: info(s) };
      }
      s.attempts.push({
        seed: plan.seed,
        status: "failed",
        error: sent.error.message.slice(0, 300),
        at: Date.now(),
      });
      s.done = true;
      s.request = null;
      await writeState(file, s);
      return {
        state: "done" as const,
        retry: info(s),
        error: finalError(s, sent.error, "submit"),
      };
    }
    s.attempts.push({ seed: plan.seed, taskId: sent.taskId, status: "running", at: Date.now() });
    await writeState(file, s);
    return { state: "next" as const, taskId: sent.taskId, seed: plan.seed, retry: info(s) };
  });

  if (result.state === "missing") {
    await dropEmptyDir(file);
    if (sent.ok) await cancelUpstreamTask(plan.request.service, sent.taskId);
    return result;
  }
  await setAssetRetry(id, {
    retry: result.retry,
    ...(result.state === "next" ? { taskId: result.taskId, seed: result.seed } : {}),
  });
  if (result.state === "next" && result.retry.stopped) {
    const stopped = await stopRetry(id);
    if (stopped.state === "stopped" && stopped.cancelled)
      return { state: "done", retry: stopped.retry, error: stopped.error! };
  }
  return result;
}

export async function reportSuccess(id: string, taskId: string): Promise<RetryInfo | null> {
  const file = stateFile(id);
  if (!file || !(await hasState(file))) return null;
  const s = await withFileLock(file, async () => {
    const s = await readState(file);
    if (!s) return null;
    const hit = s.attempts.find((a) => a.taskId === taskId);
    if (!hit) return s;
    hit.status = "succeeded";
    delete hit.error;
    s.done = true;
    s.request = null;
    delete s.advancing;
    await writeState(file, s);
    return s;
  });
  if (!s) return null;
  await setAssetRetry(id, { retry: info(s), taskId, seed: s.attempts.find((a) => a.taskId === taskId)?.seed });
  return info(s);
}

export type StopResult =
  | { state: "stopped"; cancelled: boolean; retry: RetryInfo; error?: ApiError }
  | { state: "missing" };

export async function stopRetry(id: string): Promise<StopResult> {
  const file = stateFile(id);
  if (!file || !(await hasState(file))) return { state: "missing" };
  const first = await withFileLock(file, async () => {
    const s = await readState(file);
    if (!s) return null;
    s.stopped = true;
    await writeState(file, s);
    return s;
  });
  if (!first) return { state: "missing" };
  const last = first.attempts[first.attempts.length - 1];
  const service = first.request?.service;
  const cancelled =
    !first.done && last?.status === "running"
      ? await cancelUpstreamTask(service, last.taskId)
      : false;
  const s = await withFileLock(file, async () => {
    const s = await readState(file);
    if (!s) return null;
    if (cancelled) {
      const hit = s.attempts.find((a) => a.taskId === last?.taskId);
      if (hit && hit.status === "running") hit.status = "cancelled";
      s.done = true;
      s.request = null;
    }
    await writeState(file, s);
    return s;
  });
  if (!s) return { state: "missing" };
  const retry = info(s);
  await setAssetRetry(id, { retry });
  if (!cancelled) return { state: "stopped", cancelled, retry };
  const n = s.attempts.length;
  const error: ApiError = {
    code: "Stopped",
    message: `Stopped by you on attempt ${n}. That attempt was cancelled while it was still queued.`,
  };
  await failAsset(id, error.message);
  return { state: "stopped", cancelled, retry, error };
}
