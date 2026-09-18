"use client";

import { useEffect, useRef, useState } from "react";
import type { Character } from "@/lib/types";
import { charImgUrl } from "@/lib/types";

export type MediaMention = {
  token: string;
  label: string;
  sub?: string;
  thumb?: string;
};

type MentionItem =
  | { kind: "media"; token: string; label: string; sub?: string; thumb?: string }
  | {
      kind: "character";
      character: Character;
      label: string;
      sub?: string;
      title?: string;
    };

const TRIGGER_RE = /(?:^|[^\w])@([^\s@]*)$/;

function isVideoSrc(u: string): boolean {
  return /^blob:/i.test(u) || /\.(mp4|mov)(\?|$)/i.test(u);
}

function makeThumb(u?: string): HTMLElement {
  if (u && isVideoSrc(u)) {
    const wrap = document.createElement("span");
    const v = document.createElement("video");
    v.src = u;
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    wrap.appendChild(v);
    return wrap;
  }
  if (u) {
    const wrap = document.createElement("span");
    const img = document.createElement("img");
    img.src = u;
    img.alt = "";
    wrap.appendChild(img);
    return wrap;
  }
  const empty = document.createElement("span");
  empty.className = "mention-thumb-empty";
  empty.textContent = "♪";
  return empty;
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function chipText(el: HTMLElement): string {
  return el.dataset.text || el.dataset.token || "";
}

function makeChip(token: string, thumb?: string, text?: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "mention-chip";
  chip.contentEditable = "false";
  chip.dataset.token = token;
  if (text && text !== token) chip.dataset.text = text;
  chip.appendChild(makeThumb(thumb));
  chip.appendChild(document.createTextNode(token));
  return chip;
}

function lenOf(n: Node): number {
  if (n.nodeType === 3) return (n.nodeValue || "").length;
  if (n.nodeType === 1) {
    const e = n as HTMLElement;
    if (e.dataset?.token) return chipText(e).length;
    if (e.tagName === "BR") return 1;
    let s = 0;
    e.childNodes.forEach((c) => (s += lenOf(c)));
    return s;
  }
  return 0;
}

function serialize(root: Node): string {
  let out = "";
  root.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += n.nodeValue || "";
    else if (n.nodeType === 1) {
      const e = n as HTMLElement;
      if (e.dataset?.token) out += chipText(e);
      else if (e.tagName === "BR") out += "\n";
      else out += serialize(e);
    }
  });
  return out;
}

function locate(root: Node, target: number): [Node, number] | null {
  let pos = 0;
  const visit = (n: Node): [Node, number] | null => {
    if (n.nodeType === 3) {
      const len = (n.nodeValue || "").length;
      if (pos + len >= target) return [n, target - pos];
      pos += len;
      return null;
    }
    if (n.nodeType === 1) {
      const e = n as HTMLElement;
      if (e.dataset?.token) {
        pos += chipText(e).length;
        return null;
      }
      if (e.tagName === "BR") {
        pos += 1;
        return null;
      }
      for (const c of Array.from(e.childNodes)) {
        const r = visit(c);
        if (r) return r;
      }
    }
    return null;
  };
  for (const c of Array.from(root.childNodes)) {
    const r = visit(c);
    if (r) return r;
  }
  return null;
}

export default function MentionTextArea({
  value,
  onChange,
  getMediaMentions,
  onPickCharacter,
  rows = 5,
  maxLength,
  placeholder,
  chipCharacters = false,
  mediaSignature,
  projectId,
}: {
  value: string;
  onChange: (v: string) => void;
  getMediaMentions: () => MediaMention[];
  onPickCharacter?: (c: Character) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  chipCharacters?: boolean;
  mediaSignature?: string;
  projectId?: string | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastEmit = useRef(value);
  const [menu, setMenu] = useState<{
    at: number;
    end: number;
    query: string;
  } | null>(null);
  const [active, setActive] = useState(0);
  const [characters, setCharacters] = useState<Character[]>([]);
  const historyRef = useRef<string[]>([""]);
  const histPos = useRef(0);
  const commitTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!menu && !chipCharacters) return;
    let cancelled = false;
    const pq =
      projectId === undefined
        ? ""
        : projectId === null
          ? "none"
          : projectId;
    fetch(`/api/characters${pq ? `?project=${pq}` : ""}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled)
          setCharacters(Array.isArray(d.characters) ? d.characters : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [menu, chipCharacters, projectId]);

  function knownTokens(): {
    token: string;
    thumb?: string;
    text: string;
    isChar: boolean;
  }[] {
    const tokens = getMediaMentions().map((x) => ({
      token: x.token,
      thumb: x.thumb,
      text: x.token,
      isChar: false,
    }));
    if (chipCharacters)
      for (const c of characters)
        tokens.push({
          token: `@${c.name}`,
          thumb: charImgUrl(c, 0),
          text: c.name,
          isChar: true,
        });
    return tokens;
  }

  function renderText(text: string) {
    const root = ref.current;
    if (!root) return;
    const matches: { index: number; len: number; token: string; thumb?: string; ser: string }[] = [];
    for (const { token, thumb, text: ser, isChar } of knownTokens()) {
      if (isChar) {
        const re = new RegExp(`(?<![\\w])@?(?:${escapeRe(ser)}(?![\\w-]))`, "g");
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)))
          matches.push({ index: m.index, len: m[0].length, token, thumb, ser });
      } else {
        let idx = text.indexOf(token);
        while (idx !== -1) {
          matches.push({ index: idx, len: token.length, token, thumb, ser });
          idx = text.indexOf(token, idx + 1);
        }
      }
    }
    matches.sort((a, b) => a.index - b.index || b.len - a.len);
    root.textContent = "";
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of matches) {
      if (m.index < last) continue;
      if (m.index > last)
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(makeChip(m.token, m.thumb, m.ser));
      last = m.index + m.len;
    }
    if (last < text.length)
      frag.appendChild(document.createTextNode(text.slice(last)));
    root.appendChild(frag);
  }

  useEffect(() => {
    if (value === lastEmit.current) return;
    lastEmit.current = value;
    renderText(value);
    historyRef.current = [value];
    histPos.current = 0;
    const root = ref.current;
    if (!root) return;
    const sel = window.getSelection();
    if (document.activeElement === root && sel && root.contains(sel.anchorNode)) {
      const r = document.createRange();
      r.selectNodeContents(root);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    requestAnimationFrame(() => {
      root.scrollTop = root.scrollHeight;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (ref.current && !ref.current.textContent) renderText(value);
    historyRef.current = [value];
    histPos.current = 0;
    return () => {
      if (commitTimer.current !== undefined)
        window.clearTimeout(commitTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sigRef = useRef(mediaSignature);
  useEffect(() => {
    if (sigRef.current === mediaSignature) return;
    sigRef.current = mediaSignature;
    const root = ref.current;
    if (!root) return;
    const text = serialize(root);
    const pos = caretPos();
    renderText(text);
    lastEmit.current = text;
    if (pos >= 0 && document.activeElement === root) {
      const loc = locate(root, pos);
      if (loc) {
        const r = document.createRange();
        r.setStart(loc[0], loc[1]);
        r.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaSignature]);

  function caretPos(): number {
    const root = ref.current;
    const sel = window.getSelection();
    if (!root || !sel || !sel.rangeCount) return -1;
    const { anchorNode, anchorOffset } = sel;
    if (!anchorNode || !root.contains(anchorNode)) return -1;
    let pos = 0;
    let found = false;
    const visit = (n: Node): void => {
      if (found) return;
      if (n === anchorNode) {
        if (n.nodeType === 3) pos += Math.min(anchorOffset, (n.nodeValue || "").length);
        else
          for (let i = 0; i < Math.min(anchorOffset, n.childNodes.length); i++)
            pos += lenOf(n.childNodes[i]);
        found = true;
        return;
      }
      if (n.nodeType === 3) {
        pos += (n.nodeValue || "").length;
        return;
      }
      if (n.nodeType === 1) {
        const e = n as HTMLElement;
        if (e.dataset?.token) {
          if (e.contains(anchorNode)) {
            pos += chipText(e).length;
            found = true;
          } else pos += chipText(e).length;
          return;
        }
        if (e.tagName === "BR") {
          pos += 1;
          return;
        }
        e.childNodes.forEach(visit);
      }
    };
    visit(root);
    return found ? pos : -1;
  }

  function emit() {
    const root = ref.current;
    if (!root) return;
    const v = serialize(root);
    lastEmit.current = v;
    onChange(v);
  }

  function commit() {
    if (commitTimer.current !== undefined) {
      window.clearTimeout(commitTimer.current);
      commitTimer.current = undefined;
    }
    const root = ref.current;
    if (!root) return;
    const text = serialize(root);
    const h = historyRef.current;
    if (text === h[histPos.current]) return;
    historyRef.current = [...h.slice(0, histPos.current + 1), text].slice(-80);
    histPos.current = historyRef.current.length - 1;
  }

  function scheduleCommit() {
    window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(commit, 500);
  }

  function applyHistory(text: string) {
    const root = ref.current;
    if (!root) return;
    renderText(text);
    lastEmit.current = text;
    onChange(text);
    requestAnimationFrame(() => {
      const r = document.createRange();
      r.selectNodeContents(root);
      r.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
      root.scrollTop = root.scrollHeight;
    });
  }

  function undo() {
    commit();
    if (histPos.current <= 0) return;
    histPos.current -= 1;
    applyHistory(historyRef.current[histPos.current]);
  }

  function redo() {
    const h = historyRef.current;
    if (histPos.current >= h.length - 1) return;
    histPos.current += 1;
    applyHistory(h[histPos.current]);
  }

  function detect() {
    const pos = caretPos();
    if (pos < 0) {
      setMenu(null);
      return;
    }
    const root = ref.current;
    if (!root) return;
    const before = serialize(root).slice(0, pos);
    const m = TRIGGER_RE.exec(before);
    if (m) {
      setMenu({ at: pos - m[1].length - 1, end: pos, query: m[1] });
      setActive(0);
    } else setMenu(null);
  }

  const q = (menu?.query || "").toLowerCase();
  const items: MentionItem[] = menu
    ? [
        ...getMediaMentions()
          .filter(
            (x) =>
              !q ||
              x.label.toLowerCase().includes(q) ||
              (x.sub || "").toLowerCase().includes(q)
          )
          .map((x) => ({ kind: "media" as const, ...x })),
        ...characters
          .filter(
            (c) =>
              !q ||
              c.name.toLowerCase().includes(q) ||
              (c.description || "").toLowerCase().includes(q)
          )
          .map((c) => ({
            kind: "character" as const,
            character: c,
            label: c.name,
            sub: c.description,
            title: `character · ${c.imageCount} image${c.imageCount === 1 ? "" : "s"}${c.hasAudio ? " + voice" : ""}`,
          })),
      ]
    : [];

  function pick(i: number) {
    const root = ref.current;
    const item = items[i];
    if (!root || !item || !menu) return;
    commit();
    const a = locate(root, menu.at);
    const b = locate(root, menu.end);
    if (!a || !b) return;
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(a[0], a[1]);
    range.setEnd(b[0], b[1]);
    range.deleteContents();
    if (item.kind === "character") {
      if (chipCharacters) {
        const name = item.character.name;
        const chip = makeChip(
          `@${name}`,
          charImgUrl(item.character, 0),
          name
        );
        range.insertNode(chip);
        const space = document.createTextNode(" ");
        chip.after(space);
        range.setStartAfter(space);
        range.collapse(true);
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
        root.focus();
        setMenu(null);
        emit();
        commit();
        onPickCharacter?.(item.character);
        return;
      }
      range.collapse(true);
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      setMenu(null);
      emit();
      commit();
      onPickCharacter?.(item.character);
      return;
    }
    const chip = makeChip(item.token, item.thumb);
    range.insertNode(chip);
    const space = document.createTextNode(" ");
    chip.after(space);
    range.setStartAfter(space);
    range.collapse(true);
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    root.focus();
    setMenu(null);
    emit();
    commit();
  }

  return (
    <div className="relative">
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        spellCheck={false}
        onInput={() => {
          emit();
          scheduleCommit();
          detect();
        }}
        onKeyUp={(e) => {
          if (
            [
              "ArrowDown",
              "ArrowUp",
              "ArrowLeft",
              "ArrowRight",
              "Enter",
              "Tab",
              "Escape",
            ].includes(e.key)
          )
            return;
          detect();
        }}
        onMouseUp={detect}
        onCopy={(e) => {
          const root = ref.current;
          const sel = window.getSelection();
          if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return;
          const tmp = document.createElement("div");
          tmp.appendChild(sel.getRangeAt(0).cloneContents());
          e.clipboardData.setData("text/plain", serialize(tmp));
          e.preventDefault();
        }}
        onCut={(e) => {
          const root = ref.current;
          const sel = window.getSelection();
          if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return;
          const tmp = document.createElement("div");
          tmp.appendChild(sel.getRangeAt(0).cloneContents());
          e.clipboardData.setData("text/plain", serialize(tmp));
          e.preventDefault();
          commit();
          const range = sel.getRangeAt(0);
          range.deleteContents();
          emit();
          commit();
          detect();
        }}
        onBlur={() => {
          commit();
          setTimeout(() => setMenu(null), 150);
        }}
        onPaste={(e) => {
          e.preventDefault();
          let text = e.clipboardData.getData("text/plain");
          if (!text) return;
          const root = ref.current;
          if (!root) return;
          const prev = serialize(root);
          if (maxLength) {
            const room = maxLength - prev.length;
            if (room <= 0) return;
            if (text.length > room) text = text.slice(0, room);
          }
          commit();
          document.execCommand("insertText", false, text);
          commit();
          requestAnimationFrame(() => {
            const el = ref.current;
            if (!el) return;
            const v = serialize(el);
            renderText(v);
            lastEmit.current = v;
            commit();
            const r = document.createRange();
            r.selectNodeContents(el);
            r.collapse(false);
            const s = window.getSelection();
            s?.removeAllRanges();
            s?.addRange(r);
            if (chipCharacters && onPickCharacter) {
              for (const c of characters) {
                const re = new RegExp(`(?<![\\w])${escapeRe(c.name)}(?![\\w-])`);
                if (re.test(v) && !re.test(prev)) onPickCharacter(c);
              }
            }
          });
        }}
        onKeyDown={(e) => {
          const mod = e.ctrlKey || e.metaKey;
          if (mod && !e.altKey) {
            const k = e.key.toLowerCase();
            if (k === "z" && !e.shiftKey) {
              e.preventDefault();
              undo();
              return;
            }
            if (k === "y" || (k === "z" && e.shiftKey)) {
              e.preventDefault();
              redo();
              return;
            }
          }
          if (menu && items.length) {
            const move = (delta: number) => {
              e.preventDefault();
              setActive((v) => (v + delta + items.length) % items.length);
            };
            if (e.key === "ArrowDown" || e.key === "ArrowRight") {
              move(1);
              return;
            }
            if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
              move(-1);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(active);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setMenu(null);
              return;
            }
          }
          if (e.key === "Enter") {
            e.preventDefault();
            document.execCommand("insertText", false, "\n");
          }
        }}
        className="w-full bg-panel2 border border-line rounded px-3 py-2 text-sm leading-5 text-ink outline-none focus:border-accent/60 transition-colors whitespace-pre-wrap break-words overflow-y-auto"
        style={{
          minHeight: rows * 20 + 18,
          maxHeight: rows * 45 + 18,
        }}
      />
      {!value && (
        <span className="pointer-events-none absolute left-3 top-2 text-sm text-muted/50 select-none">
          {placeholder}
        </span>
      )}
      {menu && items.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 border border-line bg-panel rounded-md shadow-xl shadow-black/50 overflow-hidden">
          <p className="px-3 pt-2 pb-1 text-[10px] font-mono uppercase tracking-[0.14em] text-muted">
            references · click or ↑↓←→ Enter
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 p-2 max-h-80 overflow-y-auto">
            {items.map((item, i) => (
              <button
                key={`${item.kind}-${item.label}-${i}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(i)}
                title={"title" in item && item.title ? item.title : item.sub}
                className={`flex flex-col items-stretch gap-1 rounded-md border p-1.5 transition-colors ${
                  i === active
                    ? "border-accent/70 bg-accent/10"
                    : "border-line hover:border-muted/60 hover:bg-panel2"
                }`}
              >
                <span className="w-full aspect-video rounded overflow-hidden bg-black/50 flex items-center justify-center">
                  {item.kind === "media" ? (
                    makeThumbNode(item.thumb, true)
                  ) : (
                    <CharacterThumb character={item.character} />
                  )}
                </span>
                <span
                  className={`text-[10px] font-mono truncate text-center w-full ${
                    item.kind === "character" ? "text-warn" : "text-accent"
                  }`}
                >
                  {item.kind === "media" ? item.token : `@${item.label}`}
                </span>
                {item.sub && (
                  <span className="text-[9px] leading-tight text-muted text-center w-full line-clamp-2">
                    {item.sub}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function makeThumbNode(u?: string, fill = false) {
  const cls = fill ? "w-full h-full object-cover" : undefined;
  const media =
    u && isVideoSrc(u) ? (
      <video src={u} muted playsInline preload="metadata" className={cls} />
    ) : u ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={u} alt="" className={cls} />
    ) : (
      <span className="mention-thumb-empty inline-flex items-center justify-center">
        ♪
      </span>
    );
  return media;
}

function CharacterThumb({ character }: { character: Character }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={charImgUrl(character, 0)}
      alt=""
      className="w-full h-full object-cover"
      onError={(e) => (e.currentTarget.style.display = "none")}
    />
  );
}
