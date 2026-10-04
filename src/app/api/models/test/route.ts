import { NextRequest, NextResponse } from "next/server";
import { providerSettings } from "@/lib/config";
import { ApiErrorLike } from "@/lib/errors";
import { PROVIDER_LABELS, type ProviderId } from "@/lib/model-catalog";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { provider?: string };
  const provider = body.provider as ProviderId;
  if (!["dashscope", "qwencloud", "openrouter", "tokenplan"].includes(provider))
    return NextResponse.json({ ok: false, message: "Unknown provider." }, { status: 400 });
  try {
    const { apiKey, baseUrl } = await providerSettings(provider);
    const url =
      provider === "openrouter" ? `${baseUrl}/key` : `${baseUrl}/compatible-mode/v1/models`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      data?: { limit_remaining?: number | null; usage?: number };
      error?: { message?: string };
      message?: string;
    };
    if (!res.ok)
      return NextResponse.json({
        ok: false,
        message: `${PROVIDER_LABELS[provider]} rejected the key (HTTP ${res.status})${
          data.error?.message || data.message ? `: ${data.error?.message || data.message}` : ""
        }.`,
      });
    const remaining = data.data?.limit_remaining;
    return NextResponse.json({
      ok: true,
      message:
        provider === "openrouter" && typeof remaining === "number"
          ? `Key works. $${remaining.toFixed(2)} credit left on its limit.`
          : "Key works.",
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message:
        err instanceof ApiErrorLike
          ? err.message
          : `Could not reach ${PROVIDER_LABELS[provider]}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
