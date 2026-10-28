"use client";

import { useEffect, useState } from "react";
import TaskCard from "./task-card";
import { ASSET_DND } from "./drop-zone";
import {
  copyFileToClipboard,
  prefetchFile,
  revealInExplorer,
} from "./asset-file-cache";
import { Btn, fmtElapsed, IconBtn, RelocateSelect } from "./ui";
import { formatSGD } from "@/lib/pricing";
import type { TaskRecord } from "@/lib/types";

const overlayBtn =
  "inline-flex items-center justify-center w-7 h-7 rounded-sm text-xs leading-none text-white/75 hover:text-white hover:bg-white/15 transition-colors";

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
  onTogglePinned,
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
  onTogglePinned?: () => void;
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
      className={`cursor-pointer text-left border bg-panel rounded-md overflow-hidden hover:border-accent/60 transition-colors group ${
        selecting && selected
          ? "border-accent ring-1 ring-accent"
          : task.pinned
            ? "border-accent/70"
            : "border-line"
      }`}
    >
      <div className="relative aspect-video bg-black/50 flex items-center justify-center overflow-hidden">
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
            <span className="font-mono text-2xs text-muted">
              {task.status === "submitting" ? "submitting" : task.kind === "video" ? "rendering" : "drawing"}
            </span>
          </div>
        )}
        {!preview && !active && (
          <span className="text-danger text-lg">✕</span>
        )}
        <span
          className={`absolute top-1.5 left-1.5 flex items-center gap-1.5 rounded-full bg-black/65 backdrop-blur-sm px-2 py-1 text-2xs font-medium ${
            task.kind === "video" ? "text-cat-video" : "text-cat-image"
          }`}
        >
          {selecting && (
            <span
              aria-hidden
              className={`-ml-0.5 w-4 h-4 rounded-sm border flex items-center justify-center text-2xs leading-none ${
                selected
                  ? "bg-accent border-accent text-accent-ink"
                  : "bg-black/70 border-muted text-transparent"
              }`}
            >
              ✓
            </span>
          )}
          {active && (
            <span className="w-1.5 h-1.5 rounded-full bg-warn animate-pulse-dot" />
          )}
          {task.kind === "video" ? "Video" : "Image"}
        </span>
        <div
          className={`absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-md bg-black/65 backdrop-blur-sm p-0.5 transition-opacity ${
            task.hidden || task.pinned || task.status === "failed"
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
          }`}
        >
          {task.assetId && preview && (
            <button
              type="button"
              aria-label="Show file in Explorer"
              title="Show file in Explorer"
              onClick={(e) => {
                e.stopPropagation();
                void revealInExplorer(task.assetId!);
              }}
              className={overlayBtn}
            >
              📂
            </button>
          )}
          {task.assetId && preview && (
            <button
              type="button"
              aria-label="Copy file to clipboard"
              title="Copy the file to the clipboard, then paste it into Clipchamp's media bin with Ctrl+V"
              onClick={(e) => {
                e.stopPropagation();
                void copyFileToClipboard(task.assetId!).then((r) => {
                  setCopied(r.ok ? "ok" : "err");
                  window.setTimeout(() => setCopied(null), 2200);
                });
              }}
              className={overlayBtn}
            >
              📋
            </button>
          )}
          {task.assetId && onTogglePinned && (
            <button
              type="button"
              aria-label={task.pinned ? "Unpin asset" : "Pin asset"}
              title={
                task.pinned
                  ? "Unpin — let this asset sort by date again"
                  : "Pin to the top of the Generated grid"
              }
              onClick={(e) => {
                e.stopPropagation();
                onTogglePinned();
              }}
              className={`${overlayBtn} ${task.pinned ? "text-accent" : ""}`}
            >
              📌
            </button>
          )}
          {task.assetId && onToggleHidden && (
            <button
              type="button"
              aria-label={task.hidden ? "Unhide asset" : "Hide asset"}
              title={
                task.hidden
                  ? "Unhide — show this asset in the grid again"
                  : "Hide from the grid (the file stays on disk)"
              }
              onClick={(e) => {
                e.stopPropagation();
                onToggleHidden();
              }}
              className={`${overlayBtn} ${task.hidden ? "text-warn" : ""}`}
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
              className={`${overlayBtn} hover:text-danger`}
            >
              ✕
            </button>
          )}
        </div>
        {copied && (
          <span
            className={`absolute inset-x-1.5 bottom-1.5 z-10 rounded-md bg-black/85 px-2 py-1.5 text-center text-2xs leading-tight ${
              copied === "ok" ? "text-ok" : "text-danger"
            }`}
          >
            {copied === "ok"
              ? "File copied — press Ctrl+V in Clipchamp"
              : "Could not copy the file"}
          </span>
        )}
      </div>
      <div className="px-2 py-1.5 space-y-0.5">
        <p className="text-xs text-ink/80 truncate">
          {task.prompt || <span className="text-muted italic">no prompt</span>}
        </p>
        <p className="text-2xs text-muted flex justify-between gap-2">
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

function sortRank(t: TaskRecord): number {
  if (t.pinned) return 0;
  if (
    t.status === "submitting" ||
    t.status === "queued" ||
    t.status === "running"
  )
    return 1;
  return 2;
}

export default function AssetsGallery({
  tasks,
  onReuse,
  onDelete,
  onToggleHidden,
  onTogglePinned,
  projectId,
  onChanged,
  onUploaded,
}: {
  tasks: TaskRecord[];
  onReuse: (task: TaskRecord) => void;
  onDelete?: (task: TaskRecord) => void;
  onToggleHidden?: (task: TaskRecord) => void;
  onTogglePinned?: (task: TaskRecord) => void;
  projectId: string | null;
  onChanged?: () => void;
  onUploaded?: () => void;
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
  const [bulkNotice, setBulkNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

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
        setBulkNotice({ kind: "err", msg: d?.message || `Could not ${action} the selection (HTTP ${res.status})` });
        return;
      }
      const where =
        target === "none"
          ? "Unassigned"
          : projects.find((p) => p.id === target)?.name || "another project";
      const n = action === "move" ? d.moved : d.copied;
      setBulkNotice({
        kind: "ok",
        msg: `${action === "move" ? "Moved" : "Copied"} ${n} asset${n === 1 ? "" : "s"} to ${where}`,
      });
      setPicked(new Set());
      setSelecting(false);
      onChanged?.();
      setTimeout(() => setBulkNotice(null), 4000);
    } catch {
      setBulkNotice({ kind: "err", msg: `Could not ${action} the selection` });
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
  const shown = (
    filter === "all" ? visible : visible.filter((t) => t.kind === filter)
  )
    .slice()
    .sort((a, b) => sortRank(a) - sortRank(b));

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
      <div className="sticky top-0 z-10 -mx-px px-px pb-3 bg-bg/90 backdrop-blur-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-0.5 p-1 rounded-md border border-line bg-bg">
          {(
            [
              { id: "all", label: "All" },
              { id: "video", label: "Video" },
              { id: "image", label: "Images" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`min-h-7 px-2.5 rounded-sm text-xs font-medium transition-colors ${
                filter === f.id
                  ? "bg-panel2 text-accent shadow-panel"
                  : "text-muted hover:text-ink"
              }`}
            >
              {f.label}
              <span className="ml-1.5 tabular-nums opacity-60">{counts[f.id]}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <IconBtn
            active={showHidden}
            onClick={() => setShowHidden((v) => !v)}
            title={
              hiddenCount
                ? showHidden
                  ? `Showing ${hiddenCount} hidden asset${hiddenCount === 1 ? "" : "s"} — click to hide them again`
                  : `Show ${hiddenCount} hidden asset${hiddenCount === 1 ? "" : "s"}`
                : "No hidden assets yet — hide one with the eye on its tile"
            }
          >
            <span aria-hidden>{showHidden ? "🙈" : "👁"}</span>
            {hiddenCount > 0 && (
              <span className="ml-0.5 text-2xs tabular-nums">{hiddenCount}</span>
            )}
          </IconBtn>
          <IconBtn
            active={selecting}
            onClick={() => {
              setSelecting((v) => !v);
              setPicked(new Set());
            }}
            title="Select multiple assets to move or copy between projects"
          >
            <span aria-hidden>✓</span>
          </IconBtn>
          <div className="flex gap-0.5 p-1 rounded-md border border-line bg-bg ml-1">
            {(
              [
                { id: "large", label: "L" },
                { id: "medium", label: "M" },
                { id: "small", label: "S" },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                title={`${s.id} thumbnails`}
                onClick={() => setThumbSize(s.id)}
                aria-pressed={thumbSize === s.id}
                className={`w-7 h-7 rounded-sm text-xs font-medium transition-colors ${
                  thumbSize === s.id
                    ? "bg-panel2 text-accent"
                    : "text-muted hover:text-ink"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {selecting && (
        <div className="flex flex-wrap items-center gap-2 mt-2 border border-line bg-panel2 rounded-md px-3 py-1.5">
          <span className="text-xs text-ink tabular-nums">
            {picked.size
              ? `${picked.size} selected`
              : "Click tiles to select them"}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <RelocateSelect
              projects={projects}
              currentProjectId={projectId}
              trigger="text"
              triggerLabel={bulkBusy ? "Working…" : "Move or copy"}
              label={`Move or copy ${picked.size} selected asset${picked.size === 1 ? "" : "s"} to another project`}
              disabled={!picked.size || bulkBusy}
              count={picked.size}
              onPick={(action, target) => void bulk(action, target)}
            />
            <Btn
              variant="subtle"
              size="sm"
              onClick={() => {
                setSelecting(false);
                setPicked(new Set());
              }}
            >
              Cancel
            </Btn>
          </div>
        </div>
      )}
      {bulkNotice && (
        <p
          role="status"
          className={`mt-2 border rounded-md px-3 py-2 text-xs ${
            bulkNotice.kind === "ok"
              ? "border-ok/30 bg-ok/10 text-ok"
              : "border-danger/30 bg-danger/10 text-danger"
          }`}
        >
          {bulkNotice.msg}
        </p>
      )}
      </div>
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
            onTogglePinned={
              onTogglePinned ? () => onTogglePinned(t) : undefined
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
                className="text-xs text-muted hover:text-ink border border-line hover:border-muted/60 rounded-md px-3 min-h-8 inline-flex items-center transition-colors"
              >
                ✕ close
              </button>
            </div>
            <TaskCard
              task={selected}
              projectId={projectId}
              onUploaded={onUploaded}
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
