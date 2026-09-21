"use client";

import { useCallback, useEffect, useState } from "react";
import { AddTile, ASSET_DND, formatBytes } from "./drop-zone";
import { RelocateSelect } from "./ui";
import type { UploadRecord } from "@/lib/types";

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export default function UploadsGallery({
  projectId,
  reloadNonce = 0,
}: {
  projectId: string | null;
  reloadNonce?: number;
}) {
  const projectQs = projectId === null ? "none" : projectId;
  const [items, setItems] = useState<UploadRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/uploads?project=${projectQs}`);
      const data = await res.json();
      setItems(Array.isArray(data.uploads) ? data.uploads : []);
    } catch {
      setNotice("Failed to load uploads");
    } finally {
      setLoaded(true);
    }
  }, [projectQs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/uploads?project=${projectQs}`);
        const data = await res.json();
        if (!cancelled) {
          setItems(Array.isArray(data.uploads) ? data.uploads : []);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setNotice("Failed to load uploads");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectQs, reloadNonce]);

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

  async function relocateUpload(
    id: string,
    action: "move" | "copy",
    target: string
  ) {
    const res = await fetch(`/api/uploads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        projectId: target === "none" ? null : target,
      }),
    });
    if (!res.ok) {
      setNotice(`Could not ${action} this file`);
      return;
    }
    await refresh();
  }

  async function addFiles(files: File[]) {
    setNotice(null);
    const usable = files.filter((f) => {
      const kind = f.type.startsWith("image/") || f.type.startsWith("audio/");
      return kind && f.size <= 20 * 1024 * 1024;
    });
    if (usable.length < files.length)
      setNotice(
        `${files.length - usable.length} file(s) skipped — images/audio only, ≤20MB`
      );
    if (!usable.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      usable.forEach((f) => form.append("files", f));
      form.append("projectId", projectId || "");
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setNotice(data.message || `Upload failed (HTTP ${res.status})`);
        return;
      }
      setItems((list) => [...(data.uploads || []), ...list]);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function remove(u: UploadRecord) {
    setItems((list) => list.filter((x) => x.id !== u.id));
    try {
      await fetch(`/api/uploads/${u.id}`, { method: "DELETE" });
    } catch {
      void refresh();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <p className="text-xs text-warn" role="alert">
          ⚠ {notice}
        </p>
      )}
      {uploading && (
        <p className="text-xs text-muted">Saving files…</p>
      )}
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        }}
      >
        {items.map((u) => (
          <div
            key={u.id}
            draggable={u.kind === "image"}
            onDragStart={
              u.kind === "image"
                ? (e) => {
                    const url = `/api/uploads/${u.id}/file`;
                    e.dataTransfer.setData(
                      ASSET_DND,
                      JSON.stringify({ url, name: u.name, kind: "image" })
                    );
                    e.dataTransfer.setData("text/plain", url);
                    e.dataTransfer.effectAllowed = "copy";
                  }
                : undefined
            }
            title={
              u.kind === "image"
                ? "Drag into a reference drop zone to reuse"
                : undefined
            }
            className="relative border border-line bg-panel rounded-md overflow-hidden group hover:border-accent/60 transition-colors"
          >
            <div className="aspect-video bg-black/50 flex items-center justify-center overflow-hidden">
              {u.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/uploads/${u.id}/file`}
                  alt={u.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full px-2">
                  <span className="block text-2xl leading-none text-accent mb-2 text-center">
                    ♪
                  </span>
                  <audio
                    src={`/api/uploads/${u.id}/file`}
                    controls
                    preload="metadata"
                    className="w-full h-8"
                  />
                </div>
              )}
            </div>
            <div className="px-2 py-1.5 space-y-0.5">
              <p className="text-2xs text-ink/80 truncate" title={u.name}>
                {u.name}
              </p>
              <p className="text-2xs font-mono text-muted flex justify-between gap-2">
                <span>
                  {u.kind} · {formatBytes(u.size)}
                </span>
                <span className="shrink-0">{timeAgo(u.createdAt)}</span>
              </p>
            </div>
            <button
              type="button"
              aria-label={`Delete ${u.name}`}
              onClick={() => remove(u)}
              className="absolute top-1.5 right-1.5 w-7 h-7 rounded-md bg-black/65 backdrop-blur-sm text-white/75 hover:text-danger hover:bg-black/80 text-xs leading-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            >
              ✕
            </button>
            <RelocateSelect
              projects={projects}
              currentProjectId={projectId}
              label="Move or copy this file to another project"
              onPick={(action, target) =>
                void relocateUpload(u.id, action, target)
              }
              className="absolute top-1.5 right-9 bg-black/65 backdrop-blur-sm text-white/75 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            />
          </div>
        ))}
        <AddTile
          accept="image/*,audio/*,.m4a,.mp3,.wav,.ogg"
          onFiles={addFiles}
          disabled={uploading}
          className="aspect-video min-h-20"
        />
      </div>
      {!loaded && (
        <p className="text-xs text-muted">Loading uploads…</p>
      )}
      {loaded && items.length === 0 && (
        <p className="text-2xs font-mono text-muted">
          nothing uploaded yet — click + or drop images / audio here
        </p>
      )}
    </div>
  );
}
