import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Music,
  Paperclip,
  Trash2,
  Video,
  FileArchive,
  File as FileIcon,
} from "lucide-react";
import { AttachmentService } from "../../../bindings/sharknote";
import type { Attachment } from "../../../bindings/sharknote";
import { cn } from "../../lib/utils";

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("audio/")) return Music;
  if (mime.startsWith("video/")) return Video;
  if (mime === "application/zip") return FileArchive;
  if (mime === "application/pdf" || mime.startsWith("text/")) return FileText;
  return FileIcon;
}

function humanSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentsPanel({
  noteId,
  refreshKey,
  onChanged,
}: {
  noteId: number;
  refreshKey: number;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const list = await AttachmentService.List(noteId);
      if (mounted.current) setItems(list ?? []);
    } catch (err) {
      console.error("attachments load failed", err);
    }
  }, [noteId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const attach = async () => {
    setBusy(true);
    setError("");
    try {
      const a = await AttachmentService.AttachViaDialog(noteId);
      if (a) {
        await load();
        onChanged();
      }
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await AttachmentService.Remove(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
      onChanged();
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Attachments
        </span>
        <button
          onClick={attach}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2 py-1 text-[11.5px] font-medium text-foreground/90 transition hover:border-(--accent-soft-border) hover:text-(--accent-head) disabled:opacity-50"
        >
          <Paperclip className="size-3.5" />
          {busy ? "Attaching…" : "Attach"}
        </button>
      </div>

      {error && (
        <p className="mb-2 rounded-lg border border-red-900/50 bg-red-950/40 px-2 py-1.5 text-[11.5px] text-red-300">
          {error}
        </p>
      )}

      {items.length === 0 && !busy && (
        <p className="px-2 py-1 text-[11.5px] leading-relaxed text-muted-foreground/80">
          No files yet. Attach keeps a copy inside Sharknote, so the note works
          even if the original file moves.
        </p>
      )}

      <div className="space-y-1">
        {items.map((a) => {
          const Icon = iconFor(a.mime);
          return (
            <div
              key={a.id}
              className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground/70" />
              <button
                onClick={() => void AttachmentService.OpenWith(a.id).catch((e) => setError(String(e)))}
                title="Open with default app"
                className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-foreground/90 hover:text-(--link-strong)"
              >
                {a.filename}
              </button>
              <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                {humanSize(a.size)}
              </span>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                <button
                  onClick={() => void AttachmentService.SaveCopyPath(a.id).catch((e) => setError(String(e)))}
                  title="Save a copy…"
                  className="flex size-5 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground hover:border-(--accent-soft-border) hover:text-(--accent-head)"
                >
                  <Download className="size-3" />
                </button>
                <button
                  onClick={() => void AttachmentService.OpenWith(a.id).catch((e) => setError(String(e)))}
                  title="Open"
                  className="flex size-5 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground hover:border-(--accent-soft-border) hover:text-(--accent-head)"
                >
                  <ExternalLink className="size-3" />
                </button>
                <button
                  onClick={() => void remove(a.id)}
                  title="Remove attachment"
                  className={cn(
                    "flex size-5 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground",
                    "hover:border-red-900 hover:text-red-400"
                  )}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
