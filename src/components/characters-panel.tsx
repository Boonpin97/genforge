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
import {
  Btn,
  Chip,
  Field,
  Panel,
  RelocateSelect,
  TextArea,
  TextInput,
} from "./ui";
import type { Character } from "@/lib/types";
import {
  activeLook,
  charImgUrl,
  charLookImgUrl,
  characterLooks,
} from "@/lib/types";

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MAX_LOOKS = 12;

type PendingImage = { file: File; url: string };

export default function CharactersPanel({
  projectId,
}: {
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
  const [listNotice, setListNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [existingImages, setExistingImages] = useState<number[]>([]);
  const [editHadAudio, setEditHadAudio] = useState(false);
  const [removeExistingAudio, setRemoveExistingAudio] = useState(false);
  const [editingLookId, setEditingLookId] = useState<string | null>(null);
  const [lookName, setLookName] = useState("");

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

  async function relocateCharacter(
    c: Character,
    action: "move" | "copy",
    target: string
  ) {
    const form = new FormData();
    form.append(action === "copy" ? "copyProject" : "moveProject", target);
    const res = await fetch(`/api/characters/${c.id}`, {
      method: "PATCH",
      body: form,
    });
    if (!res.ok) {
      setListNotice({ kind: "err", msg: `Could not ${action} ${c.name}` });
      return;
    }
    const where =
      target === "none"
        ? "Unassigned"
        : projects.find((p) => p.id === target)?.name || "another project";
    setListNotice({
      kind: "ok",
      msg:
        action === "copy"
          ? `Copied ${c.name} to ${where}`
          : `Moved ${c.name} to ${where}`,
    });
    if (action === "move" && editingId === c.id) resetForm();
    await refresh();
  }

  useEffect(() => {
    if (!listNotice) return;
    const id = window.setTimeout(() => setListNotice(null), 4000);
    return () => window.clearTimeout(id);
  }, [listNotice]);

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
    setEditingLookId(null);
    setLookName("");
  }

  function loadLook(c: Character, lookId: string) {
    setImageFiles((list) => {
      list.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
    setEditingLookId(lookId);
    if (lookId === "new") {
      setLookName("");
      setDescription(activeLook(c).description);
      setExistingImages([]);
      return;
    }
    const look =
      characterLooks(c).find((l) => l.id === lookId) ?? activeLook(c);
    setLookName(look.name);
    setDescription(look.description);
    setExistingImages(
      Array.from({ length: look.imageCount }, (_, i) => i)
    );
  }

  function startEdit(c: Character, lookId?: string) {
    setNotice(null);
    resetForm();
    setEditingId(c.id);
    setName(c.name);
    setEditHadAudio(c.hasAudio);
    loadLook(c, lookId ?? activeLook(c).id);
  }

  function replaceCharacter(next: Character) {
    setCharacters((list) => list.map((x) => (x.id === next.id ? next : x)));
  }

  async function activateLook(c: Character, lookId: string) {
    if (activeLook(c).id === lookId) return;
    const form = new FormData();
    form.append("activeLook", lookId);
    const res = await fetch(`/api/characters/${c.id}`, {
      method: "PATCH",
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.character) {
      setNotice({
        kind: "err",
        msg: data.message || `Could not switch ${c.name}'s look`,
      });
      return;
    }
    replaceCharacter(data.character);
    const look = activeLook(data.character);
    setNotice({
      kind: "ok",
      msg: `${c.name} now uses the "${look.name}" look in new generations`,
    });
  }

  async function removeLook(c: Character, lookId: string) {
    const form = new FormData();
    form.append("deleteLook", lookId);
    const res = await fetch(`/api/characters/${c.id}`, {
      method: "PATCH",
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.character) {
      setNotice({
        kind: "err",
        msg: data.message || "Could not delete this look",
      });
      return;
    }
    replaceCharacter(data.character);
    loadLook(data.character, activeLook(data.character).id);
    setNotice({ kind: "ok", msg: "Look deleted" });
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
      if (editingChar && editingLookId && editingLookId !== "new") {
        for (const idx of existingImages.slice(0, 3)) {
          try {
            const res = await fetch(
              charLookImgUrl(editingChar, editingLookId, idx)
            );
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
      form.append("lookName", lookName.trim());
      let url: string;
      let method: string;
      if (editingId) {
        if (editingLookId) form.append("lookId", editingLookId);
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
        msg:
          editingLookId === "new"
            ? `New look "${activeLook(data.character).name}" added to ${data.character.name} and now active in new generations`
            : `Character "${data.character.name}" ${editingId ? "updated" : "saved"}`,
      });
      resetForm();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleHidden(c: Character) {
    const form = new FormData();
    form.append("hidden", c.hidden ? "false" : "true");
    const res = await fetch(`/api/characters/${c.id}`, {
      method: "PATCH",
      body: form,
    });
    if (!res.ok) {
      setNotice({
        kind: "err",
        msg: `Could not ${c.hidden ? "unhide" : "hide"} ${c.name}`,
      });
      return;
    }
    setCharacters((list) =>
      list.map((x) => (x.id === c.id ? { ...x, hidden: !c.hidden } : x))
    );
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

  const editingChar = editingId
    ? characters.find((x) => x.id === editingId)
    : undefined;
  const editingLooks = editingChar ? characterLooks(editingChar) : [];
  const editingActiveId = editingChar ? activeLook(editingChar).id : null;

  return (
    <div className="flex flex-col gap-4">
      <Panel title={editingId ? "Edit character" : "New character"} step={editingId ? "✎" : "+"}>
        {editingId && (
          <div className="mb-4 flex items-center justify-between border border-accent/40 bg-accent/5 rounded-md px-3 py-2">
            <span className="text-xs font-medium text-ink">
              editing saved character — changes apply on save
            </span>
            <button
              type="button"
              onClick={resetForm}
              className="text-xs text-muted hover:text-ink border border-line hover:border-muted/60 rounded-md px-3 min-h-8 inline-flex items-center transition-colors"
            >
              cancel
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name" hint="Up to 60 characters">
            <TextInput
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nova the courier"
            />
          </Field>
          <Field label="Voice sample" hint="Optional, wav or mp3 up to 15MB">
            <div className="flex items-center gap-2">
              <label className="flex-1 cursor-pointer">
                <span className="block bg-panel2 border border-line rounded-md px-3 py-2 text-sm text-muted hover:border-accent/50 transition-colors truncate">
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
                  className="text-muted hover:text-danger text-sm"
                >
                  ✕
                </button>
              )}
            </div>
            {editingId && editHadAudio && !audioFile && (
              <button
                type="button"
                onClick={() => setRemoveExistingAudio((v) => !v)}
                className={`mt-1.5 text-xs border rounded-md px-3 min-h-8 inline-flex items-center transition-colors ${
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
        {editingChar && (
          <div className="mt-4">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <span className="text-xs font-medium text-ink/80">Looks</span>
              <span className="text-2xs text-muted">
                Name and voice are shared. Each look has its own description and images.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {editingLooks.map((l) => (
                <Chip
                  key={l.id}
                  active={editingLookId === l.id}
                  onClick={() => loadLook(editingChar, l.id)}
                  title={`Edit the "${l.name}" look — unsaved changes to the current look are discarded`}
                >
                  {l.name}
                  {editingActiveId === l.id && (
                    <span className="text-2xs text-ok">active</span>
                  )}
                </Chip>
              ))}
              {editingLooks.length < MAX_LOOKS && (
                <Chip
                  active={editingLookId === "new"}
                  onClick={() => loadLook(editingChar, "new")}
                  title="Add another look with its own description and reference images"
                >
                  ＋ New look
                </Chip>
              )}
            </div>
          </div>
        )}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
          <Field
            label="Look name"
            hint={editingId ? "Up to 40 characters" : "Optional, e.g. Default"}
          >
            <TextInput
              value={lookName}
              maxLength={40}
              onChange={(e) => setLookName(e.target.value)}
              placeholder={
                editingLookId === "new" ? "e.g. Winter coat" : "Default"
              }
            />
          </Field>
          {editingChar && editingLookId && editingLookId !== "new" && (
            <div className="flex items-center gap-1.5 flex-wrap min-h-9">
              {editingActiveId !== editingLookId ? (
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={() => void activateLook(editingChar, editingLookId)}
                  title="Use this look's description and images whenever this character is referenced"
                >
                  Make active
                </Btn>
              ) : (
                <span className="text-2xs text-muted">
                  Active look, used in new generations
                </span>
              )}
              {editingLooks.length > 1 && (
                <Btn
                  variant="danger"
                  size="sm"
                  onClick={() => void removeLook(editingChar, editingLookId)}
                  title="Delete this look and its reference images"
                >
                  Delete look
                </Btn>
              )}
            </div>
          )}
        </div>
        <div className="mt-4">
          <Field label="Appearance / persona description" hint="Added to the prompt">
            <TextArea
              rows={2}
              maxLength={600}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="young woman, short silver hair, amber eyes, worn red flight jacket, confident smirk…"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-2xs text-muted">
                Auto-write reads the reference images you have added.
              </p>
              <Btn
                variant="ghost"
                size="sm"
                onClick={autoDescribe}
                disabled={descBusy || busy || !name.trim()}
              >
                {descBusy ? "Writing…" : "✦ Auto-write"}
              </Btn>
            </div>
          </Field>
        </div>
        <div className="mt-4">
          {totalImages === 0 && (
            <DropZone
              accept="image/png,image/jpeg,image/webp,image/bmp"
              title={`Reference images (1–${MAX_IMAGES})`}
              hint="Front, side and full-body shots work best. Up to 10MB each."
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
                        src={charLookImgUrl(
                          editingChar ?? { id: editingId, createdAt: 0 },
                          editingLookId ?? "main",
                          idx
                        )}
                        alt={`image ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <p className="px-1.5 py-1 text-2xs text-muted truncate">
                      {pos + 1}. saved
                    </p>
                    <button
                      type="button"
                      onClick={() => setExistingImages((l) => l.filter((x) => x !== idx))}
                      aria-label={`Remove image ${idx + 1}`}
                      className="absolute top-1.5 right-1.5 w-7 h-7 rounded-md bg-black/65 backdrop-blur-sm text-white/75 hover:text-danger hover:bg-black/80 text-xs leading-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
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
                  <p className="px-1.5 py-1 text-2xs text-muted truncate" title={p.file.name}>
                    {editingId ? existingImages.length + i + 1 : i + 1}.{" "}
                    {formatBytes(p.file.size)}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label={`Remove ${p.file.name}`}
                    className="absolute top-1.5 right-1.5 w-7 h-7 rounded-md bg-black/65 backdrop-blur-sm text-white/75 hover:text-danger hover:bg-black/80 text-xs leading-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
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
            className={`mt-3 text-xs ${
              notice.kind === "ok" ? "text-ok" : "text-danger"
            }`}
          >
            {notice.kind === "ok" ? "✓ " : "⚠ "}
            {notice.msg}
          </p>
        )}
        <div className="mt-4">
          <Btn onClick={saveCharacter} disabled={busy}>
            {busy
              ? "Saving…"
              : editingLookId === "new"
                ? "Save new look"
                : editingId
                  ? "Save changes"
                  : "Save character"}
          </Btn>
        </div>
      </Panel>

      <Panel title={`Saved characters (${characters.length})`}>
        {listNotice && (
          <p
            role="status"
            className={`mb-3 border rounded-md px-3 py-2 text-xs ${
              listNotice.kind === "ok"
                ? "border-ok/30 bg-ok/10 text-ok"
                : "border-danger/30 bg-danger/10 text-danger"
            }`}
          >
            {listNotice.msg}
          </p>
        )}
        {characters.length === 0 ? (
          <p className="text-sm text-muted py-4 text-center">
            No characters yet — create one above.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {characters.map((c) => (
              <div
                key={c.id}
                className={`border rounded-lg bg-panel2 overflow-hidden flex gap-3 p-3 animate-rise ${
                  editingId === c.id ? "border-accent/60" : "border-line"
                }`}
              >
                <div className="w-16 h-16 shrink-0 rounded-md border border-line overflow-hidden bg-black/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={charImgUrl(c, 0)}
                    alt={c.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1 flex flex-col">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm text-ink truncate">
                      {c.name}
                    </p>
                    {c.hasAudio && (
                      <span className="text-2xs font-medium text-accent bg-accent/10 rounded-full px-2 py-0.5">
                        voice
                      </span>
                    )}
                    {c.hidden && (
                      <span
                        className="text-2xs font-medium text-muted bg-panel rounded-full px-2 py-0.5"
                        title="Kept in this list, but not offered in @ mentions or reference picking"
                      >
                        hidden
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-2xs text-muted">
                      {c.imageCount} image{c.imageCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="text-2xs text-muted line-clamp-2 mt-1">
                    {c.description || "No description yet"}
                  </p>
                  {characterLooks(c).length > 1 && (
                    <div
                      className="flex items-center gap-1.5 mt-2 flex-wrap"
                      role="group"
                      aria-label={`${c.name}'s active look`}
                    >
                      {characterLooks(c).map((l) => (
                        <Chip
                          key={l.id}
                          active={activeLook(c).id === l.id}
                          onClick={() => void activateLook(c, l.id)}
                          title={
                            activeLook(c).id === l.id
                              ? `"${l.name}" is the active look`
                              : `Use "${l.name}" whenever ${c.name} is referenced`
                          }
                        >
                          {l.name}
                        </Chip>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={() => startEdit(c)}
                      title="Load this character into the form above"
                    >
                      Edit
                    </Btn>
                    {characterLooks(c).length < MAX_LOOKS && (
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => startEdit(c, "new")}
                        title="Add another look with its own description and reference images"
                      >
                        Add look
                      </Btn>
                    )}
                    <RelocateSelect
                      projects={projects}
                      currentProjectId={projectId}
                      trigger="text"
                      triggerLabel="Move or copy"
                      label={`Move or copy ${c.name} to another project`}
                      onPick={(action, target) =>
                        void relocateCharacter(c, action, target)
                      }
                    />
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={() => void toggleHidden(c)}
                      title={
                        c.hidden
                          ? "Offer this character in @ mentions and reference picking again"
                          : "Keep it in this list but stop offering it in @ mentions and reference picking"
                      }
                    >
                      {c.hidden ? "Unhide" : "Hide"}
                    </Btn>
                    <Btn
                      variant="danger"
                      size="sm"
                      onClick={() => removeCharacter(c)}
                      title="Delete this character and its files"
                    >
                      Delete
                    </Btn>
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
