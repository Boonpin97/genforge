import { providerSettings, readConfig } from "./config";

export async function getOpenRouterApiKey(): Promise<string> {
  return (await providerSettings("openrouter")).apiKey;
}

export async function isOpenRouterConfigured(): Promise<boolean> {
  return Boolean((await readConfig()).providers.openrouter.apiKey);
}

export type OpenRouterResponse = {
  status: number;
  body: Record<string, unknown>;
};

export async function openrouter(
  path: string,
  init: { method?: string; json?: unknown } = {}
): Promise<OpenRouterResponse> {
  const { apiKey: key, baseUrl } = await providerSettings("openrouter");
  const res = await fetch(`${baseUrl}${path}`, {
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
