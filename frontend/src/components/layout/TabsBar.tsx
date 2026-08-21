import { FileText, Plus, Waypoints, X } from "lucide-react";
import { cn } from "../../lib/utils";

export interface TabItem {
  /** Stable unique key of the tab (used for activation/close). */
  key: string;
  kind: "note" | "graph";
  /** noteId is set for note tabs. */
  noteId?: number;
  title: string;
  dirty?: boolean;
}

interface TabsBarProps {
  tabs: TabItem[];
  activeKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onNewTab: () => void;
}

/**
 * Obsidian-style tab bar: one tab per open note, plus a graph tab. Middle
 * click closes, the + button opens a fresh note tab.
 */
export function TabsBar({ tabs, activeKey, onActivate, onClose, onNewTab }: TabsBarProps) {
  return (
    <div className="flex h-10 shrink-0 items-stretch gap-px overflow-x-auto border-b border-border bg-sidebar/40 [scrollbar-width:thin]">
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <div
            key={tab.key}
            role="tab"
            aria-selected={active}
            onClick={() => onActivate(tab.key)}
            onAuxClick={(e) => {
              // Middle click closes, like a browser.
              if (e.button === 1) {
                e.preventDefault();
                onClose(tab.key);
              }
            }}
            className={cn(
              "group relative flex min-w-0 max-w-52 cursor-pointer select-none items-center gap-2 border-r border-border px-3 text-[12.5px] transition-colors",
              active
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            )}
            title={`${tab.kind === "graph" ? "Knowledge graph" : tab.title}${
              tab.dirty ? " (unsaved changes)" : ""
            }`}
          >
            {/* Active-tab accent line along the top edge */}
            {active && (
              <span className="absolute inset-x-0 top-0 h-[2px] bg-(--accent-ink)" />
            )}
            {tab.kind === "graph" ? (
              <Waypoints
                className="size-3.5 shrink-0"
                style={{ color: "var(--link-strong)" }}
              />
            ) : (
              <FileText
                className={cn("size-3.5 shrink-0", active && "text-(--link-strong)")}
              />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">
              {tab.title}
            </span>
            {/* Dirty dot / close button */}
            {tab.dirty ? (
              <span className="size-1.5 shrink-0 rounded-full bg-amber-400" />
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.key);
                }}
                title="Close tab (Ctrl+W)"
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-md transition-colors",
                  active
                    ? "text-muted-foreground hover:bg-accent hover:text-foreground"
                    : "text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus:opacity-100"
                )}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={onNewTab}
        title="New note tab (Ctrl+T)"
        className="flex w-9 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
      <div className="min-w-2 flex-1" />
    </div>
  );
}
