import { NextRequest, NextResponse } from "next/server";
import {
  modelProvider,
  readConfig,
  toPublic,
  updateConfig,
} from "@/lib/config";
import { ApiErrorLike, errorStatus } from "@/lib/errors";
import {
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  PROVIDER_LABELS,
  blankModel,
  type GenforgeConfig,
  type ModelEntry,
  type ModelKind,
  type ProviderId,
  type Roles,
} from "@/lib/model-catalog";
import { sanitizePolicy, sanitizePricing } from "@/lib/model-sanitize";

export const dynamic = "force-dynamic";

const PROVIDERS: ProviderId[] = ["dashscope", "qwencloud", "openrouter"];
const ID_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._:-]+)?$/;

type ModelPatch = {
  id?: unknown;
  enabled?: unknown;
  label?: unknown;
  notes?: unknown;
  policy?: unknown;
  pricing?: unknown;
  reset?: unknown;
  remove?: unknown;
};

type Body = {
  providers?: Partial<Record<ProviderId, { apiKey?: unknown; baseUrl?: unknown }>>;
  videoProvider?: unknown;
  roles?: Partial<Record<keyof Roles, unknown>>;
  models?: ModelPatch[];
  add?: { id?: unknown; kind?: unknown; label?: unknown; policy?: unknown; pricing?: unknown; notes?: unknown };
};

function bad(message: string): never {
  throw new ApiErrorLike("BadRequest", message);
}

function applyModelPatch(c: GenforgeConfig, patch: ModelPatch): void {
  if (typeof patch.id !== "string") bad("Each model change needs an id.");
  const idx = c.models.findIndex((m) => m.id === patch.id);
  if (idx < 0) bad(`Unknown model ${patch.id}.`);
  const current = c.models[idx];
  if (patch.remove === true) {
    if (!current.custom) bad(`${current.label} is a built-in model — turn it off instead.`);
    c.models.splice(idx, 1);
    return;
  }
  let next: ModelEntry = { ...current };
  if (patch.reset === true) {
    const def = DEFAULT_MODELS.find((d) => d.id === current.id);
    if (def) next = { ...structuredClone(def), enabled: current.enabled };
  }
  if (typeof patch.label === "string" && patch.label.trim())
    next.label = patch.label.trim().slice(0, 60);
  if (typeof patch.notes === "string") next.notes = patch.notes.trim().slice(0, 400) || undefined;
  if (patch.policy !== undefined)
    next = { ...next, policy: sanitizePolicy(next, patch.policy) } as ModelEntry;
  if (patch.pricing !== undefined) next.pricing = sanitizePricing(patch.pricing);
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  c.models[idx] = next;
}

export async function GET() {
  try {
    return NextResponse.json(toPublic(await readConfig()));
  } catch (err) {
    if (err instanceof ApiErrorLike)
      return NextResponse.json(err.toApiError(), { status: errorStatus(err) });
    throw err;
  }
}

export async function PUT(req: NextRequest) {
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
    const updated = await updateConfig((c) => {
      if (body.providers) {
        for (const p of PROVIDERS) {
          const v = body.providers[p];
          if (!v) continue;
          if (v.apiKey === null) c.providers[p].apiKey = "";
          else if (typeof v.apiKey === "string" && v.apiKey.trim()) {
            if (/\s/.test(v.apiKey.trim())) bad("An API key cannot contain spaces.");
            c.providers[p].apiKey = v.apiKey.trim();
          }
          if (typeof v.baseUrl === "string") {
            const url = v.baseUrl.trim().replace(/\/+$/, "");
            if (url && !/^https:\/\/[^\s]+$/i.test(url)) bad("Base URLs must start with https://");
            c.providers[p].baseUrl = url || DEFAULT_BASE_URLS[p];
          }
        }
      }
      if (body.videoProvider === "dashscope" || body.videoProvider === "qwencloud")
        c.videoProvider = body.videoProvider;
      if (body.roles)
        for (const k of ["director", "rewrite", "appearance"] as const) {
          const v = body.roles[k];
          if (typeof v !== "string") continue;
          const m = c.models.find((x) => x.id === v && x.kind === "text");
          if (!m) bad(`${v} is not a writing model.`);
          if (k === "appearance" && m.kind === "text" && !m.policy.vision)
            bad(`${m.label} cannot read images, so it cannot describe characters.`);
          c.roles[k] = v;
        }
      if (body.add) {
        const id = typeof body.add.id === "string" ? body.add.id.trim() : "";
        const kind = body.add.kind as ModelKind;
        if (!ID_RE.test(id)) bad("Model ids look like vendor/model (OpenRouter) or a DashScope model name.");
        if (!["video", "image", "text"].includes(kind)) bad("Pick video, image or writing for the new model.");
        if (c.models.some((m) => m.id === id)) bad(`${id} is already in the list.`);
        const blank = blankModel(
          kind,
          id,
          typeof body.add.label === "string" ? body.add.label.trim().slice(0, 60) : undefined
        );
        const entry = {
          ...blank,
          policy: sanitizePolicy(blank, body.add.policy),
          pricing:
            body.add.pricing !== undefined ? sanitizePricing(body.add.pricing) : blank.pricing,
          notes:
            typeof body.add.notes === "string" ? body.add.notes.slice(0, 400) : undefined,
        } as ModelEntry;
        c.models.push(entry);
      }
      for (const patch of body.models || []) applyModelPatch(c, patch);
      for (const m of c.models)
        if (m.enabled && !c.providers[modelProvider(c, m)].apiKey) {
          const touched = (body.models || []).some((p) => p.id === m.id && p.enabled === true);
          if (touched)
            bad(`Add the ${PROVIDER_LABELS[modelProvider(c, m)]} API key before turning on ${m.label}.`);
        }
    });
    return NextResponse.json(toPublic(updated));
  } catch (err) {
    if (err instanceof ApiErrorLike)
      return NextResponse.json(err.toApiError(), { status: errorStatus(err) });
    return NextResponse.json(
      { code: "InternalError", message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
