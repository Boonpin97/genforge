"use client";

import { useRef, useState } from "react";

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

export function getVideoDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      resolve(Number.isFinite(video.duration) ? video.duration : 0);
      video.src = "";
    };
    video.onerror = () => reject(new Error("Could not read video metadata"));
    video.src = url;
  });
}

export function getAudioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
      audio.src = "";
    };
    audio.onerror = () => reject(new Error("Could not read audio metadata"));
    audio.src = url;
  });
}

function writeStr(dv: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) dv.setUint8(offset + i, s.charCodeAt(i));
}

function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const bytes = 44 + len * numCh * 2;
  const ab = new ArrayBuffer(bytes);
  const dv = new DataView(ab);
  writeStr(dv, 0, "RIFF");
  dv.setUint32(4, bytes - 8, true);
  writeStr(dv, 8, "WAVE");
  writeStr(dv, 12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(21, numCh, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * numCh * 2, true);
  dv.setUint16(32, numCh * 2, true);
  dv.setUint16(34, 16, true);
  writeStr(dv, 36, "data");
  dv.setUint32(40, len * numCh * 2, true);
  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let pos = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      dv.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      pos += 2;
    }
  }
  return ab;
}

export async function trimAudioBlob(
  blob: Blob,
  maxSec: number
): Promise<{ blob: Blob; durationSec: number; trimmed: boolean }> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration <= maxSec + 0.1)
      return { blob, durationSec: decoded.duration, trimmed: false };
    const frames = Math.floor(maxSec * decoded.sampleRate);
    const out = ctx.createBuffer(
      decoded.numberOfChannels,
      frames,
      decoded.sampleRate
    );
    for (let c = 0; c < decoded.numberOfChannels; c++)
      out.copyToChannel(decoded.getChannelData(c).slice(0, frames), c);
    return {
      blob: new Blob([encodeWav(out)], { type: "audio/wav" }),
      durationSec: decoded.duration,
      trimmed: true,
    };
  } catch {
    return { blob, durationSec: 0, trimmed: false };
  } finally {
    void ctx.close();
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const ASSET_DND = "application/x-genforge-asset";

export type AssetDropData = {
  url: string;
  name: string;
  kind: "image" | "video";
};

function readDrop(e: React.DragEvent): { asset?: AssetDropData; files: File[] } {
  const raw = e.dataTransfer.getData(ASSET_DND);
  if (raw) {
    try {
      const asset = JSON.parse(raw) as AssetDropData;
      if (asset?.url) return { asset, files: [] };
    } catch {
      // fall through to file handling
    }
  }
  return { files: Array.from(e.dataTransfer.files || []) };
}

export function AddTile({
  accept,
  onFiles,
  onAssetDrop,
  disabled,
  className = "",
}: {
  accept: string;
  onFiles: (files: File[]) => void;
  onAssetDrop?: (data: AssetDropData) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Add more references"
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled)
          inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (disabled) return;
        const { asset, files } = readDrop(e);
        if (asset) onAssetDrop?.(asset);
        else if (files.length) onFiles(files);
      }}
      className={`border border-dashed rounded-md bg-panel2/40 flex flex-col items-center justify-center gap-1 cursor-pointer select-none text-muted transition-all ${
        dragging
          ? "border-accent bg-accent/10 text-accent scale-[1.02]"
          : "border-line hover:border-accent/60 hover:text-accent"
      } ${disabled ? "opacity-40 pointer-events-none" : ""} ${className}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
      <span className="text-2xl leading-none">+</span>
      <span className="text-[10px] font-mono uppercase tracking-[0.12em]">
        add
      </span>
    </div>
  );
}

export default function DropZone({
  accept,
  title,
  hint,
  onFiles,
  onAssetDrop,
  disabled,
}: {
  accept: string;
  title: string;
  hint?: string;
  onFiles: (files: File[]) => void;
  onAssetDrop?: (data: AssetDropData) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (disabled) return;
        const { asset, files } = readDrop(e);
        if (asset) onAssetDrop?.(asset);
        else if (files.length) onFiles(files);
      }}
      className={`border border-dashed rounded-md py-3 flex items-center justify-center cursor-pointer transition-all select-none ${
        dragging
          ? "border-accent bg-accent/5 scale-[1.01]"
          : "border-line hover:border-muted/60 bg-panel2/40"
      } ${disabled ? "opacity-40 pointer-events-none" : ""}`}
      title={[title, hint].filter(Boolean).join(" · ")}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
      <div
        className={`w-9 h-9 rounded border flex items-center justify-center transition-colors ${
          dragging ? "border-accent text-accent" : "border-line text-muted"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 17V3m0 0l-5 5m5-5l5 5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 15v4a2 2 0 002 2h14a2 2 0 002-2v-4" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
