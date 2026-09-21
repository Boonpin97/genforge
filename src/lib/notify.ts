"use client";

const KEY = "genforge:alerts";
const CHANNEL_KEY = "genforge:alerts.";
const CHIME_KEY = "genforge.chimeVolume";
const VIDEO_VOLUME_KEY = "genforge.volume";

export type NotifState = "unsupported" | NotificationPermission;

export const ALERT_CHANNELS = ["video", "image", "rewrite", "director"] as const;

export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const CHANNEL_LABELS: Record<
  AlertChannel,
  { label: string; hint: string }
> = {
  video: {
    label: "Video generations",
    hint: "A video finishes rendering, or fails",
  },
  image: {
    label: "Image generations",
    hint: "An image batch finishes, or fails",
  },
  rewrite: {
    label: "Prompt rewrites",
    hint: "A rewritten request is ready to review",
  },
  director: {
    label: "Director storyboards",
    hint: "A storyboard or revision is written",
  },
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribePrefs(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit() {
  listeners.forEach((fn) => fn());
}

function readNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeNumber(key: string, value: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {}
  emit();
}

export function channelEnabled(channel: AlertChannel): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(`${CHANNEL_KEY}${channel}`) !== "0";
  } catch {
    return true;
  }
}

export function setChannelEnabled(channel: AlertChannel, on: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${CHANNEL_KEY}${channel}`, on ? "1" : "0");
  } catch {}
  emit();
}

export function chimeVolume(): number {
  return readNumber(CHIME_KEY, 1);
}

export function setChimeVolume(v: number) {
  writeNumber(CHIME_KEY, v);
}

export function videoVolume(): number {
  return readNumber(VIDEO_VOLUME_KEY, 1);
}

export function setVideoVolume(v: number) {
  writeNumber(VIDEO_VOLUME_KEY, v);
}

export function alertsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setAlertsEnabled(on: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
  emit();
}

export function notifState(): NotifState {
  if (typeof window === "undefined" || !("Notification" in window))
    return "unsupported";
  return Notification.permission;
}

export async function askNotifPermission(): Promise<NotifState> {
  const s = notifState();
  if (s !== "default") return s;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

let audio: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!audio) {
    try {
      audio = new AC();
    } catch {
      return null;
    }
  }
  return audio;
}

export function primeAudio() {
  const c = ctx();
  if (c && c.state === "suspended") void c.resume();
}

export function playChime(ok = true) {
  const c = ctx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  const peak = Math.max(0.0002, 0.2 * chimeVolume());
  const start = c.currentTime + 0.02;
  const notes = ok ? [784, 1046.5, 1318.5] : [392, 311.1];
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = start + i * 0.14;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

let baseTitle = "";
let watching = false;

function restoreTitle() {
  if (typeof document === "undefined" || !baseTitle) return;
  document.title = baseTitle;
  baseTitle = "";
}

function badgeTitle(text: string) {
  if (typeof document === "undefined") return;
  if (!baseTitle) baseTitle = document.title;
  document.title = text;
  if (watching) return;
  watching = true;
  window.addEventListener("focus", restoreTitle);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) restoreTitle();
  });
}

export function appFocused(): boolean {
  if (typeof document === "undefined") return true;
  return !document.hidden && document.hasFocus();
}

export function alertDone({
  channel,
  ok,
  title,
  body,
  tag,
}: {
  channel: AlertChannel;
  ok: boolean;
  title: string;
  body?: string;
  tag?: string;
}): void {
  if (!alertsEnabled() || !channelEnabled(channel) || appFocused()) return;
  playChime(ok);
  badgeTitle(`${ok ? "✅" : "⚠"} ${title} · GENFORGE`);
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(title, { body: body || undefined, tag });
      n.onclick = () => {
        window.focus();
        restoreTitle();
        n.close();
      };
    }
  } catch {}
}
