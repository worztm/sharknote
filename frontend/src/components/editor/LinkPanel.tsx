import { useCallback, useEffect, useState } from "react";
import {
  CornerDownRight,
  Link2,
  Plus,
} from "lucide-react";
import { NoteService } from "../../../bindings/sharknote";
import type { Backlink, LinkInfo } from "../../../bindings/sharknote";
import { cn } from "../../lib/utils";

interface LinkPanelProps {
  noteId: number;
  refreshKey: number;
  onOpenNote: (id: number) => void;
  onCreateNote: (title: string) => void;
}

export function LinkPanel({
  noteId,
  refreshKey,
  onOpenNote,
  onCreateNote,
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
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <Link2 className="size-3.5" />
          Links & backlinks
        </div>
      </div>

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
