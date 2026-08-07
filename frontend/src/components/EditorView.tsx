import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Eye,
  FilePenLine,
  Link2,
  Loader2,
  MoreHorizontal,
  PanelRight,
  PencilLine,
  Trash2,
} from "lucide-react";
import DOMPurify from "dompurify";
import { NoteService } from "../../bindings/sharknote";
import type { Note, NoteSummary } from "../../bindings/sharknote";
import { Browser } from "@wailsio/runtime";
import {
  findWikiQuery,
  looksLikeHtml,
  markdownToEditorHtml,
  renderRichContent,
  stripHtml,
} from "../lib/markdown";
import { fullDate, wordCount } from "../lib/time";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { FormatMenu, type FormatCommand } from "./FormatMenu";
import { LinkPanel } from "./LinkPanel";
import { RenameNoteDialog } from "./RenameNoteDialog";

type SaveState = "saved" | "dirty" | "saving";

interface EditorViewProps {
  noteId: number;
  notes: NoteSummary[];
  onSaved: (note: Note) => void;
  onRequestDelete: (id: number) => void;
  onOpenNote: (id: number) => void;
  onCreateNote: (title: string) => void;
  /** How fresh notes open: "preview" (rendered) or "edit". */
  defaultView: "preview" | "edit";
  /** Debounce between typing and saving, in ms. */
  autosaveDelay: number;
  /** Fired when the note becomes dirty / saved again (tab dot). */
  onDirtyChange?: (noteId: number, dirty: boolean) => void;
}


// --- Paste safety ---------------------------------------------------------
// A pasted blob can be megabytes of text with no spaces (a long URL, base64,
// minified JSON, a whole copied page). Inserting it as one giant unbroken
// text run is a known WebView2/Blink failure mode — the renderer shapes and
// lays out the whole line and the app crashes. Two layers of defense:
//   1. Every long run of unbroken text gets <wbr> break opportunities every
//      LONG_RUN_BREAK chars, so layout only ever sees short text runs.
//      <wbr> is invisible and has no text content, so notes stay clean.
//   2. Pastes larger than one chunk are inserted a few chunks per frame,
//      so no single edit command handles the whole blob at once.

const PASTE_MAX_CHARS = 24 * 1024 * 1024; // refuse anything over 24 MB
const PASTE_CHUNK_CHARS = 128 * 1024; // chars inserted per animation frame
const LONG_RUN_BREAK = 2048; // <wbr> inserted every this many unbroken chars
const WBR = '<wbr>';

/** Minimal HTML escaping for text that is about to be inserted as HTML. */
function escapeHtmlBasic(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inserts <wbr> after every LONG_RUN_BREAK chars inside unbroken runs. */
function addWordBreakOpportunities(s: string): string {
  if (s.length <= LONG_RUN_BREAK) return s;
  let out = '';
  let run = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch.trim() === '') {
      out += ch;
      run = 0;
    } else {
      out += ch;
      run++;
      if (run === LONG_RUN_BREAK) {
        out += WBR;
        run = 0;
      }
    }
  }
  return out;
}

/** Splits sanitized HTML into tag-safe chunks at node boundaries. */
function chunkHtmlNodes(html: string, max: number): string[] {
  const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  const nodes = Array.from(doc.body.childNodes);
  const tmp = document.createElement('div');
  const chunks: string[] = [];
  let buf: Node[] = [];
  let size = 0;
  const flush = () => {
    if (buf.length === 0) return;
    tmp.replaceChildren();
    for (const n of buf) tmp.appendChild(n.cloneNode(true));
    chunks.push(tmp.innerHTML);
    buf = [];
    size = 0;
  };
  for (const n of nodes) {
    tmp.replaceChildren();
    tmp.appendChild(n.cloneNode(true));
    const cost = tmp.innerHTML.length;
    if (cost > max) {
      // Single node bigger than a chunk: never silently split a tag.
      flush();
      chunks.push(tmp.innerHTML);
    } else if (size + cost > max) {
      flush();
      buf.push(n);
      size = cost;
    } else {
      buf.push(n);
      size += cost;
    }
  }
  flush();
  return chunks;
}

/** Splits paste HTML (which may contain <wbr> tags) at tag boundaries. */
function chunkTextHtml(html: string, max: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < html.length) {
    let end = Math.min(start + max, html.length);
    if (end < html.length) {
      // Back up to the last <wbr> so we never split a tag in half.
      const wbr = html.lastIndexOf(WBR, end);
      if (wbr > start) end = wbr;
    }
    chunks.push(html.slice(start, end));
    start = end;
  }
  return chunks;
}

// --- Rich text helpers -----------------------------------------------------

/** Maps a plain-text character offset to a DOM position inside the editor. */
function pointFromOffset(root: Node, offset: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) return { node, offset: remaining };
    remaining -= len;
  }
  const last = root.lastChild ?? root;
  return { node: last, offset: last.textContent?.length ?? 0 };
}

/** Selects the word under the caret when nothing is selected (Docs-like). */
function expandSelectionToWord() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;
  const text = node.textContent ?? "";
  if (!text.trim()) return;
  let start = range.startOffset;
  let end = range.startOffset;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  while (end < text.length && !/\s/.test(text[end])) end++;
  if (end === start) return;
  range.setStart(node, start);
  range.setEnd(node, end);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Removes style properties from every element intersecting the selection. */
function clearStyleProps(editor: HTMLElement, props: string[]) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) =>
      range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
  });
  const els: HTMLElement[] = [];
  while (walker.nextNode()) els.push(walker.currentNode as HTMLElement);
  for (const el of els) {
    for (const p of props) el.style.removeProperty(p);
  }
}

/** Wraps the selection in a span with an exact pixel font size, like Docs. */
function applyFontSize(px: number) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const tmp = document.createElement("div");
  tmp.appendChild(range.cloneContents());
  document.execCommand(
    "insertHTML",
    false,
    `<span style="font-size:${px}px">${tmp.innerHTML}</span>`
  );
}

export function EditorView({
  noteId,
  notes,
  onSaved,
  onRequestDelete,
  onOpenNote,
  onCreateNote,
  defaultView,
  autosaveDelay,
  onDirtyChange,
}: EditorViewProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  // The component is keyed by tab+note, so switching tabs always lands back
  // in the user's preferred default view.
  const [preview, setPreview] = useState(defaultView !== "edit");
  const [panelOpen, setPanelOpen] = useState(true);
  const [renameOpen, setRenameOpen] = useState(false);
  const [linkRefreshKey, setLinkRefreshKey] = useState(0);

  // Wiki-link autocomplete
  const [wikiQuery, setWikiQuery] = useState<{ start: number; query: string } | null>(null);
  const [caretPos, setCaretPos] = useState<{ left: number; top: number } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Right-click formatting menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Selection captured on right-click; the menu's inputs (color picker, size
  // field) steal focus, so commands restore it before applying.
  const savedRangeRef = useRef<Range | null>(null);

  // Refs keep latest values available to the debounced saver
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveStateRef = useRef<SaveState>("saved");
  const caretOffsetRef = useRef(0);
  const setSaveStateSafe = (s: SaveState) => {
    saveStateRef.current = s;
    setSaveState(s);
  };

  titleRef.current = title;
  contentRef.current = content;

  // Inline styles instead of <font> tags, so everything stays CSS-based.
  useEffect(() => {
    document.execCommand("styleWithCSS", false, "true");
  }, []);

  // Load the note whenever noteId changes (component is keyed by noteId).
  useEffect(() => {
    let cancelled = false;
    setNote(null);
    setTitle("");
    setContent("");
    dirtyRef.current = false;
    setWikiQuery(null);
    setContextMenu(null);
    NoteService.GetNote(noteId)
      .then((n) => {
        if (cancelled || !n) return;
        setNote(n);
        setTitle(n.title);
        titleRef.current = n.title;
        // Legacy markdown notes are migrated to rich text on open.
        const html = n.content && !looksLikeHtml(n.content)
          ? markdownToEditorHtml(n.content)
          : n.content;
        contentRef.current = html;
        setContent(html);
        setSaveStateSafe("saved");
      })
      .catch((err) => console.error("GetNote failed", err));
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  // The editor div is uncontrolled: whenever it (re-)mounts — note load or
  // switching back from preview — push the current content into the DOM.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = DOMPurify.sanitize(contentRef.current, {
      ADD_ATTR: ["contenteditable"], // keeps the frontmatter card read-only
    });
    setWikiQuery(null);
    setCaretPos(null);
  }, [preview, note]);

  const saveNow = useCallback(async () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    setSaveStateSafe("saving");
    try {
      const saved = await NoteService.UpdateNote(
        noteId,
        titleRef.current,
        contentRef.current
      );
      if (saved) {
        setSaveStateSafe("saved");
        onSaved(saved);
        setLinkRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.error("UpdateNote failed", err);
      dirtyRef.current = true;
      setSaveStateSafe("saved");
    }
  }, [noteId, onSaved]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveStateSafe("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void saveNow(), autosaveDelay);
  }, [saveNow, autosaveDelay]);

  // Flush any pending save when the editor unmounts (note switch / close).
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dirtyRef.current) void saveNow();
    };
  }, [saveNow]);

  // Keep the tab bar's dirty dot in sync with the save state.
  const lastDirtyRef = useRef(false);
  useEffect(() => {
    const dirty = saveState !== "saved";
    if (dirty !== lastDirtyRef.current) {
      lastDirtyRef.current = dirty;
      onDirtyChange?.(noteId, dirty);
    }
  }, [saveState, noteId, onDirtyChange]);

  /** Reads the editor DOM into state and schedules a save. */
  const syncFromEditor = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    let html = el.innerHTML;
    // Empty note → clean slate so the placeholder shows again.
    if (!el.textContent?.trim() && html !== "") html = "";
    if (html === contentRef.current) return;
    contentRef.current = html;
    setContent(html);
    scheduleSave();
  }, [scheduleSave]);

  /** Measures the caret so the autocomplete popover follows it. */
  const measureCaret = useCallback((): { left: number; top: number } | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    const rect = rects.length > 0 ? rects[rects.length - 1] : null;
    if (!rect) return null;
    const wrapRect = wrap.getBoundingClientRect();
    const left = rect.right - wrapRect.left;
    let top = rect.bottom + 8 - wrapRect.top;
    if (top > wrapRect.height - 260) top = rect.top - 8 - wrapRect.top;
    return { left, top };
  }, []);

  // Track typing, save, and open the [[ autocomplete when needed.
  const handleEditorInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    // A chunked paste is still draining: let a manual keystroke take over
    // (but don't cancel our own chunked inserts — each one fires an input
    // event too).
    if (!pasteChunkActiveRef.current) pasteQueueRef.current = null;
    syncFromEditor();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    const textBefore = pre.toString();
    caretOffsetRef.current = textBefore.length;
    const found = findWikiQuery(textBefore, textBefore.length);
    if (found && notes.length > 0) {
      setWikiQuery(found);
      setSelectedIndex(0);
      requestAnimationFrame(() => setCaretPos(measureCaret()));
    } else {
      setWikiQuery(null);
    }
  }, [notes.length, syncFromEditor, measureCaret]);

  const autocompleteOptions = useMemo(() => {
    if (!wikiQuery) return [];
    const q = wikiQuery.query.trim().toLowerCase();
    if (!q) return notes.slice(0, 8);
    return notes
      .filter((n) => n.title.toLowerCase().includes(q))
      .sort((a, b) => {
        const ap = a.title.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.title.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp;
      })
      .slice(0, 8);
  }, [wikiQuery, notes]);

  const insertLink = useCallback(
    (targetTitle: string) => {
      const el = editorRef.current;
      if (!el || !wikiQuery) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const start = pointFromOffset(el, wikiQuery.start);
      const end = pointFromOffset(el, caretOffsetRef.current);
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      range.deleteContents();
      const text = document.createTextNode(`[[${targetTitle}]]`);
      range.insertNode(text);
      const after = document.createRange();
      after.setStart(text, text.length);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      setWikiQuery(null);
      contentRef.current = el.innerHTML;
      setContent(el.innerHTML);
      scheduleSave();
      el.focus();
    },
    [wikiQuery, scheduleSave]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "e") {
          e.preventDefault();
          setPreview((p) => !p);
        } else if (k === "b") {
          e.preventDefault();
          document.execCommand("bold");
        } else if (k === "i") {
          e.preventDefault();
          document.execCommand("italic");
        } else if (k === "u") {
          e.preventDefault();
          document.execCommand("underline");
        }
        return;
      }
      if (!wikiQuery) return;
      const opts = autocompleteOptions;
      if (opts.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % opts.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + opts.length) % opts.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertLink(opts[selectedIndex].title);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setWikiQuery(null);
      }
    },
    [wikiQuery, autocompleteOptions, selectedIndex, insertLink]
  );

  // Refs for crash-safe pasting: chunks are drained one animation frame at
  // a time so a huge paste never hits the renderer in one hit.
  const pasteQueueRef = useRef<string[] | null>(null);
  const pasteFrameRef = useRef(false);
  const pasteChunkActiveRef = useRef(false);

  /** Inserts one queued paste chunk per frame; syncs once the queue drains. */
  const insertNextPasteChunk = useCallback(() => {
    const queue = pasteQueueRef.current;
    if (!queue || queue.length === 0) {
      pasteQueueRef.current = null;
      pasteFrameRef.current = false;
      return;
    }
    let ok = true;
    pasteChunkActiveRef.current = true;
    try {
      document.execCommand('insertHTML', false, queue.shift() ?? '');
    } catch (err) {
      console.error('paste chunk failed', err);
      ok = false;
    }
    pasteChunkActiveRef.current = false;
    if (!ok) {
      pasteQueueRef.current = null;
      pasteFrameRef.current = false;
      return;
    }
    if (queue.length > 0) {
      requestAnimationFrame(insertNextPasteChunk);
    } else {
      pasteQueueRef.current = null;
      pasteFrameRef.current = false;
      syncFromEditor();
    }
  }, [syncFromEditor]);

  // Sanitize pasted HTML, break up giant unbroken words, and chunk huge
  // pastes — a single >100 KB unbreakable text run can crash WebView2.
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = editorRef.current;
      if (!el) return;
      const rich = e.clipboardData.getData('text/html');
      const text = e.clipboardData.getData('text/plain');
      // Interrupt any in-flight chunked paste so chunks can't land at a caret
      // the user has since moved.
      pasteQueueRef.current = null;

      let html: string;
      if (rich) {
        // Sanitize first so nothing sketchy can land in the note, then add
        // break opportunities inside overly long words.
        const doc = new DOMParser().parseFromString(
          '<body>' + DOMPurify.sanitize(rich) + '</body>',
          'text/html'
        );
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
        for (const n of textNodes) {
          const raw = n.textContent ?? '';
          if (raw.length <= LONG_RUN_BREAK) continue;
          const span = document.createElement('span');
          span.innerHTML = addWordBreakOpportunities(escapeHtmlBasic(raw));
          n.replaceWith(span);
        }
        html = doc.body.innerHTML;
      } else if (text) {
        html = addWordBreakOpportunities(escapeHtmlBasic(text));
      } else {
        return;
      }
      if (!html) return;
      // Hard ceiling: keep the head of the blob instead of crashing.
      if (html.length > PASTE_MAX_CHARS) {
        html = html.slice(0, PASTE_MAX_CHARS);
      }

      if (html.length <= PASTE_CHUNK_CHARS) {
        try {
          document.execCommand('insertHTML', false, html);
        } catch (err) {
          console.error('paste failed', err);
          // Last resort: forget formatting, keep the words.
          try {
            document.execCommand('insertText', false, text || rich || '');
          } catch {
            /* nothing left to try */
          }
        }
        syncFromEditor();
        return;
      }

      // Large paste: split at <wbr>/node boundaries (never mid-tag) and
      // drain the queue across animation frames.
      pasteQueueRef.current = rich
        ? chunkHtmlNodes(html, PASTE_CHUNK_CHARS)
        : chunkTextHtml(html, PASTE_CHUNK_CHARS);
      if (!pasteFrameRef.current) {
        pasteFrameRef.current = true;
        requestAnimationFrame(insertNextPasteChunk);
      }
    },
    [insertNextPasteChunk, syncFromEditor]
  );

  // Docs-style formatting applied from the right-click menu.
  const handleFormatCommand = useCallback(
    (cmd: FormatCommand) => {
      const el = editorRef.current;
      if (!el) return;
      // Restore the selection captured when the menu opened.
      const sel = window.getSelection();
      if (savedRangeRef.current && sel) {
        sel.removeAllRanges();
        sel.addRange(savedRangeRef.current.cloneRange());
      }
      // Refocus the editor unless focus is inside a menu input — calling
      // focus() while the native color picker is open would dismiss it.
      if (!(document.activeElement instanceof HTMLInputElement)) {
        el.focus();
      }
      try {
        switch (cmd.type) {
          case "color":
            if (cmd.value === null) clearStyleProps(el, ["color"]);
            else document.execCommand("foreColor", false, cmd.value);
            break;
          case "font":
            if (cmd.value === null) clearStyleProps(el, ["font-family"]);
            else document.execCommand("fontName", false, cmd.value);
            break;
          case "size":
            applyFontSize(cmd.value);
            break;
          case "align":
            document.execCommand(
              `justify${{ left: "Left", center: "Center", right: "Right", justify: "Full" }[cmd.value]}`,
              false
            );
            break;
          case "inline":
            document.execCommand(cmd.value, false);
            break;
          case "clear":
            document.execCommand("removeFormat", false);
            break;
        }
      } catch (err) {
        console.error("format failed", err);
      }
      setContextMenu(null);
      syncFromEditor();
    },
    [syncFromEditor]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    expandSelectionToWord();
    // Remember what the user right-clicked so formatting still applies after
    // the menu's inputs take focus.
    const sel = window.getSelection();
    savedRangeRef.current =
      sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    setWikiQuery(null);
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // Click handling for rendered wiki links in preview mode.
  const handlePreviewClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = (e.target as HTMLElement).closest(
        "[data-wiki-target]"
      ) as HTMLElement | null;
      if (target) {
        const title = target.getAttribute("data-wiki-target") ?? "";
        const match = notes.find(
          (n) => n.title.toLowerCase() === title.toLowerCase()
        );
        if (match) onOpenNote(match.id);
        else onCreateNote(title);
        return;
      }
      // Copy button on a code block
      const copyBtn = (e.target as HTMLElement).closest(
        "[data-copy-code]"
      ) as HTMLElement | null;
      if (copyBtn) {
        const code = copyBtn
          .closest(".code-block")
          ?.querySelector("pre code");
        if (code) {
          void navigator.clipboard.writeText(code.textContent ?? "").then(() => {
            copyBtn.classList.add("copied");
            window.setTimeout(() => copyBtn.classList.remove("copied"), 1600);
          });
        }
        return;
      }
      const anchor = (e.target as HTMLElement).closest("a") as HTMLElement | null;
      if (anchor) {
        e.preventDefault();
        void Browser.OpenURL(anchor.getAttribute("href") ?? "");
      }
    },
    [notes, onOpenNote, onCreateNote]
  );

  const previewHtml = useMemo(() => renderRichContent(content), [content]);
  const plainText = useMemo(() => stripHtml(content), [content]);
  const words = wordCount(plainText);
  const chars = plainText.length;

  if (!note) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---------- Header ---------- */}
        <header className="flex items-start gap-3 border-b border-border px-6 pb-3 pt-5">
          <div className="min-w-0 flex-1">
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                scheduleSave();
              }}
              spellCheck={false}
              placeholder="Untitled"
              className="w-full border-none bg-transparent text-[26px] font-semibold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-0"
            />
            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>Created {fullDate(note.createdAt)}</span>
              <span className="text-border">•</span>
              <span>{words} words</span>
              <span className="text-border">•</span>
              <span className="inline-flex items-center gap-1">
                <Link2 className="size-3" />
                {note.content.includes("[[") ? "linked note" : "no links yet"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 pt-1">
            <Button
              variant={preview ? "secondary" : "ghost"}
              size="icon"
              title="Toggle preview (Ctrl+E)"
              onClick={() => setPreview((p) => !p)}
            >
              {preview ? <FilePenLine className="size-4" /> : <Eye className="size-4" />}
            </Button>
            <Button
              variant={panelOpen ? "secondary" : "ghost"}
              size="icon"
              title="Toggle links panel"
              onClick={() => setPanelOpen((p) => !p)}
            >
              <PanelRight className="size-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" title="More">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                  <PencilLine className="size-4" />
                  Rename note
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPreview((p) => !p)}>
                  <Eye className="size-4" />
                  {preview ? "Edit mode" : "Preview mode"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => onRequestDelete(note.id)}
                >
                  <Trash2 className="size-4" />
                  Delete note
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* ---------- Body ---------- */}
        <div ref={wrapRef} className="relative min-h-0 flex-1">
          {preview ? (
            <div
              className="md-body h-full overflow-y-auto px-8 py-6 lg:px-12"
              onClick={handlePreviewClick}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              spellCheck={false}
              data-placeholder="Start writing… type [[ to link another note"
              className="editor-area h-full w-full overflow-y-auto border-none bg-transparent px-8 py-6 text-foreground outline-none lg:px-12"
              onInput={handleEditorInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onContextMenu={handleContextMenu}
              onScroll={wikiQuery ? measureCaret : undefined}
              onBlur={() => setWikiQuery(null)}
            />
          )}

          {/* Wiki-link autocomplete popover */}
          {wikiQuery && autocompleteOptions.length > 0 && caretPos && (
            <div
              className="absolute z-50 w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl shadow-black/50 backdrop-blur-xl"
              style={{ left: Math.max(16, caretPos.left), top: caretPos.top }}
            >
              <div className="border-b border-border px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Link to note
              </div>
              <div className="max-h-64 overflow-y-auto p-1">
                {autocompleteOptions.map((n, i) => (
                  <button
                    key={n.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setSelectedIndex(i)}
                    onClick={() => insertLink(n.title)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                      i === selectedIndex && "bg-accent"
                    )}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-(--accent-soft) text-[10px] font-bold text-(--accent-head)">
                      {n.title.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {n.title}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {n.excerpt || "Empty note"}
                      </span>
                    </span>
                    {i === selectedIndex && (
                      <Check className="size-3.5 shrink-0 text-(--link-strong)" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ---------- Status bar ---------- */}
        <footer className="flex items-center gap-4 border-t border-border px-5 py-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 font-medium",
              saveState === "saved" && "text-emerald-400/90",
              (saveState === "dirty" || saveState === "saving") && "text-amber-400/90"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                saveState === "saved" && "bg-emerald-400",
                saveState === "dirty" && "bg-amber-400",
                saveState === "saving" && "animate-pulse bg-amber-400"
              )}
            />
            {saveState === "saved"
              ? "Saved"
              : saveState === "saving"
                ? "Saving…"
                : "Unsaved changes"}
          </span>
          <span className="text-border">|</span>
          <span className="tabular-nums">{words} words</span>
          <span className="tabular-nums">{chars} chars</span>
          <span className="ml-auto hidden text-muted-foreground/60 sm:block">
            Tip: type <kbd className="rounded border border-border bg-secondary px-1 text-[10px]">[[</kbd> to link a note · right-click text to format it
          </span>
        </footer>
      </div>

      {/* ---------- Links & backlinks panel ---------- */}
      {panelOpen && (
        <LinkPanel
          noteId={noteId}
          refreshKey={linkRefreshKey}
          onOpenNote={onOpenNote}
          onCreateNote={onCreateNote}
        />
      )}

      {/* ---------- Right-click formatting menu ---------- */}
      {contextMenu && (
        <FormatMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onCommand={handleFormatCommand}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* ---------- Rename dialog ---------- */}
      <RenameNoteDialog
        open={renameOpen}
        initialTitle={title}
        onClose={() => setRenameOpen(false)}
        onRename={(newTitle) => {
          setRenameOpen(false);
          if (newTitle === title) return;
          setTitle(newTitle);
          scheduleSave();
        }}
      />
    </div>
  );
}
