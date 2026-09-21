"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Btn, IconBtn, Popover, Slider, Toggle } from "./ui";
import {
  ALERT_CHANNELS,
  CHANNEL_LABELS,
  alertsEnabled,
  askNotifPermission,
  channelEnabled,
  chimeVolume,
  notifState,
  playChime,
  primeAudio,
  setAlertsEnabled,
  setChannelEnabled,
  setChimeVolume,
  setVideoVolume,
  subscribePrefs,
  videoVolume,
  type AlertChannel,
  type NotifState,
} from "@/lib/notify";

type View = "root" | "notifications" | "volume";

const pct = (v: number) => Math.round(v * 100);

export default function SettingsMenu() {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("root");
  const [alertsOn, setAlertsOn] = useState(false);
  const [channels, setChannels] = useState<Record<AlertChannel, boolean>>(
    () => ({ video: true, image: true, rewrite: true, director: true })
  );
  const [chime, setChime] = useState(1);
  const [video, setVideo] = useState(1);
  const [perm, setPerm] = useState<NotifState>("default");

  const sync = useCallback(() => {
    setAlertsOn(alertsEnabled());
    setChannels({
      video: channelEnabled("video"),
      image: channelEnabled("image"),
      rewrite: channelEnabled("rewrite"),
      director: channelEnabled("director"),
    });
    setChime(chimeVolume());
    setVideo(videoVolume());
    setPerm(notifState());
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(sync);
    const off = subscribePrefs(sync);
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  }, [sync]);

  const onCount = ALERT_CHANNELS.filter((c) => channels[c]).length;

  async function toggleAlerts(next: boolean) {
    setAlertsEnabled(next);
    if (!next) return;
    primeAudio();
    playChime(true);
    setPerm(await askNotifPermission());
  }

  const permLine =
    perm === "granted"
      ? "Desktop popups allowed."
      : perm === "denied"
        ? "Desktop popups are blocked for this site — you still get the chime and the tab title."
        : perm === "unsupported"
          ? "This browser has no notifications — you still get the chime and the tab title."
          : "Desktop popups not allowed yet — you still get the chime and the tab title.";

  return (
    <>
      <IconBtn
        ref={btnRef}
        onClick={() => {
          setView("root");
          setOpen((o) => !o);
        }}
        active={open}
        title="Settings — notifications and volume"
      >
        <span aria-hidden>⚙</span>
      </IconBtn>
      <Popover
        open={open}
        anchorRef={btnRef}
        onClose={() => setOpen(false)}
        width={300}
        label="Settings"
      >
        {view === "root" && (
          <div className="py-1">
            <p className="px-3 py-2 text-2xs text-muted">Settings</p>
            <button
              type="button"
              onClick={() => setView("notifications")}
              className="w-full px-3 py-2.5 flex items-center gap-3 text-left hover:bg-panel2 transition-colors"
            >
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-ink">Notifications</span>
                <span className="block text-2xs text-muted">
                  {alertsOn
                    ? `On · ${onCount} of ${ALERT_CHANNELS.length} kinds`
                    : "Off"}
                </span>
              </span>
              <span className="text-muted" aria-hidden>
                ›
              </span>
            </button>
            <button
              type="button"
              onClick={() => setView("volume")}
              className="w-full px-3 py-2.5 flex items-center gap-3 text-left hover:bg-panel2 transition-colors"
            >
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-ink">Volume</span>
                <span className="block text-2xs text-muted">
                  Video {pct(video)}% · chime {pct(chime)}%
                </span>
              </span>
              <span className="text-muted" aria-hidden>
                ›
              </span>
            </button>
          </div>
        )}

        {view !== "root" && (
          <div>
            <div className="flex items-center gap-2 px-2 py-2 border-b border-line-soft">
              <IconBtn title="Back to settings" onClick={() => setView("root")}>
                <span aria-hidden>‹</span>
              </IconBtn>
              <h2 className="text-sm font-semibold text-ink">
                {view === "notifications" ? "Notifications" : "Volume"}
              </h2>
            </div>
            <div className="p-3 flex flex-col gap-3">
              {view === "notifications" ? (
                <>
                  <Toggle
                    checked={alertsOn}
                    onChange={(v) => void toggleAlerts(v)}
                    label="Alert me when work finishes"
                  />
                  <p className="text-2xs text-muted -mt-1.5">
                    Alerts only fire while this window is in the background.{" "}
                    {alertsOn ? permLine : ""}
                  </p>
                  {perm === "default" && alertsOn && (
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={async () => setPerm(await askNotifPermission())}
                    >
                      Allow desktop popups
                    </Btn>
                  )}
                  <div
                    className={`flex flex-col gap-2.5 pt-2 border-t border-line-soft ${
                      alertsOn ? "" : "opacity-40 pointer-events-none"
                    }`}
                    aria-disabled={!alertsOn}
                  >
                    {ALERT_CHANNELS.map((c) => (
                      <div key={c}>
                        <Toggle
                          checked={channels[c]}
                          onChange={(v) => setChannelEnabled(c, v)}
                          label={CHANNEL_LABELS[c].label}
                        />
                        <p className="text-2xs text-muted pl-12">
                          {CHANNEL_LABELS[c].hint}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-medium text-ink/80 mb-1">
                      Video playback
                    </p>
                    <Slider
                      value={pct(video)}
                      min={0}
                      max={100}
                      step={5}
                      suffix="%"
                      onChange={(v) => setVideoVolume(v / 100)}
                    />
                    <p className="text-2xs text-muted">
                      Applies to every video player, and is remembered in this
                      browser.
                    </p>
                  </div>
                  <div className="pt-2 border-t border-line-soft">
                    <p className="text-xs font-medium text-ink/80 mb-1">
                      Alert chime
                    </p>
                    <Slider
                      value={pct(chime)}
                      min={0}
                      max={100}
                      step={5}
                      suffix="%"
                      onChange={(v) => setChimeVolume(v / 100)}
                    />
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <p className="text-2xs text-muted">
                        The sound played when work finishes.
                      </p>
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          primeAudio();
                          playChime(true);
                        }}
                      >
                        Play it
                      </Btn>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </Popover>
    </>
  );
}
