import { NextRequest, NextResponse } from "next/server";
import { reportFailure, reportSuccess, stopRetry } from "@/lib/video-retry";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  action?: "failed" | "succeeded" | "stop";
  taskId?: string;
  error?: ApiError;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: "BadRequest", message: "Invalid JSON body." },
      { status: 400 }
    );
  }
  try {
    if (body.action === "stop") {
      const out = await stopRetry(id);
      return NextResponse.json(out, { status: out.state === "missing" ? 404 : 200 });
    }
    if (typeof body.taskId !== "string" || !body.taskId) {
      return NextResponse.json(
        { code: "BadRequest", message: "taskId is required." },
        { status: 400 }
      );
    }
    if (body.action === "succeeded") {
      const retry = await reportSuccess(id, body.taskId);
      return NextResponse.json({ retry });
    }
    if (body.action === "failed") {
      const error: ApiError = {
        code: typeof body.error?.code === "string" ? body.error.code : undefined,
        message:
          typeof body.error?.message === "string" && body.error.message
            ? body.error.message
            : "Task failed",
        requestId:
          typeof body.error?.requestId === "string" ? body.error.requestId : undefined,
      };
      const out = await reportFailure(id, body.taskId, error);
      return NextResponse.json(out, { status: out.state === "missing" ? 404 : 200 });
    }
    return NextResponse.json(
      { code: "BadRequest", message: "action must be failed, succeeded or stop." },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        code: "InternalError",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
