import type { ApiError } from "./types";
import { providerSettings, readConfig } from "./config";
import { ApiErrorLike } from "./errors";

export { ApiErrorLike };

export async function getBaseUrl(): Promise<string> {
  return (await readConfig()).providers.dashscope.baseUrl;
}

export async function getApiKey(): Promise<string> {
  return (await providerSettings("dashscope")).apiKey;
}

export async function isConfigured(): Promise<boolean> {
  return Boolean((await readConfig()).providers.dashscope.apiKey);
}

export type VideoProvider = "dashscope" | "qwencloud";

export async function getVideoProvider(): Promise<VideoProvider> {
  return (await readConfig()).videoProvider;
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
  const { apiKey: key, baseUrl: base } = await providerSettings(svc);
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
    "The API key was rejected — check the key on the Models page, and for DashScope that it matches the region of the base URL.",
  "missing_api_key":
    "No API key was sent to the provider — add it on the Models page.",
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
