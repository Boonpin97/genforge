"use client";

import { useEffect, useState } from "react";
import TaskCard from "./task-card";
import { ASSET_DND } from "./drop-zone";
import {
  copyFileToClipboard,
  prefetchFile,
  revealInExplorer,
} from "./asset-file-cache";
import { fmtElapsed } from "./ui";
import { formatSGD } from "@/lib/pricing";
import type { TaskRecord } from "@/lib/types";

type KindFilter = "all" | "video" | "image";
type ThumbSize = "large" | "medium" | "small";

const MIN_COL_PX: Record<ThumbSize, number> = {
  large: 300,
  medium: 200,
  small: 140,
};

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function Tile({
  task,
  now,
  onOpen,
  onDelete,
  onToggleHidden,
  selecting,
  selected,
}: {
  task: TaskRecord;
  now: number;
  onOpen: () => void;
  onDelete?: () => void;
  selecting: boolean;
  selected: boolean;
  onToggleHidden?: () => void;
}) {
  const active =
    task.status === "submitting" ||
    task.status === "queued" ||
    task.status === "running";
  const preview = task.videoUrl
    ? ("video" as const)
    : task.imageUrls?.[0]
      ? ("image" as const)
      : null;
  const [copied, setCopied] = useState<"ok" | "err" | null>(null);
  const assetUrl = task.videoUrl || task.imageUrls?.[0] || "";
  const absUrl = assetUrl
    ? /^https?:/i.test(assetUrl)
      ? assetUrl
      : `${window.location.origin}${assetUrl}`
    : "";

  return (
    <div
      role="button"
      tabIndex={0}
      title={
        assetUrl
          ? "Click for details · drag into a reference zone below, or out to an Explorer window · 📋 copies the file so you can paste it into Clipchamp · 📂 shows it in Explorer"
          : undefined
      }
      draggable={!!assetUrl}
      onPointerEnter={() => {
        if (absUrl)
          void prefetchFile(absUrl, `genforge-${task.id.slice(0, 8)}`);
      }}
      onDragStart={(e) => {
        if (!assetUrl) return;
        const isVid = !!task.videoUrl;
        const payload = JSON.stringify({
          url: assetUrl,
          name: (task.prompt || task.kind).slice(0, 24),
          kind: isVid ? "video" : "image",
        });
        e.dataTransfer.setData(ASSET_DND, payload);
        e.dataTransfer.setData("text/plain", absUrl);
        e.dataTransfer.setData(
          "DownloadURL",
          `${isVid ? "video/mp4" : "image/png"}:genforge-${task.id.slice(0, 8)}.${isVid ? "mp4" : "png"}:${absUrl}`
        );
        void prefetchFile(absUrl, `genforge-${task.id.slice(0, 8)}`);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer text-left border border-line bg-panel rounded-md overflow-hidden hover:border-accent/60 transition-colors group"
    >
      <div className="relative aspect-video bg-black/50 flex items-center justify-center overflow-hidden">
        {selecting && (
          <span
            aria-hidden
            className={`absolute top-1.5 left-1.5 z-10 w-4 h-4 rounded-sm border flex items-center justify-center text-[10px] leading-none ${
              selected
                ? "bg-accent border-accent text-[#10130c]"
                : "bg-black/70 border-muted text-transparent"
            }`}
          >
            ✓
          </span>
        )}
        {preview === "video" && (
          <video
            src={task.videoUrl}
            muted
            playsInline
            loop
            draggable={false}
            preload="metadata"
            className="w-full h-full object-cover bg-black"
            onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
            onMouseLeave={(e) => e.currentTarget.pause()}
          />
        )}
        {preview === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={task.imageUrls![0]}
            alt={task.prompt || "generated image"}
            className="w-full h-full object-cover"
          />
        )}
        {!preview && active && (
          <div className="flex flex-col items-center gap-1 px-2 text-center">
            <span className="font-mono text-sm text-warn">
              ⏱ {fmtElapsed(task, now)}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
              {task.status === "submitting" ? "submitting" : task.kind === "video" ? "rendering" : "drawing"}
            </span>
          </div>
        )}
        {!preview && !active && (
          <span className="text-danger text-lg font-mono">✕</span>
        )}
        <span
          className={`absolute top-1.5 left-1.5 font-display font-semibold text-[9px] tracking-[0.16em] uppercase px-1.5 py-0.5 rounded border bg-black/60 ${
            task.kind === "video"
              ? "text-accent border-accent/40"
              : "text-[#7cc7ff] border-[#7cc7ff]/40"
          }`}
        >
          {task.kind}
        </span>
        {active && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-warn animate-pulse-dot" />
        )}
        {task.assetId && preview && (
          <button
            type="button"
            aria-label="Show file in Explorer"
            title="Show file in Explorer"
            onClick={(e) => {
              e.stopPropagation();
              void revealInExplorer(task.assetId!);
            }}
            className="absolute top-1 right-7 h-5 px-1.5 rounded bg-black/70 text-[10px] font-mono leading-none text-muted hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity"
          >
            📂
          </button>
        )}
        {task.assetId && preview && (
          <button
            type="button"
            aria-label="Copy file to clipboard"
            title="Copy the file to the clipboard — then paste into Clipchamp's media bin with Ctrl+V"
            onClick={(e) => {
              e.stopPropagation();
              void copyFileToClipboard(task.assetId!).then((r) => {
                setCopied(r.ok ? "ok" : "err");
                window.setTimeout(() => setCopied(null), 2200);
              });
            }}
            className="absolute top-1 right-[3.25rem] h-5 px-1.5 rounded bg-black/70 text-[10px] font-mono leading-none text-muted hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity"
          >
            📋
          </button>
        )}
        {copied && (
          <span
            className={`absolute inset-x-1 bottom-1 z-10 rounded px-1.5 py-1 text-center font-mono text-[10px] leading-tight ${
              copied === "ok"
                ? "bg-black/85 text-accent"
                : "bg-black/85 text-danger"
            }`}
          >
            {copied === "ok"
              ? "file copied — Ctrl+V in Clipchamp"
              : "clipboard copy failed"}
          </span>
        )}
        {task.assetId && onToggleHidden && (
          <button
            type="button"
            aria-label={task.hidden ? "Unhide asset" : "Hide asset"}
            title={
              task.hidden
                ? "Unhide — show this asset in the grid again"
                : "Hide from the grid (the file is kept on disk)"
            }
            onClick={(e) => {
              e.stopPropagation();
              onToggleHidden();
            }}
            className={`absolute top-1 right-[4.75rem] h-5 px-1.5 rounded bg-black/70 text-[10px] font-mono leading-none transition-opacity hover:text-accent ${
              task.hidden
                ? "text-warn opacity-100"
                : "text-muted opacity-0 group-hover:opacity-100"
            }`}
          >
            {task.hidden ? "🙈" : "👁"}
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            aria-label="Delete asset"
            title={
              task.assetId
                ? "Delete saved asset"
                : task.status === "failed"
                  ? "Delete failed generation"
                  : "Remove from list"
            }
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className={`absolute top-1 right-1 w-5 h-5 rounded bg-black/70 text-muted hover:text-danger text-xs leading-none transition-opacity ${
              task.status === "failed"
                ? "opacity-80 group-hover:opacity-100"
                : "opacity-0 group-hover:opacity-100"
            }`}
          >
            ✕
          </button>
        )}
      </div>
      <div className="px-2 py-1.5 space-y-0.5">
        <p className="text-[10px] font-mono text-ink/80 truncate">
          {task.prompt || <span className="text-muted italic">no prompt</span>}
        </p>
        <p className="text-[10px] font-mono text-muted flex justify-between gap-2">
          <span className="truncate">
            {task.model}
            {task.assetId ? " · saved" : ""}
          </span>
          <span className="shrink-0">
            {task.status === "succeeded" && task.estimate ? (
              <span className="text-accent" title="Estimated cost (SGD @ 1.3 USD)">
                {formatSGD(task.estimate)}
              </span>
            ) : task.status === "failed" ? (
              <span className="text-danger">S$0</span>
            ) : (
              <span>…</span>
            )}
            <span> · {timeAgo(task.createdAt)}</span>
          </span>
        </p>
      </div>
    </div>
  );
}

export default function AssetsGallery({
  tasks,
  onReuse,
  onDelete,
  onToggleHidden,
  projectId,
  onChanged,
}: {
  tasks: TaskRecord[];
  onReuse: (task: TaskRecord) => void;
  onDelete?: (task: TaskRecord) => void;
  onToggleHidden?: (task: TaskRecord) => void;
  projectId: string | null;
  onChanged?: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<KindFilter>("all");
  const [thumbSize, setThumbSize] = useState<ThumbSize>("medium");
  const [showHidden, setShowHidden] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.projects))
          setProjects(
            d.projects.map((p: { id: string; name: string }) => ({
              id: p.id,
              name: p.name,
            }))
          );
      })
      .catch(() => {});
  }, []);

  async function bulk(action: "move" | "copy", target: string) {
    if (!picked.size || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/assets/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ids: [...picked],
          projectId: target === "none" ? null : target,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setBulkNotice(d?.message || `HTTP ${res.status}`);
        return;
      }
      setBulkNotice(
        action === "move" ? `moved ${d.moved}` : `copied ${d.copied}`
      );
      setPicked(new Set());
      setSelecting(false);
      onChanged?.();
      setTimeout(() => setBulkNotice(null), 2500);
    } catch {
      setBulkNotice("bulk action failed");
    } finally {
      setBulkBusy(false);
    }
  }

  function togglePick(id: string) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  const anyActive = tasks.some(
    (t) =>
      t.status === "submitting" ||
      t.status === "queued" ||
      t.status === "running"
  );
  const selected = tasks.find((t) => t.id === selectedId) || null;
  const visible = showHidden ? tasks : tasks.filter((t) => !t.hidden);
  const hiddenCount = tasks.filter((t) => t.hidden).length;
  const shown =
    filter === "all" ? visible : visible.filter((t) => t.kind === filter);

  useEffect(() => {
    if (!anyActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyActive]);
  const counts: Record<KindFilter, number> = {
    all: visible.length,
    video: visible.filter((t) => t.kind === "video").length,
    image: visible.filter((t) => t.kind === "image").length,
  };

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const v = localStorage.getItem("genforge.thumbSize");
      if (v === "large" || v === "medium" || v === "small") setThumbSize(v);
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("genforge.thumbSize", thumbSize);
    } catch {}
  }, [thumbSize]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  return (
    <>
      <div className="flex items-center gap-1.5 mb-3">
        {(["all", "video", "image"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-[0.12em] border transition-colors ${
              filter === f
                ? "border-accent/60 text-accent bg-accent/10"
                : "border-line text-muted hover:text-ink"
            }`}
          >
            {f} <span className="opacity-70">({counts[f]})</span>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={showHidden}
          onClick={() => setShowHidden((v) => !v)}
          title={
            hiddenCount
              ? showHidden
                ? `Showing ${hiddenCount} hidden asset${hiddenCount === 1 ? "" : "s"} — click to hide them again`
                : `${hiddenCount} hidden asset${hiddenCount === 1 ? "" : "s"} — click to show them`
              : "No hidden assets yet — hide one with 👁 on its tile"
          }
          className={`ml-auto h-6 px-1.5 rounded text-[10px] font-mono border transition-colors ${
            showHidden
              ? "border-warn/60 text-warn bg-warn/10"
              : "border-line text-muted hover:text-ink"
          }`}
        >
          {showHidden ? "🙈" : "👁"}
          {hiddenCount > 0 && <span className="ml-1">{hiddenCount}</span>}
        </button>
        <span
          className="text-[10px] font-mono text-muted mr-1 ml-2"
          title="Thumbnail size"
        >
          size
        </span>
        {(["large", "medium", "small"] as const).map((s) => (
          <button
            key={s}
            type="button"
            title={`${s} thumbnails`}
            onClick={() => setThumbSize(s)}
            className={`w-6 h-6 rounded text-[10px] font-mono uppercase border transition-colors ${
              thumbSize === s
                ? "border-accent/60 text-accent bg-accent/10"
                : "border-line text-muted hover:text-ink"
            }`}
          >
            {s[0]}
          </button>
        ))}
        <button
          type="button"
          title="Select multiple assets to move/copy between projects"
          onClick={() => {
            setSelecting((v) => !v);
            setPicked(new Set());
          }}
          className={`w-6 h-6 rounded text-[10px] font-mono uppercase border transition-colors ${
            selecting
              ? "border-accent/60 text-accent bg-accent/10"
              : "border-line text-muted hover:text-ink"
          }`}
        >
          ✓
        </button>
      </div>
      {selecting && (
        <div className="flex flex-wrap items-center gap-2 mb-3 border border-line bg-panel2/60 rounded px-3 py-2">
          <span className="text-[11px] font-mono text-muted">
            {picked.size} selected
          </span>
          <select
            value=""
            disabled={!picked.size || bulkBusy}
            onChange={(e) => e.target.value && void bulk("move", e.target.value)}
            className="bg-panel2 border border-line rounded px-2 py-1 text-[11px] font-mono text-ink outline-none focus:border-accent/60 disabled:opacity-40"
          >
            <option value="">move to…</option>
            {projects
              .filter((p) => p.id !== projectId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            {projectId !== null && <option value="none">Unassigned</option>}
          </select>
          <select
            value=""
            disabled={!picked.size || bulkBusy}
            onChange={(e) => e.target.value && void bulk("copy", e.target.value)}
            className="bg-panel2 border border-line rounded px-2 py-1 text-[11px] font-mono text-ink outline-none focus:border-accent/60 disabled:opacity-40"
          >
            <option value="">copy to…</option>
            {projects
              .filter((p) => p.id !== projectId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            {projectId !== null && <option value="none">Unassigned</option>}
          </select>
          <button
            type="button"
            onClick={() => {
              setSelecting(false);
              setPicked(new Set());
            }}
            className="text-[11px] font-mono text-muted hover:text-ink"
          >
            cancel
          </button>
          {bulkNotice && (
            <span className="text-[11px] font-mono text-accent">
              {bulkNotice}
            </span>
          )}
        </div>
      )}
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_COL_PX[thumbSize]}px, 1fr))`,
        }}
      >
        {shown.map((t) => (
          <Tile
            key={t.id}
            task={t}
            now={now}
            selecting={selecting}
            selected={picked.has(t.id)}
            onToggleHidden={
              onToggleHidden ? () => onToggleHidden(t) : undefined
            }
            onOpen={() =>
              selecting
                ? t.assetId
                  ? togglePick(t.id)
                  : undefined
                : setSelectedId(t.id)
            }
            onDelete={
              onDelete
                ? () => {
                    onDelete(t);
                    if (selectedId === t.id) setSelectedId(null);
                  }
                : undefined
            }
          />
        ))}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setSelectedId(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-2xl my-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="text-xs font-mono text-muted hover:text-ink border border-line hover:border-muted rounded px-2 py-1 transition-colors"
              >
                ✕ close
              </button>
            </div>
            <TaskCard
              task={selected}
              onReuse={
                selected.settings
                  ? (t) => {
                      onReuse(t);
                      setSelectedId(null);
                    }
                  : undefined
              }
            />
          </div>
        </div>
      )}
    </>
  );
}
