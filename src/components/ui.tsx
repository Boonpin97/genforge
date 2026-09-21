"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
      className={`border border-line bg-panel rounded-lg shadow-panel ${className}`}
    >
      {title && (
        <header className="flex items-center gap-2.5 px-4 py-3 border-b border-line-soft">
          {step && (
            <span className="font-mono text-2xs text-accent bg-accent/12 rounded-sm px-1.5 py-0.5">
              {step}
            </span>
          )}
          <h2 className="font-semibold text-sm text-ink">{title}</h2>
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
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="text-xs font-medium text-ink/80">{label}</span>
        {hint && <span className="text-2xs text-muted">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

const control =
  "w-full bg-panel2 border border-line rounded-md px-3 text-sm text-ink placeholder:text-muted/60 outline-none focus:border-accent/50 transition-colors";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${control} h-9 ${props.className || ""}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${control} py-2.5 resize-y leading-relaxed ${props.className || ""}`}
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
      className={`${control} h-9 cursor-pointer pr-8`}
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
    <div className="flex gap-0.5 p-1 border border-line rounded-md bg-bg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex-1 min-h-8 px-2.5 rounded-sm text-xs font-medium leading-tight text-center transition-colors ${
            value === o.value
              ? "bg-panel2 text-accent shadow-panel"
              : "text-muted hover:text-ink hover:bg-panel2/50"
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
      className="flex items-center gap-2.5 group min-h-8 text-left"
    >
      <span
        className={`w-10 h-6 shrink-0 rounded-full border transition-colors relative ${
          checked ? "bg-accent/30 border-accent/50" : "bg-panel2 border-line"
        }`}
      >
        <span
          className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full transition-all ${
            checked ? "left-[19px] bg-accent" : "left-1 bg-muted"
          }`}
        />
      </span>
      <span className="text-xs text-ink/85 group-hover:text-ink transition-colors">
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
    <div className="flex items-center gap-3 min-h-8">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="font-mono text-xs text-ink tabular-nums w-14 text-right">
        {value}
        {suffix || ""}
      </span>
    </div>
  );
}

export type BtnVariant = "primary" | "ghost" | "danger" | "subtle";
export type BtnSize = "sm" | "md" | "lg";

export function btnClass(
  variant: BtnVariant = "primary",
  size: BtnSize = "md",
  className = ""
): string {
  const styles = {
    primary:
      "bg-accent text-accent-ink hover:brightness-110 font-semibold border border-transparent",
    ghost:
      "bg-transparent text-ink/80 hover:text-ink border border-line hover:border-muted/60 hover:bg-panel2",
    subtle:
      "bg-panel2 text-ink/80 hover:text-ink border border-transparent hover:bg-line",
    danger:
      "bg-transparent text-danger border border-danger/35 hover:border-danger/70 hover:bg-danger/10",
  }[variant];
  const sizing = {
    sm: "min-h-8 px-3 text-xs gap-1.5",
    md: "min-h-9 px-4 text-sm gap-2",
    lg: "min-h-11 px-5 text-sm gap-2",
  }[size];
  return `inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${sizing} ${styles} ${className}`;
}

export function Btn({
  children,
  onClick,
  disabled,
  variant = "primary",
  size = "md",
  type = "button",
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: BtnVariant;
  size?: BtnSize;
  type?: "button" | "submit";
  title?: string;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={btnClass(variant, size, className)}
    >
      {children}
    </button>
  );
}

export function Chip({
  children,
  active,
  onClick,
  title,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`inline-flex items-center gap-1.5 min-h-8 px-3 rounded-full text-xs font-medium transition-colors ${
        active
          ? "bg-accent/15 text-accent"
          : "bg-panel2 text-muted hover:text-ink hover:bg-line/60"
      }`}
    >
      {children}
    </button>
  );
}

export function Popover({
  open,
  anchorRef,
  onClose,
  children,
  width = 224,
  className = "",
  label,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  className?: string;
  label?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const w = panel?.width || width;
      const h = panel?.height || 240;
      const left = Math.min(
        Math.max(8, anchor.right - w),
        Math.max(8, window.innerWidth - w - 8)
      );
      const below = anchor.bottom + 6;
      const top =
        below + h > window.innerHeight - 8
          ? Math.max(8, anchor.top - h - 6)
          : below;
      setPos({ left, top });
    };
    place();
    const id = window.setTimeout(place, 0);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef, width, children]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t))
        return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, anchorRef, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width,
        visibility: pos ? "visible" : "hidden",
      }}
      className={`fixed z-50 max-h-[70vh] overflow-auto border border-line bg-panel rounded-lg shadow-pop ${className}`}
    >
      {children}
    </div>,
    document.body
  );
}

export function RelocateSelect({
  projects,
  currentProjectId,
  onPick,
  label,
  trigger = "icon",
  triggerLabel = "Move or copy",
  className = "",
}: {
  projects: { id: string; name: string }[];
  currentProjectId: string | null;
  onPick: (action: "move" | "copy", target: string) => void;
  label: string;
  trigger?: "icon" | "text";
  triggerLabel?: string;
  className?: string;
}) {
  const targets = [
    ...projects.filter((p) => p.id !== currentProjectId),
    ...(currentProjectId !== null ? [{ id: "none", name: "Unassigned" }] : []),
  ];
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  if (!targets.length) return null;

  const group = (action: "move" | "copy", heading: string) => (
    <div className="py-1">
      <p className="px-3 py-1 text-2xs text-muted">{heading}</p>
      {targets.map((p) => (
        <button
          key={`${action}-${p.id}`}
          type="button"
          onClick={() => {
            setOpen(false);
            onPick(action, p.id);
          }}
          className="w-full min-h-8 px-3 text-left text-xs text-ink/85 hover:text-ink hover:bg-panel2 transition-colors truncate"
        >
          {p.name}
        </button>
      ))}
    </div>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          trigger === "text"
            ? btnClass("ghost", "sm", className)
            : `inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-md border text-sm leading-none transition-colors ${
                open
                  ? "text-accent bg-accent/15 border-accent/40"
                  : "text-muted border-transparent hover:text-ink hover:bg-panel2 hover:border-line"
              } ${className}`
        }
      >
        {trigger === "text" ? triggerLabel : "⇄"}
      </button>
      <Popover
        open={open}
        anchorRef={btnRef}
        onClose={() => setOpen(false)}
        width={224}
        label={label}
        className="py-1"
      >
        {group("move", "Move to")}
        <div className="border-t border-line-soft" />
        {group("copy", "Copy to")}
      </Popover>
    </>
  );
}

export function IconBtn({
  children,
  onClick,
  disabled,
  title,
  active,
  tone = "default",
  className = "",
  ref,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title: string;
  active?: boolean;
  tone?: "default" | "danger";
  className?: string;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  const tones = active
    ? "text-accent bg-accent/15 border-accent/40"
    : tone === "danger"
      ? "text-muted border-transparent hover:text-danger hover:bg-danger/10 hover:border-danger/30"
      : "text-muted border-transparent hover:text-ink hover:bg-panel2 hover:border-line";
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-md border text-sm leading-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${tones} ${className}`}
    >
      {children}
    </button>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    submitting: { cls: "text-warn bg-warn/10", label: "Submitting" },
    queued: { cls: "text-muted bg-line/60", label: "Queued" },
    running: { cls: "text-warn bg-warn/10", label: "Running" },
    succeeded: { cls: "text-ok bg-ok/10", label: "Done" },
    failed: { cls: "text-danger bg-danger/10", label: "Failed" },
  };
  const s = map[status] || map.queued;
  const pulse = status === "running" || status === "queued" || status === "submitting";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-2xs font-medium rounded-full px-2 py-1 ${s.cls}`}
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
    <div className="border border-danger/35 bg-danger/10 rounded-lg p-3.5 text-sm">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-semibold text-sm text-danger">Generation failed</span>
        {code && (
          <span className="font-mono text-2xs text-danger/80 bg-danger/10 rounded-sm px-1.5 py-0.5">
            {code}
          </span>
        )}
      </div>
      <p className="text-ink/90 break-words">{message}</p>
      {requestId && (
        <p className="mt-2 font-mono text-2xs text-muted">request_id: {requestId}</p>
      )}
    </div>
  );
}
