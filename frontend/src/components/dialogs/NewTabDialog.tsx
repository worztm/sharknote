import { useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, FileText, Search } from "lucide-react";
import type { NoteSummary } from "../../../bindings/sharknote";
import { relativeTime } from "../../lib/time";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

interface NewTabDialogProps {
  /** null = closed, string = pre-filled create-title */
  prefill: string | null;
  notes: NoteSummary[];
  onClose: () => void;
  onCreate: (title: string) => void;
  /** Opens an existing note in a NEW tab. */
  onOpenNote: (id: number) => void;
}

/**
 * The "new tab" dialog: create a note (button on top) or click any existing
 * note in the vault to open it in a fresh tab — Obsidian-style picker.
 */
export function NewTabDialog({
  prefill,
  notes,
  onClose,
  onCreate,
  onOpenNote,
}: NewTabDialogProps) {
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const open = prefill !== null;

  useEffect(() => {
    if (open) {
      setTitle(prefill ?? "");
      setQuery("");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, prefill]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.excerpt.toLowerCase().includes(q)
    );
  }, [notes, query]);

  const submit = () => {
    if (!title.trim()) return;
    onCreate(title.trim());
    setTitle("");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus2 className="size-4 text-(--link-strong)" />
            Open a note
          </DialogTitle>
          <DialogDescription>
            Open an existing note in a new tab — or create a fresh one on the
            spot.
          </DialogDescription>
        </DialogHeader>

        {/* Create — front and center */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="New note title…"
              className="text-[14px]"
              autoComplete="off"
            />
            <Button type="submit" disabled={!title.trim()} className="shrink-0">
              Create note
            </Button>
          </div>
        </form>

        {/* Every note in the vault, click to open */}
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
              All notes ({filtered.length})
            </span>
            <div className="relative w-48">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter…"
                className="h-7 w-full rounded-md border border-transparent bg-secondary/60 pl-7 pr-2 text-[12px] text-foreground placeholder:text-muted-foreground/60 focus:border-(--accent-soft-border-strong) focus:outline-none focus:ring-2 focus:ring-(--ring)/25"
              />
            </div>
          </div>
          <div className="max-h-72 min-h-28 space-y-px overflow-y-auto rounded-lg border border-border bg-background/40 p-1">
            {filtered.length === 0 ? (
              <div className="flex h-28 items-center justify-center px-6 text-center text-xs leading-relaxed text-muted-foreground">
                {notes.length === 0
                  ? "No notes yet — create your first one above."
                  : `No notes match “${query.trim()}”.`}
              </div>
            ) : (
              filtered.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onOpenNote(n.id)}
                  title={`Open “${n.title}” in a new tab`}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-(--accent-soft)"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                    {n.title}
                  </span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground/70">
                    {relativeTime(n.updatedAt)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
