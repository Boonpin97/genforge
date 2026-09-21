"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import MentionTextArea from "./mention-textarea";
import { Btn, ErrorBox, Field, Panel, Seg } from "./ui";
import { alertDone } from "@/lib/notify";
import { formatSGD } from "@/lib/pricing";
import type { ApiError, Character } from "@/lib/types";

type ScriptEntry = {
  id: string;
  ts: number;
  premise: string;
  script: string;
  estimate: number | null;
  revised?: boolean;
};

export default function DirectorPanel({
  active,
  slot,
  projectId,
}: {
  active: boolean;
  slot?: HTMLElement | null;
  projectId: string | null;
}) {
  const [premise, setPremise] = useState("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extraCast, setExtraCast] = useState("");
  const [model, setModel] = useState("qwen3.8-max");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [history, setHistory] = useState<ScriptEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(true);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const projectQs = projectId === null ? "none" : projectId;
  const loadedFor = useRef<string | null>(null);

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
            script: string;
            estimate: number | null;
            revised: boolean;
          }) => ({
            id: s.id,
            ts: s.createdAt,
            premise: s.premise,
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
        title: target ? "Revision ready" : "Storyboard ready",
        body: text.slice(0, 140),
        tag: "director",
      });
      setHistory((h) => {
        const entry: ScriptEntry = {
          id: data.id || `${target ? "r" : "g"}${Date.now()}`,
          ts: Date.now(),
          premise: target ? target.premise : text,
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
                  <span className="truncate flex-1">{h.premise}</span>
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
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink/90 bg-panel2/50 border border-line rounded-md p-4 max-h-[60vh] overflow-y-auto">
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
          <Seg
            value={model}
            onChange={setModel}
            options={[
              { value: "qwen3.8-flash", label: "qwen3.8-flash" },
              { value: "qwen3.8-max", label: "qwen3.8-max" },
            ]}
          />
        </Field>
        <Btn
          onClick={generate}
          disabled={!premise.trim()}
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
