import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  FilePlus2,
  FileText,
  FolderOpen,
  Save,
  Settings2,
  Trash2,
  Waypoints,
} from "lucide-react";
import type { NoteSummary } from "../../../bindings/sharknote";
import { relativeTime } from "../../lib/time";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../ui/command";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notes: NoteSummary[];
  activeId: number | null;
  onOpenNote: (id: number) => void;
  onDeleteNote: (id: number) => void;
  onCreateNote: (title: string) => void;
  onOpenGraph: () => void;
  /** Import .md files via a multi-select dialog. */
  onOpenFiles: () => void;
  /** Import a whole folder and set it as the vault. */
  onOpenFolder: () => void;
  /** Save the open note as a file via the native save dialog. */
  onSaveNoteAs: (id: number) => void;
  /** Opens today's daily note, creating it if needed. */
  onOpenDailyNote: () => void;
  onOpenSettings: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  notes,
  activeId,
  onOpenNote,
  onDeleteNote,
  onCreateNote,
  onOpenGraph,
  onOpenFiles,
  onOpenFolder,
  onSaveNoteAs,
  onOpenDailyNote,
  onOpenSettings,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes.slice(0, 12);
    return notes
      .filter((n) => n.title.toLowerCase().includes(q))
      .sort((a, b) => {
        const ap = a.title.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.title.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp;
      })
      .slice(0, 12);
  }, [notes, query]);

  const exactMatch = results.some(
    (n) => n.title.toLowerCase() === query.trim().toLowerCase()
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search notes or run a command…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty className="py-4 text-center text-[13px] text-muted-foreground">
          No notes found{query.trim() && " for “" + query.trim() + "”"}.
        </CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem
            value={`__new__${query}`}
            onSelect={() => {
              onCreateNote(query.trim() || "Untitled");
            }}
          >
            <FilePlus2 className="size-4" style={{ color: "var(--link-strong)" }} />
            <span>
              New note
              {query.trim() && !exactMatch && (
                <span className="text-muted-foreground">
                  {" "}
                  — “{query.trim()}”
                </span>
              )}
            </span>
          </CommandItem>
          <CommandItem
            value={`__daily__${query}`}
            onSelect={onOpenDailyNote}
          >
            <CalendarDays className="size-4" style={{ color: "var(--link-strong)" }} />
            <span>
              Open daily note
              <span className="text-muted-foreground">
                {" "}
                — {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              </span>
            </span>
          </CommandItem>
          <CommandItem value="__openfiles__" onSelect={onOpenFiles}>
            <FileText className="size-4" style={{ color: "var(--link-strong)" }} />
            Open markdown files…
          </CommandItem>
          <CommandItem value="__openfolder__" onSelect={onOpenFolder}>
            <FolderOpen className="size-4" style={{ color: "var(--link-strong)" }} />
            Open folder as vault…
          </CommandItem>
          <CommandItem
            value="__graph__"
            onSelect={onOpenGraph}
          >
            <Waypoints className="size-4" style={{ color: "var(--link-strong)" }} />
            Open knowledge graph
          </CommandItem>
          <CommandItem value="__settings__" onSelect={onOpenSettings}>
            <Settings2 className="size-4" style={{ color: "var(--link-strong)" }} />
            Settings
          </CommandItem>
          {activeId != null && (
            <CommandItem value="__saveas__" onSelect={() => {
                onOpenChange(false);
                onSaveNoteAs(activeId);
              }}
            >
              <Save className="size-4" style={{ color: "var(--link-strong)" }} />
              Save current note as…
            </CommandItem>
          )}
          {activeId != null && (
            <CommandItem
              value="__delete__"
              onSelect={() => {
                onOpenChange(false);
                onDeleteNote(activeId);
              }}
            >
              <Trash2 className="size-4 text-destructive/80" />
              Delete current note
            </CommandItem>
          )}
        </CommandGroup>

        {results.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Notes">
              {results.map((n) => (
                <CommandItem
                  key={n.id}
                  value={`note:${n.title}`}
                  onSelect={() => onOpenNote(n.id)}
                >
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {relativeTime(n.updatedAt)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
