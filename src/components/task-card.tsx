"use client";

import { useEffect, useState, type DragEvent } from "react";
import { Btn, ErrorBox, StatusBadge, fmtElapsed } from "./ui";
import { getCachedFile, prefetchFile, revealInExplorer } from "./asset-file-cache";
import { formatSGD } from "@/lib/pricing";
import type { ImageUsage, TaskRecord, VideoUsage } from "@/lib/types";

const PREVIEWABLE = /^(\/|data:|blob:|https?:)/i;

type RefPreview = {
  kind: "image" | "video";
  url: string;
  name: string;
};

function refPreviews(task: TaskRecord): { refs: RefPreview[]; voices: string[] } {
  const refs: RefPreview[] = [];
  const voices: string[] = [];
  if (task.settings?.kind === "video") {
    for (const m of task.settings.media) {
      if (m.type === "reference_audio") {
        voices.push(m.name || "voice sample");
        continue;
      }
      const raw = m.previewUrl || m.url;
      refs.push({
        kind: m.type === "reference_video" ? "video" : "image",
        url: PREVIEWABLE.test(raw) ? raw : "",
        name: m.name || (m.type === "reference_video" ? "video" : "image"),
      });
    }
  } else if (task.settings?.kind === "image") {
    for (const im of task.settings.images) {
      refs.push({
        kind: "image",
        url: PREVIEWABLE.test(im.url) ? im.url : "",
        name: im.name,
      });
    }
  }
  return { refs, voices };
}

function PromptSources({ task }: { task: TaskRecord }) {
  const [open, setOpen] = useState(false);
  const s = task.settings;
  if (s?.kind !== "video" || !s.rewrotePrompt) return null;
  const usedRewritten = s.promptTab === "rewritten" || Boolean(task.params?.rewrite);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] font-mono text-accent hover:underline"
      >
        {open ? "− hide" : "+ prompt sources"} ·{" "}
        <span className="text-muted">
          sent: {usedRewritten ? "rewritten" : "prompt"}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="border border-line rounded bg-panel2 px-2.5 py-2">
            <p className="text-[9px] uppercase tracking-[0.14em] text-muted mb-1">
              original{!usedRewritten ? " · sent" : ""}
            </p>
            <p className="text-[11px] font-mono text-ink/80 whitespace-pre-wrap line-clamp-6">
              {s.userPrompt || "—"}
            </p>
          </div>
          <div className="border border-line rounded bg-panel2 px-2.5 py-2">
            <p className="text-[9px] uppercase tracking-[0.14em] text-muted mb-1">
              rewritten{usedRewritten ? " · sent" : ""}
            </p>
            <p className="text-[11px] font-mono text-ink/80 whitespace-pre-wrap line-clamp-6">
              {s.rewrotePrompt}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function dragOut(url: string, isVid: boolean, id: string) {
  const abs = /^https?:/i.test(url)
    ? url
    : `${window.location.origin}${url}`;
  return {
    draggable: true,
    title: "Drag out to Explorer to save (for Clipchamp use 📂 show in Explorer)",
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(
        "DownloadURL",
        `${isVid ? "video/mp4" : "image/png"}:genforge-${id.slice(0, 8)}.${isVid ? "mp4" : "png"}:${abs}`
      );
      e.dataTransfer.setData("text/plain", abs);
      const file = getCachedFile(abs);
      if (file) {
        try {
          e.dataTransfer.items.add(file);
        } catch {}
      }
      void prefetchFile(abs, `genforge-${id.slice(0, 8)}`);
      e.dataTransfer.effectAllowed = "copy";
    },
  };
}

function Usage({ task }: { task: TaskRecord }) {
  const u = task.usage;
  if (!u) return null;
  const rows: [string, string][] = [];
  if (task.kind === "video") {
    const v = u as VideoUsage;
    if (v.output_video_duration || v.duration)
      rows.push(["output duration", `${v.output_video_duration ?? v.duration}s`]);
    if (v.input_video_duration)
      rows.push(["input video duration", `${v.input_video_duration}s`]);
    if (v.SR) rows.push(["resolution", `${v.SR}P`]);
    if (v.ratio) rows.push(["ratio", v.ratio]);
    if (v.fps) rows.push(["fps", String(v.fps)]);
    if (v.video_count) rows.push(["videos", String(v.video_count)]);
  } else {
    const im = u as ImageUsage;
    if (im.output_width && im.output_height)
      rows.push(["output size", `${im.output_width}×${im.output_height}`]);
    if (im.output_image_count)
      rows.push(["images out", String(im.output_image_count)]);
    if (im.output_image_type) rows.push(["output tier", im.output_image_type]);
    if (im.input_image_count)
      rows.push(["images in", String(im.input_image_count)]);
    if (im.input_image_type && im.input_image_count)
      rows.push(["input tier", im.input_image_type]);
  }
  if (!rows.length) return null;
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mt-3">
      {rows.map(([k, val]) => (
        <div key={k} className="flex justify-between gap-2 border-b border-line/50 py-0.5">
          <dt className="text-[10px] uppercase tracking-wider text-muted">{k}</dt>
          <dd className="font-mono text-[11px] text-ink">{val}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function TaskCard({
  task,
  onReuse,
}: {
  task: TaskRecord;
  onReuse?: (task: TaskRecord) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const active = task.status === "queued" || task.status === "running" || task.status === "submitting";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  useEffect(() => {
    const base = `genforge-${task.id.slice(0, 8)}`;
    if (task.videoUrl) {
      const abs = /^https?:/i.test(task.videoUrl)
        ? task.videoUrl
        : `${window.location.origin}${task.videoUrl}`;
      void prefetchFile(abs, base);
    }
    (task.imageUrls || []).forEach((u, i) => {
      const abs = /^https?:/i.test(u) ? u : `${window.location.origin}${u}`;
      void prefetchFile(abs, `${base}-${i + 1}`);
    });
  }, [task.videoUrl, task.imageUrls, task.id]);
  const { refs, voices } = refPreviews(task);

  return (
    <article className="border border-line bg-panel rounded-md animate-rise overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-line flex-wrap">
        <span
          className={`font-display font-semibold text-[11px] tracking-[0.18em] uppercase px-1.5 py-0.5 rounded border ${
            task.kind === "video"
              ? "text-accent border-accent/40"
              : "text-[#7cc7ff] border-[#7cc7ff]/40"
          }`}
        >
          {task.kind}
        </span>
        <span className="font-mono text-xs text-ink">{task.model}</span>
        <StatusBadge status={task.status} />
        {task.assetId && (
          <span className="font-mono text-[10px] text-ok border border-ok/40 rounded px-1.5 py-0.5">
            SAVED
          </span>
        )}
        <span className="ml-auto text-[11px] font-mono text-muted">
          {timeAgo(task.createdAt)}
        </span>
      </header>

      <div className="p-4 space-y-3">
        <p
          className={`text-sm text-ink/85 whitespace-pre-wrap ${
            !expanded ? "line-clamp-2" : ""
          }`}
        >
          {task.prompt || <span className="text-muted italic">no prompt</span>}
        </p>
        {task.prompt && task.prompt.length > 140 && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-[11px] font-mono text-accent hover:underline"
          >
            {expanded ? "− collapse" : "+ expand prompt"}
          </button>
        )}

        <PromptSources task={task} />

        {task.params && Object.keys(task.params).length > 0 && (
          <p className="font-mono text-[10px] text-muted flex flex-wrap gap-x-3 gap-y-0.5">
            {Object.entries(task.params)
              .filter(([k]) => k !== "rewrite")
              .map(([k, v]) => (
              <span key={k}>
                {k}=<span className="text-ink/70">{String(v)}</span>
              </span>
            ))}
          </p>
        )}

        {(refs.length > 0 || voices.length > 0) && (
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted mb-1.5">
              References
            </p>
            {refs.length > 0 && (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                {refs.map((r, i) => (
                  <div
                    key={i}
                    className="border border-line rounded overflow-hidden bg-panel2"
                    title={r.name}
                  >
                    <div className="aspect-video bg-black/40 flex items-center justify-center overflow-hidden">
                      {r.url ? (
                        r.kind === "video" ? (
                          <video
                            src={r.url}
                            muted
                            playsInline
                            preload="metadata"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.url}
                            alt={r.name}
                            className="w-full h-full object-cover"
                          />
                        )
                      ) : (
                        <span className="text-[9px] font-mono text-muted px-1 truncate">
                          attached
                        </span>
                      )}
                    </div>
                    <p className="px-1 py-0.5 text-[9px] font-mono text-muted truncate">
                      {r.name}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {voices.length > 0 && (
              <p className="mt-1.5 text-[10px] font-mono text-muted">
                audio: {voices.join(", ")}
              </p>
            )}
          </div>
        )}

        {active && (
          <div className="flex items-center gap-3 py-6 justify-center">
            <span className="w-2 h-2 rounded-full bg-warn animate-pulse-dot" />
            <span className="font-mono text-xs text-muted">
              {task.status === "submitting"
                ? "submitting request…"
                : task.kind === "image"
                  ? "drawing"
                  : "rendering"}{" "}
              · <span className="text-warn">{fmtElapsed(task, now)}</span> elapsed
            </span>
          </div>
        )}

        {task.error && (
          <ErrorBox
            code={task.error.code}
            message={task.error.message}
            requestId={task.error.requestId}
          />
        )}

        {task.videoUrl && (
          <div>
            <video
              src={task.videoUrl}
              controls
              {...dragOut(task.videoUrl, true, task.id)}
              className="w-full rounded border border-line bg-black max-h-[480px]"
            />
            <div className="mt-2 flex gap-3 items-center">
              <a
                href={task.videoUrl}
                download
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono text-accent hover:underline"
              >
                ⬇ download{task.assetId ? "" : " (link expires in 24h)"}
              </a>
              {task.assetId && (
                <button
                  type="button"
                  onClick={() => void revealInExplorer(task.assetId!)}
                  title="Opens the folder with this video selected — drag the file from Explorer into Clipchamp (browsers can't hand real files to Clipchamp directly)"
                  className="text-xs font-mono text-muted hover:text-ink hover:underline"
                >
                  📂 show in Explorer
                </button>
              )}
            </div>
          </div>
        )}

        {task.imageUrls && task.imageUrls.length > 0 && (
          <div
            className={`grid gap-3 ${
              task.imageUrls.length > 1 ? "grid-cols-2" : "grid-cols-1"
            }`}
          >
            {task.imageUrls.map((url, i) => (
              <div key={i} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Generated ${i + 1}`}
                  {...dragOut(url, false, task.id)}
                  className="w-full rounded border border-line bg-black/40"
                />
                <a
                  href={url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="absolute bottom-2 right-2 text-[11px] font-mono bg-black/75 text-accent px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ⬇ save
                </a>
                {task.assetId && (
                  <button
                    type="button"
                    onClick={() => void revealInExplorer(task.assetId!, i)}
                    title="Show in Explorer — drag from there into Clipchamp"
                    className="absolute bottom-2 right-[70px] text-[11px] font-mono bg-black/75 text-muted hover:text-ink px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    📂
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {(task.imageUrls?.length ?? 0) > 0 && !task.assetId && (
          <p className="text-[10px] font-mono text-muted">
            image links expire in 24h — save promptly
          </p>
        )}

        <Usage task={task} />

        <footer className="flex items-center justify-between gap-3 pt-1 border-t border-line/50 mt-2">
          <span className="font-mono text-[10px] text-muted truncate">
            {task.taskId ? `task_id: ${task.taskId}` : task.requestId ? `request_id: ${task.requestId}` : ""}
          </span>
          <span className="font-mono text-[11px] shrink-0 flex items-center gap-3">
            {task.status === "succeeded" ? (
              <>
                <span className="text-muted">est. cost </span>
                <span className="text-accent" title="Estimate based on rates in src/lib/pricing.ts · shown in SGD @ 1.3 USD">
                  {formatSGD(task.estimate)}
                </span>
              </>
            ) : (
              <span className="text-muted">
                {task.status === "failed" ? "no charge expected" : "cost pending"}
              </span>
            )}
            {task.settings && onReuse && (
              <Btn variant="ghost" onClick={() => onReuse(task)}>
                ↺ reuse settings
              </Btn>
            )}
          </span>
        </footer>
      </div>
    </article>
  );
}
