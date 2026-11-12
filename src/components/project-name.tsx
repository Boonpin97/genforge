"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectCounts } from "@/lib/types";
import { Btn, IconBtn, Popover } from "./ui";

function countLine(c: ProjectCounts | null): string {
  if (!c) return "Its items";
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(c.assets, "asset", "assets");
  add(c.scripts, "storyboard", "storyboards");
  add(c.characters, "character", "characters");
  add(c.uploads, "upload", "uploads");
  add(c.prompts, "prompt", "prompts");
  if (!parts.length) return "";
  if (parts.length === 1) return `Its ${parts[0]}`;
  return `Its ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export default function ProjectName({
  projectId,
  initialName,
}: {
  projectId: string | null;
  initialName?: string;
}) {
  const [name, setName] = useState(
    initialName || (projectId === null ? "Unassigned" : "")
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const deleteRef = useRef<HTMLButtonElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [counts, setCounts] = useState<ProjectCounts | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (projectId === null) {
    return (
      <span className="hidden sm:block text-sm text-muted truncate max-w-[220px]">
        {name}
      </span>
    );
  }

  function start() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  async function save() {
    const next = draft.trim();
    if (saving) return;
    if (!next || next === name) {
      setEditing(false);
      setError(null);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message || `Rename failed (HTTP ${res.status})`);
        return;
      }
      setName(data?.project?.name || next);
      setEditing(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setSaving(false);
    }
  }

  function openConfirm() {
    setDeleteError(null);
    setCounts(null);
    setConfirming(true);
    fetch("/api/projects", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const p = Array.isArray(d.projects)
          ? d.projects.find((x: { id: string }) => x.id === projectId)
          : null;
        if (p?.counts) setCounts(p.counts);
      })
      .catch(() => {});
  }

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setDeleteError(d?.message || `Delete failed (HTTP ${res.status})`);
        setDeleting(false);
        return;
      }
      router.push("/");
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Delete failed");
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <span className="hidden sm:flex items-center gap-2 min-w-0">
        <input
          autoFocus
          value={draft}
          maxLength={80}
          disabled={saving}
          aria-label="Project name"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
            if (e.key === "Escape") {
              setEditing(false);
              setError(null);
            }
          }}
          className="w-[220px] h-8 bg-panel2 border border-accent/60 rounded-md px-2 text-sm text-ink outline-none disabled:opacity-60"
        />
        {error && <span className="text-2xs text-danger truncate">{error}</span>}
      </span>
    );
  }

  const moved = countLine(counts);
  return (
    <span className="hidden sm:flex items-center gap-1 min-w-0">
      <button
        type="button"
        onClick={start}
        title="Rename project"
        className="flex items-center gap-1.5 h-8 px-2 -ml-2 rounded-md text-sm text-muted hover:text-ink hover:bg-panel2 transition-colors min-w-0 group"
      >
        <span className="truncate max-w-[220px]">{name || projectId}</span>
        <span
          aria-hidden
          className="text-2xs opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
        >
          ✎
        </span>
      </button>
      <IconBtn
        ref={deleteRef}
        title="Delete project"
        tone="danger"
        active={confirming}
        onClick={() => (confirming ? setConfirming(false) : openConfirm())}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className="w-4 h-4"
          aria-hidden
        >
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
        </svg>
      </IconBtn>
      <Popover
        open={confirming}
        anchorRef={deleteRef}
        onClose={() => !deleting && setConfirming(false)}
        width={300}
        label="Delete project"
        className="p-4"
      >
        <p className="text-sm text-ink font-semibold break-words">
          Delete {name}?
        </p>
        <p className="text-xs text-muted mt-1.5">
          {moved
            ? `${moved} will move to Unassigned. No files are deleted.`
            : "The project is empty. No files are deleted."}
        </p>
        {deleteError && (
          <p className="text-2xs text-danger mt-2">{deleteError}</p>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Btn
            variant="ghost"
            size="sm"
            disabled={deleting}
            onClick={() => setConfirming(false)}
          >
            Keep project
          </Btn>
          <Btn
            variant="danger"
            size="sm"
            disabled={deleting}
            onClick={() => void remove()}
          >
            {deleting ? "Deleting…" : "Delete project"}
          </Btn>
        </div>
      </Popover>
    </span>
  );
}
