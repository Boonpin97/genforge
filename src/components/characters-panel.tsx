"use client";

import { useCallback, useEffect, useState } from "react";
import DropZone, {
  AddTile,
  blobToDataUrl,
  fileToDataUrl,
  formatBytes,
  getAudioDuration,
  type AssetDropData,
} from "./drop-zone";
import { Btn, Field, Panel, TextArea, TextInput } from "./ui";
import type { Character } from "@/lib/types";
import { charImgUrl } from "@/lib/types";

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

type PendingImage = { file: File; url: string };

export default function CharactersPanel({
  onUse,
  projectId,
}: {
  onUse: (target: "video" | "image", character: Character) => void;
  projectId: string | null;
}) {
  const projectQs = projectId === null ? "none" : projectId;
  const [characters, setCharacters] = useState<Character[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageFiles, setImageFiles] = useState<PendingImage[]>([]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [descBusy, setDescBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [existingImages, setExistingImages] = useState<number[]>([]);
  const [editHadAudio, setEditHadAudio] = useState(false);
  const [removeExistingAudio, setRemoveExistingAudio] = useState(false);

  const totalImages = existingImages.length + imageFiles.length;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/characters?project=${projectQs}`);
      const data = await res.json();
      setCharacters(data.characters || []);
    } catch {
      setNotice({ kind: "err", msg: "Failed to load character library" });
    }
  }, [projectQs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/characters?project=${projectQs}`);
        const data = await res.json();
        if (!cancelled) setCharacters(data.characters || []);
      } catch {
        if (!cancelled) setNotice({ kind: "err", msg: "Failed to load character library" });
      }
    })();
    return () => {
      cancelled = true;
    };
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

  async function moveCharacter(id: string, target: string) {
    const form = new FormData();
    form.append("moveProject", target);
    const res = await fetch(`/api/characters/${id}`, {
      method: "PATCH",
      body: form,
    });
    if (res.ok) await refresh();
  }

  function resetForm() {
    setName("");
    setDescription("");
    setImageFiles((list) => {
      list.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
    setAudioFile(null);
    setEditingId(null);
    setExistingImages([]);
    setEditHadAudio(false);
    setRemoveExistingAudio(false);
  }

  function startEdit(c: Character) {
    setNotice(null);
    resetForm();
    setEditingId(c.id);
    setName(c.name);
    setDescription(c.description);
    setExistingImages(c.imageCount ? Array.from({ length: c.imageCount }, (_, i) => i) : []);
    setEditHadAudio(c.hasAudio);
  }

  function addImages(files: File[]) {
    setNotice(null);
    const baseCount = existingImages.length;
    setImageFiles((list) => {
      const next = [...list];
      for (const f of files) {
        if (!f.type.startsWith("image/")) {
          setNotice({ kind: "err", msg: `${f.name}: only image files allowed` });
          continue;
        }
        if (f.size > MAX_IMAGE_BYTES) {
          setNotice({ kind: "err", msg: `${f.name}: exceeds 10MB limit` });
          continue;
        }
        if (baseCount + next.length >= MAX_IMAGES) {
          setNotice({ kind: "err", msg: `Max ${MAX_IMAGES} images per character` });
          break;
        }
        next.push({ file: f, url: URL.createObjectURL(f) });
      }
      return next;
    });
  }

  function removeImage(i: number) {
    setImageFiles((list) => {
      URL.revokeObjectURL(list[i]?.url);
      return list.filter((_, j) => j !== i);
    });
  }

  function addAudio(files: File[]) {
    setNotice(null);
    const f = files[0];
    if (!f) return;
    const ok = /^audio\//.test(f.type) || /\.(wav|mp3)$/i.test(f.name);
    if (!ok) {
      setNotice({ kind: "err", msg: "Voice sample must be wav or mp3" });
      return;
    }
    if (f.size > MAX_AUDIO_BYTES) {
      setNotice({ kind: "err", msg: "Voice sample exceeds 15MB limit" });
      return;
    }
    setAudioFile(f);
    const url = URL.createObjectURL(f);
    getAudioDuration(url)
      .then((dur) => {
        URL.revokeObjectURL(url);
        if (dur > 15)
          setNotice({
            kind: "err",
            msg: `Voice is ${dur.toFixed(1)}s — video generations will use only its first 15s`,
          });
      })
      .catch(() => URL.revokeObjectURL(url));
  }

  async function addAsset(d: AssetDropData) {
    setNotice(null);
    if (d.kind === "video") {
      setNotice({ kind: "err", msg: "Only image assets can be character references" });
      return;
    }
    try {
      const res = await fetch(d.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) {
        setNotice({ kind: "err", msg: "Dropped asset is not an image" });
        return;
      }
      const ext = blob.type.includes("png") ? ".png" : ".jpg";
      const base = (d.name || "asset").replace(/[^\w.-]+/g, "_").slice(0, 40);
      addImages([new File([blob], `${base}${ext}`, { type: blob.type })]);
    } catch (e) {
      setNotice({
        kind: "err",
        msg: `Could not import asset: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  async function autoDescribe() {
    if (!name.trim()) {
      setNotice({ kind: "err", msg: "Enter a character name first" });
      return;
    }
    setDescBusy(true);
    setNotice(null);
    try {
      const imageDataUrls: string[] = [];
      const editingChar = editingId
        ? characters.find((x) => x.id === editingId)
        : undefined;
      if (editingChar) {
        for (const idx of existingImages.slice(0, 3)) {
          try {
            const res = await fetch(charImgUrl(editingChar, idx));
            if (res.ok) imageDataUrls.push(await blobToDataUrl(await res.blob()));
          } catch {}
        }
      }
      for (const p of imageFiles) {
        if (imageDataUrls.length >= 3) break;
        try {
          imageDataUrls.push(await fileToDataUrl(p.file));
        } catch {}
      }
      const res = await fetch("/api/appearance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          hint: description.trim() || undefined,
          images: imageDataUrls,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({
          kind: "err",
          msg: data.message || `Draft failed (HTTP ${res.status})`,
        });
        return;
      }
      setDescription(data.description);
      setNotice({
        kind: "ok",
        msg: data.fallback
          ? "Drafted from the name only — model couldn't read the images"
          : imageDataUrls.length
            ? `Description drafted from your reference images (${data.model})`
            : `Description drafted from the name (${data.model})`,
      });
    } catch (e) {
      setNotice({
        kind: "err",
        msg: e instanceof Error ? e.message : "Draft failed",
      });
    } finally {
      setDescBusy(false);
    }
  }

  async function saveCharacter() {
    setNotice(null);
    if (!name.trim()) {
      setNotice({ kind: "err", msg: "Name is required" });
      return;
    }
    if (totalImages === 0) {
      setNotice({ kind: "err", msg: "Keep or add at least 1 reference image" });
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("name", name.trim());
      form.append("description", description.trim());
      let url: string;
      let method: string;
      if (editingId) {
        form.append("keepImages", JSON.stringify(existingImages));
        imageFiles.forEach((p) => form.append("images", p.file));
        if (audioFile) form.append("audio", audioFile);
        else if (editHadAudio && removeExistingAudio)
          form.append("removeAudio", "true");
        url = `/api/characters/${editingId}`;
        method = "PATCH";
      } else {
        imageFiles.forEach((p) => form.append("images", p.file));
        if (audioFile) form.append("audio", audioFile);
        form.append("projectId", projectId || "");
        url = "/api/characters";
        method = "POST";
      }
      const res = await fetch(url, { method, body: form });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ kind: "err", msg: data.message || `Save failed (HTTP ${res.status})` });
        return;
      }
      setNotice({
        kind: "ok",
        msg: `Character "${data.character.name}" ${editingId ? "updated" : "saved"}`,
      });
      resetForm();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeCharacter(c: Character) {
    const res = await fetch(`/api/characters/${c.id}`, { method: "DELETE" });
    if (res.ok) {
      if (editingId === c.id) resetForm();
      setCharacters((list) => list.filter((x) => x.id !== c.id));
    } else {
      setNotice({ kind: "err", msg: `Delete failed (HTTP ${res.status})` });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title={editingId ? "Edit character" : "New character"} step={editingId ? "✎" : "+"}>
        {editingId && (
          <div className="mb-4 flex items-center justify-between border border-accent/40 bg-accent/5 rounded px-3 py-2">
            <span className="font-mono text-[11px] text-accent">
              editing saved character — changes apply on save
            </span>
            <button
              type="button"
              onClick={resetForm}
              className="font-mono text-[10px] text-muted hover:text-ink border border-line rounded px-2 py-0.5"
            >
              cancel
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name" hint="≤60 chars">
            <TextInput
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nova the courier"
            />
          </Field>
          <Field label="Voice sample" hint="optional · wav/mp3 ≤15MB">
            <div className="flex items-center gap-2">
              <label className="flex-1 cursor-pointer">
                <span className="block bg-panel2 border border-line rounded px-3 py-2 text-sm text-muted hover:border-accent/50 transition-colors truncate">
                  {audioFile
                    ? audioFile.name
                    : editingId && editHadAudio && !removeExistingAudio
                      ? "replace / add new…"
                      : "Choose audio file…"}
                </span>
                <input
                  type="file"
                  accept="audio/wav,audio/mpeg,.wav,.mp3"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) addAudio([f]);
                    e.target.value = "";
                  }}
                />
              </label>
              {audioFile && (
                <button
                  type="button"
                  onClick={() => setAudioFile(null)}
                  className="text-muted hover:text-danger text-xs font-mono"
                >
                  ✕
                </button>
              )}
            </div>
            {editingId && editHadAudio && !audioFile && (
              <button
                type="button"
                onClick={() => setRemoveExistingAudio((v) => !v)}
                className={`mt-1.5 font-mono text-[10px] border rounded px-2 py-0.5 transition-colors ${
                  removeExistingAudio
                    ? "border-danger/60 text-danger"
                    : "border-line text-muted hover:text-ink"
                }`}
              >
                {removeExistingAudio
                  ? "✓ existing voice will be removed (click to keep)"
                  : "remove existing voice"}
              </button>
            )}
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Appearance / persona description" hint="injected into the prompt">
            <TextArea
              rows={2}
              maxLength={600}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="young woman, short silver hair, amber eyes, worn red flight jacket, confident smirk…"
            />
            <div className="mt-1.5 flex justify-end">
              <Btn
                variant="ghost"
                onClick={autoDescribe}
                disabled={descBusy || busy || !name.trim()}
                className="px-2.5 py-1 text-[11px] font-mono"
              >
                {descBusy ? "drafting…" : "✦ auto-write · reads your images"}
              </Btn>
            </div>
          </Field>
        </div>
        <div className="mt-4">
          {totalImages === 0 && (
            <DropZone
              accept="image/png,image/jpeg,image/webp,image/bmp"
              title={`Reference images (1–${MAX_IMAGES})`}
              hint="…or drag a gallery image here · front / side / full-body shots work best · png/jpeg/webp/bmp ≤10MB each"
              onFiles={addImages}
              onAssetDrop={addAsset}
              disabled={busy}
            />
          )}
          {totalImages > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {editingId &&
                existingImages.map((idx, pos) => (
                  <div
                    key={`ex-${idx}`}
                    className="relative border border-line rounded-md overflow-hidden bg-panel2 group"
                  >
                    <div className="aspect-square bg-black/40 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={charImgUrl(
                          characters.find((x) => x.id === editingId) ?? {
                            id: editingId,
                            createdAt: 0,
                          },
                          idx
                        )}
                        alt={`image ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <p className="px-1.5 py-1 text-[10px] font-mono text-muted truncate">
                      {pos + 1}. saved
                    </p>
                    <button
                      type="button"
                      onClick={() => setExistingImages((l) => l.filter((x) => x !== idx))}
                      aria-label={`Remove image ${idx + 1}`}
                      className="absolute top-1 right-1 w-5 h-5 rounded bg-black/70 text-muted hover:text-danger text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              {imageFiles.map((p, i) => (
                <div
                  key={p.url}
                  className="relative border border-line rounded-md overflow-hidden bg-panel2 group"
                >
                  <div className="aspect-square bg-black/40 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt={p.file.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <p className="px-1.5 py-1 text-[10px] font-mono text-muted truncate" title={p.file.name}>
                    {editingId ? existingImages.length + i + 1 : i + 1}.{" "}
                    {formatBytes(p.file.size)}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label={`Remove ${p.file.name}`}
                    className="absolute top-1 right-1 w-5 h-5 rounded bg-black/70 text-muted hover:text-danger text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <AddTile
                accept="image/png,image/jpeg,image/webp,image/bmp"
                onFiles={addImages}
                onAssetDrop={addAsset}
                disabled={busy}
                className="aspect-square min-h-20"
              />
            </div>
          )}
        </div>
        {notice && (
          <p
            className={`mt-3 text-xs font-mono ${
              notice.kind === "ok" ? "text-ok" : "text-danger"
            }`}
          >
            {notice.kind === "ok" ? "✓ " : "⚠ "}
            {notice.msg}
          </p>
        )}
        <div className="mt-4">
          <Btn onClick={saveCharacter} disabled={busy}>
            {busy ? "Saving…" : editingId ? "Save changes" : "Save character"}
          </Btn>
        </div>
      </Panel>

      <Panel title={`Saved characters (${characters.length})`}>
        {characters.length === 0 ? (
          <p className="text-sm text-muted py-4 text-center">
            No characters yet — create one above.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {characters.map((c) => (
              <div
                key={c.id}
                className={`border rounded-md bg-panel2 overflow-hidden flex gap-3 p-3 animate-rise ${
                  editingId === c.id ? "border-accent/60" : "border-line"
                }`}
              >
                <div className="w-20 h-20 shrink-0 rounded border border-line overflow-hidden bg-black/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={charImgUrl(c, 0)}
                    alt={c.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1 flex flex-col">
                  <div className="flex items-center gap-2">
                    <p className="font-display font-semibold text-sm text-ink truncate">
                      {c.name}
                    </p>
                    {c.hasAudio && (
                      <span className="font-mono text-[9px] text-accent border border-accent/40 rounded px-1">
                        voice
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted line-clamp-2 mt-0.5">
                    {c.description || "no description"}
                  </p>
                  <p className="text-[10px] font-mono text-muted mt-auto pt-1">
                    {c.imageCount} image{c.imageCount === 1 ? "" : "s"} ·{" "}
                    {new Date(c.createdAt).toLocaleDateString()}
                  </p>
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => onUse("video", c)}
                      className="font-mono text-[10px] border border-accent/50 text-accent rounded px-2 py-1 hover:bg-accent hover:text-[#10130c] transition-colors"
                    >
                      → use in video
                    </button>
                    <button
                      type="button"
                      onClick={() => onUse("image", c)}
                      className="font-mono text-[10px] border border-line text-muted rounded px-2 py-1 hover:border-[#7cc7ff]/60 hover:text-[#7cc7ff] transition-colors"
                    >
                      → use in image
                    </button>
                    <select
                      value=""
                      onChange={(e) =>
                        e.target.value && void moveCharacter(c.id, e.target.value)
                      }
                      title="Move character to another project"
                      className="font-mono text-[10px] border border-line text-muted rounded px-1 py-1 bg-panel2 outline-none focus:border-accent/60"
                    >
                      <option value="">move to…</option>
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
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      className="font-mono text-[10px] border border-line text-muted rounded px-2 py-1 hover:border-warn/60 hover:text-warn transition-colors"
                    >
                      edit
                    </button>
                    <button
                      type="button"
                      onClick={() => removeCharacter(c)}
                      className="font-mono text-[10px] border border-line text-muted rounded px-2 py-1 hover:border-danger/60 hover:text-danger transition-colors ml-auto"
                    >
                      delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
