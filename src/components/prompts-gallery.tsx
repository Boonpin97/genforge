"use client";

import { useCallback, useEffect, useState } from "react";
import { Btn, IconBtn, RelocateSelect, Seg, TextArea, TextInput } from "./ui";
import type { PromptKind, SavedPrompt } from "@/lib/types";

const KIND_LABEL: Record<PromptKind, string> = {
  video: "Video",
  image: "Image",
  any: "Any",
};

const KIND_STYLE: Record<PromptKind, string> = {
  video: "text-cat-video bg-cat-video/10",
  image: "text-cat-image bg-cat-image/10",
  any: "text-muted bg-line/60",
};

export default function PromptsGallery({
  projectId,
  onUse,
  reloadNonce = 0,
}: {
  projectId: string | null;
  onUse: (target: "video" | "image", text: string) => void;
  reloadNonce?: number;
}) {
  const projectQs = projectId === null ? "none" : projectId;
  const [scope, setScope] = useState<"project" | "all">("project");
  const [items, setItems] = useState<SavedPrompt[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftText, setDraftText] = useState("");
  const [draftKind, setDraftKind] = useState<PromptKind>("any");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const qs = scope === "all" ? "" : `?project=${projectQs}`;
      const res = await fetch(`/api/prompts${qs}`);
      const data = await res.json();
      setItems(Array.isArray(data.prompts) ? data.prompts : []);
    } catch {
      setNotice("Could not load saved prompts");
    } finally {
      setLoaded(true);
    }
  }, [projectQs, scope]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = scope === "all" ? "" : `?project=${projectQs}`;
        const res = await fetch(`/api/prompts${qs}`);
        const data = await res.json();
        if (cancelled) return;
        setItems(Array.isArray(data.prompts) ? data.prompts : []);
        setLoaded(true);
      } catch {
        if (!cancelled) setNotice("Could not load saved prompts");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectQs, scope, reloadNonce]);

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

  function resetDraft() {
    setComposing(false);
    setEditingId(null);
    setDraftTitle("");
    setDraftText("");
    setDraftKind("any");
  }

  function startEdit(p: SavedPrompt) {
    setNotice(null);
    setComposing(true);
    setEditingId(p.id);
    setDraftTitle(p.title);
    setDraftText(p.text);
    setDraftKind(p.kind);
  }

  async function save() {
    const text = draftText.trim();
    if (!text || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = editingId
        ? await fetch(`/api/prompts/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text,
              title: draftTitle.trim(),
              kind: draftKind,
            }),
          })
        : await fetch("/api/prompts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text,
              title: draftTitle.trim(),
              kind: draftKind,
              projectId,
            }),
          });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setNotice(data?.message || `Could not save (HTTP ${res.status})`);
        return;
      }
      resetDraft();
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not save the prompt");
    } finally {
      setBusy(false);
    }
  }

  async function relocate(
    id: string,
    action: "move" | "copy",
    target: string
  ) {
    try {
      const res = await fetch(`/api/prompts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          projectId: target === "none" ? null : target,
        }),
      });
      if (!res.ok) {
        setNotice(`Could not ${action} this prompt`);
        return;
      }
      await refresh();
    } catch {
      setNotice(`Could not ${action} this prompt`);
    }
  }

  async function remove(p: SavedPrompt) {
    setItems((list) => list.filter((x) => x.id !== p.id));
    try {
      await fetch(`/api/prompts/${p.id}`, { method: "DELETE" });
    } catch {
      void refresh();
    }
  }

  const projectName = (id?: string | null) =>
    id ? projects.find((p) => p.id === id)?.name || "Unknown project" : "Unassigned";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-56">
          <Seg
            value={scope}
            onChange={setScope}
            options={[
              { value: "project", label: "This project" },
              { value: "all", label: "All projects" },
            ]}
          />
        </div>
        {!composing && (
          <Btn
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              resetDraft();
              setComposing(true);
            }}
          >
            + New prompt
          </Btn>
        )}
      </div>

      {notice && (
        <p className="text-xs text-warn" role="alert">
          {notice}
        </p>
      )}

      {composing && (
        <div className="border border-line bg-panel rounded-lg p-3 flex flex-col gap-2.5">
          <TextInput
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            maxLength={80}
            placeholder="Name it, or leave blank to use the first line"
          />
          <TextArea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={5}
            maxLength={20000}
            placeholder="The prompt you want to keep…"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-56">
              <Seg
                value={draftKind}
                onChange={setDraftKind}
                options={[
                  { value: "any", label: "Any" },
                  { value: "video", label: "Video" },
                  { value: "image", label: "Image" },
                ]}
              />
            </div>
            <span className="ml-auto flex items-center gap-2">
              <Btn size="sm" variant="ghost" onClick={resetDraft}>
                Cancel
              </Btn>
              <Btn size="sm" onClick={() => void save()} disabled={busy || !draftText.trim()}>
                {busy ? "Saving…" : editingId ? "Save changes" : "Save prompt"}
              </Btn>
            </span>
          </div>
        </div>
      )}

      {loaded && items.length === 0 && !composing && (
        <div className="border border-dashed border-line rounded-lg px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink mb-1.5">
            No saved prompts{scope === "project" ? " in this project" : ""}
          </p>
          <p className="text-xs text-muted max-w-[44ch] mx-auto">
            Save a prompt from the Video or Image tab with the bookmark button, or
            add one here to reuse it later.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {items.map((p) => (
          <div
            key={p.id}
            className="border border-line bg-panel rounded-lg p-3 animate-rise group"
          >
            <div className="flex items-center gap-2">
              <p className="font-semibold text-sm text-ink truncate">{p.title}</p>
              <span
                className={`shrink-0 text-2xs font-medium rounded-full px-2 py-0.5 ${KIND_STYLE[p.kind]}`}
              >
                {KIND_LABEL[p.kind]}
              </span>
              {scope === "all" && (
                <span className="ml-auto shrink-0 text-2xs text-muted truncate max-w-[40%]">
                  {projectName(p.projectId)}
                </span>
              )}
            </div>
            <p className="text-xs text-muted line-clamp-3 mt-1.5 whitespace-pre-wrap">
              {p.text}
            </p>
            <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
              {p.kind !== "image" && (
                <button
                  type="button"
                  onClick={() => onUse("video", p.text)}
                  className="text-xs font-medium bg-panel2 text-ink border border-line rounded-md px-3 min-h-8 inline-flex items-center hover:border-muted/60 transition-colors"
                >
                  Use in video
                </button>
              )}
              {p.kind !== "video" && (
                <button
                  type="button"
                  onClick={() => onUse("image", p.text)}
                  className="text-xs font-medium bg-panel2 text-ink border border-line rounded-md px-3 min-h-8 inline-flex items-center hover:border-muted/60 transition-colors"
                >
                  Use in image
                </button>
              )}
              <span className="ml-auto flex items-center gap-0.5">
                <IconBtn
                  title="Copy this prompt to the clipboard"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(p.text)
                      .then(() => setNotice("Prompt copied to the clipboard"))
                      .catch(() => setNotice("Clipboard unavailable"));
                  }}
                >
                  ⧉
                </IconBtn>
                <RelocateSelect
                  projects={projects}
                  currentProjectId={p.projectId ?? null}
                  label="Move or copy this prompt to another project"
                  onPick={(action, target) => void relocate(p.id, action, target)}
                />
                <IconBtn title="Edit this prompt" onClick={() => startEdit(p)}>
                  ✎
                </IconBtn>
                <IconBtn
                  title="Delete this prompt"
                  tone="danger"
                  onClick={() => void remove(p)}
                >
                  ✕
                </IconBtn>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
