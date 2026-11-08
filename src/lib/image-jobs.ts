import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { assetDir, completeAsset, failAsset, listAssets } from "./assets";
import { ApiErrorLike, errorStatus } from "./errors";
import type { ApiError, ImageUsage } from "./types";

const BEAT_FILE = "job.beat";
const BEAT_MS = 10_000;
const BEAT_STALE_MS = 45_000;
const NEVER_STARTED_MS = 3 * 60_000;

export const INTERRUPTED_MESSAGE =
  "Interrupted before it finished: the server restarted or the request never reached it. Generate it again.";

export type ImageRunOk = {
  ok: true;
  images: string[];
  usage: ImageUsage | null;
  requestId: string | null;
  estimate: number | null;
};
export type ImageRunErr = {
  ok: false;
  status: number;
  error: ApiError;
};
export type ImageRunResult = ImageRunOk | ImageRunErr;

export function errorResult(err: unknown): ImageRunErr {
  if (err instanceof ApiErrorLike)
    return { ok: false, status: errorStatus(err), error: err.toApiError() };
  return {
    ok: false,
    status: 500,
    error: {
      code: "InternalError",
      message: err instanceof Error ? err.message : String(err),
    },
  };
}

export function resultResponse(r: ImageRunResult): NextResponse {
  if (!r.ok) return NextResponse.json(r.error, { status: r.status });
  const { images, usage, requestId, estimate } = r;
  return NextResponse.json({ images, usage, requestId, estimate });
}

function beatPath(id: string): string | null {
  const dir = assetDir(id);
  return dir ? path.join(dir, BEAT_FILE) : null;
}

export async function startImageJob(
  assetId: string,
  run: () => Promise<ImageRunResult>
): Promise<NextResponse> {
  const asset = (await listAssets()).find((a) => a.id === assetId);
  const beat = beatPath(assetId);
  if (!asset || !beat || asset.kind !== "image") {
    return NextResponse.json(
      { code: "NotFound", message: "Save the pending image before starting it." },
      { status: 404 }
    );
  }
  if (asset.status !== "pending" || asset.results.length) {
    return NextResponse.json({ asset }, { status: 200 });
  }
  try {
    await fs.writeFile(beat, String(Date.now()));
  } catch {
    return NextResponse.json(
      { code: "NotFound", message: "The pending image was deleted." },
      { status: 404 }
    );
  }
  const timer = setInterval(() => {
    const now = new Date();
    void fs.utimes(beat, now, now).catch(() => {});
  }, BEAT_MS);

  void (async () => {
    try {
      let r: ImageRunResult;
      try {
        r = await run();
      } catch (err) {
        r = errorResult(err);
      }
      if (r.ok) {
        const done = await completeAsset(assetId, {
          imageUrls: r.images.slice(0, 1),
          usage: r.usage ?? undefined,
          estimate: r.estimate,
          requestId: r.requestId ?? undefined,
        });
        if (!done)
          await failAsset(assetId, "The image was generated but could not be downloaded.");
      } else {
        await failAsset(assetId, r.error.message || r.error.code || "Image generation failed.");
      }
    } catch (err) {
      await failAsset(assetId, err instanceof Error ? err.message : String(err)).catch(
        () => null
      );
    } finally {
      clearInterval(timer);
      await fs.rm(beat, { force: true }).catch(() => {});
    }
  })();

  return NextResponse.json({ pending: true }, { status: 202 });
}

export async function expireStaleImageJobs(): Promise<void> {
  let list;
  try {
    list = await listAssets();
  } catch {
    return;
  }
  const now = Date.now();
  for (const a of list) {
    if (a.kind !== "image" || a.status !== "pending" || a.results.length) continue;
    const beat = beatPath(a.id);
    if (!beat) continue;
    let stale: boolean;
    try {
      const st = await fs.stat(beat);
      stale = now - st.mtimeMs > BEAT_STALE_MS;
    } catch {
      stale = now - a.createdAt > NEVER_STARTED_MS;
    }
    if (stale) await failAsset(a.id, INTERRUPTED_MESSAGE).catch(() => null);
  }
}
