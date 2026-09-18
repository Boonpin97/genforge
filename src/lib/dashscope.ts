import { promises as fs } from "fs";
import path from "path";
import type { ApiError } from "./types";

/**
 * .env.local must win over OS-level environment variables (Next.js gives
 * precedence to pre-existing process.env values, which is the opposite of
 * what a project-local key should do), so we parse it directly.
 */
let envFileCache: Record<string, string> | null = null;

export async function localEnv(): Promise<Record<string, string>> {
  return envFile();
}

export async function localEnvFresh(): Promise<Record<string, string>> {
  envFileCache = null;
  return envFile();
}

async function envFile(): Promise<Record<string, string>> {
  if (envFileCache) return envFileCache;
  const map: Record<string, string> = {};
  try {
    const raw = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[2] !== "") {
        map[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // no .env.local
  }
  envFileCache = map;
  return map;
}

export function getBaseUrl(): string {
  return (
    process.env.DASHSCOPE_BASE_URL || "https://dashscope-intl.aliyuncs.com"
  ).replace(/\/+$/, "");
}

export async function getApiKey(): Promise<string> {
  const fromFile = (await envFile()).DASHSCOPE_API_KEY;
  const key = fromFile || process.env.DASHSCOPE_API_KEY;
  if (!key) {
    throw new ApiErrorLike(
      "MissingConfig",
      "DASHSCOPE_API_KEY is not set. Add it to .env.local (see .env.example), then restart the dev server."
    );
  }
  return key;
}

export async function isConfigured(): Promise<boolean> {
  try {
    await getApiKey();
    return true;
  } catch {
    return false;
  }
}

export type VideoProvider = "dashscope" | "qwencloud";

export async function getVideoProvider(): Promise<VideoProvider> {
  const fromFile = (await envFile()).VIDEO_PROVIDER;
  const v = (fromFile || process.env.VIDEO_PROVIDER || "").toLowerCase();
  return v === "qwencloud" ? "qwencloud" : "dashscope";
}

export async function getQwencloudBaseUrl(): Promise<string> {
  const fromFile = (await envFile()).QWENCLOUD_BASE_URL;
  return (
    fromFile ||
    process.env.QWENCLOUD_BASE_URL ||
    "https://dashscope-intl.aliyuncs.com"
  ).replace(/\/+$/, "");
}

export async function getQwencloudApiKey(): Promise<string> {
  const fromFile = (await envFile()).QWENCLOUD_API_KEY;
  const key = fromFile || process.env.QWENCLOUD_API_KEY;
  if (!key) {
    throw new ApiErrorLike(
      "MissingConfig",
      "VIDEO_PROVIDER=qwencloud but QWENCLOUD_API_KEY is not set. Add it to .env.local (see .env.example), then restart the server."
    );
  }
  return key;
}

export async function isQwencloudConfigured(): Promise<boolean> {
  try {
    await getQwencloudApiKey();
    return true;
  } catch {
    return false;
  }
}

export class ApiErrorLike extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
  toApiError(): ApiError {
    return { code: this.code, message: this.message };
  }
}

export type DashResponse = {
  status: number;
  body: Record<string, unknown>;
};

async function serviceFetch(
  svc: VideoProvider,
  path: string,
  init: {
    method?: string;
    json?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<DashResponse> {
  const base = svc === "qwencloud" ? await getQwencloudBaseUrl() : getBaseUrl();
  const key = svc === "qwencloud" ? await getQwencloudApiKey() : await getApiKey();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(init.headers || {}),
  };

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method || "GET",
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      cache: "no-store",
    });
  } catch (err) {
    throw new ApiErrorLike(
      "NetworkError",
      `Failed to reach ${svc === "qwencloud" ? "QwenCloud" : "DashScope"} (${base}): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  let body: Record<string, unknown> = {};
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 2000) };
    }
  }
  return { status: res.status, body };
}

export async function dashscope(
  path: string,
  init: {
    method?: string;
    json?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<DashResponse> {
  return serviceFetch("dashscope", path, init);
}

export async function qwencloud(
  path: string,
  init: {
    method?: string;
    json?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<DashResponse> {
  return serviceFetch("qwencloud", path, init);
}

export async function videoService(
  provider: VideoProvider,
  path: string,
  init: {
    method?: string;
    json?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<DashResponse> {
  return serviceFetch(provider, path, init);
}

export function extractError(body: Record<string, unknown>): ApiError {
  const output = (body.output || {}) as Record<string, unknown>;
  const nested = (body.error || {}) as Record<string, unknown>;
  return friendlyError({
    code: String(body.code || output.code || nested.code || "UnknownError"),
    message: String(
      body.message ||
        output.message ||
        nested.message ||
        "Request failed with no error message."
    ),
    requestId: body.request_id
      ? String(body.request_id)
      : body.id
        ? String(body.id)
        : undefined,
  });
}

const FRIENDLY_CODES: Record<string, string> = {
  DataInspectionFailed:
    "Blocked by content moderation — the prompt, a reference image, or the output was flagged as inappropriate. Try rewording the prompt or replacing the references.",
  "data_inspection_failed":
    "Blocked by content moderation — the prompt, a reference image, or the output was flagged as inappropriate. Try rewording the prompt or replacing the references.",
  IPInfringementSuspect:
    "Blocked: the request was flagged as possible intellectual-property infringement (e.g. a copyrighted character or brand).",
  "ip_infringement_suspect":
    "Blocked: the request was flagged as possible intellectual-property infringement (e.g. a copyrighted character or brand).",
  InvalidParameter:
    "The provider rejected one of the request parameters — check prompt length and the reference media (format/size).",
  Throttling: "Rate-limited by the provider — wait a few seconds and retry.",
  "Throttling.RateQuota":
    "Rate quota reached — wait a moment and retry, or lower how many you generate at once.",
  "Throttling.AllocationQuota":
    "Account quota/balance exhausted on the provider — check your DashScope or OpenRouter credits.",
  Arrearage:
    "Provider account is past due (out of credit/balance) — top up your DashScope or OpenRouter account.",
  ContentPolicyViolation:
    "Blocked by the provider's content policy — the prompt or an image was considered inappropriate.",
  InvalidApiKey:
    "The API key was rejected — check DASHSCOPE_API_KEY / OPENROUTER_API_KEY in .env.local and that it matches the region.",
  "missing_api_key":
    "No API key was sent to the provider — add it to .env.local and restart the server.",
  unsupported_model:
    "The requested model id is not available on this provider/account right now.",
};

export function friendlyError(err: ApiError): ApiError {
  if (!err) return err;
  const friendly = err.code ? FRIENDLY_CODES[err.code] : undefined;
  const raw = err.message && err.message !== friendly ? err.message : "";
  const hint =
    raw &&
    /content|polic|nsfw|inappropr|safety|moderation|violat|prohibited|flagged/i.test(
      raw
    ) &&
    !friendly
      ? "The provider flagged this request under its content policy. Try rewording the prompt or swapping the reference media."
      : "";
  const message = friendly || err.message || "Request failed.";
  return {
    ...err,
    message: hint ? `${message} — ${raw} ${hint}` : friendly && raw ? `${message} (provider: ${raw})` : message,
  };
}

export function hasOssMedia(media: { url: string }[]): boolean {
  return media.some((m) => m.url.startsWith("oss://"));
}

/**
 * Uploads a file to DashScope's temporary storage (48h validity) and returns
 * an `oss://` URL usable in `input.media` when the request carries the
 * `X-DashScope-OssResourceResolve: enable` header.
 */
export async function uploadTempFile(
  file: { bytes: Buffer; filename: string; contentType: string },
  model: string,
  svc: VideoProvider = "dashscope"
): Promise<string> {
  const policyRes = await serviceFetch(
    svc,
    `/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`
  );
  const data = policyRes.body.data as Record<string, string> | undefined;
  if (policyRes.status !== 200 || !data || !data.upload_host) {
    throw new ApiErrorLike(
      "UploadPolicyFailed",
      `Could not get upload policy: ${JSON.stringify(policyRes.body).slice(0, 500)}`
    );
  }

  const key = `${data.upload_dir}/${file.filename}`;
  const form = new FormData();
  form.append("OSSAccessKeyId", data.oss_access_key_id);
  form.append("Signature", data.signature);
  form.append("policy", data.policy);
  form.append("key", key);
  form.append("x-oss-object-acl", data.x_oss_object_acl);
  form.append("x-oss-forbid-overwrite", data.x_oss_forbid_overwrite);
  form.append("success_action_status", "200");
  form.append(
    "file",
    new Blob([new Uint8Array(file.bytes)], { type: file.contentType }),
    file.filename
  );

  let uploadRes: Response;
  try {
    uploadRes = await fetch(data.upload_host, { method: "POST", body: form });
  } catch (err) {
    throw new ApiErrorLike(
      "UploadFailed",
      `File upload failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new ApiErrorLike(
      "UploadFailed",
      `File upload failed (HTTP ${uploadRes.status}): ${text.slice(0, 500)}`
    );
  }
  return `oss://${key}`;
}
