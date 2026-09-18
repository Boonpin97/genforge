"use client";

import type { ReactNode } from "react";
import type { TaskRecord } from "@/lib/types";

export function fmtElapsed(task: TaskRecord, now: number): string {
  const s = Math.max(0, Math.floor((now - task.createdAt) / 1000));
  if (task.kind === "image") return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

export function Panel({
  title,
  step,
  children,
  className = "",
}: {
  title?: string;
  step?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`border border-line bg-panel rounded-md ${className}`}
    >
      {title && (
        <header className="flex items-center gap-3 px-4 py-2.5 border-b border-line">
          {step && (
            <span className="font-mono text-[10px] text-accent border border-accent/40 rounded px-1 py-px">
              {step}
            </span>
          )}
          <h2 className="font-display font-semibold text-[13px] tracking-[0.14em] uppercase text-ink">
            {title}
          </h2>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[11px] font-medium tracking-[0.12em] uppercase text-muted">
          {label}
        </span>
        {hint && <span className="text-[11px] text-muted/70 font-mono">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-panel2 border border-line rounded px-3 py-2 text-sm text-ink placeholder:text-muted/50 outline-none focus:border-accent/60 transition-colors ${props.className || ""}`}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full bg-panel2 border border-line rounded px-3 py-2 text-sm text-ink placeholder:text-muted/50 outline-none focus:border-accent/60 transition-colors resize-y ${props.className || ""}`}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-panel2 border border-line rounded px-2.5 py-2 text-sm text-ink outline-none focus:border-accent/60 transition-colors cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex border border-line rounded overflow-hidden bg-panel2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 px-2 py-1.5 text-xs font-medium transition-colors ${
            value === o.value
              ? "bg-accent text-[#10130c]"
              : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 group"
    >
      <span
        className={`w-9 h-5 rounded-full border transition-colors relative ${
          checked ? "bg-accent/25 border-accent/60" : "bg-panel2 border-line"
        }`}
      >
        <span
          className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all ${
            checked ? "left-[18px] bg-accent" : "left-0.5 bg-muted"
          }`}
        />
      </span>
      <span className="text-xs text-ink group-hover:text-accent transition-colors">
        {label}
      </span>
    </button>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="font-mono text-xs text-accent w-14 text-right">
        {value}
        {suffix || ""}
      </span>
    </div>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
  className?: string;
}) {
  const styles = {
    primary:
      "bg-accent text-[#10130c] hover:bg-[#d4f766] font-semibold border border-accent",
    ghost:
      "bg-transparent text-muted hover:text-ink border border-line hover:border-muted",
    danger:
      "bg-transparent text-danger border border-danger/40 hover:border-danger",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 rounded text-sm tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    submitting: { cls: "text-warn border-warn/40", label: "SUBMITTING" },
    queued: { cls: "text-muted border-line", label: "QUEUED" },
    running: { cls: "text-warn border-warn/40", label: "RUNNING" },
    succeeded: { cls: "text-ok border-ok/40", label: "SUCCEEDED" },
    failed: { cls: "text-danger border-danger/40", label: "FAILED" },
  };
  const s = map[status] || map.queued;
  const pulse = status === "running" || status === "queued" || status === "submitting";
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[10px] tracking-wider border rounded px-1.5 py-0.5 ${s.cls}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full bg-current ${pulse ? "animate-pulse-dot" : ""}`}
      />
      {s.label}
    </span>
  );
}

export function ErrorBox({
  code,
  message,
  requestId,
}: {
  code?: string;
  message: string;
  requestId?: string;
}) {
  return (
    <div className="border border-danger/40 bg-danger/5 rounded p-3 text-sm">
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono text-[10px] tracking-wider text-danger border border-danger/40 rounded px-1 py-px">
          {code || "ERROR"}
        </span>
        <span className="text-[11px] uppercase tracking-[0.14em] text-danger font-display font-semibold">
          Generation failed
        </span>
      </div>
      <p className="text-ink/90 break-words">{message}</p>
      {requestId && (
        <p className="mt-1.5 font-mono text-[10px] text-muted">
          request_id: {requestId}
        </p>
      )}
    </div>
  );
}
