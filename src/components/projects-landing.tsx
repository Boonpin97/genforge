"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project, ProjectCounts } from "@/lib/types";

type ProjectWithCounts = Project & { counts: ProjectCounts };

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
      aria-hidden
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      <path d="M3 10h18" opacity="0.5" />
    </svg>
  );
}

function countLine(c: ProjectCounts): string {
  const parts: string[] = [];
  if (c.assets) parts.push(`${c.assets} asset${c.assets === 1 ? "" : "s"}`);
  if (c.scripts) parts.push(`${c.scripts} script${c.scripts === 1 ? "" : "s"}`);
  if (c.characters)
    parts.push(`${c.characters} char${c.characters === 1 ? "" : "s"}`);
  if (c.uploads) parts.push(`${c.uploads} upload${c.uploads === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "empty";
}

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ProjectsLanding() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectWithCounts[]>([]);
  const [unassigned, setUnassigned] = useState<ProjectCounts | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        setProjects(Array.isArray(d.projects) ? d.projects : []);
        setUnassigned(d.unassigned || null);
        setLoaded(true);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load projects")
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message || `HTTP ${res.status}`);
        return;
      }
      setNewName("");
      setCreating(false);
      router.push(`/p/${data.project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function rename(id: string) {
    const name = renameValue.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setError(d?.message || `HTTP ${res.status}`);
      } else {
        setRenamingId(null);
        load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: ProjectWithCounts) {
    if (
      !window.confirm(
        `Delete project "${p.name}"? Its ${countLine(
          p.counts
        )} will become Unassigned (nothing is deleted).`
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
      if (!res.ok) setError(`HTTP ${res.status}`);
      else load();
    } finally {
      setBusy(false);
    }
  }

  const unassignedTotal = unassigned
    ? unassigned.assets +
      unassigned.scripts +
      unassigned.characters +
      unassigned.uploads
    : 0;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-panel/70 backdrop-blur sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3 flex items-baseline gap-2.5">
          <span className="font-display font-bold text-xl tracking-[0.08em] text-ink">
            GEN<span className="text-accent">FORGE</span>
          </span>
          <span className="text-[11px] font-mono text-muted">
            projects · pick a folder to open the studio
          </span>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {error && (
          <p className="mb-4 text-xs font-mono text-danger border border-danger/40 bg-danger/5 rounded px-3 py-2">
            {error}
          </p>
        )}
        {!loaded && !error && (
          <p className="text-sm text-muted font-mono py-10 text-center">
            loading projects…
          </p>
        )}
        {loaded && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() =>
                  renamingId !== p.id && router.push(`/p/${p.id}`)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && renamingId !== p.id)
                    router.push(`/p/${p.id}`);
                }}
                className="group relative border border-line bg-panel rounded-md p-4 hover:border-accent/60 transition-colors cursor-pointer text-left"
              >
                <div className="flex items-start gap-3">
                  <FolderIcon className="w-9 h-9 text-accent shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    {renamingId === p.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") void rename(p.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="w-full bg-panel2 border border-accent/60 rounded px-2 py-1 text-sm text-ink outline-none"
                      />
                    ) : (
                      <h2 className="font-display font-semibold text-[15px] text-ink truncate">
                        {p.name}
                      </h2>
                    )}
                    <p className="text-[11px] font-mono text-muted mt-1 truncate">
                      {countLine(p.counts)}
                    </p>
                    <p className="text-[10px] font-mono text-muted/70 mt-0.5">
                      updated {timeAgo(p.updatedAt)}
                    </p>
                  </div>
                </div>
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    aria-label="Rename project"
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(p.id);
                      setRenameValue(p.name);
                    }}
                    className="w-6 h-6 rounded bg-black/70 text-muted hover:text-ink text-xs"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    aria-label="Delete project"
                    title="Delete (items become Unassigned)"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(p);
                    }}
                    className="w-6 h-6 rounded bg-black/70 text-muted hover:text-danger text-xs"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}

            {unassignedTotal > 0 && unassigned && (
              <div
                role="button"
                tabIndex={0}
                onClick={() => router.push("/p/none")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") router.push("/p/none");
                }}
                className="group relative border border-dashed border-line bg-panel/50 rounded-md p-4 hover:border-warn/60 transition-colors cursor-pointer text-left"
              >
                <div className="flex items-start gap-3">
                  <FolderIcon className="w-9 h-9 text-muted shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <h2 className="font-display font-semibold text-[15px] text-muted">
                      Unassigned
                    </h2>
                    <p className="text-[11px] font-mono text-muted mt-1 truncate">
                      {countLine(unassigned)}
                    </p>
                    <p className="text-[10px] font-mono text-muted/70 mt-0.5">
                      not tagged to any project
                    </p>
                  </div>
                </div>
              </div>
            )}

            {creating ? (
              <div className="border border-accent/60 bg-panel rounded-md p-4">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void create();
                    if (e.key === "Escape") {
                      setCreating(false);
                      setNewName("");
                    }
                  }}
                  placeholder="Project name…"
                  maxLength={80}
                  className="w-full bg-panel2 border border-line rounded px-2 py-1.5 text-sm text-ink outline-none focus:border-accent/60"
                />
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => void create()}
                    disabled={busy || !newName.trim()}
                    className="px-3 py-1.5 rounded text-[11px] font-mono uppercase tracking-[0.12em] bg-accent text-[#10130c] disabled:opacity-40"
                  >
                    create & open
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setNewName("");
                    }}
                    className="px-3 py-1.5 rounded text-[11px] font-mono uppercase tracking-[0.12em] border border-line text-muted hover:text-ink"
                  >
                    cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="border border-dashed border-line rounded-md p-4 text-muted hover:text-accent hover:border-accent/60 transition-colors flex items-center justify-center gap-2 min-h-[104px] font-mono text-sm uppercase tracking-[0.14em]"
              >
                ＋ new project
              </button>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-line px-4 sm:px-6 py-3">
        <p className="text-[10px] font-mono text-muted">
          each project keeps its own assets, storyboards, characters and
          uploads · deleting a project never deletes its files
        </p>
      </footer>
    </div>
  );
}
