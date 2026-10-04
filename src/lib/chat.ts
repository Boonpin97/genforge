import { modelProvider, readConfig } from "./config";
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

  if (res.status !== 200 || out.error || (out.message && !out.choices)) {
    return {
      ok: false,
      status: res.status >= 400 ? res.status : 502,
      error: friendlyError(
        out.error?.message
          ? {
              code: String(out.error.code || `HTTP_${res.status}`),
              message: out.error.message,
              requestId: out.id,
            }
          : extractError(res.body)
      ),
    };
  }

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
