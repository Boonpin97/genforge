"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Btn, Chip, Field, Panel, Seg, Select, TextInput, Toggle } from "./ui";
import {
  PROVIDER_LABELS,
  policySummary,
  type ModelEntry,
  type ModelKind,
  type ModelPricing,
  type ProviderId,
  type PublicConfig,
  type PublicModel,
} from "@/lib/model-catalog";

type SaveBody = {
  providers?: Partial<Record<ProviderId, { apiKey?: string | null; baseUrl?: string }>>;
  videoProvider?: "dashscope" | "qwencloud";
  roles?: Partial<PublicConfig["roles"]>;
  models?: Record<string, unknown>[];
  add?: Record<string, unknown>;
};

const KIND_LABELS: Record<ModelKind, string> = {
  video: "Video",
  image: "Image",
  text: "Writing",
};

const PROVIDER_HINTS: Record<ProviderId, string> = {
  dashscope:
    "Runs Wan video, Qwen Image and the Qwen writing models. Keys are region-locked: Singapore keys use dashscope-intl.aliyuncs.com, Beijing keys use dashscope.aliyuncs.com.",
  qwencloud:
    "An alternative endpoint for Wan video only. It is the only one that supports first and last frame mode for Wan.",
  openrouter:
    "One key for every non-Qwen model: Veo, Kling, Seedance, Hailuo, Runway, Grok, Nano Banana, GPT Image, FLUX, Claude, GPT, Gemini and more.",
  tokenplan:
    "Model Studio's Token Plan subscription (Singapore only), billed in Credits from a monthly quota instead of dollars. Keys start with sk-sp- and only work with the Token Plan base URL — they are not interchangeable with pay-as-you-go DashScope keys. Runs HappyHorse video, Wan 2.7 Image Pro and Qwen 3.8 Max; qwen-image-2.0-pro needs the Team Edition. Alibaba limits the plan to interactive use in AI tools, so heavy backend use risks suspension.",
};

function priceLine(m: ModelEntry): string {
  const p = m.pricing;
  if (p.free) return "";
  const table = (t?: Record<string, number>) =>
    t
      ? Object.entries(t)
          .map(([k, v]) => (k === "default" ? `$${v}` : `${k} $${v}`))
          .join(", ")
      : "";
  if (m.kind === "video") {
    const a = table(p.perSecond);
    return a ? `${a} per second${p.perSecondNoAudio ? ` (silent ${table(p.perSecondNoAudio)})` : ""}` : "";
  }
  if (m.kind === "image") return p.perImage ? `${table(p.perImage)} per image` : "";
  if (p.per1KInput === undefined && p.per1KOutput === undefined) return "";
  return `$${p.per1KInput ?? 0} in, $${p.per1KOutput ?? 0} out per 1K tokens`;
}

function getAt(obj: unknown, path: string[]): unknown {
  return path.reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    obj
  );
}

function setAt<T>(obj: T, path: string[], value: unknown): T {
  const copy = structuredClone(obj) as Record<string, unknown>;
  let cur = copy;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
  return copy as T;
}

type FieldSpec =
  | { kind: "num"; path: string[]; label: string; hint?: string }
  | { kind: "bool"; path: string[]; label: string }
  | { kind: "list"; path: string[]; label: string; hint?: string }
  | { kind: "table"; path: string[]; label: string; hint?: string }
  | { kind: "durations" }
  | { kind: "frames" };

const VIDEO_FIELDS: FieldSpec[] = [
  { kind: "durations" },
  { kind: "list", path: ["policy", "resolutions"], label: "Resolutions", hint: "comma separated" },
  { kind: "list", path: ["policy", "ratios"], label: "Aspect ratios", hint: "comma separated" },
  { kind: "list", path: ["policy", "longestDurationOnly"], label: "Needs the longest duration with", hint: "resolutions, refs, last_frame" },
  { kind: "frames" },
  { kind: "bool", path: ["policy", "firstFrameRequired"], label: "A first frame is required" },
  { kind: "num", path: ["policy", "maxPromptChars"], label: "Prompt length, max", hint: "characters, 0 = none" },
  { kind: "num", path: ["policy", "refs", "minImages"], label: "Reference images, min" },
  { kind: "num", path: ["policy", "refs", "maxImages"], label: "Reference images, max" },
  { kind: "num", path: ["policy", "refs", "maxImageMB"], label: "Image size limit", hint: "MB" },
  { kind: "num", path: ["policy", "refs", "minImageSide"], label: "Image shortest side, min", hint: "px, 0 = none; smaller images are upscaled" },
  { kind: "num", path: ["policy", "refs", "maxImageSide"], label: "Image longest side, max", hint: "px, 0 = none; larger images are downscaled" },
  { kind: "num", path: ["policy", "refs", "maxImageAspect"], label: "Image aspect ratio, max", hint: "long÷short, 0 = none" },
  { kind: "num", path: ["policy", "refs", "minClipSec"], label: "Video and audio clip length, min", hint: "seconds, 0 = none" },
  { kind: "num", path: ["policy", "refs", "maxVideos"], label: "Reference videos, max", hint: "DashScope only" },
  { kind: "num", path: ["policy", "refs", "maxVideoTotalSec"], label: "Reference video length, combined", hint: "seconds" },
  { kind: "num", path: ["policy", "refs", "maxVideoMB"], label: "Video size limit", hint: "MB" },
  { kind: "num", path: ["policy", "refs", "maxAudio"], label: "Reference audio clips, max", hint: "DashScope only" },
  { kind: "num", path: ["policy", "refs", "maxAudioSec"], label: "Audio used per clip", hint: "seconds" },
  { kind: "num", path: ["policy", "refs", "maxAudioMB"], label: "Audio size limit", hint: "MB" },
  { kind: "bool", path: ["policy", "refs", "videoCountsTowardDuration"], label: "Reference video takes time out of the output" },
  { kind: "num", path: ["policy", "refs", "totalBudgetSec"], label: "Reference plus output total", hint: "seconds" },
  { kind: "bool", path: ["policy", "refs", "framesExclusiveWithRefs"], label: "Frames cannot be mixed with reference media" },
  { kind: "bool", path: ["policy", "framesRequireQwencloud"], label: "Frame mode needs the QwenCloud endpoint" },
  { kind: "bool", path: ["policy", "smartDuration"], label: "Model can choose the length" },
  { kind: "bool", path: ["policy", "audio"], label: "Generates audio" },
  { kind: "bool", path: ["policy", "seed"], label: "Accepts a seed" },
  { kind: "bool", path: ["policy", "watermark"], label: "Has a watermark option" },
  { kind: "bool", path: ["pricing", "free"], label: "No cost — count every run as $0" },
  { kind: "table", path: ["pricing", "perSecond"], label: "Price per second", hint: "resolution=USD, or default=USD" },
  { kind: "table", path: ["pricing", "perSecondNoAudio"], label: "Price per second without audio", hint: "optional" },
];

const IMAGE_FIELDS: FieldSpec[] = [
  { kind: "num", path: ["policy", "maxRefs"], label: "Reference images, max" },
  { kind: "num", path: ["policy", "maxRefMB"], label: "Image size limit", hint: "MB" },
  { kind: "num", path: ["policy", "minRefSide"], label: "Reference shortest side, min", hint: "px, 0 = none; smaller images are upscaled" },
  { kind: "num", path: ["policy", "maxRefSide"], label: "Reference longest side, max", hint: "px, 0 = none; larger images are downscaled" },
  { kind: "num", path: ["policy", "maxRefAspect"], label: "Reference aspect ratio, max", hint: "long÷short, 0 = none" },
  { kind: "bool", path: ["policy", "refNoAlpha"], label: "References cannot have transparency" },
  { kind: "num", path: ["policy", "maxN"], label: "Images per run, max", hint: "1–6" },
  { kind: "list", path: ["policy", "sizes"], label: "Sizes", hint: "auto, or W*H, comma separated" },
  { kind: "list", path: ["policy", "textOnlySizes"], label: "Sizes for text-to-image only", hint: "comma separated" },
  { kind: "num", path: ["policy", "maxPromptChars"], label: "Prompt length, max", hint: "characters, 0 = none" },
  { kind: "num", path: ["policy", "maxNegativeChars"], label: "Negative prompt length, max", hint: "characters, 0 = none" },
  { kind: "bool", path: ["policy", "negativePrompt"], label: "Accepts a negative prompt" },
  { kind: "bool", path: ["policy", "promptExtend"], label: "Has a prompt rewrite option" },
  { kind: "bool", path: ["policy", "watermark"], label: "Has a watermark option" },
  { kind: "bool", path: ["policy", "seed"], label: "Accepts a seed" },
  { kind: "bool", path: ["pricing", "free"], label: "No cost — count every run as $0" },
  { kind: "table", path: ["pricing", "perImage"], label: "Price per image", hint: "default=USD, or 1k= / 2k=" },
  { kind: "table", path: ["pricing", "perInputImage"], label: "Price per input image", hint: "optional" },
];

const TEXT_FIELDS: FieldSpec[] = [
  { kind: "bool", path: ["policy", "vision"], label: "Reads images (can describe characters)" },
  { kind: "num", path: ["policy", "maxTokens"], label: "Output tokens, max" },
  { kind: "bool", path: ["pricing", "free"], label: "No cost — count every run as $0" },
  { kind: "num", path: ["pricing", "per1KInput"], label: "Input price", hint: "USD per 1K tokens" },
  { kind: "num", path: ["pricing", "per1KOutput"], label: "Output price", hint: "USD per 1K tokens" },
];

function tableToText(t: unknown): string {
  if (!t || typeof t !== "object") return "";
  return Object.entries(t as Record<string, number>)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

function textToTable(s: string): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const part of s.split(",")) {
    const [k, v] = part.split("=").map((x) => x.trim());
    const n = Number(v);
    if (k && v !== undefined && Number.isFinite(n)) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

function LimitsEditor({
  model,
  onSave,
  onReset,
  onCancel,
  busy,
}: {
  model: ModelEntry;
  onSave: (m: ModelEntry) => void;
  onReset?: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<ModelEntry>(() => structuredClone(model));
  const [texts, setTexts] = useState<Record<string, string>>({});
  const fields =
    draft.kind === "video" ? VIDEO_FIELDS : draft.kind === "image" ? IMAGE_FIELDS : TEXT_FIELDS;

  const textFor = (key: string, fallback: string) => texts[key] ?? fallback;
  const setText = (key: string, v: string) => setTexts((t) => ({ ...t, [key]: v }));

  function commit() {
    let out = draft;
    for (const f of fields) {
      if (f.kind !== "list" && f.kind !== "table") continue;
      const key = f.path.join(".");
      if (texts[key] === undefined) continue;
      const value =
        f.kind === "list"
          ? texts[key].split(",").map((x) => x.trim()).filter(Boolean)
          : textToTable(texts[key]);
      out = setAt(out, f.path, value);
    }
    if (out.kind === "video" && texts["durations"] !== undefined) {
      const d = out.policy.durations;
      if ("values" in d) {
        const values = texts["durations"]
          .split(",")
          .map((x) => Number(x.trim()))
          .filter((n) => Number.isFinite(n) && n > 0);
        out = setAt(out, ["policy", "durations"], { values });
      }
    }
    onSave(out);
  }

  return (
    <div className="mt-3 pt-3 border-t border-line-soft">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Label">
          <TextInput
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />
        </Field>
        <Field label="Notes" hint="shown under the model picker">
          <TextInput
            value={draft.notes || ""}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </Field>
        {fields.map((f, i) => {
          if (f.kind === "durations" && draft.kind === "video") {
            const d = draft.policy.durations;
            const isValues = "values" in d;
            return (
              <div key={i} className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Durations">
                  <Seg
                    value={isValues ? "values" : "range"}
                    onChange={(v) =>
                      setDraft(
                        setAt(
                          draft,
                          ["policy", "durations"],
                          v === "values"
                            ? { values: isValues ? d.values : [d.min, d.max] }
                            : isValues
                              ? { min: Math.min(...d.values), max: Math.max(...d.values) }
                              : d
                        )
                      )
                    }
                    options={[
                      { value: "range", label: "Any length in a range" },
                      { value: "values", label: "Fixed lengths" },
                    ]}
                  />
                </Field>
                {isValues ? (
                  <Field label="Allowed lengths" hint="seconds, comma separated">
                    <TextInput
                      value={textFor("durations", d.values.join(", "))}
                      onChange={(e) => setText("durations", e.target.value)}
                      className="font-mono"
                    />
                  </Field>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Shortest" hint="seconds">
                      <TextInput
                        type="number"
                        min={1}
                        value={d.min}
                        onChange={(e) =>
                          setDraft(setAt(draft, ["policy", "durations", "min"], Number(e.target.value)))
                        }
                        className="font-mono"
                      />
                    </Field>
                    <Field label="Longest" hint="seconds">
                      <TextInput
                        type="number"
                        min={1}
                        value={d.max}
                        onChange={(e) =>
                          setDraft(setAt(draft, ["policy", "durations", "max"], Number(e.target.value)))
                        }
                        className="font-mono"
                      />
                    </Field>
                  </div>
                )}
              </div>
            );
          }
          if (f.kind === "frames" && draft.kind === "video") {
            const frames = draft.policy.frames;
            const toggle = (t: "first_frame" | "last_frame", on: boolean) =>
              setDraft(
                setAt(
                  draft,
                  ["policy", "frames"],
                  (["first_frame", "last_frame"] as const).filter((x) =>
                    x === t ? on : frames.includes(x)
                  )
                )
              );
            return (
              <div key={i} className="sm:col-span-2 flex flex-wrap gap-x-6 gap-y-2">
                <Toggle
                  checked={frames.includes("first_frame")}
                  onChange={(v) => toggle("first_frame", v)}
                  label="Can start from a first frame"
                />
                <Toggle
                  checked={frames.includes("last_frame")}
                  onChange={(v) => toggle("last_frame", v)}
                  label="Can end on a last frame"
                />
              </div>
            );
          }
          if (f.kind === "bool")
            return (
              <div key={i} className="flex items-center">
                <Toggle
                  checked={Boolean(getAt(draft, f.path))}
                  onChange={(v) => setDraft(setAt(draft, f.path, v))}
                  label={f.label}
                />
              </div>
            );
          if (f.kind === "num")
            return (
              <Field key={i} label={f.label} hint={f.hint}>
                <TextInput
                  type="number"
                  min={0}
                  step="any"
                  value={String(getAt(draft, f.path) ?? "")}
                  onChange={(e) =>
                    setDraft(
                      setAt(draft, f.path, e.target.value === "" ? undefined : Number(e.target.value))
                    )
                  }
                  className="font-mono"
                />
              </Field>
            );
          if (f.kind === "list" || f.kind === "table") {
            const key = f.path.join(".");
            const current = getAt(draft, f.path);
            const fallback =
              f.kind === "list"
                ? Array.isArray(current)
                  ? current.join(", ")
                  : ""
                : tableToText(current);
            return (
              <Field key={i} label={f.label} hint={f.hint}>
                <TextInput
                  value={textFor(key, fallback)}
                  onChange={(e) => setText(key, e.target.value)}
                  className="font-mono"
                />
              </Field>
            );
          }
          return null;
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Btn size="sm" variant="subtle" onClick={commit} disabled={busy}>
          Save limits
        </Btn>
        <Btn size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Btn>
        {onReset && (
          <Btn size="sm" variant="ghost" onClick={onReset} disabled={busy} className="ml-auto">
            Reset to researched defaults
          </Btn>
        )}
      </div>
    </div>
  );
}

function ProviderCard({
  id,
  info,
  busy,
  onSave,
  extra,
}: {
  id: ProviderId;
  info: PublicConfig["providers"][ProviderId];
  busy: boolean;
  onSave: (body: SaveBody) => Promise<boolean>;
  extra?: React.ReactNode;
}) {
  const [key, setKey] = useState("");
  const [url, setUrl] = useState(info.baseUrl);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id }),
      });
      setTest(await res.json());
    } catch (e) {
      setTest({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="border border-line rounded-md bg-panel2/40 p-4">
      <div className="flex items-center gap-2.5 mb-1">
        <span
          className={`w-2 h-2 rounded-full ${info.hasKey ? "bg-ok" : "bg-muted"}`}
          aria-hidden
        />
        <h3 className="font-semibold text-sm text-ink">{PROVIDER_LABELS[id]}</h3>
        <span className="ml-auto text-2xs text-muted">
          {info.hasKey ? (
            <>
              Key saved, ends in <span className="font-mono text-ink">{info.last4}</span>
            </>
          ) : (
            "No key yet"
          )}
        </span>
      </div>
      <p className="text-xs text-muted leading-snug mb-3">{PROVIDER_HINTS[id]}</p>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
        <Field label={info.hasKey ? "Replace the key" : "API key"}>
          <TextInput
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={info.hasKey ? "Paste a new key to replace it" : "Paste your key"}
            className="font-mono"
          />
        </Field>
        <Btn
          size="md"
          variant="subtle"
          disabled={busy || !key.trim()}
          onClick={async () => {
            if (await onSave({ providers: { [id]: { apiKey: key.trim() } } })) {
              setKey("");
              setTest(null);
            }
          }}
        >
          Save key
        </Btn>
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
        <Field label="Base URL">
          <TextInput
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <Btn
          size="md"
          variant="ghost"
          disabled={busy || url.trim() === info.baseUrl}
          onClick={() => void onSave({ providers: { [id]: { baseUrl: url.trim() } } })}
        >
          Save URL
        </Btn>
      </div>
      {extra}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Btn size="sm" variant="ghost" disabled={!info.hasKey || testing} onClick={() => void runTest()}>
          {testing ? "Testing…" : "Test the key"}
        </Btn>
        {info.hasKey && (
          <Btn
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => {
              setTest(null);
              void onSave({ providers: { [id]: { apiKey: null } } });
            }}
          >
            Remove key
          </Btn>
        )}
        {test && (
          <span className={`text-xs ${test.ok ? "text-ok" : "text-danger"}`}>{test.message}</span>
        )}
      </div>
    </div>
  );
}

function ModelRow({
  m,
  cfg,
  busy,
  onSave,
}: {
  m: PublicModel;
  cfg: PublicConfig;
  busy: boolean;
  onSave: (body: SaveBody) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [askKey, setAskKey] = useState(false);
  const [key, setKey] = useState("");
  const provider = m.resolvedProvider;
  const keyed = cfg.providers[provider].hasKey;
  const price = priceLine(m);

  async function toggle(on: boolean) {
    if (on && !keyed) {
      setAskKey(true);
      return;
    }
    await onSave({ models: [{ id: m.id, enabled: on }] });
  }

  return (
    <li className="py-3.5 border-b border-line-soft last:border-b-0">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <Toggle checked={m.enabled} onChange={(v) => void toggle(v)} label={m.label} />
        <span className="self-center font-mono text-2xs text-muted bg-panel2 rounded-sm px-1.5 py-0.5">
          {m.id}
        </span>
        <span className="self-center text-2xs text-muted rounded-full border border-line px-2 py-0.5">
          {PROVIDER_LABELS[provider]}
        </span>
        {m.custom && (
          <span className="self-center text-2xs text-accent bg-accent/15 rounded-full px-2 py-0.5">
            Added by you
          </span>
        )}
        {m.deprecated && (
          <span className="self-center text-2xs text-warn bg-warn/10 rounded-full px-2 py-0.5">
            Retired upstream
          </span>
        )}
        {m.pricing.free && (
          <span className="self-center text-2xs text-ok bg-ok/10 rounded-full px-2 py-0.5">
            No cost
          </span>
        )}
        {m.enabled && !keyed && (
          <span className="self-center text-2xs text-danger bg-danger/10 rounded-full px-2 py-0.5">
            Needs a {PROVIDER_LABELS[provider]} key
          </span>
        )}
        <div className="ml-auto flex gap-1.5">
          <Btn size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>
            {editing ? "Close" : "Edit limits"}
          </Btn>
          {m.custom && (
            <Btn
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() => void onSave({ models: [{ id: m.id, remove: true }] })}
            >
              Remove
            </Btn>
          )}
        </div>
      </div>
      <p className="mt-1.5 pl-12 text-xs text-ink/80 leading-snug">{policySummary(m)}</p>
      {price && (
        <p className="pl-12 font-mono text-2xs text-muted">est. {price}</p>
      )}
      {m.notes && <p className="pl-12 mt-1 text-2xs text-muted leading-snug">{m.notes}</p>}
      {askKey && !keyed && (
        <div className="mt-3 ml-12 border border-warn/35 bg-warn/10 rounded-md p-3">
          <p className="text-xs text-warn mb-2">
            {m.label} runs on {PROVIDER_LABELS[provider]}. Add its key to turn it on.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <TextInput
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={`${PROVIDER_LABELS[provider]} API key`}
              className="font-mono"
            />
            <Btn
              size="md"
              variant="subtle"
              disabled={busy || !key.trim()}
              onClick={async () => {
                const ok = await onSave({
                  providers: { [provider]: { apiKey: key.trim() } },
                  models: [{ id: m.id, enabled: true }],
                });
                if (ok) {
                  setKey("");
                  setAskKey(false);
                }
              }}
            >
              Save key and turn on
            </Btn>
            <Btn size="md" variant="ghost" onClick={() => setAskKey(false)}>
              Not now
            </Btn>
          </div>
        </div>
      )}
      {editing && (
        <div className="pl-12">
          <LimitsEditor
            model={m}
            busy={busy}
            onCancel={() => setEditing(false)}
            onReset={
              m.custom
                ? undefined
                : async () => {
                    if (await onSave({ models: [{ id: m.id, reset: true }] })) setEditing(false);
                  }
            }
            onSave={async (d) => {
              const ok = await onSave({
                models: [
                  {
                    id: m.id,
                    label: d.label,
                    notes: d.notes || "",
                    policy: d.policy,
                    pricing: d.pricing as ModelPricing,
                  },
                ],
              });
              if (ok) setEditing(false);
            }}
          />
        </div>
      )}
    </li>
  );
}

function AddModel({
  kind,
  existing,
  busy,
  onSave,
}: {
  kind: ModelKind;
  existing: Set<string>;
  busy: boolean;
  onSave: (body: SaveBody) => Promise<boolean>;
}) {
  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState<ModelEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/models/openrouter-catalog?kind=${kind}&q=${encodeURIComponent(q.trim())}`
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message || `HTTP ${res.status}`);
      setDrafts(d.drafts || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDrafts(null);
    } finally {
      setSearching(false);
    }
  }

  const add = (d: { id: string; label?: string; policy?: unknown; pricing?: unknown; notes?: string }) =>
    onSave({ add: { kind, ...d } });

  return (
    <div className="mt-4 pt-4 border-t border-line-soft">
      <h3 className="text-sm font-semibold text-ink mb-1">
        Add a {KIND_LABELS[kind].toLowerCase()} model
      </h3>
      <p className="text-xs text-muted mb-3">
        Search OpenRouter&apos;s live catalog. Durations, resolutions, ratios, frames and
        audio are filled in from it; check reference limits against the vendor&apos;s docs.
      </p>
      <form
        className="flex flex-col sm:flex-row gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <TextInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={kind === "text" ? "e.g. claude, gemini, deepseek" : "e.g. kling, veo, flux"}
          spellCheck={false}
        />
        <Btn type="submit" size="md" variant="subtle" disabled={searching}>
          {searching ? "Searching…" : "Search OpenRouter"}
        </Btn>
      </form>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {drafts && (
        <ul className="mt-3 max-h-80 overflow-y-auto divide-y divide-line-soft border border-line rounded-md">
          {drafts.length === 0 && (
            <li className="p-3 text-xs text-muted">
              Nothing matched.{" "}
              {/^[\w.-]+\/[\w.:-]+$/.test(q.trim()) && !existing.has(q.trim()) && (
                <button
                  type="button"
                  className="text-accent underline underline-offset-2"
                  onClick={() => void add({ id: q.trim() })}
                >
                  Add {q.trim()} with blank limits
                </button>
              )}
            </li>
          )}
          {drafts.map((d) => (
            <li key={d.id} className="p-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">
                  {d.label}{" "}
                  <span className="font-mono text-2xs text-muted">{d.id}</span>
                </p>
                <p className="text-2xs text-muted">{policySummary(d)}</p>
              </div>
              {existing.has(d.id) ? (
                <span className="text-2xs text-muted self-center">In the list</span>
              ) : (
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void add({
                      id: d.id,
                      label: d.label,
                      policy: d.policy,
                      pricing: d.pricing,
                      notes: d.notes,
                    })
                  }
                >
                  Add
                </Btn>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ModelsPage() {
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<ModelKind>("video");
  const [filter, setFilter] = useState<"all" | "on">("all");
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/models", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.message || `HTTP ${r.status}`);
        setCfg(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async (body: SaveBody): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message || `HTTP ${res.status}`);
      setCfg(d);
      setSaved("Saved to genforge.config.json");
      window.setTimeout(() => setSaved(null), 2500);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const counts = useMemo(() => {
    const c: Record<ModelKind, { on: number; all: number }> = {
      video: { on: 0, all: 0 },
      image: { on: 0, all: 0 },
      text: { on: 0, all: 0 },
    };
    for (const m of cfg?.models || []) {
      c[m.kind].all++;
      if (m.available) c[m.kind].on++;
    }
    return c;
  }, [cfg]);

  const list = (cfg?.models || []).filter(
    (m) => m.kind === kind && (filter === "all" || m.enabled)
  );
  const textModels = (cfg?.models || []).filter((m) => m.kind === "text");
  const roleOptions = (vision: boolean, current: string) =>
    textModels
      .filter((m) => (m.available || m.id === current) && (!vision || (m.kind === "text" && m.policy.vision)))
      .map((m) => ({ value: m.id, label: m.available ? m.label : `${m.label} (off)` }));

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-panel/70 backdrop-blur sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link
            href="/"
            title="Back to projects"
            aria-label="Back to projects"
            className="inline-flex items-center justify-center w-8 h-8 shrink-0 -ml-1 rounded-md text-muted hover:text-ink hover:bg-panel2 transition-colors"
          >
            ←
          </Link>
          <span className="font-semibold text-xl tracking-[0.08em] text-ink">GENFORGE</span>
          <span className="text-sm text-muted">Models and API keys</span>
          <span className="ml-auto text-xs text-ok" aria-live="polite">
            {saved}
          </span>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-5">
        <p className="text-sm text-muted max-w-[75ch]">
          Turn on the models you want in the Video, Images and Director tabs. Everything
          here — keys, which models are on, their limits and prices — is saved to{" "}
          <code className="font-mono text-xs text-ink">genforge.config.json</code> in the
          project folder, which git ignores. Changes apply without a restart.
        </p>

        {error && (
          <div className="border border-danger/35 bg-danger/10 rounded-lg p-3.5 text-sm text-ink">
            <span className="font-semibold text-danger">Could not save. </span>
            {error}
          </div>
        )}

        {!cfg && !error && <p className="text-sm text-muted py-10 text-center">Loading models…</p>}

        {cfg && (
          <>
            <Panel title="API keys" step="01">
              <div className="flex flex-col gap-3">
                <ProviderCard
                  id="dashscope"
                  info={cfg.providers.dashscope}
                  busy={busy}
                  onSave={save}
                />
                <ProviderCard
                  id="qwencloud"
                  info={cfg.providers.qwencloud}
                  busy={busy}
                  onSave={save}
                  extra={
                    <div className="mt-3">
                      <Field label="Wan video runs on">
                        <Seg
                          value={cfg.videoProvider}
                          onChange={(v) => void save({ videoProvider: v })}
                          options={[
                            { value: "dashscope", label: "DashScope" },
                            { value: "qwencloud", label: "QwenCloud" },
                          ]}
                        />
                      </Field>
                    </div>
                  }
                />
                <ProviderCard
                  id="openrouter"
                  info={cfg.providers.openrouter}
                  busy={busy}
                  onSave={save}
                />
                <ProviderCard
                  id="tokenplan"
                  info={cfg.providers.tokenplan}
                  busy={busy}
                  onSave={save}
                />
              </div>
            </Panel>

            <Panel title="Models" step="02">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <Seg
                  value={kind}
                  onChange={setKind}
                  options={(["video", "image", "text"] as const).map((k) => ({
                    value: k,
                    label: `${KIND_LABELS[k]} ${counts[k].on}/${counts[k].all}`,
                  }))}
                />
                <div className="flex gap-1.5 ml-auto">
                  <Chip active={filter === "all"} onClick={() => setFilter("all")}>
                    All
                  </Chip>
                  <Chip active={filter === "on"} onClick={() => setFilter("on")}>
                    Turned on
                  </Chip>
                </div>
              </div>
              <p className="text-2xs text-muted mb-1">
                The count shows models that are on and have a key. Prices are estimates
                from each vendor&apos;s list price — edit them to match your bill.
              </p>
              <ul>
                {list.map((m) => (
                  <ModelRow key={m.id} m={m} cfg={cfg} busy={busy} onSave={save} />
                ))}
                {list.length === 0 && (
                  <li className="py-6 text-sm text-muted text-center">
                    No {KIND_LABELS[kind].toLowerCase()} models are turned on. Switch to All
                    to pick some.
                  </li>
                )}
              </ul>
              <AddModel
                kind={kind}
                existing={new Set(cfg.models.map((m) => m.id))}
                busy={busy}
                onSave={save}
              />
            </Panel>

            <Panel title="Writing roles" step="03">
              <p className="text-xs text-muted mb-3">
                Which writing model does each job. Only models that are on and have a key
                are listed; if a pick is turned off, the first available one is used.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Director default">
                  <Select
                    value={cfg.roles.director}
                    onChange={(v) => void save({ roles: { director: v } })}
                    options={roleOptions(false, cfg.roles.director)}
                  />
                </Field>
                <Field label="Video prompt rewrite">
                  <Select
                    value={cfg.roles.rewrite}
                    onChange={(v) => void save({ roles: { rewrite: v } })}
                    options={roleOptions(false, cfg.roles.rewrite)}
                  />
                </Field>
                <Field label="Character auto-write" hint="needs image reading">
                  <Select
                    value={cfg.roles.appearance}
                    onChange={(v) => void save({ roles: { appearance: v } })}
                    options={roleOptions(true, cfg.roles.appearance)}
                  />
                </Field>
              </div>
            </Panel>
          </>
        )}
      </main>
    </div>
  );
}
