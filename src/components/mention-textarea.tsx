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
const BLOCK_TAGS =
  /^(DIV|P|LI|UL|OL|SECTION|ARTICLE|BLOCKQUOTE|PRE|H[1-6]|TABLE|TR)$/;

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

type Seg = { node: Node; start: number; len: number };
type Point = { node: Node; offset: number; pos: number };
type Scan = { text: string; segs: Seg[]; points: Point[]; caret: number };

function scan(root: Node, anchor?: { node: Node; offset: number } | null): Scan {
  let text = "";
  let caret = -1;
  let seen = false;
  const segs: Seg[] = [];
  const points: Point[] = [];
  const hit = (p: number) => {
    if (caret < 0) caret = p;
  };

  const walk = (parent: Node) => {
    const kids = Array.from(parent.childNodes);
    for (let i = 0; i < kids.length; i++) {
      if (anchor && anchor.node === parent && anchor.offset === i)
        hit(text.length);
      const n = kids[i];
      if (n.nodeType === 3) {
        const s = n.nodeValue || "";
        if (anchor && anchor.node === n)
          hit(text.length + Math.min(anchor.offset, s.length));
        segs.push({ node: n, start: text.length, len: s.length });
        text += s;
        if (s.length) seen = true;
        continue;
      }
      if (n.nodeType !== 1) continue;
      const e = n as HTMLElement;
      if (e.dataset?.token) {
        const t = chipText(e);
        points.push({ node: parent, offset: i, pos: text.length });
        if (anchor && (anchor.node === e || e.contains(anchor.node)))
          hit(text.length + t.length);
        text += t;
        seen = true;
        points.push({ node: parent, offset: i + 1, pos: text.length });
        continue;
      }
      if (e.tagName === "BR") {
        if (anchor && anchor.node === e) hit(text.length);
        points.push({ node: parent, offset: i, pos: text.length });
        if (i < kids.length - 1) {
          text += "\n";
          seen = true;
        }
        continue;
      }
      if (BLOCK_TAGS.test(e.tagName)) {
        if (seen) text += "\n";
        seen = true;
        points.push({ node: e, offset: 0, pos: text.length });
        walk(e);
        continue;
      }
      walk(e);
    }
    if (anchor && anchor.node === parent && anchor.offset >= kids.length)
      hit(text.length);
  };

  walk(root);
  return { text, segs, points, caret };
}

function serialize(root: Node): string {
  return scan(root).text;
}

function toDom(s: Scan, target: number): [Node, number] | null {
  let best: [Node, number] | null = null;
  for (const seg of s.segs) {
    if (target >= seg.start && target <= seg.start + seg.len) {
      best = [seg.node, target - seg.start];
      if (target < seg.start + seg.len) return best;
    }
  }
  if (best) return best;
  let pt: Point | null = null;
  for (const p of s.points)
    if (p.pos <= target && (!pt || p.pos >= pt.pos)) pt = p;
  return pt ? [pt.node, pt.offset] : null;
}

function normalizeCR(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    if ((n.nodeValue || "").includes("\r")) hits.push(n as Text);
    n = walker.nextNode();
  }
  for (const t of hits) t.nodeValue = (t.nodeValue || "").replace(/\r\n?/g, "\n");
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
  const historyRef = useRef<{ text: string; pos: number }[]>([
    { text: "", pos: 0 },
  ]);
  const histPos = useRef(0);
  const commitTimer = useRef<number | undefined>(undefined);
  const composing = useRef(false);

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
    const tokens = getMediaMentions()
      .filter((x) => x.token)
      .map((x) => ({
        token: x.token,
        thumb: x.thumb,
        text: x.token,
        isChar: false,
      }));
    if (chipCharacters)
      for (const c of characters) {
        const name = (c.name || "").trim();
        if (!name) continue;
        tokens.push({
          token: `@${name}`,
          thumb: charImgUrl(c, 0),
          text: name,
          isChar: true,
        });
      }
    return tokens;
  }

  function renderText(text: string) {
    const root = ref.current;
    if (!root) return;
    const matches: {
      index: number;
      len: number;
      token: string;
      thumb?: string;
      ser: string;
    }[] = [];
    for (const { token, thumb, text: ser, isChar } of knownTokens()) {
      if (!ser) continue;
      if (isChar) {
        const re = new RegExp(`(?<![\\w])(@?${escapeRe(ser)})(?![\\w-])`, "g");
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          if (!m[0].length) {
            re.lastIndex += 1;
            continue;
          }
          matches.push({
            index: m.index,
            len: m[0].length,
            token,
            thumb,
            ser: m[0],
          });
        }
      } else {
        let idx = text.indexOf(token);
        while (idx !== -1) {
          matches.push({ index: idx, len: token.length, token, thumb, ser: token });
          idx = text.indexOf(token, idx + 1);
        }
      }
    }
    matches.sort((a, b) => a.index - b.index || b.len - a.len);
    const scrollTop = root.scrollTop;
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
    if (text.endsWith("\n")) frag.appendChild(document.createElement("br"));
    root.appendChild(frag);
    root.scrollTop = scrollTop;
  }

  function setCaret(pos: number) {
    const root = ref.current;
    if (!root) return;
    const s = scan(root);
    const loc = toDom(s, Math.max(0, Math.min(pos, s.text.length)));
    const r = document.createRange();
    if (loc) {
      r.setStart(loc[0], loc[1]);
      r.collapse(true);
    } else {
      r.selectNodeContents(root);
      r.collapse(false);
    }
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  }

  function caretIntoView() {
    const root = ref.current;
    const sel = window.getSelection();
    if (!root || !sel || !sel.rangeCount) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const box = root.getBoundingClientRect();
    if (!rect.height && !rect.top) return;
    if (rect.top < box.top) root.scrollTop -= box.top - rect.top + 4;
    else if (rect.bottom > box.bottom)
      root.scrollTop += rect.bottom - box.bottom + 4;
  }

  useEffect(() => {
    if (value === lastEmit.current) return;
    lastEmit.current = value;
    renderText(value);
    historyRef.current = [{ text: value, pos: value.length }];
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
    historyRef.current = [{ text: value, pos: value.length }];
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
    if (!root || composing.current) return;
    const focused = document.activeElement === root;
    const s = readScan();
    if (!s) return;
    renderText(s.text);
    if (s.text !== lastEmit.current) {
      lastEmit.current = s.text;
      onChange(s.text);
    }
    if (focused && s.caret >= 0) setCaret(s.caret);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaSignature]);

  function readScan(): Scan | null {
    const root = ref.current;
    if (!root) return null;
    const sel = window.getSelection();
    const anchor =
      sel && sel.anchorNode && root.contains(sel.anchorNode)
        ? { node: sel.anchorNode, offset: sel.anchorOffset }
        : null;
    return scan(root, anchor);
  }

  function selectionSpan(): number {
    const root = ref.current;
    const sel = window.getSelection();
    if (!root || !sel || !sel.rangeCount) return 0;
    const r = sel.getRangeAt(0);
    if (r.collapsed || !root.contains(r.startContainer)) return 0;
    const a = scan(root, { node: r.startContainer, offset: r.startOffset }).caret;
    const b = scan(root, { node: r.endContainer, offset: r.endOffset }).caret;
    return a >= 0 && b >= 0 ? Math.abs(b - a) : 0;
  }

  function overLimit(s: Scan): boolean {
    const prev = lastEmit.current;
    if (!maxLength || s.text.length <= maxLength) return false;
    if (s.text.length <= prev.length) return false;
    const delta = s.text.length - prev.length;
    const pos = (s.caret < 0 ? s.text.length : s.caret) - delta;
    renderText(prev);
    emit(prev);
    setCaret(pos);
    caretIntoView();
    return true;
  }

  function emit(text?: string) {
    const root = ref.current;
    if (!root) return;
    const v = text ?? serialize(root);
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
    const s = readScan();
    if (!s) return;
    const h = historyRef.current;
    const pos = s.caret >= 0 ? s.caret : s.text.length;
    if (s.text === h[histPos.current]?.text) {
      h[histPos.current].pos = pos;
      return;
    }
    historyRef.current = [
      ...h.slice(0, histPos.current + 1),
      { text: s.text, pos },
    ].slice(-80);
    histPos.current = historyRef.current.length - 1;
  }

  function scheduleCommit() {
    window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(commit, 500);
  }

  function applyHistory(entry: { text: string; pos: number }) {
    const root = ref.current;
    if (!root) return;
    renderText(entry.text);
    lastEmit.current = entry.text;
    onChange(entry.text);
    requestAnimationFrame(() => {
      setCaret(entry.pos);
      caretIntoView();
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

  function detect(s?: Scan | null) {
    const cur = s ?? readScan();
    if (!cur || cur.caret < 0) {
      setMenu(null);
      return;
    }
    const before = cur.text.slice(0, cur.caret);
    const m = TRIGGER_RE.exec(before);
    if (m) {
      setMenu({ at: cur.caret - m[1].length - 1, end: cur.caret, query: m[1] });
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
    const s = scan(root);
    const a = toDom(s, menu.at);
    const b = toDom(s, menu.end);
    if (!a || !b) return;
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(a[0], a[1]);
    range.setEnd(b[0], b[1]);
    range.deleteContents();
    if (item.kind === "character" && !chipCharacters) {
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
    const chip =
      item.kind === "character"
        ? makeChip(
            `@${item.character.name}`,
            charImgUrl(item.character, 0),
            item.character.name
          )
        : makeChip(item.token, item.thumb);
    range.insertNode(chip);
    const space = document.createTextNode(" ");
    chip.after(space);
    range.setStart(space, 1);
    range.collapse(true);
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    root.focus();
    setMenu(null);
    emit();
    commit();
    if (item.kind === "character") onPickCharacter?.(item.character);
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
          const s = readScan();
          if (s && overLimit(s)) return;
          emit(s?.text);
          scheduleCommit();
          if (!composing.current) detect(s);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          const s = readScan();
          if (s && overLimit(s)) return;
          emit(s?.text);
          scheduleCommit();
          detect(s);
        }}
        onKeyUp={(e) => {
          if (composing.current) return;
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
        onMouseUp={() => detect()}
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
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
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
          let text = e.clipboardData
            .getData("text/plain")
            .replace(/\r\n?/g, "\n");
          if (!text) return;
          const root = ref.current;
          if (!root) return;
          const prev = serialize(root);
          if (maxLength) {
            const room = maxLength - prev.length + selectionSpan();
            if (room <= 0) return;
            if (text.length > room) text = text.slice(0, room);
          }
          commit();
          document.execCommand("insertText", false, text);
          requestAnimationFrame(() => {
            const el = ref.current;
            if (!el) return;
            normalizeCR(el);
            const s = readScan();
            if (!s) return;
            const pos = s.caret;
            renderText(s.text);
            lastEmit.current = s.text;
            onChange(s.text);
            if (pos >= 0) {
              setCaret(pos);
              caretIntoView();
            }
            commit();
            if (chipCharacters && onPickCharacter) {
              for (const c of characters) {
                const name = (c.name || "").trim();
                if (!name) continue;
                const re = new RegExp(`(?<![\\w])${escapeRe(name)}(?![\\w-])`);
                if (re.test(s.text) && !re.test(prev)) onPickCharacter(c);
              }
            }
          });
        }}
        onKeyDown={(e) => {
          if ((e.nativeEvent as KeyboardEvent).isComposing || e.keyCode === 229)
            return;
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
            commit();
            const s = readScan();
            if (!s || s.caret < 0) return;
            const root = ref.current;
            if (!root) return;
            const sel = window.getSelection();
            if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed)
              sel.getRangeAt(0).deleteContents();
            const after = readScan();
            if (!after || after.caret < 0) return;
            const pos = after.caret;
            const next =
              after.text.slice(0, pos) + "\n" + after.text.slice(pos);
            if (maxLength && next.length > maxLength) return;
            renderText(next);
            emit(next);
            setCaret(pos + 1);
            caretIntoView();
            commit();
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
