"use client";

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Btn, ErrorBox, StatusBadge, btnClass, fmtElapsed } from "./ui";
import {
  copyFileToClipboard,
  prefetchFile,
  revealInExplorer,
} from "./asset-file-cache";
import { formatSGD } from "@/lib/pricing";
import { setVideoVolume, subscribePrefs, videoVolume } from "@/lib/notify";
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

function promptSources(
  task: TaskRecord
): { userPrompt: string; rewrotePrompt: string; usedRewritten: boolean } | null {
  const s = task.settings;
  if (s?.kind !== "video" || !s.rewrotePrompt) return null;
  return {
    userPrompt: s.userPrompt || "",
    rewrotePrompt: s.rewrotePrompt,
    usedRewritten: s.promptTab === "rewritten" || Boolean(task.params?.rewrite),
  };
}

function PromptBlock({
  heading,
  sent,
  text,
}: {
  heading: string;
  sent: boolean;
  text: string;
}) {
  return (
    <div className="border border-line rounded-md bg-panel2 px-3 py-2.5">
      <p className="text-2xs text-muted mb-1.5 flex items-center gap-2">
        {heading}
        {sent && (
          <span className="text-2xs font-medium text-accent bg-accent/15 rounded-full px-2 py-0.5">
            sent to the model
          </span>
        )}
      </p>
      <p className="text-xs text-ink/85 whitespace-pre-wrap break-words leading-relaxed">
        {text || "—"}
      </p>
    </div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function dragOut(
  url: string,
  isVid: boolean,
  id: string,
  guardBottomPx = 0
) {
  const abs = /^https?:/i.test(url)
    ? url
    : `${window.location.origin}${url}`;
  return {
    draggable: true,
    title: isVid
      ? "Drag the picture out to an Explorer window to save · use Copy file for Clipchamp"
      : "Drag out to an Explorer window to save · for Clipchamp use 📋 copy file, then Ctrl+V",
    onDragStart: (e: DragEvent) => {
      if (guardBottomPx > 0) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        if (e.clientY > rect.bottom - guardBottomPx) {
          e.preventDefault();
          return;
        }
      }
      e.dataTransfer.setData(
        "DownloadURL",
        `${isVid ? "video/mp4" : "image/png"}:genforge-${id.slice(0, 8)}.${isVid ? "mp4" : "png"}:${abs}`
      );
      e.dataTransfer.setData("text/plain", abs);
      void prefetchFile(abs, `genforge-${id.slice(0, 8)}`);
      e.dataTransfer.effectAllowed = "copy";
    },
  };
}

function timecode(t: number): string {
  const safe = Number.isFinite(t) && t > 0 ? t : 0;
  const secs = Math.floor(safe);
  const cs = Math.floor((safe - secs) * 100);
  return `${String(secs).padStart(2, "0")}:${String(cs).padStart(2, "0")}`;
}

type FrameCbVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, meta: { mediaTime: number }) => void
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const CONTROL_BAR_PX = 56;

function VideoPlayer({
  task,
  url,
  projectId,
  onUploaded,
  extraActions,
}: {
  task: TaskRecord;
  url: string;
  projectId?: string | null;
  onUploaded?: () => void;
  extraActions?: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tcRef = useRef<HTMLSpanElement | null>(null);
  const durRef = useRef<HTMLSpanElement | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [volume, setVolume] = useState(1);
  const [savingFrame, setSavingFrame] = useState(false);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    const read = () => setVolume(videoVolume());
    const raf = requestAnimationFrame(read);
    const off = subscribePrefs(read);
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.volume = volume;
  }, [volume, url]);

  function changeVolume(next: number) {
    setVolume(next);
    setVideoVolume(next);
  }

  useEffect(() => {
    const v = videoRef.current as FrameCbVideo | null;
    if (!v) return;
    let raf = 0;
    let vfc = 0;
    let alive = true;
    const paint = (t: number) => {
      if (tcRef.current) tcRef.current.textContent = timecode(t);
    };
    const paintDuration = () => {
      if (durRef.current)
        durRef.current.textContent = Number.isFinite(v.duration)
          ? `${v.duration.toFixed(1)}s`
          : "--";
    };
    if (typeof v.requestVideoFrameCallback === "function") {
      const step = (_now: number, meta: { mediaTime: number }) => {
        if (!alive) return;
        paint(meta.mediaTime);
        vfc = v.requestVideoFrameCallback!(step);
      };
      vfc = v.requestVideoFrameCallback(step);
    } else {
      const loop = () => {
        if (!alive) return;
        paint(v.currentTime);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    const onSync = () => paint(v.currentTime);
    const onMeta = () => {
      paintDuration();
      paint(v.currentTime);
    };
    v.addEventListener("seeked", onSync);
    v.addEventListener("timeupdate", onSync);
    v.addEventListener("loadedmetadata", onMeta);
    onMeta();
    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      if (vfc && typeof v.cancelVideoFrameCallback === "function")
        v.cancelVideoFrameCallback(vfc);
      v.removeEventListener("seeked", onSync);
      v.removeEventListener("timeupdate", onSync);
      v.removeEventListener("loadedmetadata", onMeta);
    };
  }, [url]);

  function flash(msg: string, ms = 4000) {
    setNote(msg);
    window.setTimeout(() => setNote(null), ms);
  }

  async function copyFile() {
    if (!task.assetId || copying) return;
    setCopying(true);
    try {
      const r = await copyFileToClipboard(task.assetId);
      flash(
        r.ok
          ? `Copied ${r.filename || "the video"} to the clipboard — paste it with Ctrl+V`
          : r.message || "Could not copy the file to the clipboard",
        r.ok ? 5000 : 6000
      );
    } finally {
      setCopying(false);
    }
  }

  function captureFrame():
    | { blob: Promise<Blob | null>; name: string; w: number; h: number }
    | null {
    const v = videoRef.current;
    if (!v) return null;
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (!w || !h) {
      flash("Frame not ready yet — let the video load first");
      return null;
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(v, 0, 0, w, h);
      const tc = timecode(v.currentTime).replace(":", "-");
      return {
        blob: new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png")
        ),
        name: `frame-${tc}-${task.id.slice(0, 8)}.png`,
        w,
        h,
      };
    } catch {
      flash(
        task.assetId
          ? "This frame could not be read from the video"
          : "Frame grab needs the saved copy — it works once the asset is stored locally",
        6000
      );
      return null;
    }
  }

  async function grabFrame() {
    const shot = captureFrame();
    if (!shot) return;
    const blob = await shot.blob;
    if (!blob) {
      flash("Could not encode this frame");
      return;
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = shot.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 15000);
    flash(`Saved ${shot.name} (${shot.w}×${shot.h}) to your downloads`, 5000);
  }

  async function frameToUploads() {
    if (savingFrame) return;
    const shot = captureFrame();
    if (!shot) return;
    setSavingFrame(true);
    try {
      const blob = await shot.blob;
      if (!blob) {
        flash("Could not encode this frame");
        return;
      }
      const form = new FormData();
      form.append(
        "files",
        new File([blob], shot.name, { type: "image/png" })
      );
      form.append("projectId", projectId || "");
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        flash(data?.message || `Could not save the frame (HTTP ${res.status})`, 6000);
        return;
      }
      onUploaded?.();
      flash(
        `Added ${shot.name} (${shot.w}×${shot.h}) to Uploaded — drop it into any reference zone`,
        6000
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not save the frame", 6000);
    } finally {
      setSavingFrame(false);
    }
  }

  return (
    <div>
      <video
        ref={videoRef}
        src={url}
        controls
        playsInline
        preload="metadata"
        {...dragOut(url, true, task.id, CONTROL_BAR_PX)}
        className="w-full rounded-md border border-line bg-black max-h-[480px]"
      />
      <div className="mt-2.5 flex flex-wrap gap-2 items-center">
        <span
          className="font-mono text-xs text-muted px-1"
          title="Current position · seconds:hundredths"
        >
          <span ref={tcRef} className="text-accent">
            00:00
          </span>
          <span> / </span>
          <span ref={durRef}>--</span>
        </span>
        <span
          className="flex items-center gap-2 min-h-8 px-2.5 border border-line rounded-md"
          title="Playback volume — remembered for every video"
        >
          <button
            type="button"
            onClick={() => changeVolume(volume > 0 ? 0 : 1)}
            aria-label={volume > 0 ? "Mute" : "Unmute"}
            className="text-xs text-muted hover:text-ink leading-none"
          >
            {volume === 0 ? "🔇" : volume < 0.5 ? "🔈" : "🔊"}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            aria-label="Playback volume"
            onChange={(e) => changeVolume(Number(e.target.value))}
            className="w-24"
          />
          <span className="font-mono text-2xs text-muted tabular-nums w-8">
            {Math.round(volume * 100)}%
          </span>
        </span>
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => void grabFrame()}
          title="Download the frame showing right now as a PNG"
        >
          Download frame
        </Btn>
        <Btn
          variant="ghost"
          size="sm"
          onClick={() => void frameToUploads()}
          disabled={savingFrame}
          title="Save the frame showing right now into the Uploaded tab, so you can reuse it as a reference image"
        >
          {savingFrame ? "Saving frame…" : "Frame to Uploaded"}
        </Btn>
        <a
          href={url}
          download
          target="_blank"
          rel="noreferrer"
          title={
            task.assetId
              ? "Save this video to your downloads"
              : "Save this video — the source link expires 24h after generation"
          }
          className={btnClass("ghost", "sm")}
        >
          Download video{task.assetId ? "" : " (link expires in 24h)"}
        </a>
        {task.assetId && (
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => void copyFile()}
            disabled={copying}
            title="Copy the file to the clipboard, then paste it into Clipchamp's media bin with Ctrl+V"
          >
            {copying ? "Copying…" : "Copy file"}
          </Btn>
        )}
        {task.assetId && (
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => void revealInExplorer(task.assetId!)}
            title="Opens the folder with this video selected"
          >
            Show in Explorer
          </Btn>
        )}
        {extraActions}
      </div>
      {note && (
        <p className="mt-1.5 text-xs text-ink/80">{note}</p>
      )}
    </div>
  );
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
          <dt className="text-2xs text-muted">{k}</dt>
          <dd className="font-mono text-2xs text-ink">{val}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function TaskCard({
  task,
  onReuse,
  projectId,
  onUploaded,
}: {
  task: TaskRecord;
  onReuse?: (task: TaskRecord) => void;
  projectId?: string | null;
  onUploaded?: () => void;
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
  const sources = promptSources(task);
  const canExpand = Boolean(sources) || (task.prompt?.length ?? 0) > 140;
  const reuseBtn =
    task.settings && onReuse ? (
      <Btn
        variant="ghost"
        size="sm"
        onClick={() => onReuse(task)}
        title="Load this task's prompt, references and settings back into the form"
      >
        Reuse settings
      </Btn>
    ) : null;

  return (
    <article className="border border-line bg-panel rounded-md animate-rise overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-line flex-wrap">
        <span
          className={`font-medium text-2xs px-2 py-0.5 rounded-full ${
            task.kind === "video"
              ? "text-cat-video bg-cat-video/10"
              : "text-cat-image bg-cat-image/10"
          }`}
        >
          {task.kind === "video" ? "Video" : "Image"}
        </span>
        <span className="font-mono text-xs text-ink">{task.model}</span>
        <StatusBadge status={task.status} />
        {task.assetId && (
          <span className="text-2xs font-medium text-ok bg-ok/10 rounded-full px-2 py-0.5">
            Saved
          </span>
        )}
        <span className="ml-auto text-2xs text-muted">
          {timeAgo(task.createdAt)}
        </span>
      </header>

      <div className="p-4 space-y-3">
        {!(expanded && sources) && (
          <p
            className={`text-sm text-ink/85 whitespace-pre-wrap break-words ${
              !expanded ? "line-clamp-2" : ""
            }`}
          >
            {task.prompt || <span className="text-muted italic">no prompt</span>}
          </p>
        )}
        {expanded && sources && (
          <div className="space-y-2">
            <PromptBlock
              heading="Your prompt"
              sent={!sources.usedRewritten}
              text={sources.userPrompt}
            />
            <PromptBlock
              heading="Rewritten prompt"
              sent={sources.usedRewritten}
              text={sources.rewrotePrompt}
            />
          </div>
        )}
        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-accent hover:underline"
          >
            {expanded ? "− collapse prompt" : "+ expand prompt"}
          </button>
        )}

        {task.params && Object.keys(task.params).length > 0 && (
          <p className="font-mono text-2xs text-muted flex flex-wrap gap-x-3 gap-y-0.5">
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
            <p className="text-2xs text-muted mb-1.5">
              References
            </p>
            {refs.length > 0 && (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                {refs.map((r, i) => (
                  <div
                    key={i}
                    className="border border-line rounded-md overflow-hidden bg-panel2"
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
                        <span className="text-2xs text-muted px-1 truncate">
                          attached
                        </span>
                      )}
                    </div>
                    <p className="px-1 py-0.5 text-2xs text-muted truncate">
                      {r.name}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {voices.length > 0 && (
              <p className="mt-1.5 text-2xs text-muted">
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
          <VideoPlayer
            task={task}
            url={task.videoUrl}
            projectId={projectId}
            onUploaded={onUploaded}
            extraActions={reuseBtn}
          />
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
                  className="w-full rounded-md border border-line bg-black/40"
                />
                <a
                  href={url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="absolute bottom-2 right-2 text-2xs font-mono bg-black/75 text-accent px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ⬇ save
                </a>
                {task.assetId && (
                  <button
                    type="button"
                    onClick={() => void revealInExplorer(task.assetId!, i)}
                    title="Show in Explorer — drag from there into Clipchamp"
                    className="absolute bottom-2 right-[70px] text-2xs font-mono bg-black/75 text-muted hover:text-ink px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    📂
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {(task.imageUrls?.length ?? 0) > 0 && !task.assetId && (
          <p className="text-2xs font-mono text-muted">
            image links expire in 24h — save promptly
          </p>
        )}

        <Usage task={task} />

        <footer className="flex items-center justify-between gap-3 pt-1 border-t border-line/50 mt-2">
          <span className="font-mono text-2xs text-muted truncate">
            {task.taskId ? `task_id: ${task.taskId}` : task.requestId ? `request_id: ${task.requestId}` : ""}
          </span>
          <span className="font-mono text-2xs shrink-0 flex items-center gap-3">
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
            {!task.videoUrl && reuseBtn}
          </span>
        </footer>
      </div>
    </article>
  );
}
