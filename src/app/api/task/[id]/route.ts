import { NextRequest, NextResponse } from "next/server";
import {
  ApiErrorLike,
  dashscope,
  extractError,
  friendlyError,
  qwencloud,
} from "@/lib/dashscope";
import { openrouter } from "@/lib/openrouter";
import { estimateVideoCost } from "@/lib/pricing";
import type { TaskStatus, VideoUsage } from "@/lib/types";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const STATUS_MAP: Record<string, TaskStatus> = {
  PENDING: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELED: "failed",
  UNKNOWN: "failed",
};

const OR_STATUS: Record<string, TaskStatus> = {
  queued: "queued",
  pending: "queued",
  created: "queued",
  in_progress: "running",
  processing: "running",
  running: "running",
  completed: "succeeded",
  succeeded: "succeeded",
  done: "succeeded",
  failed: "failed",
  error: "failed",
  expired: "failed",
  cancelled: "failed",
  canceled: "failed",
};

function findVideoUrl(
  v: unknown,
  keys: string[],
  depth = 0
): string | null {
  if (depth > 6 || !v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  for (const k of keys) {
    const val = o[k];
    if (typeof val === "string" && /^https?:/i.test(val)) return val;
  }
  for (const val of Object.values(o)) {
    const r = findVideoUrl(val, keys, depth + 1);
    if (r) return r;
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const provider = _req.nextUrl.searchParams.get("provider");

  if (provider === "openrouter") {
    try {
      const res = await openrouter(`/videos/${encodeURIComponent(id)}`);
      const out = res.body as {
        id?: string;
        generation_id?: string;
        status?: string;
        cost?: number;
        usage?: { cost?: number | null };
        error?: { code?: string | number; message?: string } | string;
        message?: string;
        data?: { status?: string };
        unsigned_urls?: string[];
      };
      const raw = String(out.status ?? out.data?.status ?? "").toLowerCase();
      const status: TaskStatus =
        OR_STATUS[raw] ||
        (res.status >= 400 || out.error ? "failed" : "running");
      const videoUrl =
        (out.unsigned_urls || []).find(
          (u) => typeof u === "string" && /^https?:/i.test(u)
        ) ||
        findVideoUrl(out, ["videoUrl", "video_url"]) ||
        findVideoUrl(out, ["url"]);
      const cost =
        typeof out.usage?.cost === "number"
          ? out.usage.cost
          : typeof out.cost === "number"
            ? out.cost
            : null;
      const errObj =
        typeof out.error === "string" ? { message: out.error } : out.error;
      return NextResponse.json({
        status,
        rawStatus: raw || "unknown",
        videoUrl: status === "succeeded" ? videoUrl : null,
        usage: null,
        requestId: out.generation_id || out.id || null,
        estimate: status === "succeeded" && cost !== null ? cost : null,
        error:
          status === "failed"
            ? friendlyError({
                code: String(errObj?.code || "Failed"),
                message:
                  errObj?.message ||
                  out.message ||
                  "OpenRouter task failed.",
                requestId: out.id,
              })
            : null,
      });
    } catch (err) {
      if (err instanceof ApiErrorLike) {
        return NextResponse.json({ error: err.toApiError() }, { status: 500 });
      }
      return NextResponse.json(
        {
          error: {
            code: "InternalError",
            message: err instanceof Error ? err.message : String(err),
          },
        },
        { status: 500 }
      );
    }
  }

  const useQwencloud = provider === "qwencloud";
  const pollModel = _req.nextUrl.searchParams.get("model") || undefined;
  try {
    const res = useQwencloud
      ? await qwencloud(`/api/v1/tasks/${encodeURIComponent(id)}`)
      : await dashscope(`/api/v1/tasks/${encodeURIComponent(id)}`);
    const out = res.body as {
      code?: string;
      message?: string;
      request_id?: string;
      output?: {
        task_status?: string;
        video_url?: string;
        code?: string;
        message?: string;
      };
      usage?: VideoUsage;
    };

    if (res.status !== 200 && !out.output) {
      const err = extractError(res.body);
      return NextResponse.json(
        { error: err },
        { status: res.status >= 400 ? res.status : 502 }
      );
    }

    const raw = out.output?.task_status || "UNKNOWN";
    const status: TaskStatus = STATUS_MAP[raw] || "failed";
    const resolution =
      _req.nextUrl.searchParams.get("resolution") || undefined;

    return NextResponse.json({
      status,
      rawStatus: raw,
      videoUrl: out.output?.video_url || null,
      usage: out.usage || null,
      requestId: out.request_id || null,
      estimate:
        status === "succeeded"
          ? estimateVideoCost(out.usage, resolution, {
              model: pollModel,
              provider: useQwencloud ? "qwencloud" : "dashscope",
            })
          : null,
      error:
        out.output?.code || out.code
          ? friendlyError({
              code: String(out.output?.code || out.code),
              message:
                String(out.output?.message || out.message) || "Task failed.",
              requestId: out.request_id,
            })
          : status === "failed" && raw === "UNKNOWN"
            ? {
                code: "UnknownTask",
                message:
                  "Task does not exist or its 24h validity window has expired.",
              }
            : null,
    });
  } catch (err) {
    if (err instanceof ApiErrorLike) {
      return NextResponse.json({ error: err.toApiError() }, { status: 500 });
    }
    return NextResponse.json(
      {
        error: {
          code: "InternalError",
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 }
    );
  }
}
