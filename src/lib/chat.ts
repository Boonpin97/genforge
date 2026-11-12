import { modelProvider, providerSettings, readConfig } from "./config";
import { dashscope, extractError, friendlyError, tokenplan } from "./dashscope";
import { openrouter } from "./openrouter";
import { upstreamModelId, type ModelEntry } from "./model-catalog";
import type { ApiError } from "./types";

export type ChatContent =
  | string
  | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

export type ChatMessage = { role: "system" | "user" | "assistant"; content: ChatContent };

export type ChatResult =
  | {
      ok: true;
      text: string;
      usage: { input_tokens?: number; output_tokens?: number } | null;
      cost: number | null;
      requestId: string | null;
    }
  | { ok: false; status: number; error: ApiError };

export async function chat(
  model: ModelEntry,
  messages: ChatMessage[],
  opts: {
    temperature?: number;
    maxTokens?: number;
    enableThinking?: boolean;
    stream?: boolean;
    timeoutMs?: number;
  } = {}
): Promise<ChatResult> {
  const c = await readConfig();
  const provider = modelProvider(c, model);
  const json = {
    model: upstreamModelId(model),
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: Math.min(
      opts.maxTokens ?? 4000,
      model.kind === "text" ? model.policy.maxTokens : 4000
    ),
    ...(provider === "openrouter"
      ? {
          usage: { include: true },
          ...(opts.enableThinking !== undefined
            ? { reasoning: { enabled: opts.enableThinking } }
            : {}),
        }
      : opts.enableThinking !== undefined
        ? { enable_thinking: opts.enableThinking }
        : {}),
  };
  if (opts.stream) return streamChat(provider, json, opts.timeoutMs ?? 600_000);

  const res =
    provider === "openrouter"
      ? await openrouter("/chat/completions", { method: "POST", json })
      : provider === "tokenplan"
        ? await tokenplan("/compatible-mode/v1/chat/completions", {
            method: "POST",
            json,
          })
        : await dashscope("/compatible-mode/v1/chat/completions", {
            method: "POST",
            json,
          });

  const out = res.body as {
    id?: string;
    error?: { code?: string | number; message?: string };
    message?: string;
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };

  if (res.status !== 200 || out.error || (out.message && !out.choices))
    return failure(res.status, res.body);

  return {
    ok: true,
    text: (out.choices?.[0]?.message?.content ?? "").trim(),
    usage: out.usage
      ? {
          input_tokens: out.usage.prompt_tokens,
          output_tokens: out.usage.completion_tokens,
        }
      : null,
    cost: typeof out.usage?.cost === "number" ? out.usage.cost : null,
    requestId: out.id || null,
  };
}

type ErrorBody = {
  id?: string;
  error?: { code?: string | number; message?: string };
};

function failure(status: number, body: Record<string, unknown>): ChatResult {
  const out = body as ErrorBody;
  return {
    ok: false,
    status: status >= 400 ? status : 502,
    error: friendlyError(
      out.error?.message
        ? {
            code: String(out.error.code || `HTTP_${status}`),
            message: out.error.message,
            requestId: out.id,
          }
        : extractError(body)
    ),
  };
}

function minutes(ms: number): string {
  const m = Math.round(ms / 60000);
  return m >= 1 ? `${m} minute${m === 1 ? "" : "s"}` : `${Math.round(ms / 1000)} seconds`;
}

type StreamChunk = ErrorBody & {
  choices?: { delta?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | null;
};

async function streamChat(
  provider: string,
  json: Record<string, unknown>,
  timeoutMs: number
): Promise<ChatResult> {
  const svc =
    provider === "openrouter" ? "openrouter" : provider === "tokenplan" ? "tokenplan" : "dashscope";
  const { apiKey, baseUrl } = await providerSettings(svc);
  const url =
    svc === "openrouter"
      ? `${baseUrl}/chat/completions`
      : `${baseUrl}/compatible-mode/v1/chat/completions`;
  const body = {
    ...json,
    stream: true,
    ...(svc === "openrouter" ? {} : { stream_options: { include_usage: true } }),
  };
  const timeout: ChatResult = {
    ok: false,
    status: 504,
    error: {
      code: "Timeout",
      message: `The model did not finish within ${minutes(timeoutMs)}, so the request was stopped.`,
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") return timeout;
    return {
      ok: false,
      status: 502,
      error: {
        code: "NetworkError",
        message: `Failed to reach ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => "");
    let parsed: Record<string, unknown> = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { message: raw.slice(0, 2000) };
    }
    return failure(res.status, parsed);
  }

  let text = "";
  let id: string | null = null;
  let usage: StreamChunk["usage"] = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) return failure(502, chunk as Record<string, unknown>);
        id = id || chunk.id || null;
        const piece = chunk.choices?.[0]?.delta?.content;
        if (piece) text += piece;
        if (chunk.usage) usage = chunk.usage;
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") return timeout;
    return {
      ok: false,
      status: 502,
      error: {
        code: "StreamError",
        message: `The model's response was cut off: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  return {
    ok: true,
    text: text.trim(),
    usage: usage
      ? { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens }
      : null,
    cost: typeof usage?.cost === "number" ? usage.cost : null,
    requestId: id,
  };
}
