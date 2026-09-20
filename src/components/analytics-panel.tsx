"use client";

import { useEffect, useMemo, useState } from "react";
import { ErrorBox, Panel, Seg } from "./ui";
import { formatSGD, SGD_RATE } from "@/lib/pricing";
import type { CostKind, CostRecord } from "@/lib/types";

type RangeKey = "today" | "week" | "month" | "all" | "custom";
type KindKey = "all" | CostKind;

const RANGES: { id: RangeKey; label: string }[] = [
  { id: "today", label: "today" },
  { id: "week", label: "7 days" },
  { id: "month", label: "1 month" },
  { id: "all", label: "all time" },
  { id: "custom", label: "custom" },
];

const KINDS: { id: KindKey; label: string }[] = [
  { id: "all", label: "all" },
  { id: "video", label: "video" },
  { id: "image", label: "image" },
  { id: "director", label: "director" },
  { id: "rewrite", label: "rewrite" },
];

const KIND_COLORS: Record<CostKind, string> = {
  video: "text-accent border-accent/40",
  image: "text-[#7cc7ff] border-[#7cc7ff]/40",
  director: "text-warn border-warn/40",
  rewrite: "text-[#c58cff] border-[#c58cff]/40",
};

const KIND_HEX: Record<CostKind, string> = {
  video: "var(--color-accent)",
  image: "#7cc7ff",
  director: "var(--color-warn)",
  rewrite: "#c58cff",
};

const KIND_ORDER: CostKind[] = ["video", "image", "director", "rewrite"];

type Bucket = {
  key: string;
  label: string;
  full: string;
  cost: Record<CostKind, number>;
  n: Record<CostKind, number>;
  costTotal: number;
  nTotal: number;
};

function fmtCompact(n: number): string {
  const v = n * SGD_RATE;
  if (!v) return "";
  if (v >= 100) return `S$${Math.round(v)}`;
  if (v >= 10) return `S$${v.toFixed(1)}`;
  return `S$${v.toFixed(2)}`;
}

function zeroed(): Pick<Bucket, "cost" | "n"> {
  return {
    cost: { video: 0, image: 0, director: 0, rewrite: 0 },
    n: { video: 0, image: 0, director: 0, rewrite: 0 },
  };
}

function buildBuckets(
  range: RangeKey,
  from: number,
  to: number,
  records: CostRecord[]
): { unit: "hour" | "day" | "month"; buckets: Bucket[] } {
  const floorDay = (ts: number) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const spanDays = (to - from) / 864e5;
  const unit: "hour" | "day" | "month" =
    range === "today"
      ? "hour"
      : range === "all" || (range === "custom" && spanDays > 60)
        ? "month"
        : "day";

  const starts: number[] = [];
  if (unit === "hour") {
    const day = floorDay(to);
    for (let h = 0; h < 24; h++) {
      const s = new Date(day);
      s.setHours(h, 0, 0, 0);
      if (s.getTime() <= to) starts.push(s.getTime());
    }
  } else if (unit === "day") {
    const dayCount = Math.min(Math.ceil(spanDays) + 1, 60);
    let s = floorDay(floorDay(to) - (dayCount - 1) * 864e5);
    const last = floorDay(to);
    let guard = 0;
    while (s <= last && guard++ < 400) {
      starts.push(s);
      const d = new Date(s);
      d.setDate(d.getDate() + 1);
      s = d.getTime();
    }
  } else {
    const first = records.length
      ? records.reduce((m, r) => Math.min(m, r.createdAt), Infinity)
      : from;
    const d = new Date(Math.max(isFinite(first) ? first : to, range === "all" ? 0 : from));
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setDate(1);
    let guard = 0;
    while (d <= end && guard++ < 400) {
      starts.push(d.getTime());
      d.setMonth(d.getMonth() + 1);
    }
  }

  const agg = new Map<string, Pick<Bucket, "cost" | "n">>();
  const keyOf = (ts: number) => {
    const d = new Date(ts);
    if (unit === "hour") return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
    if (unit === "day") return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    return `${d.getFullYear()}-${d.getMonth()}`;
  };
  for (const r of records) {
    const k = keyOf(r.createdAt);
    let slot = agg.get(k);
    if (!slot) {
      slot = zeroed();
      agg.set(k, slot);
    }
    slot.n[r.kind] += 1;
    slot.cost[r.kind] += r.estimate || 0;
  }

  const buckets: Bucket[] = starts.map((s) => {
    const d = new Date(s);
    const key = keyOf(s);
    const slot = agg.get(key) || zeroed();
    const label =
      unit === "hour"
        ? `${d.getHours()}h`
        : unit === "day"
          ? `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
          : `${d.toLocaleString(undefined, { month: "short" })} ${String(d.getFullYear()).slice(2)}`;
    const full =
      unit === "hour"
        ? d.toLocaleString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          }) + ` ${String(d.getHours()).padStart(2, "0")}:00–${String((d.getHours() + 1) % 24).padStart(2, "0")}:00`
        : unit === "day"
          ? d.toLocaleDateString(undefined, {
              weekday: "short",
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
    const costTotal = KIND_ORDER.reduce((v, k) => v + slot.cost[k], 0);
    const nTotal = KIND_ORDER.reduce((v, k) => v + slot.n[k], 0);
    return { key, label, full, ...slot, costTotal, nTotal };
  });
  return { unit, buckets };
}

function rangeBounds(
  range: RangeKey,
  fromStr: string,
  toStr: string
): { from: number; to: number } {
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  switch (range) {
    case "today":
      return { from: dayStart.getTime(), to: now };
    case "week":
      return { from: now - 7 * 864e5, to: now };
    case "month":
      return { from: now - 30 * 864e5, to: now };
    case "custom": {
      const from = fromStr ? new Date(`${fromStr}T00:00:00`).getTime() : 0;
      const to = toStr ? new Date(`${toStr}T23:59:59.999`).getTime() : now;
      return { from, to: Number.isNaN(to) ? now : to };
    }
    default:
      return { from: 0, to: now };
  }
}

function fmtDay(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line bg-panel2 rounded-md px-3 py-2.5">
      <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted">
        {label}
      </p>
      <p className="font-display font-bold text-lg text-ink mt-0.5">{value}</p>
    </div>
  );
}

export default function AnalyticsPanel({
  projectId,
}: {
  projectId: string | null;
}) {
  const [records, setRecords] = useState<CostRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [kind, setKind] = useState<KindKey>("all");
  const [metric, setMetric] = useState<"cost" | "count">("cost");
  const [allScope, setAllScope] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const qs = allScope
      ? ""
      : `?project=${projectId === null ? "none" : projectId}`;
    fetch(`/api/analytics${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setRecords(Array.isArray(d.records) ? d.records : []);
        setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load analytics");
      });
    return () => {
      cancelled = true;
    };
  }, [allScope, projectId]);

  const { from, to } = rangeBounds(range, customFrom, customTo);

  const filtered = useMemo(
    () =>
      records.filter(
        (r) =>
          r.createdAt >= from &&
          r.createdAt <= to &&
          (kind === "all" || r.kind === kind)
      ),
    [records, from, to, kind]
  );

  const span = useMemo(() => {
    if (!filtered.length) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of filtered) {
      if (r.createdAt < lo) lo = r.createdAt;
      if (r.createdAt > hi) hi = r.createdAt;
    }
    return { lo, hi };
  }, [filtered]);

  const stats = useMemo(() => {
    let total = 0;
    let costed = 0;
    const byKind: Record<CostKind, { n: number; cost: number }> = {
      video: { n: 0, cost: 0 },
      image: { n: 0, cost: 0 },
      director: { n: 0, cost: 0 },
      rewrite: { n: 0, cost: 0 },
    };
    for (const r of filtered) {
      byKind[r.kind].n += 1;
      if (r.estimate) {
        total += r.estimate;
        costed += 1;
        byKind[r.kind].cost += r.estimate;
      }
    }
    return { total, costed, byKind };
  }, [filtered]);

  const { unit, buckets } = useMemo(
    () => buildBuckets(range, from, to, filtered),
    [range, from, to, filtered]
  );
  const max = Math.max(
    ...buckets.map((b) => (metric === "cost" ? b.costTotal : b.nTotal)),
    metric === "cost" ? 0.0001 : 1
  );
  const hasData = buckets.some((b) => b.nTotal > 0);
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 12));

  const counts: Record<KindKey, number> = {
    all: records.filter((r) => r.createdAt >= from && r.createdAt <= to).length,
    video: 0,
    image: 0,
    director: 0,
    rewrite: 0,
  };
  for (const r of records) {
    if (r.createdAt < from || r.createdAt > to) continue;
    counts[r.kind] += 1;
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Period">
        <div className="flex flex-wrap items-center gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-[0.1em] border transition-colors ${
                range === r.id
                  ? "border-accent/60 text-accent bg-accent/10"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          ))}
          {range === "custom" && (
            <span className="flex items-center gap-1.5 ml-1">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-panel2 border border-line rounded px-2 py-1 text-xs text-ink font-mono outline-none focus:border-accent/60"
              />
              <span className="text-muted text-xs">→</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="bg-panel2 border border-line rounded px-2 py-1 text-xs text-ink font-mono outline-none focus:border-accent/60"
              />
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAllScope(false)}
              aria-pressed={!allScope}
              title="Show only cost records from the project you have open"
              className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-[0.1em] border transition-colors ${
                !allScope
                  ? "border-accent/60 text-accent bg-accent/10"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              current project
            </button>
            <button
              type="button"
              onClick={() => setAllScope(true)}
              aria-pressed={allScope}
              title="Show cost records from every project in this workspace"
              className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-[0.1em] border transition-colors ${
                allScope
                  ? "border-accent/60 text-accent bg-accent/10"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              all projects
            </button>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-[0.1em] border transition-colors ${
                kind === k.id
                  ? "border-accent/60 text-accent bg-accent/10"
                  : "border-line text-muted hover:text-ink"
              }`}
            >
              {k.label} <span className="opacity-70">({counts[k.id]})</span>
            </button>
          ))}
        </div>
        <p className="mt-3 pt-2.5 border-t border-line text-[11px] font-mono text-muted">
          showing{" "}
          <span className="text-accent">{filtered.length}</span>{" "}
          record{filtered.length === 1 ? "" : "s"} ·{" "}
          <span className="text-ink">
            {span
              ? span.hi - span.lo < 864e5 && range === "today"
                ? `today, ${fmtDay(span.lo)}`
                : `${fmtDay(span.lo)} – ${fmtDay(span.hi)}`
              : range === "all"
                ? "no records yet"
                : `${fmtDay(from)} – ${fmtDay(to)}`}
          </span>{" "}
          · <span className="text-ink">{allScope ? "all projects" : "current project"}</span>
        </p>
      </Panel>

      {error && <ErrorBox code="Analytics" message={error} />}

      {!loaded && !error && (
        <p className="text-sm text-muted font-mono py-6 text-center">
          loading records…
        </p>
      )}

      {loaded && !error && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="est. spend (S$)" value={formatSGD(stats.total || null)} />
            <Stat label="generations" value={String(filtered.length)} />
            <Stat label="billed (est.)" value={String(stats.costed)} />
            <Stat
              label="avg / gen"
              value={formatSGD(stats.costed ? stats.total / stats.costed : null)}
            />
          </div>

          <Panel title="By type">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(["video", "image", "director", "rewrite"] as const).map((k) => (
                <div key={k} className="border border-line bg-panel2 rounded-md px-3 py-2.5">
                  <p
                    className={`text-[10px] font-mono uppercase tracking-[0.14em] border rounded px-1.5 py-0.5 inline-block ${KIND_COLORS[k]}`}
                  >
                    {k}
                  </p>
                  <p className="font-display font-bold text-lg text-ink mt-1.5">
                    {formatSGD(stats.byKind[k].cost || null)}
                  </p>
                  <p className="text-[10px] font-mono text-muted">
                    {stats.byKind[k].n} generation{stats.byKind[k].n === 1 ? "" : "s"}
                  </p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title={`Usage by ${unit}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div className="w-52">
                <Seg
                  value={metric}
                  onChange={setMetric}
                  options={[
                    { value: "cost", label: "est. cost (S$)" },
                    { value: "count", label: "generations" },
                  ]}
                />
              </div>
              <div className="flex items-center gap-3">
                {KIND_ORDER.map((k) => (
                  <span
                    key={k}
                    className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-muted"
                  >
                    <span
                      className="w-2 h-2 rounded-sm"
                      style={{ background: KIND_HEX[k] }}
                    />
                    {k}
                  </span>
                ))}
                <span className="text-[10px] font-mono text-muted">
                  peak{" "}
                  {metric === "cost"
                    ? formatSGD(max)
                    : `${Math.round(max)} gen`}
                </span>
              </div>
            </div>
            {hasData ? (
              <>
                <div className="flex items-end gap-[3px] h-40 border-b border-line">
                  {buckets.map((b) => {
                    const total =
                      metric === "cost" ? b.costTotal : b.nTotal;
                    const segs = KIND_ORDER.filter(
                      (k) =>
                        (metric === "cost" ? b.cost[k] : b.n[k]) > 0
                    );
                    return (
                      <div
                        key={b.key}
                        className="flex-1 min-w-0 h-full flex flex-col justify-end"
                        title={
                          b.full +
                          segs
                            .map(
                              (k) =>
                                ` · ${k} ${
                                  metric === "cost"
                                    ? formatSGD(b.cost[k])
                                    : b.n[k]
                                }`
                            )
                            .join("") +
                          (total
                            ? ` · total ${
                                metric === "cost"
                                  ? formatSGD(total)
                                  : total
                              }`
                            : "")
                        }
                      >
                        {total > 0 && (
                          <span
                            className={`text-[8px] font-mono text-muted text-center leading-none pb-1 ${
                              buckets.length > 14
                                ? "[writing-mode:vertical-rl] rotate-180 mx-auto"
                                : ""
                            }`}
                          >
                            {metric === "cost"
                              ? fmtCompact(total)
                              : `${total}g`}
                          </span>
                        )}
                        {total > 0 && (
                          <div
                            className="w-full rounded-t-[2px] overflow-hidden flex flex-col-reverse"
                            style={{
                              height: `${Math.max((total / max) * 100, 2)}%`,
                            }}
                          >
                            {segs.map((k) => {
                              const v =
                                metric === "cost" ? b.cost[k] : b.n[k];
                              return (
                                <div
                                  key={k}
                                  style={{
                                    height: `${(v / total) * 100}%`,
                                    background: KIND_HEX[k],
                                    opacity: 0.85,
                                  }}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-[3px] mt-1">
                  {buckets.map((b, i) => (
                    <span
                      key={b.key}
                      className="flex-1 min-w-0 text-center text-[9px] font-mono text-muted truncate"
                    >
                      {i % labelEvery === 0 ||
                      i === buckets.length - 1
                        ? b.label
                        : ""}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted py-4 text-center">
                No usage in this range / filter.
              </p>
            )}
          </Panel>

          <Panel title="Records">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted py-4 text-center">
                No records in this range / filter.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted border-b border-line">
                      <th className="py-1.5 pr-3">when</th>
                      <th className="py-1.5 pr-3">type</th>
                      <th className="py-1.5 pr-3">model</th>
                      <th className="py-1.5 pr-3">prompt</th>
                      <th className="py-1.5 text-right">est. cost (S$)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 60).map((r) => (
                      <tr
                        key={r.id}
                        className="text-[11px] font-mono border-b border-line/50"
                      >
                        <td className="py-1.5 pr-3 text-muted whitespace-nowrap">
                          {new Date(r.createdAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-1.5 pr-3">
                          <span
                            className={`border rounded px-1.5 py-0.5 text-[9px] uppercase ${KIND_COLORS[r.kind]}`}
                          >
                            {r.kind}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-ink/80 max-w-[140px] truncate">
                          {r.model}
                        </td>
                        <td
                          className="py-1.5 pr-3 text-muted max-w-[220px] truncate"
                          title={r.prompt}
                        >
                          {r.prompt || "—"}
                        </td>
                        <td className="py-1.5 text-right text-accent">
                          {r.estimate ? formatSGD(r.estimate) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length > 60 && (
                  <p className="mt-2 text-[10px] font-mono text-muted">
                    showing latest 60 of {filtered.length}
                  </p>
                )}
              </div>
            )}
          </Panel>
        </>
      )}

      <p className="text-[10px] font-mono text-muted">
        all costs shown in SGD (fixed 1.3 × USD); underlying estimates come
        from rates in src/lib/pricing.ts · failed generations are not expected
        to incur cost · director runs are recorded from now on (earlier ones
        are missing)
      </p>
    </div>
  );
}
