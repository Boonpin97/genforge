"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import MentionTextArea from "./mention-textarea";
import Link from "next/link";
import { Btn, ErrorBox, Field, Panel, Seg, Select } from "./ui";
import { alertDone } from "@/lib/notify";
import { draftKey, readDraft, writeDraft } from "@/lib/draft";
import { formatSGD } from "@/lib/pricing";
import type { ApiError, Character } from "@/lib/types";
import type { PublicTextModel } from "@/lib/model-catalog";

type DirectorDraft = {
  premise: string;
  extraCast: string;
  selected: string[];
  model: string | null;
  creating: boolean;
  selectedId: string | null;
};

type ScriptEntry = {
  id: string;
  ts: number;
  premise: string;
  premiseTruncated?: boolean;
  instruction?: string;
  parentId?: string;
  script: string;
  estimate: number | null;
  revised?: boolean;
};

type ScrollSpot = { pre: number; pane: number };

const SCROLL_KEY = "genforge.storyboardScroll";
const SCROLL_KEEP = 50;
let scrollSpots: Record<string, ScrollSpot> | null = null;
let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;

function storyboardScroll(): Record<string, ScrollSpot> {
  if (!scrollSpots) {
    try {
      const parsed = JSON.parse(localStorage.getItem(SCROLL_KEY) || "{}");
      scrollSpots = parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      scrollSpots = {};
    }
  }
  return scrollSpots!;
}

function rememberStoryboardScroll(id: string, spot: ScrollSpot) {
  const spots = storyboardScroll();
  delete spots[id];
  spots[id] = spot;
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => {
    try {
      const recent = Object.entries(spots).slice(-SCROLL_KEEP);
      localStorage.setItem(SCROLL_KEY, JSON.stringify(Object.fromEntries(recent)));
    } catch {}
  }, 300);
}

export default function DirectorPanel({
  active,
  slot,
  projectId,
  models,
  defaultModel,
}: {
  active: boolean;
  slot?: HTMLElement | null;
  projectId: string | null;
  models: PublicTextModel[];
  defaultModel?: string;
}) {
  const [premise, setPremise] = useState("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extraCast, setExtraCast] = useState("");
  const [modelChoice, setModel] = useState<string | null>(null);
  const model =
    models.find((m) => m.id === modelChoice)?.id ??
    models.find((m) => m.id === defaultModel)?.id ??
    models[0]?.id ??
    "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [history, setHistory] = useState<ScriptEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [promptOpenId, setPromptOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(true);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const projectQs = projectId === null ? "none" : projectId;
  const loadedFor = useRef<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const draftId = draftKey(projectId, "director");
  const draftReady = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    draftReady.current = null;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const d = readDraft<DirectorDraft>(draftId);
      if (d) {
        setPremise(d.premise ?? "");
        setExtraCast(d.extraCast ?? "");
        setSelected(new Set(Array.isArray(d.selected) ? d.selected : []));
        setModel(d.model ?? null);
        setCreating(d.creating !== false);
        setSelectedId(d.selectedId ?? null);
      }
      draftReady.current = draftId;
    });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  useEffect(() => {
    if (draftReady.current !== draftId) return;
    const timer = window.setTimeout(() => {
      if (draftReady.current !== draftId) return;
      const value: DirectorDraft = {
        premise,
        extraCast,
        selected: [...selected],
        model: modelChoice,
        creating,
        selectedId,
      };
      writeDraft(draftId, value);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftId, premise, extraCast, selected, modelChoice, creating, selectedId]);

  const loadScripts = useCallback(() => {
    return fetch(`/api/director?project=${projectQs}`)
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d.scripts)) return;
        const incoming: ScriptEntry[] = d.scripts.map(
          (s: {
            id: string;
            createdAt: number;
            premise: string;
            premiseTruncated?: boolean;
            instruction?: string;
            parentId?: string;
            script: string;
            estimate: number | null;
            revised: boolean;
          }) => ({
            id: s.id,
            ts: s.createdAt,
            premise: s.premise,
            premiseTruncated: s.premiseTruncated,
            instruction: s.instruction,
            parentId: s.parentId,
            script: s.script,
            estimate: s.estimate,
            revised: s.revised,
          })
        );
        setHistory(incoming.sort((a, b) => b.ts - a.ts));
      })
      .catch(() => {});
  }, [projectQs]);

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

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch(`/api/characters?project=${projectQs}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !Array.isArray(d.characters)) return;
        setCharacters(d.characters);
        const live = new Set(d.characters.map((c: Character) => c.id));
        setSelected((s) => {
          const kept = [...s].filter((id) => live.has(id));
          return kept.length === s.size ? s : new Set(kept);
        });
      })
      .catch(() => {});
    if (loadedFor.current !== projectQs) {
      loadedFor.current = projectQs;
      void loadScripts();
    }
    return () => {
      cancelled = true;
    };
  }, [active, projectQs, loadScripts]);

  async function scriptBulk(action: "move" | "copy", target: string) {
    if (!current) return;
    try {
      const res = await fetch("/api/director/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ids: [current.id],
          projectId: target === "none" ? null : target,
        }),
      });
      if (!res.ok) return;
      if (action === "move") {
        setSelectedId(null);
        setCreating(true);
      }
      await loadScripts();
    } catch {}
  }

  function toggleCharacter(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const activeScript = creating
    ? null
    : history.find((h) => h.id === selectedId) || null;
  const amending = !creating && !!activeScript;
  const current = activeScript || history[0] || null;
  const currentId = current?.id ?? null;

  const saveScroll = useCallback(() => {
    const pre = preRef.current;
    if (!currentId || !slot || !pre || pre.clientHeight === 0) return;
    rememberStoryboardScroll(currentId, {
      pre: pre.scrollTop,
      pane: slot.scrollTop,
    });
  }, [currentId, slot]);

  useLayoutEffect(() => {
    if (!slot || !currentId) return;
    const spot = storyboardScroll()[currentId];
    if (preRef.current) preRef.current.scrollTop = spot?.pre ?? 0;
    slot.scrollTo({ top: spot?.pane ?? 0 });
  }, [slot, currentId]);

  useEffect(() => {
    if (!slot) return;
    slot.addEventListener("scroll", saveScroll, { passive: true });
    return () => slot.removeEventListener("scroll", saveScroll);
  }, [slot, saveScroll]);

  async function generate() {
    const text = premise.trim();
    if (!text) return;
    const target = amending ? activeScript : null;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/director", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          target
            ? {
                premise: target.premise || "(revision)",
                characterIds: [...selected],
                extraCast: extraCast.trim() || undefined,
                baseScript: target.script,
                instruction: text,
                parentId: target.id,
                model,
                projectId,
              }
            : {
                premise: text,
                characterIds: [...selected],
                extraCast: extraCast.trim() || undefined,
                model,
                projectId,
              }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError({
          code: data.code || `HTTP_${res.status}`,
          message:
            data.message ||
            `${target ? "Revision" : "Request"} failed with status ${res.status}`,
          requestId: data.requestId || data.request_id,
        });
        alertDone({
          channel: "director",
          ok: false,
          title: target ? "Revision failed" : "Storyboard failed",
          body: data.message || `Request failed with status ${res.status}`,
          tag: "director",
        });
        return;
      }
      alertDone({
        channel: "director",
        ok: true,
        title: target
          ? data.appendedScenes
            ? `Storyboard extended by ${data.appendedScenes} scene${data.appendedScenes === 1 ? "" : "s"}`
            : "Revision ready"
          : "Storyboard ready",
        body: text.slice(0, 140),
        tag: "director",
      });
      setHistory((h) => {
        const entry: ScriptEntry = {
          id: data.id || `${target ? "r" : "g"}${Date.now()}`,
          ts: Date.now(),
          premise: target ? target.premise : text,
          premiseTruncated: target?.premiseTruncated,
          instruction: target ? text : undefined,
          parentId: target?.id,
          script: data.script,
          estimate: data.estimate ?? null,
          revised: Boolean(target),
        };
        setSelectedId(entry.id);
        setCreating(false);
        return [entry, ...h];
      });
      setPremise("");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError({ code: "NetworkError", message });
      alertDone({
        channel: "director",
        ok: false,
        title: target ? "Revision failed" : "Storyboard failed",
        body: message,
        tag: "director",
      });
    } finally {
      setBusy(false);
    }
  }

  async function copyScript() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError({ code: "Clipboard", message: "Clipboard unavailable" });
    }
  }

  function downloadScript() {
    if (!current) return;
    const blob = new Blob([current.script], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `storyboard-${new Date(current.ts)
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const scriptPane = (
    <div className="flex flex-col gap-4">
      {busy && (
        <Panel
          title={amending ? "Revising storyboard" : "Storyboard in progress"}
        >
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="border border-line rounded-md p-3 bg-panel2/40 animate-pulse"
              >
                <div className="h-3 w-16 rounded-md bg-line" />
                <div className="mt-2 h-2 w-full rounded-md bg-line/70" />
                <div className="mt-1.5 h-2 w-5/6 rounded-md bg-line/50" />
                <div className="mt-1.5 h-2 w-2/3 rounded-md bg-line/40" />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            <span className="animate-pulse-dot inline-block text-warn">●</span>{" "}
            {amending
              ? "director applying your amendment…"
              : "director is writing — the full script lands here when done"}
          </p>
        </Panel>
      )}
      {history.length > 0 && (
        <Panel title={`Storyboards (${history.length})`}>
          <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setSelectedId(null);
              }}
              className={`text-left px-3 py-2 rounded-md border text-xs transition-colors flex items-center gap-2 ${
                creating
                  ? "border-accent/60 text-ink bg-accent/10"
                  : "border-dashed border-line text-muted hover:text-ink"
              }`}
            >
              <span className="shrink-0 text-accent">＋</span>
              <span className="truncate flex-1">
                New storyboard
                {creating ? " — write the premise below" : ""}
              </span>
            </button>
            {history.map((h) => {
              const on = activeScript?.id === h.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(h.id);
                    setCreating(false);
                  }}
                  className={`text-left px-3 py-2 rounded-md border text-xs transition-colors flex items-center gap-2 ${
                    on
                      ? "border-accent/60 text-ink bg-accent/10"
                      : "border-line text-muted hover:text-ink"
                  }`}
                >
                  <span className="shrink-0">
                    {new Date(h.ts).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    {new Date(h.ts).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span
                    className={`shrink-0 border rounded-md px-1 text-2xs ${
                      h.revised
                        ? "border-warn/50 text-warn"
                        : "border-accent/40 text-accent"
                    }`}
                  >
                    {h.revised ? "rev" : "gen"}
                  </span>
                  <span
                    className="truncate flex-1"
                    title={h.revised && h.instruction ? h.instruction : h.premise}
                  >
                    {h.revised && h.instruction ? h.instruction : h.premise}
                  </span>
                  {h.estimate !== null && (
                    <span className="shrink-0 text-accent">
                      {formatSGD(h.estimate)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Panel>
      )}
      {current ? (
        <Panel
          title={current.revised ? "Revised storyboard" : "Storyboard"}
        >
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Btn variant="ghost" size="sm" onClick={copyScript}>
              {copied ? "✓ Copied" : "Copy"}
            </Btn>
            <Btn variant="ghost" size="sm" onClick={downloadScript}>
              ⬇ Download .txt
            </Btn>
            <select
              value=""
              onChange={(e) =>
                e.target.value && void scriptBulk("move", e.target.value)
              }
              title="Move this storyboard to another project"
              className="bg-panel2 border border-line rounded-md px-2 min-h-8 text-xs text-muted outline-none focus:border-accent/60"
            >
              <option value="">Move to…</option>
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
              onChange={(e) =>
                e.target.value && void scriptBulk("copy", e.target.value)
              }
              title="Copy this storyboard to another project"
              className="bg-panel2 border border-line rounded-md px-2 min-h-8 text-xs text-muted outline-none focus:border-accent/60"
            >
              <option value="">Copy to…</option>
              {projects
                .filter((p) => p.id !== projectId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              {projectId !== null && (
                <option value="none">Unassigned</option>
              )}
            </select>
            {current.estimate !== null && (
              <span className="ml-auto text-2xs text-muted">
                Est. cost{" "}
                <span
                  className="text-accent"
                  title="Estimate based on rates in src/lib/pricing.ts · shown in SGD @ 1.3 USD"
                >
                  {formatSGD(current.estimate)}
                </span>
              </span>
            )}
          </div>
          {(() => {
            const parent = current.parentId
              ? history.find((h) => h.id === current.parentId)
              : undefined;
            const open = promptOpenId === current.id;
            const long =
              current.premise.length + (current.instruction?.length ?? 0) > 220 ||
              /\n/.test(current.premise + (current.instruction ?? ""));
            const clamp = open ? "" : "line-clamp-3";
            return (
              <div className="mb-3 rounded-md border border-line bg-panel2/40 p-3">
                {current.revised && (
                  <>
                    <p className="text-2xs font-medium text-warn mb-1">
                      Amendment
                    </p>
                    {current.instruction ? (
                      <p className={`text-sm text-ink/90 whitespace-pre-wrap ${clamp}`}>
                        {current.instruction}
                      </p>
                    ) : (
                      <p className="text-xs text-muted">
                        Not saved. Revisions made before this update did not record their amendment.
                      </p>
                    )}
                  </>
                )}
                <p
                  className={`text-2xs font-medium text-muted mb-1 ${
                    current.revised ? "mt-3" : ""
                  }`}
                >
                  {current.revised ? "Original premise" : "Premise"}
                </p>
                <p className={`text-sm text-ink/90 whitespace-pre-wrap ${clamp}`}>
                  {current.premise}
                  {current.premiseTruncated ? "…" : ""}
                </p>
                {current.premiseTruncated && (
                  <p className="mt-1 text-2xs text-muted">
                    Only the first 120 characters were saved for storyboards made before this update.
                  </p>
                )}
                {(long || parent) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {long && (
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => setPromptOpenId(open ? null : current.id)}
                      >
                        {open ? "Show less" : "Show full prompt"}
                      </Btn>
                    )}
                    {parent && (
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedId(parent.id);
                          setCreating(false);
                        }}
                        title="Open the storyboard this one was revised from"
                      >
                        Open the version it revised
                      </Btn>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          <pre
            ref={preRef}
            onScroll={saveScroll}
            className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink/90 bg-panel2/50 border border-line rounded-md p-4 max-h-[60vh] overflow-y-auto">
            {current.script}
          </pre>
        </Panel>
      ) : (
        <div className="border border-dashed border-line rounded-md p-8 text-center">
          <p className="text-sm text-muted">
            The storyboard will appear here — write a premise and hit
            <span className="text-accent"> Generate storyboard</span>.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Panel title={amending ? "Amendment" : "Premise"} step="01">
        <MentionTextArea
          rows={4}
          maxLength={4000}
          value={premise}
          onChange={setPremise}
          projectId={projectId}
          getMediaMentions={() => []}
          onPickCharacter={(c) =>
            setSelected((s) => {
              const next = new Set(s);
              next.add(c.id);
              return next;
            })
          }
          chipCharacters
          placeholder={
            amending
              ? "Tell Director how to change the selected storyboard, e.g. 'expand scene 3 with more resistance beats', 'add a scene where Diana calls for help', 'make the final line colder'"
              : "What happens? Type @ to mention a character (adds them to the cast). e.g. '@Kara investigates the noise…'"
          }
        />
        <div className="mt-1.5 flex justify-between gap-2 text-2xs text-muted">
          <span className="truncate">
            {amending ? (
              <>
                applying to{" "}
                <span className="text-ink/80" title={activeScript?.premise}>
                  {activeScript?.premise.slice(0, 40) || "untitled"}
                  {(activeScript?.premise.length ?? 0) > 40 ? "…" : ""}
                </span>{" "}
                · keeps style · untouched scenes verbatim
              </>
            ) : (
              "Director turns this into your storyboard script style"
            )}
          </span>
          <span className="shrink-0">{premise.length}/4000</span>
        </div>
      </Panel>

      <Panel title="Cast" step="02">
        <div className="flex flex-wrap gap-2">
          {characters.length === 0 && (
            <p className="text-xs text-muted">
              No saved characters — create them in the Characters tab, or list
              cast below.
            </p>
          )}
          {characters.map((c) => {
            const on = selected.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleCharacter(c.id)}
                title={c.description}
                className={`flex items-center gap-2 border rounded-full px-2.5 py-1 text-xs transition-colors ${
                  on
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-line text-muted hover:text-ink"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${on ? "bg-accent" : "bg-muted/50"}`}
                />
                {c.name}
              </button>
            );
          })}
        </div>
        <div className="mt-3">
          <input
            value={extraCast}
            onChange={(e) => setExtraCast(e.target.value)}
            placeholder="…or type extra names (comma separated): the janitor, the voice on the radio…"
            className="w-full bg-panel2 border border-line rounded-md px-3 py-2 text-sm text-ink placeholder:text-muted/50 outline-none focus:border-accent/60 transition-colors"
          />
        </div>
      </Panel>

      <Panel title="Action" step="03">
        <Field label="Writer model">
          {models.length > 0 && models.length <= 3 ? (
            <Seg
              value={model}
              onChange={setModel}
              options={models.map((m) => ({ value: m.id, label: m.label }))}
            />
          ) : models.length > 3 ? (
            <Select
              value={model}
              onChange={setModel}
              options={models.map((m) => ({ value: m.id, label: m.label }))}
            />
          ) : (
            <Link
              href="/models"
              className="flex items-center h-9 px-3 rounded-md border border-line bg-panel2 text-sm text-accent hover:bg-panel2/70"
            >
              Enable a writing model on the Models page
            </Link>
          )}
        </Field>
        <Btn
          onClick={generate}
          disabled={!premise.trim() || !model}
          size="lg"
          className="mt-4 w-full"
        >
          {amending ? "✦ Apply amendment" : "Generate storyboard"}
        </Btn>
        {busy && (
          <p className="mt-2 text-xs text-muted">
            {amending
              ? "director revising…"
              : "director writing… you can start another take"}
          </p>
        )}
      </Panel>

      {error && (
        <ErrorBox
          code={error.code}
          message={error.message}
          requestId={error.requestId}
        />
      )}

      {slot ? createPortal(scriptPane, slot) : current ? scriptPane : null}
    </div>
  );
}
