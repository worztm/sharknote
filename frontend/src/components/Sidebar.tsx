import { useMemo } from "react";
import { FolderOpen, Plus, Search, Settings2, Waypoints, FileText, Trash2 } from "lucide-react";
import type { NoteSummary } from "../../bindings/sharknote";
import { Logo } from "../App";
import { relativeTime } from "../lib/time";
import { cn } from "../lib/utils";
import type { View } from "../App";

interface SidebarProps {
  notes: NoteSummary[];
  activeId: number | null;
  query: string;
  onQueryChange: (q: string) => void;
  /** Second arg: open in a new tab (Ctrl/Cmd+click or middle click). */
  onOpenNote: (id: number, newTab?: boolean) => void;
  onNewNote: () => void;
  onOpenGraph: () => void;
  onDeleteNote: (id: number) => void;
  /** Import .md files via a multi-select dialog. */
  onOpenFiles: () => void;
  /** Import a whole folder and set it as the vault. */
  onOpenFolder: () => void;
  onOpenSettings: () => void;
  vaultPath: string;
  view: View;
}

type Group = { label: string; items: NoteSummary[] };

function groupNotes(notes: NoteSummary[]): Group[] {
  const now = Date.now();
  const day = 86_400_000;
  const buckets: Group[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];
  for (const n of notes) {
    const t = new Date(n.updatedAt).getTime();
    const d = (now - t) / day;
    let b = 3;
    if (d < 1) b = 0;
    else if (d < 2) b = 1;
    else if (d < 7) b = 2;
    buckets[b].items.push(n);
  }
  return buckets.filter((b) => b.items.length > 0);
}

export function Sidebar({
  notes,
  activeId,
  query,
  onQueryChange,
  onOpenNote,
  onNewNote,
  onOpenGraph,
  onDeleteNote,
  onOpenFiles,
  onOpenFolder,
  onOpenSettings,
  vaultPath,
  view,
}: SidebarProps) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.excerpt.toLowerCase().includes(q)
    );
  }, [notes, query]);

  const groups = useMemo(() => groupNotes(filtered), [filtered]);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <Logo size={30} />
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-sidebar-foreground">
            Sharknote
          </div>
          <div className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Second brain
          </div>
        </div>
      </div>

      {/* Search + new note */}
      <div className="space-y-2 px-3 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search notes…"
            className="h-9 w-full rounded-lg border border-transparent bg-secondary/60 pl-8.5 pr-9 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-(--accent-soft-border-strong) focus:bg-secondary focus:outline-none focus:ring-2 focus:ring-(--ring)/25"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ⌘K
          </kbd>
        </div>
        <button
          onClick={onNewNote}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground shadow-[0_2px_16px_-4px] shadow-primary/50 transition hover:bg-primary/90 active:scale-[0.985]"
        >
          <Plus className="size-4" />
          New note
        </button>
      </div>

      {/* Open markdown files, or import a whole folder as your vault —
          two separate buttons, two separate dialogs. */}
      <div className="grid grid-cols-2 gap-1.5 px-3 pb-3">
        <button
          onClick={onOpenFiles}
          title="Open .md files (multi-select)…"
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary/40 text-[12px] font-medium text-secondary-foreground transition hover:bg-secondary"
        >
          <FileText className="size-3.5" />
          Files
        </button>
        <button
          onClick={onOpenFolder}
          title="Open a whole folder as your vault"
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary/40 text-[12px] font-medium text-secondary-foreground transition hover:bg-secondary"
        >
          <FolderOpen className="size-3.5" />
          Folder
        </button>
      </div>

      {/* Note list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs leading-relaxed text-muted-foreground">
            {query
              ? "No notes match that search."
              : "No notes yet.\nClick “New note” to dive in."}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-3">
              <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                {g.label}
              </div>
              <div className="space-y-px">
                {g.items.map((n) => {
                  const active = n.id === activeId;
                  return (
                    <div key={n.id} className="group relative">
                      <button
                        onClick={(e) =>
                          onOpenNote(n.id, e.ctrlKey || e.metaKey)
                        }
                        onAuxClick={(e) => {
                          if (e.button === 1) {
                            e.preventDefault();
                            onOpenNote(n.id, true);
                          }
                        }}
                        title={`Open “${n.title}”${active ? "" : " · Ctrl+click to open in a new tab"}`}
                        className={cn(
                          "group/row relative w-full rounded-lg px-2.5 py-2 pr-9 text-left transition-colors",
                          active
                            ? "bg-(--accent-soft)"
                            : "hover:bg-sidebar-accent"
                        )}
                      >
                        {active && (
                          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-(--accent-ink)" />
                        )}
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              "truncate text-[13px] font-medium",
                              active
                                ? "text-(--link-strong)"
                                : "text-sidebar-foreground/90"
                            )}
                          >
                            {n.title}
                          </span>
                          <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground/70">
                            {relativeTime(n.updatedAt)}
                          </span>
                        </div>
                        {n.excerpt && (
                          <div className="mt-0.5 truncate text-[11.5px] leading-snug text-muted-foreground/70">
                            {n.excerpt}
                          </div>
                        )}
                      </button>
                      {/* Delete — revealed on hover */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteNote(n.id);
                        }}
                        title={`Delete “${n.title}”`}
                        className="absolute right-1.5 top-1.5 z-10 flex size-6 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition hover:bg-destructive/15 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer: view switcher + settings */}
      <div className="border-t border-border p-2">
        {vaultPath && (
          <div
            className="mb-1.5 flex items-center gap-1.5 truncate rounded-md px-2 py-1 text-[10.5px] text-muted-foreground/70"
            title={`Vault: ${vaultPath}`}
          >
            <FolderOpen className="size-3 shrink-0" />
            <span className="truncate">{vaultPath}</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onOpenNote(activeId ?? notes[0]?.id)}
            disabled={!activeId}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium transition",
              view === "notes"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              !activeId && "opacity-40"
            )}
          >
            <FileText className="size-3.5" />
            Notes
          </button>
          <button
            onClick={onOpenGraph}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium transition",
              view === "graph"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            )}
          >
            <Waypoints className="size-3.5" />
            Graph
          </button>
          <button
            onClick={onOpenSettings}
            title="Settings"
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            )}
          >
            <Settings2 className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
