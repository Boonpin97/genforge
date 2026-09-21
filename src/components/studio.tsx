"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import VideoPanel, { type VideoSubmitPayload } from "./video-panel";
import ImagePanel, { type ImageSubmitPayload } from "./image-panel";
import CharactersPanel from "./characters-panel";
import SettingsMenu from "./settings-menu";
import DirectorPanel from "./director-panel";
import AnalyticsPanel from "./analytics-panel";
import AssetsGallery from "./assets-gallery";
import UploadsGallery from "./uploads-gallery";
import PromptsGallery from "./prompts-gallery";
import { blobToDataUrl } from "./drop-zone";
import {
  estimateOpenRouterVideoCost,
  formatSGD,
} from "@/lib/pricing";
import { alertDone } from "@/lib/notify";
import type {
  ApiError,
  AssetRefMeta,
  ImageSettings,
  MediaPayload,
  StoredAsset,
  TaskRecord,
  VideoSettings,
} from "@/lib/types";

type Tab = "video" | "image" | "characters" | "director" | "analytics";

let attachNonce = 0;

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `t${Date.now()}${Math.random().toString(36).slice(2)}`;

const FETCHABLE = /^(data:|blob:)/i;

function assetToTask(a: StoredAsset): TaskRecord {
  const served = (kind: "result" | "ref", i: number) =>
    `/api/assets/${a.id}/${kind}/${i}`;
  const base = {
    id: a.id,
    assetId: a.id,
    prompt: a.prompt,
    createdAt: a.createdAt,
    status:
      a.status === "pending"
        ? ("queued" as const)
        : a.status === "failed"
          ? ("failed" as const)
          : ("succeeded" as const),
    error:
      a.status === "failed" && a.error
        ? { code: "Failed", message: a.error }
        : undefined,
    taskId: a.taskId,
    requestId: a.requestId,
    usage: a.usage,
    estimate: a.estimate,
    params: a.params,
    hidden: a.hidden,
  };
  if (a.kind === "video") {
    const settings: VideoSettings = {
      ...(a.settings as Omit<
        VideoSettings,
        "kind" | "prompt" | "media"
      >),
      kind: "video",
      prompt: a.prompt,
      media: a.refs.map((r, i) => {
        const url = r.file ? served("ref", i) : r.url || "";
        return {
          type: r.type || "reference_image",
          url,
          name: r.name,
          previewUrl: r.file ? served("ref", i) : /^https?:/i.test(url) ? url : "",
          durationSec: r.durationSec,
          characterId: r.characterId,
        };
      }),
    };
    return {
      ...base,
      kind: "video",
      model: a.model,
      videoUrl: a.results.length ? served("result", 0) : undefined,
      settings,
    };
  }
  const settings: ImageSettings = {
    ...(a.settings as Omit<ImageSettings, "kind" | "prompt" | "images">),
    kind: "image",
    prompt: a.prompt,
    images: a.refs.map((r, i) => ({
      name: r.name,
      url: r.file ? served("ref", i) : r.url || "",
      characterId: r.characterId,
    })),
  };
  return {
    ...base,
    kind: "image",
    model: a.model,
    imageUrls: a.results.map((_, i) => served("result", i)),
    settings,
  };
}

type SubmitJson = {
  taskId?: string;
  requestId?: string | null;
  images?: unknown;
  usage?: TaskRecord["usage"];
  estimate?: number | null;
};

function apiError(data: unknown, status: number): ApiError {
  const d = (data || {}) as {
    code?: unknown;
    message?: unknown;
    requestId?: unknown;
    request_id?: unknown;
    error?: { code?: unknown; message?: unknown };
  };
  const pick = (v: unknown) =>
    typeof v === "string" && v.trim() ? v : undefined;
  return {
    code: pick(d.code) || pick(d.error?.code) || `HTTP_${status}`,
    message:
      pick(d.message) ||
      pick(d.error?.message) ||
      `Request failed with status ${status}`,
    requestId: pick(d.requestId) || pick(d.request_id),
  };
}

export default function Studio({
  projectId,
  projectName,
}: {
  projectId: string | null;
  projectName?: string;
}) {
  const [tab, setTab] = useState<Tab>("video");
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [assets, setAssets] = useState<TaskRecord[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [videoProvider, setVideoProvider] = useState<"dashscope" | "qwencloud">(
    "dashscope"
  );
  const [banner, setBanner] = useState<string | null>(null);
  const [videoReuse, setVideoReuse] = useState<{
    settings: VideoSettings;
    nonce: number;
  } | null>(null);
  const [imageReuse, setImageReuse] = useState<{
    settings: ImageSettings;
    nonce: number;
  } | null>(null);
  const [split, setSplit] = useState(45);
  const [assetPane, setAssetPane] = useState<
    "generated" | "uploaded" | "prompts"
  >("generated");
  const [directorSlot, setDirectorSlot] = useState<HTMLDivElement | null>(null);
  const [uploadsNonce, setUploadsNonce] = useState(0);
  const [promptsNonce, setPromptsNonce] = useState(0);
  const [videoPrompt, setVideoPrompt] = useState<{
    text: string;
    nonce: number;
  } | null>(null);
  const [imagePrompt, setImagePrompt] = useState<{
    text: string;
    nonce: number;
  } | null>(null);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const alertedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const v = Number(localStorage.getItem("genforge.split"));
      if (v >= 25 && v <= 78) setSplit(v);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const dt = e.clipboardData;
      if (!dt) return;
      const files: File[] = [];
      for (const item of Array.from(dt.items)) {
        if (item.kind !== "file") continue;
        if (
          !item.type.startsWith("image/") &&
          !item.type.startsWith("audio/")
        )
          continue;
        const f = item.getAsFile();
        if (f) files.push(f);
      }
      if (!files.length) return;
      e.preventDefault();
      void (async () => {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        const form = new FormData();
        files.forEach((f, i) => {
          const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg");
          const named =
            f.name && f.name !== "image.png"
              ? f.name
              : `pasted-${stamp}${files.length > 1 ? `-${i + 1}` : ""}.${ext}`;
          form.append("files", f, named);
        });
        if (projectId) form.append("projectId", projectId);
        try {
          const res = await fetch("/api/uploads", { method: "POST", body: form });
          const data = await res.json().catch(() => null);
          if (!res.ok)
            throw new Error(data?.message || `Upload failed (HTTP ${res.status})`);
          setAssetPane("uploaded");
          setUploadsNonce((n) => n + 1);
          setPasteNote(
            `Pasted ${files.length} file${files.length === 1 ? "" : "s"} into the upload library — drag one into a reference zone to use it`
          );
          window.setTimeout(() => setPasteNote(null), 6000);
        } catch (err) {
          setBanner(
            `Could not paste image: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      })();
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [projectId]);

  useEffect(() => {
    try {
      localStorage.setItem("genforge.split", String(Math.round(split)));
    } catch {}
  }, [split]);

  function onDividerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
  }
  function onDividerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || !mainRef.current) return;
    const rect = mainRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setSplit(Math.min(78, Math.max(25, pct)));
  }
  function onDividerUp() {
    draggingRef.current = false;
  }

  const reuseSettings = useCallback(async (task: TaskRecord) => {
    const orig = task.settings;
    if (!orig) return;
    const remote = (u: string) => u.startsWith("/api/assets/");
    let s: VideoSettings | ImageSettings =
      orig.kind === "video"
        ? {
            ...orig,
            prompt: orig.userPrompt ?? orig.prompt,
            media: orig.media.filter((m) => !m.characterId),
          }
        : {
            ...orig,
            prompt: orig.userPrompt ?? orig.prompt,
            images: orig.images.filter((im) => !im.characterId),
          };
    try {
      if (s.kind === "video") {
        const media: MediaPayload[] = [];
        for (const m of s.media) {
          if (!remote(m.url)) {
            media.push(m);
            continue;
          }
          const res = await fetch(m.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          if (m.type === "reference_image") {
            const dataUrl = await blobToDataUrl(blob);
            media.push({ ...m, url: dataUrl, previewUrl: dataUrl });
          } else {
            const form = new FormData();
            form.append("file", blob, m.name || "reference");
            form.append("model", s.model);
            const up = await fetch("/api/upload", { method: "POST", body: form });
            const d = await up.json();
            if (!up.ok) throw new Error(d?.message || `HTTP ${up.status}`);
            media.push({
              ...m,
              url: d.url,
              previewUrl:
                m.type === "reference_video" ? URL.createObjectURL(blob) : "",
            });
          }
        }
        s = { ...s, media };
      } else {
        const images: ImageSettings["images"] = [];
        for (const im of s.images) {
          if (!remote(im.url)) {
            images.push(im);
            continue;
          }
          const res = await fetch(im.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          images.push({
            name: im.name,
            url: await blobToDataUrl(await res.blob()),
          });
        }
        s = { ...s, images };
      }
    } catch (e) {
      setBanner(
        `Could not restore saved references: ${e instanceof Error ? e.message : String(e)}`
      );
      return;
    }
    const nonce = Date.now();
    if (s.kind === "video") {
      setVideoReuse({ settings: s, nonce });
      setTab("video");
    } else {
      setImageReuse({ settings: s, nonce });
      setTab("image");
    }
    setBanner("Settings reused — review prompt and references, then generate again");
  }, []);

  const usePrompt = useCallback((target: "video" | "image", text: string) => {
    const nonce = ++attachNonce;
    if (target === "video") {
      setVideoPrompt({ text, nonce });
      setTab("video");
    } else {
      setImagePrompt({ text, nonce });
      setTab("image");
    }
    setBanner("Saved prompt loaded — edit it or generate as is");
  }, []);

  const savePrompt = useCallback(
    async (kind: "video" | "image", text: string): Promise<boolean> => {
      const body = text.trim();
      if (!body) return false;
      try {
        const res = await fetch("/api/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: body, kind, projectId }),
        });
        if (!res.ok) return false;
        setPromptsNonce((n) => n + 1);
        setAssetPane("prompts");
        return true;
      } catch {
        return false;
      }
    },
    [projectId]
  );

  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        setConfigured(Boolean(d.configured));
        if (d.videoProvider === "qwencloud") setVideoProvider("qwencloud");
      })
      .catch(() => setConfigured(false));
  }, []);

  const loadAssets = useCallback(() => {
    fetch(`/api/assets?project=${projectId === null ? "none" : projectId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d.assets)) return;
        const all = (d.assets as StoredAsset[]).map(assetToTask);
        setAssets(all);
        const resumable = all.filter((t) => t.taskId && t.status === "queued");
        if (resumable.length)
          setTasks((list) => [
            ...resumable.filter((r) => !list.some((x) => x.id === r.id)),
            ...list,
          ]);
      })
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const updateTask = useCallback((id: string, patch: Partial<TaskRecord>) => {
    setTasks((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const persistAsset = useCallback(
    async (task: TaskRecord, opts?: { pending?: boolean }) => {
      try {
        const results =
          task.kind === "video"
            ? task.videoUrl
              ? [task.videoUrl]
              : []
            : task.imageUrls || [];
        if (!results.length && !opts?.pending) return;
        const refs: AssetRefMeta[] = [];
        const files: { i: number; blob: Blob; name: string }[] = [];
        let settings: Record<string, string | number | boolean | undefined> = {};
        if (task.settings?.kind === "video") {
          const s = task.settings;
          settings = {
            model: s.model,
            userPrompt: s.userPrompt,
            resolution: s.resolution,
            ratio: s.ratio,
            duration: s.duration,
            audio: s.audio,
            watermark: s.watermark,
            rewrotePrompt: s.rewrotePrompt,
            promptTab: s.promptTab,
          };
          for (const m of s.media) {
            const kind =
              m.type === "reference_image"
                ? "image"
                : m.type === "reference_video"
                  ? "video"
                  : "audio";
            const ref: AssetRefMeta = {
              name: m.name || kind,
              kind,
              type: m.type,
              durationSec: m.durationSec,
              characterId: m.characterId,
            };
            const i = refs.length;
            refs.push(ref);
            if (FETCHABLE.test(m.url)) {
              try {
                files.push({ i, blob: await (await fetch(m.url)).blob(), name: ref.name });
              } catch {
                ref.url = "";
              }
            } else {
              ref.url = m.url;
            }
          }
        } else if (task.settings?.kind === "image") {
          const s = task.settings;
          settings = {
            model: s.model,
            userPrompt: s.userPrompt,
            size: s.size,
            n: s.n,
            negativePrompt: s.negativePrompt,
            promptExtend: s.promptExtend,
            watermark: s.watermark,
            seed: s.seed,
          };
          for (const im of s.images) {
            const ref: AssetRefMeta = {
              name: im.name,
              kind: "image",
              characterId: im.characterId,
            };
            const i = refs.length;
            refs.push(ref);
            if (FETCHABLE.test(im.url)) {
              try {
                files.push({ i, blob: await (await fetch(im.url)).blob(), name: im.name });
              } catch {
                ref.url = "";
              }
            } else {
              ref.url = im.url;
            }
          }
        }
        const form = new FormData();
        form.append(
          "meta",
          JSON.stringify({
            id: task.id,
            kind: task.kind,
            model: task.model,
            prompt: task.prompt,
            createdAt: task.createdAt,
            status: opts?.pending ? "pending" : "succeeded",
            taskId: task.taskId,
            requestId: task.requestId,
            usage: task.usage,
            estimate: task.estimate,
            params: task.params,
            settings,
            results,
            refs,
            projectId,
          })
        );
        for (const f of files) {
          form.append(`ref-${f.i}`, f.blob, f.name || `ref-${f.i}`);
        }
        const res = await fetch("/api/assets", { method: "POST", body: form });
        if (!res.ok) throw new Error((await res.json())?.message || `HTTP ${res.status}`);
        const saved = (await res.json().catch(() => null)) as {
          asset?: { id: string; results?: unknown[] };
        } | null;
        const patch: Partial<TaskRecord> = { assetId: task.id };
        const a = saved?.asset;
        if (a && Array.isArray(a.results) && a.results.length) {
          if (task.kind === "video")
            patch.videoUrl = `/api/assets/${a.id}/result/0`;
          else
            patch.imageUrls = a.results.map(
              (_, i) => `/api/assets/${a.id}/result/${i}`
            );
        }
        updateTask(task.id, patch);
      } catch (e) {
        console.error("asset save failed", e);
        setBanner(
          `Asset could not be saved to disk: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    },
    [updateTask, projectId]
  );

  const pollTask = useCallback(
    async (task: TaskRecord) => {
      if (!task.taskId) return;
      try {
        const qs = new URLSearchParams();
        if (task.params && typeof task.params.resolution === "string")
          qs.set("resolution", task.params.resolution);
        qs.set("model", task.model);
        if (task.model.includes("/")) qs.set("provider", "openrouter");
        else if (videoProvider === "qwencloud") qs.set("provider", "qwencloud");
        const q = qs.size ? `?${qs.toString()}` : "";
        const res = await fetch(`/api/task/${task.taskId}${q}`);
        const data = await res.json();
        if (!res.ok) {
          const err = data?.error || {
            code: `HTTP_${res.status}`,
            message: "Failed to poll task status",
          };
          updateTask(task.id, { status: "failed", error: err });
          return;
        }
        const patch: Partial<TaskRecord> = {
          status: data.status,
          videoUrl: data.videoUrl || undefined,
          usage: data.usage || undefined,
          estimate: data.estimate,
          requestId: data.requestId || task.requestId,
          error: data.error || (data.status === "failed" ? { code: "Failed", message: "Task failed" } : undefined),
        };
        if (
          data.status === "succeeded" &&
          patch.estimate == null &&
          task.model.includes("/")
        )
          patch.estimate =
            estimateOpenRouterVideoCost(
              Number(task.params?.duration) || 0,
              typeof task.params?.resolution === "string"
                ? task.params.resolution
                : undefined
            ) ?? undefined;
        updateTask(task.id, patch);
        if (
          (patch.status === "succeeded" || patch.status === "failed") &&
          task.status !== patch.status &&
          !alertedRef.current.has(task.id)
        ) {
          alertedRef.current.add(task.id);
          alertDone({
            channel: "video",
            ok: patch.status === "succeeded",
            title:
              patch.status === "succeeded" ? "Video ready" : "Video failed",
            body:
              patch.status === "succeeded"
                ? task.prompt.slice(0, 140)
                : patch.error?.message || "Generation failed",
            tag: task.id,
          });
        }
        if (patch.videoUrl && task.status !== "succeeded") {
          if (task.assetId) {
            void fetch(`/api/assets/${task.assetId}/complete`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                videoUrl: patch.videoUrl,
                usage: patch.usage,
                estimate: patch.estimate,
                requestId: patch.requestId,
              }),
            })
              .then((r) => r.json())
              .then((out) => {
                const a = out?.asset;
                if (a && Array.isArray(a.results) && a.results.length)
                  updateTask(task.id, {
                    videoUrl: `/api/assets/${a.id}/result/0`,
                  });
              })
              .catch(() => {});
          } else {
            void persistAsset({ ...task, ...patch });
          }
        }
        if (
          patch.status === "failed" &&
          task.assetId &&
          task.status !== "failed"
        ) {
          void fetch(`/api/assets/${task.assetId}/fail`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: patch.error?.message || "Task failed",
            }),
          }).catch(() => {});
        }
      } catch (e) {
        // Transient network error - keep polling on next tick.
        console.error("poll failed", e);
      }
    },
    [persistAsset, updateTask, videoProvider]
  );

  useEffect(() => {
    const iv = setInterval(() => {
      const active = tasksRef.current.filter(
        (t) =>
          t.kind === "video" &&
          (t.status === "queued" || t.status === "running") &&
          t.taskId
      );
      active.forEach((t) => void pollTask(t));
    }, 10000);
    return () => clearInterval(iv);
  }, [pollTask]);

  const submitVideo = useCallback(
    async (payload: VideoSubmitPayload): Promise<boolean> => {
      setBanner(null);
      const id = uid();
      const record: TaskRecord = {
        id,
        kind: "video",
        model: payload.model,
        prompt: payload.prompt,
        createdAt: Date.now(),
        status: "submitting",
        settings: payload,
        params: {
          resolution: payload.resolution,
          ratio: payload.ratio,
          duration:
            payload.duration === -1 ? "smart" : payload.duration,
          audio: payload.audio,
          refs: payload.media.length,
          rewrite: payload.promptTab === "rewritten",
        },
      };
      setTasks((list) => [record, ...list]);
      try {
        const isOR = payload.model.includes("/");
        const res = await fetch(
          isOR ? "/api/generate/openrouter-video" : "/api/generate/video",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              isOR
                ? {
                    prompt: payload.prompt,
                    model: payload.model,
                    images: payload.media
                      .filter((m) => m.type === "reference_image")
                      .map((m) => m.url || m.previewUrl),
                    duration: payload.duration,
                    ratio: payload.ratio,
                    resolution: payload.resolution,
                  }
                : {
                    prompt: payload.prompt,
                    model: payload.model,
                    resolution: payload.resolution,
                    ratio: payload.ratio,
                    duration: payload.duration,
                    audio: payload.audio,
                    watermark: payload.watermark,
                    media: payload.media.map(({ type, url }) => ({
                      type,
                      url,
                    })),
                  }
            ),
          }
        );
        const data = (await res.json().catch(() => null)) as
          | SubmitJson
          | null;
        if (!res.ok) {
          updateTask(id, {
            status: "failed",
            error: apiError(data, res.status),
          });
          return false;
        }
        if (!data) {
          updateTask(id, {
            status: "failed",
            error: {
              code: "InvalidResponse",
              message: "Server returned a success status but no JSON body.",
            },
          });
          return false;
        }
        updateTask(id, {
          status: "queued",
          taskId: data.taskId,
          requestId: data.requestId || undefined,
        });
        const created = { ...record, taskId: data.taskId as string };
        void persistAsset(created, { pending: true });
        setTimeout(() => void pollTask(created), 3000);
        return true;
      } catch (e) {
        updateTask(id, {
          status: "failed",
          error: {
            code: "NetworkError",
            message: e instanceof Error ? e.message : String(e),
          },
        });
        return false;
      } finally {
      }
    },
    [persistAsset, pollTask, updateTask]
  );

  const submitImage = useCallback(
    async (payload: ImageSubmitPayload): Promise<boolean> => {
      setBanner(null);
      const count = Math.min(6, Math.max(1, Number(payload.n) || 1));
        const endpoint = payload.model.includes("/")
          ? "/api/generate/openrouter"
          : "/api/generate/image";
      const base = uid();
      const created: TaskRecord[] = [];
      for (let i = 0; i < count; i++) {
        created.push({
          id: count === 1 ? base : `${base}-${i + 1}`,
          kind: "image",
          model: payload.model,
          prompt: payload.prompt,
          createdAt: Date.now(),
          status: "submitting",
          settings: {
            ...payload,
            n: 1,
            seed: i === 0 ? payload.seed : undefined,
          },
          params: {
            size: payload.size,
            n: 1,
            prompt_extend: payload.promptExtend,
          },
        });
      }
      setTasks((list) => [...created, ...list]);

      const runOne = async (rec: TaskRecord, i: number): Promise<boolean> => {
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: payload.prompt,
              model: payload.model,
              images: payload.images.map((im) => im.url),
              size: payload.size,
              n: 1,
              negativePrompt: payload.negativePrompt,
              promptExtend: payload.promptExtend,
              watermark: payload.watermark,
              seed: i === 0 ? payload.seed : undefined,
            }),
          });
          const data = (await res.json().catch(() => null)) as
            | SubmitJson
            | null;
          if (!res.ok) {
            updateTask(rec.id, {
              status: "failed",
              error: apiError(data, res.status),
            });
            return false;
          }
          if (!data) {
            updateTask(rec.id, {
              status: "failed",
              error: {
                code: "InvalidResponse",
                message:
                  "Server returned a success status but no JSON body.",
              },
            });
            return false;
          }
          const urls: string[] = Array.isArray(data.images)
            ? data.images.slice(0, 1)
            : [];
          if (!urls.length) {
            updateTask(rec.id, {
              status: "failed",
              error: { code: "EmptyResult", message: "API returned no image." },
            });
            return false;
          }
          const patch: Partial<TaskRecord> = {
            status: "succeeded",
            imageUrls: urls,
            usage: data.usage || undefined,
            estimate: data.estimate,
            requestId: data.requestId || undefined,
          };
          updateTask(rec.id, patch);
          void persistAsset({ ...rec, ...patch } as TaskRecord);
          return true;
        } catch (e) {
          updateTask(rec.id, {
            status: "failed",
            error: {
              code: "NetworkError",
              message: e instanceof Error ? e.message : String(e),
            },
          });
          return false;
        }
      };
      void Promise.all(created.map((rec, i) => runOne(rec, i))).then((oks) => {
        const good = oks.filter(Boolean).length;
        const many = oks.length > 1;
        alertDone({
          channel: "image",
          ok: good > 0,
          title:
            good === oks.length
              ? many
                ? `${good} images ready`
                : "Image ready"
              : good === 0
                ? many
                  ? "Images failed"
                  : "Image failed"
                : `${good}/${oks.length} images ready`,
          body: payload.prompt.slice(0, 140),
          tag: base,
        });
      });
      return true;
    },
    [persistAsset, updateTask]
  );

  const clearAll = useCallback(() => {
    setTasks([]);
    setAssets([]);
    void fetch("/api/assets", { method: "DELETE" });
  }, []);

  const toggleHidden = useCallback((task: TaskRecord) => {
    if (!task.assetId) return;
    const next = !task.hidden;
    const apply = (l: TaskRecord[]) =>
      l.map((t) => (t.id === task.id ? { ...t, hidden: next } : t));
    setTasks(apply);
    setAssets(apply);
    void fetch(`/api/assets/${task.assetId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hidden: next }),
    }).catch(() => {});
  }, []);

  const removeAsset = useCallback((task: TaskRecord) => {
    setTasks((l) => l.filter((t) => t.id !== task.id));
    setAssets((l) => l.filter((t) => t.id !== task.id));
    if (task.assetId) void fetch(`/api/assets/${task.assetId}`, { method: "DELETE" });
  }, []);

  const taskIds = new Set(tasks.map((t) => t.id));
  const gallery = [...tasks, ...assets.filter((a) => !taskIds.has(a.id))];

  const sessionCost = gallery.reduce(
    (sum, t) => sum + (t.status === "succeeded" && t.estimate ? t.estimate : 0),
    0
  );
  const activeCount = tasks.filter(
    (t) => t.status === "queued" || t.status === "running" || t.status === "submitting"
  ).length;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      <header className="border-b border-line bg-panel/80 backdrop-blur sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-2.5 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              title="Back to projects"
              className="inline-flex items-center justify-center w-8 h-8 shrink-0 -ml-1 rounded-md text-muted hover:text-ink hover:bg-panel2 transition-colors"
              aria-label="Back to projects"
            >
              ←
            </Link>
            <span className="font-semibold text-lg tracking-[0.08em] text-ink shrink-0">
              GENFORGE
            </span>
            <span className="hidden sm:block w-px h-5 bg-line shrink-0" />
            <span
              className="hidden sm:block text-sm text-muted truncate max-w-[220px]"
              title={projectName || "project"}
            >
              {projectName || (projectId === null ? "Unassigned" : projectId)}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            {activeCount > 0 && (
              <span className="flex items-center gap-2 text-warn bg-warn/10 rounded-full pl-2.5 pr-3 h-8">
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse-dot" />
                {activeCount} running
              </span>
            )}
            <span
              className="flex items-center gap-2 text-muted h-8 px-1"
              title={
                configured === false
                  ? "DASHSCOPE_API_KEY missing in .env.local"
                  : "API key configured"
              }
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  configured === null
                    ? "bg-muted"
                    : configured
                      ? "bg-ok"
                      : "bg-danger"
                }`}
              />
              <span className="hidden md:inline">
                {configured === null
                  ? "Checking key"
                  : configured
                    ? "Key ready"
                    : "No API key"}
              </span>
            </span>
            <span className="flex items-center gap-1.5 text-muted h-8 px-1">
              <span className="hidden md:inline">Session</span>
              <span className="font-mono tabular-nums text-ink">
                {sessionCost ? formatSGD(sessionCost) : "S$0"}
              </span>
            </span>
            <SettingsMenu />
          </div>
        </div>
      </header>

      <main className="flex-1 w-full px-4 sm:px-6 py-6">
        <div
          ref={mainRef}
          className="flex flex-col lg:flex-row gap-6 lg:gap-0 items-start"
        >
        <div
          className="flex flex-col gap-4 min-w-0 w-full lg:w-[var(--split)] lg:pr-4 lg:sticky lg:top-[68px] lg:max-h-[calc(100vh-92px)] lg:overflow-y-auto overscroll-contain"
          style={{ "--split": `${split}%` } as CSSProperties}
        >
          {configured === false && (
            <div className="border border-danger/35 bg-danger/10 rounded-lg p-3.5 text-sm text-ink">
              <p className="font-semibold text-danger mb-1">No API key found</p>
              <p className="text-ink/90">
                Set <code className="font-mono text-xs">DASHSCOPE_API_KEY</code> in{" "}
                <code className="font-mono text-xs">.env.local</code> (copy{" "}
                <code className="font-mono text-xs">.env.example</code>), then
                restart the dev server.
              </p>
            </div>
          )}
          {banner && (
            <div className="border border-warn/35 bg-warn/10 rounded-lg p-3.5 text-sm text-warn">
              {banner}
            </div>
          )}

          <div className="flex gap-0.5 p-1 rounded-lg border border-line bg-bg">
            {(
              [
                { id: "video", label: "Video" },
                { id: "image", label: "Images" },
                { id: "characters", label: "Characters" },
                { id: "director", label: "Director" },
                { id: "analytics", label: "Analytics" },
              ] as { id: Tab; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={`flex-1 min-h-9 px-3 rounded-md text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "bg-accent/15 text-accent font-semibold"
                    : "text-muted hover:text-ink hover:bg-panel2/60"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={tab === "video" ? "block" : "hidden"}>
            <VideoPanel
              onSubmit={submitVideo}
              promptInjection={videoPrompt}
              onSavePrompt={(text) => savePrompt("video", text)}
              reuse={videoReuse}
              projectId={projectId}
              videoProvider={videoProvider}
            />
          </div>
          <div className={tab === "image" ? "block" : "hidden"}>
            <ImagePanel
              onSubmit={submitImage}
              promptInjection={imagePrompt}
              onSavePrompt={(text) => savePrompt("image", text)}
              reuse={imageReuse}
              projectId={projectId}
            />
          </div>
          <div className={tab === "characters" ? "block" : "hidden"}>
            <CharactersPanel projectId={projectId} />
          </div>
          <div className={tab === "director" ? "block" : "hidden"}>
            <DirectorPanel
              active={tab === "director"}
              slot={directorSlot}
              projectId={projectId}
            />
          </div>
          <div className={tab === "analytics" ? "block" : "hidden"}>
            <AnalyticsPanel projectId={projectId} />
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize panels"
          onPointerDown={onDividerDown}
          onPointerMove={onDividerMove}
          onPointerUp={onDividerUp}
          onPointerCancel={onDividerUp}
          className="hidden lg:flex w-3 shrink-0 self-stretch cursor-col-resize justify-center touch-none group"
        >
          <span className="w-px h-full bg-line group-hover:bg-accent/60 group-active:bg-accent transition-colors" />
        </div>

        <aside className="min-w-0 flex-1 lg:sticky lg:top-[68px] lg:pl-4">
          {tab === "director" ? (
            <>
              <div className="flex items-center justify-between mb-3 min-h-9">
                <h2 className="font-semibold text-sm text-ink">Storyboard</h2>
              </div>
              <div
                ref={setDirectorSlot}
                className="max-h-[calc(100vh-140px)] overflow-y-auto overscroll-contain pr-1"
              />
            </>
          ) : (
            <>
              <div className="flex items-center gap-1 mb-3 min-h-9">
                {(
                  [
                    { id: "generated", label: "Generated" },
                    { id: "uploaded", label: "Uploaded" },
                    { id: "prompts", label: "Prompts" },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setAssetPane(p.id)}
                    aria-pressed={assetPane === p.id}
                    className={`min-h-8 px-3 rounded-md text-xs font-medium transition-colors ${
                      assetPane === p.id
                        ? "bg-panel2 text-accent"
                        : "text-muted hover:text-ink hover:bg-panel2/60"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                {assetPane === "generated" && gallery.length > 0 && (
                  <button
                    type="button"
                    onClick={clearAll}
                    className="ml-auto min-h-8 px-3 rounded-md text-xs text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
              {pasteNote && (
                <p className="mb-2 border border-line bg-panel2 rounded-md px-3 py-2 text-xs text-ink">
                  {pasteNote}
                </p>
              )}
              {assetPane === "prompts" ? (
                <div className="max-h-[calc(100vh-140px)] overflow-y-auto pr-1 overscroll-contain">
                  <PromptsGallery
                    projectId={projectId}
                    onUse={usePrompt}
                    reloadNonce={promptsNonce}
                  />
                </div>
              ) : assetPane === "uploaded" ? (
                <div className="max-h-[calc(100vh-140px)] overflow-y-auto pr-1 overscroll-contain">
                  <UploadsGallery
                    projectId={projectId}
                    reloadNonce={uploadsNonce}
                  />
                </div>
              ) : gallery.length === 0 ? (
                <div className="border border-dashed border-line rounded-lg px-6 py-12 text-center">
                  <p className="text-sm font-medium text-ink mb-1.5">
                    Nothing generated yet
                  </p>
                  <p className="text-xs text-muted max-w-[42ch] mx-auto">
                    Write a prompt and generate — results land here. Click any
                    result to see its prompt, references and cost, or to reuse its
                    settings.
                  </p>
                </div>
              ) : (
                <div className="max-h-[calc(100vh-140px)] overflow-y-auto pr-1 overscroll-contain">
                  <AssetsGallery
                    tasks={gallery}
                    onReuse={reuseSettings}
                    onDelete={removeAsset}
                    onToggleHidden={toggleHidden}
                    projectId={projectId}
                    onChanged={loadAssets}
                    onUploaded={() => {
                      setUploadsNonce((n) => n + 1);
                      setAssetPane("uploaded");
                    }}
                  />
                </div>
              )}
            </>
          )}
        </aside>
        </div>
      </main>

      <footer className="border-t border-line-soft py-4 mt-2">
        <p className="px-4 sm:px-6 text-2xs text-muted max-w-[90ch]">
          Cost figures are estimates, converted to SGD at a fixed 1.3 × USD. Adjust
          the rates in <code className="font-mono">src/lib/pricing.ts</code>. Usage
          data comes from the DashScope API, and result links expire 24 hours after
          generation.
        </p>
      </footer>
    </div>
  );
}
