import { ApiErrorLike, localEnvFresh } from "./dashscope";

export const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.1-flash-image";

export function getOpenRouterBaseUrl(): string {
  return (
    process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
  ).replace(/\/+$/, "");
}

export function getOpenRouterModel(): string {
  return process.env.OPENROUTER_IMAGE_MODEL || DEFAULT_OPENROUTER_MODEL;
}

export async function getOpenRouterApiKey(): Promise<string> {
  const key =
    (await localEnvFresh()).OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new ApiErrorLike(
      "MissingConfig",
      "OPENROUTER_API_KEY is not set. Add it to .env.local (see .env.example), then restart the dev server."
    );
  }
  return key;
}

export async function isOpenRouterConfigured(): Promise<boolean> {
  try {
    await getOpenRouterApiKey();
    return true;
  } catch {
    return false;
  }
}

export type OpenRouterResponse = {
  status: number;
  body: Record<string, unknown>;
};

export async function openrouter(
  path: string,
  init: { method?: string; json?: unknown } = {}
): Promise<OpenRouterResponse> {
  const key = await getOpenRouterApiKey();
  const res = await fetch(`${getOpenRouterBaseUrl()}${path}`, {
    method: init.method || "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  });
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return { status: res.status, body };
}
