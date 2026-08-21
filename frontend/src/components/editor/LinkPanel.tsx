import { useCallback, useEffect, useState } from "react";
import {
  CornerDownRight,
  Link2,
  ListTree,
  Plus,
} from "lucide-react";
import { NoteService } from "../../../bindings/sharknote";
import type { Backlink, LinkInfo } from "../../../bindings/sharknote";
import { cn } from "../../lib/utils";
import type { HeadingEntry } from "../../lib/markdown";

interface LinkPanelProps {
  noteId: number;
  refreshKey: number;
  onOpenNote: (id: number) => void;
  onCreateNote: (title: string) => void;
  /** h1–h3 outline of the open note. */
  outline: HeadingEntry[];
  panelTab: "links" | "outline";
  onPanelTabChange: (tab: "links" | "outline") => void;
  onJumpToHeading: (index: number) => void;
}

export function LinkPanel({
  noteId,
  refreshKey,
  onOpenNote,
  onCreateNote,
  outline,
  panelTab,
  onPanelTabChange,
  onJumpToHeading,
}: LinkPanelProps) {
  const [outgoing, setOutgoing] = useState<LinkInfo[]>([]);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [out, back] = await Promise.all([
        NoteService.GetOutgoingLinks(noteId),
        NoteService.GetBacklinks(noteId),
      ]);
      setOutgoing(out ?? []);
      setBacklinks(back ?? []);
    } catch (err) {
      console.error("LinkPanel load failed", err);
    } finally {
      setLoaded(true);
    }
  }, [noteId]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load, refreshKey]);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card/40">
      <div className="flex border-b border-border px-4 py-3">
        <div className="flex flex-1 items-center gap-0.5 rounded-lg border border-border bg-secondary/40 p-0.5">
          <button
            onClick={() => onPanelTabChange("links")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium transition",
              panelTab === "links"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Link2 className="size-3.5" />
            Links
          </button>
          <button
            onClick={() => onPanelTabChange("outline")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium transition",
              panelTab === "outline"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ListTree className="size-3.5" />
            Outline
          </button>
        </div>
      </div>

      {panelTab === "outline" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <Section
            title="Outline"
            count={outline.length}
            empty={
              <p className="text-[11.5px] leading-relaxed text-muted-foreground/80">
                No headings yet. Add a <span className="text-foreground"># Heading</span> to
                build the outline.
              </p>
            }
          >
            {outline.map((h, i) => (
              <button
                key={i}
                onClick={() => onJumpToHeading(i)}
                title={`Jump to “${h.text}”`}
                className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-[12.5px] text-foreground/85 transition-colors hover:bg-accent/60 hover:text-(--link-strong)"
                style={{ paddingLeft: 8 + (h.level - 1) * 14 }}
              >
                <span
                  className={cn(
                    "mr-1.5 text-[10px] font-semibold text-muted-foreground/50",
                    h.level === 1 && "font-bold"
                  )}
                >
                  H{h.level}
                </span>
                {h.text}
              </button>
            ))}
          </Section>
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* Outgoing links */}
        <Section
          title="Outgoing"
          count={outgoing.length}
          empty={
            <p className="text-[11.5px] leading-relaxed text-muted-foreground/80">
              No links yet. Type{" "}
              <kbd className="rounded border border-border bg-secondary px-1 text-[10px] text-foreground">
                [[
              </kbd>{" "}
              in the note to link another note.
            </p>
          }
        >
          {outgoing.map((l, i) => (
            <div
              key={i}
              className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60"
            >
              {l.resolved ? (
                <button
                  onClick={() => onOpenNote(l.targetId)}
                  className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-(--accent-head) hover:text-(--link-strong)"
                >
                  {l.targetTitle}
                </button>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                    {l.targetTitle}
                  </span>
                  <button
                    onClick={() => onCreateNote(l.targetTitle)}
                    title={`Create “${l.targetTitle}”`}
                    className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground opacity-0 transition hover:border-(--accent-soft-border) hover:text-(--accent-head) group-hover:opacity-100"
                  >
                    <Plus className="size-3" />
                  </button>
                </>
              )}
            </div>
          ))}
        </Section>

        <div className="my-3 h-px bg-border" />

        {/* Backlinks */}
        <Section
          title="Backlinks"
          count={backlinks.length}
          empty={
            <p className="text-[11.5px] leading-relaxed text-muted-foreground/80">
              Nothing links to this note yet. Add a{" "}
              <span className="text-(--accent-head)">
                [[{outgoing[0]?.targetTitle || "…"}]]{" "}
              </span>
              elsewhere and it will appear here.
            </p>
          }
        >
          {backlinks.map((b) => (
            <button
              key={b.id}
              onClick={() => onOpenNote(b.id)}
              className="group w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/60"
            >
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground/90 group-hover:text-(--link-strong)">
                <CornerDownRight className="size-3 shrink-0 text-muted-foreground/60" />
                {b.title}
              </div>
              {b.excerpt && (
                <p className="mt-0.5 line-clamp-2 pl-5 text-[11.5px] leading-relaxed text-muted-foreground">
                  {b.excerpt}
                </p>
              )}
            </button>
          ))}
        </Section>
      </div>
      )}

      {!loaded && (
        <div className="pointer-events-none absolute inset-0 animate-pulse bg-card/20" />
      )}
    </aside>
  );
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 px-2 pb-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {title}
        </span>
        <span
          className={cn(
            "rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums",
            count > 0
              ? "bg-(--accent-soft) text-(--accent-head)"
              : "bg-secondary text-muted-foreground"
          )}
        >
          {count}
        </span>
      </div>
      <div className="space-y-px">
        {count > 0 ? children : <div className="px-2 py-1">{empty}</div>}
      </div>
    </section>
  );
}
