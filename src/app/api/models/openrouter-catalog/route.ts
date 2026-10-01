import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { blankModel, type ModelEntry, type ModelPricing } from "@/lib/model-catalog";

export const maxDuration = 30;

type VideoRow = {
  id: string;
  name?: string;
  supported_resolutions?: string[] | null;
  supported_aspect_ratios?: string[] | null;
  supported_durations?: number[] | null;
  supported_frame_images?: string[] | null;
  generate_audio?: boolean | null;
  seed?: boolean | null;
  pricing_skus?: Record<string, string>;
};

type ModelRow = {
  id: string;
  name?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
};

function cleanName(n: string | undefined, id: string): string {
  return (n || id).replace(/:\s*/, " ").slice(0, 60);
}

function videoPricing(skus: Record<string, string> = {}): ModelPricing {
  const perSecond: Record<string, number> = {};
  for (const [k, v] of Object.entries(skus)) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const cents = k.startsWith("cents_");
    const m = /(\d+p|\dk)$/i.exec(k);
    if (/duration_seconds|per_second|video_output_second/.test(k) && !/without_audio|continuation/.test(k))
      perSecond[m ? m[1] : "default"] ??= cents ? n / 100 : n;
  }
  return Object.keys(perSecond).length ? { perSecond } : { perSecond: { default: 0.1 } };
}

function videoDraft(r: VideoRow): ModelEntry {
  const base = blankModel("video", r.id, cleanName(r.name, r.id));
  if (base.kind !== "video") return base;
  const durations = (r.supported_durations || []).filter((n) => typeof n === "number");
  const sorted = [...durations].sort((a, b) => a - b);
  const contiguous =
    sorted.length > 2 && sorted.every((v, i) => i === 0 || v - sorted[i - 1] === 1);
  return {
    ...base,
    policy: {
      ...base.policy,
      durations: !sorted.length
        ? base.policy.durations
        : contiguous
          ? { min: sorted[0], max: sorted[sorted.length - 1] }
          : { values: sorted },
      resolutions: r.supported_resolutions?.length ? r.supported_resolutions : base.policy.resolutions,
      ratios: r.supported_aspect_ratios?.length ? r.supported_aspect_ratios : base.policy.ratios,
      frames: (r.supported_frame_images || []).filter(
        (f): f is "first_frame" | "last_frame" => f === "first_frame" || f === "last_frame"
      ),
      audio: r.generate_audio === true,
      seed: r.seed === true,
    },
    pricing: videoPricing(r.pricing_skus),
    notes:
      "Filled from OpenRouter's catalog. Reference image limits are not published there — check the vendor docs and set them here.",
  };
}

function modelDraft(r: ModelRow, kind: "image" | "text"): ModelEntry {
  const base = blankModel(kind, r.id, cleanName(r.name, r.id));
  const vision = (r.architecture?.input_modalities || []).includes("image");
  if (base.kind === "image")
    return { ...base, policy: { ...base.policy, maxRefs: vision ? 4 : 0 } };
  if (base.kind === "text") {
    const i = Number(r.pricing?.prompt);
    const o = Number(r.pricing?.completion);
    return {
      ...base,
      policy: { ...base.policy, vision },
      pricing:
        Number.isFinite(i) && Number.isFinite(o)
          ? { per1KInput: i * 1000, per1KOutput: o * 1000 }
          : base.pricing,
    };
  }
  return base;
}

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  const q = (req.nextUrl.searchParams.get("q") || "").toLowerCase().trim();
  if (kind !== "video" && kind !== "image" && kind !== "text")
    return NextResponse.json({ code: "BadRequest", message: "kind must be video, image or text." }, { status: 400 });
  const base = (await readConfig()).providers.openrouter.baseUrl;
  const url =
    kind === "video"
      ? `${base}/videos/models`
      : `${base}/models?output_modalities=${kind === "image" ? "image" : "text"}`;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!res.ok)
      return NextResponse.json(
        { code: `HTTP_${res.status}`, message: "OpenRouter's model catalog did not answer." },
        { status: 502 }
      );
    const rows = ((await res.json()) as { data?: unknown[] }).data || [];
    const drafts = rows
      .filter(
        (r) =>
          kind !== "text" ||
          !((r as ModelRow).architecture?.output_modalities || []).includes("image")
      )
      .map((r) =>
        kind === "video" ? videoDraft(r as VideoRow) : modelDraft(r as ModelRow, kind)
      )
      .filter(
        (d) =>
          !d.id.startsWith("openrouter/") &&
          !d.id.startsWith("~") &&
          !d.id.endsWith(":batch") &&
          (!q || d.id.toLowerCase().includes(q) || d.label.toLowerCase().includes(q))
      )
      .slice(0, 60);
    return NextResponse.json({ drafts });
  } catch (err) {
    return NextResponse.json(
      {
        code: "NetworkError",
        message: `Could not reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 }
    );
  }
}
