import type { ModelEntry, ModelPricing } from "./model-catalog";

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;

function cleanValue(template: unknown, raw: unknown): unknown {
  if (raw === undefined) return template;
  if (typeof template === "number") return num(raw) ? raw : template;
  if (typeof template === "boolean") return typeof raw === "boolean" ? raw : template;
  if (Array.isArray(template)) {
    if (!Array.isArray(raw)) return template;
    return [
      ...new Set(
        raw
          .filter((x): x is string => typeof x === "string" && x.trim() !== "")
          .map((x) => x.trim())
      ),
    ];
  }
  if (isObj(template)) {
    if (!isObj(raw)) return template;
    if ("min" in template || "values" in template) {
      if (Array.isArray(raw.values)) {
        const values = raw.values.filter(num) as number[];
        return values.length ? { values: [...new Set(values)].sort((a, b) => a - b) } : template;
      }
      if (num(raw.min) && num(raw.max) && (raw.min as number) <= (raw.max as number))
        return { min: raw.min, max: raw.max };
      return template;
    }
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(template)) out[k] = cleanValue(template[k], raw[k]);
    return out;
  }
  return template;
}

export function sanitizePolicy<M extends ModelEntry>(base: M, raw: unknown): M["policy"] {
  const out = cleanValue(base.policy, raw) as M["policy"];
  if ("frames" in out)
    out.frames = out.frames.filter((f) => f === "first_frame" || f === "last_frame");
  return out;
}

function cleanTable(raw: unknown): Record<string, number> | undefined {
  if (!isObj(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) if (num(v) && k.trim()) out[k.trim()] = v as number;
  return Object.keys(out).length ? out : undefined;
}

export function sanitizePricing(raw: unknown): ModelPricing {
  if (!isObj(raw)) return {};
  const out: ModelPricing = {};
  for (const k of ["perSecond", "perSecondNoAudio", "perImage", "perInputImage"] as const) {
    const t = cleanTable(raw[k]);
    if (t) out[k] = t;
  }
  if (num(raw.per1KInput)) out.per1KInput = raw.per1KInput as number;
  if (num(raw.per1KOutput)) out.per1KOutput = raw.per1KOutput as number;
  return out;
}
