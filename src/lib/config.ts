import { promises as fs } from "fs";
import path from "path";
import {
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  DEFAULT_ROLES,
  PROVIDER_LABELS,
  blankModel,
  defaultConfig,
  resolveProvider,
  type GenforgeConfig,
  type ModelEntry,
  type ModelKind,
  type ProviderId,
  type PublicConfig,
  type PublicModel,
  type Roles,
} from "./model-catalog";
import { ApiErrorLike } from "./errors";
import { sanitizePolicy, sanitizePricing } from "./model-sanitize";

export const CONFIG_FILE = "genforge.config.json";

const PROVIDERS: ProviderId[] = ["dashscope", "qwencloud", "openrouter"];

function configPath(): string {
  return path.join(process.cwd(), CONFIG_FILE);
}

let cache: { mtimeMs: number; config: GenforgeConfig } | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function mergeModel(def: ModelEntry | undefined, stored: ModelEntry): ModelEntry {
  const base = def ?? blankModel(stored.kind, stored.id, stored.label);
  return {
    ...base,
    label: typeof stored.label === "string" && stored.label ? stored.label : base.label,
    enabled: Boolean(stored.enabled),
    notes: typeof stored.notes === "string" ? stored.notes : base.notes,
    deprecated: base.deprecated,
    custom: def ? undefined : true,
    policy: sanitizePolicy(base, stored.policy),
    pricing: isObj(stored.pricing) ? sanitizePricing(stored.pricing) : base.pricing,
  } as ModelEntry;
}

export function normalize(raw: unknown): GenforgeConfig {
  const base = defaultConfig();
  if (!isObj(raw)) return base;
  const providers = { ...base.providers };
  if (isObj(raw.providers)) {
    for (const p of PROVIDERS) {
      const v = raw.providers[p];
      if (isObj(v))
        providers[p] = {
          apiKey: typeof v.apiKey === "string" ? v.apiKey.trim() : "",
          baseUrl:
            typeof v.baseUrl === "string" && v.baseUrl.trim()
              ? v.baseUrl.trim().replace(/\/+$/, "")
              : DEFAULT_BASE_URLS[p],
        };
    }
  }
  const storedModels = Array.isArray(raw.models)
    ? (raw.models.filter(
        (m) =>
          isObj(m) &&
          typeof m.id === "string" &&
          (m.kind === "video" || m.kind === "image" || m.kind === "text") &&
          isObj(m.policy)
      ) as ModelEntry[])
    : [];
  const byId = new Map(storedModels.map((m) => [m.id, m]));
  const models: ModelEntry[] = DEFAULT_MODELS.map((def) => {
    const s = byId.get(def.id);
    return s ? mergeModel(def, s) : structuredClone(def);
  });
  for (const s of storedModels)
    if (!DEFAULT_MODELS.some((d) => d.id === s.id))
      models.push(mergeModel(undefined, s));
  const roles: Roles = { ...DEFAULT_ROLES };
  if (isObj(raw.roles))
    for (const k of Object.keys(roles) as (keyof Roles)[])
      if (typeof raw.roles[k] === "string") roles[k] = raw.roles[k] as string;
  return {
    version: 1,
    providers,
    videoProvider: raw.videoProvider === "qwencloud" ? "qwencloud" : "dashscope",
    roles,
    models,
  };
}

export async function readConfig(): Promise<GenforgeConfig> {
  let stat;
  try {
    stat = await fs.stat(configPath());
  } catch {
    const config = defaultConfig();
    await writeConfig(config).catch(() => {});
    return config;
  }
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache.config;
  let raw: unknown = null;
  try {
    raw = JSON.parse(await fs.readFile(configPath(), "utf8"));
  } catch (err) {
    throw new ApiErrorLike(
      "BadConfig",
      `${CONFIG_FILE} is not valid JSON (${err instanceof Error ? err.message : String(err)}). Fix it or delete it to start from defaults.`
    );
  }
  const config = normalize(raw);
  cache = { mtimeMs: stat.mtimeMs, config };
  return config;
}

export async function writeConfig(config: GenforgeConfig): Promise<void> {
  const run = async () => {
    const file = configPath();
    const tmp = `${file}.tmp`;
    const out = {
      ...config,
      models: config.models.map((m) => {
        const copy: Partial<ModelEntry> = { ...m };
        if (!copy.custom) delete copy.custom;
        return copy;
      }),
    };
    await fs.writeFile(tmp, JSON.stringify(out, null, 2) + "\n", "utf8");
    await fs.rename(tmp, file);
    cache = null;
  };
  const next = writeChain.then(run, run);
  writeChain = next.catch(() => {});
  return next;
}

export async function updateConfig(
  fn: (c: GenforgeConfig) => GenforgeConfig | void
): Promise<GenforgeConfig> {
  const current = structuredClone(await readConfig());
  const updated = fn(current) || current;
  const normalized = normalize(updated);
  await writeConfig(normalized);
  return normalized;
}

export function hasKey(c: GenforgeConfig, p: ProviderId): boolean {
  return Boolean(c.providers[p].apiKey);
}

export function modelProvider(c: GenforgeConfig, m: ModelEntry): ProviderId {
  return resolveProvider(m, c.videoProvider);
}

export function isAvailable(c: GenforgeConfig, m: ModelEntry): boolean {
  return m.enabled && hasKey(c, modelProvider(c, m));
}

export async function getModel(id: string): Promise<ModelEntry | undefined> {
  return (await readConfig()).models.find((m) => m.id === id);
}

export async function requireModel<K extends ModelKind>(
  id: string | undefined,
  kind: K
): Promise<Extract<ModelEntry, { kind: K }>> {
  const c = await readConfig();
  const m = c.models.find((x) => x.id === id && x.kind === kind);
  if (!m)
    throw new ApiErrorLike(
      "UnknownModel",
      `"${id || ""}" is not a ${kind} model in ${CONFIG_FILE}. Add it on the Models page.`
    );
  if (!m.enabled)
    throw new ApiErrorLike(
      "ModelDisabled",
      `${m.label} is turned off. Enable it on the Models page.`
    );
  const p = modelProvider(c, m);
  if (!hasKey(c, p))
    throw new ApiErrorLike(
      "MissingConfig",
      `${m.label} needs the ${PROVIDER_LABELS[p]} API key. Add it on the Models page.`
    );
  return m as Extract<ModelEntry, { kind: K }>;
}

export async function roleModel(
  role: keyof Roles,
  opts: { vision?: boolean } = {}
): Promise<Extract<ModelEntry, { kind: "text" }>> {
  const c = await readConfig();
  const texts = c.models.filter(
    (m): m is Extract<ModelEntry, { kind: "text" }> =>
      m.kind === "text" && isAvailable(c, m)
  );
  const wanted = texts.find((m) => m.id === c.roles[role]);
  if (wanted && (!opts.vision || wanted.policy.vision)) return wanted;
  const fallback = texts.find((m) => !opts.vision || m.policy.vision);
  if (fallback) return fallback;
  throw new ApiErrorLike(
    "ModelDisabled",
    `No ${opts.vision ? "image-reading " : ""}writing model is enabled with a key. Enable one on the Models page.`
  );
}

export async function providerSettings(
  p: ProviderId
): Promise<{ apiKey: string; baseUrl: string }> {
  const c = await readConfig();
  const s = c.providers[p];
  if (!s.apiKey)
    throw new ApiErrorLike(
      "MissingConfig",
      `No ${PROVIDER_LABELS[p]} API key yet. Add it on the Models page (it is saved to ${CONFIG_FILE}).`
    );
  return s;
}

export function toPublic(c: GenforgeConfig): PublicConfig {
  const providers = {} as PublicConfig["providers"];
  for (const p of PROVIDERS) {
    const s = c.providers[p];
    providers[p] = {
      hasKey: Boolean(s.apiKey),
      last4: s.apiKey ? s.apiKey.slice(-4) : null,
      baseUrl: s.baseUrl,
    };
  }
  const models: PublicModel[] = c.models.map((m) => ({
    ...m,
    resolvedProvider: modelProvider(c, m),
    available: isAvailable(c, m),
  }));
  return {
    providers,
    videoProvider: c.videoProvider,
    roles: c.roles,
    models,
  };
}
