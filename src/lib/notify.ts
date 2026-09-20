"use client";

const KEY = "genforge:alerts";

export type NotifState = "unsupported" | NotificationPermission;

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
  const start = c.currentTime + 0.02;
  const notes = ok ? [784, 1046.5, 1318.5] : [392, 311.1];
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = start + i * 0.14;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
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
  ok,
  title,
  body,
  tag,
}: {
  ok: boolean;
  title: string;
  body?: string;
  tag?: string;
}): void {
  if (!alertsEnabled() || appFocused()) return;
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
