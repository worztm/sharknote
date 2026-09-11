import { useCallback, useEffect, useRef, useState } from "react";
import { AlarmClock, Check, Circle, Plus, Trash2 } from "lucide-react";
import { TodoService } from "../../../bindings/sharknote";
import type { Todo } from "../../../bindings/sharknote";
import { cn } from "../../lib/utils";

/** datetime-local input value -> RFC3339 UTC (empty stays empty). */
function toRFC3339(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function shortWhen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `today ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

export function TodoPanel({
  noteId,
  refreshKey,
  onChanged,
}: {
  noteId: number;
  refreshKey: number;
  onChanged: () => void;
}) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [alarm, setAlarm] = useState("");
  const [showWhen, setShowWhen] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const list = await TodoService.List(noteId);
      if (mounted.current) setTodos(list ?? []);
    } catch (err) {
      console.error("todos load failed", err);
    }
  }, [noteId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await TodoService.Create(noteId, text.trim(), toRFC3339(due), toRFC3339(alarm));
      setText("");
      setDue("");
      setAlarm("");
      setShowWhen(false);
      await load();
      onChanged();
    } catch (err) {
      console.error("todo create failed", err);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (t: Todo) => {
    try {
      await TodoService.SetDone(t.id, !t.done);
      await load();
      onChanged();
    } catch (err) {
      console.error("todo toggle failed", err);
    }
  };

  const remove = async (id: number) => {
    try {
      await TodoService.Delete(id);
      setTodos((prev) => prev.filter((x) => x.id !== id));
      onChanged();
    } catch (err) {
      console.error("todo delete failed", err);
    }
  };

  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* composer */}
      <div className="border-b border-border p-3">
        <div className="flex items-center gap-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder="New todo…"
            className="min-w-0 flex-1 rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-(--accent-soft-border)"
          />
          <button
            onClick={() => setShowWhen((v) => !v)}
            title="Due date / alarm"
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground transition",
              showWhen && "border-(--accent-soft-border) text-(--accent-head)"
            )}
          >
            <AlarmClock className="size-3.5" />
          </button>
          <button
            onClick={() => void add()}
            disabled={!text.trim() || busy}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground transition hover:border-(--accent-soft-border) hover:text-(--accent-head) disabled:opacity-40"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        {showWhen && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block text-[10.5px] text-muted-foreground">
              Due
              <input
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-border bg-secondary/40 px-1.5 py-1 text-[11.5px] text-foreground outline-none [color-scheme:dark]"
              />
            </label>
            <label className="block text-[10.5px] text-muted-foreground">
              Alarm
              <input
                type="datetime-local"
                value={alarm}
                onChange={(e) => setAlarm(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-border bg-secondary/40 px-1.5 py-1 text-[11.5px] text-foreground outline-none [color-scheme:dark]"
              />
            </label>
          </div>
        )}
      </div>

      {/* list */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {open.length === 0 && done.length === 0 && (
          <p className="px-2 py-1 text-[11.5px] leading-relaxed text-muted-foreground/80">
            Nothing to do. Add a todo above; set an alarm and Sharknote will
            notify you even while it is closed to the tray.
          </p>
        )}
        {open.map((t) => (
          <Row key={t.id} t={t} onToggle={toggle} onRemove={remove} />
        ))}
        {done.length > 0 && (
          <>
            <div className="mt-2 px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Done
            </div>
            {done.map((t) => (
              <Row key={t.id} t={t} onToggle={toggle} onRemove={remove} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  t,
  onToggle,
  onRemove,
}: {
  t: Todo;
  onToggle: (t: Todo) => void;
  onRemove: (id: number) => void;
}) {
  const overdue = !t.done && t.dueAt && new Date(t.dueAt).getTime() < Date.now();
  return (
    <div className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60">
      <button
        onClick={() => void onToggle(t)}
        className="mt-0.5 shrink-0 text-muted-foreground transition hover:text-(--accent-head)"
        title={t.done ? "Mark open" : "Mark done"}
      >
        {t.done ? <Check className="size-4 text-(--accent-head)" /> : <Circle className="size-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[12.5px] leading-snug text-foreground/90",
            t.done && "text-muted-foreground/60 line-through"
          )}
        >
          {t.text}
        </p>
        {(t.dueAt || t.alarmAt) && (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10.5px] text-muted-foreground">
            {t.dueAt && (
              <span className={cn(overdue && "font-medium text-red-400")}>
                due {shortWhen(t.dueAt)}
                {overdue ? " · overdue" : ""}
              </span>
            )}
            {t.alarmAt && (
              <span className="flex items-center gap-1">
                <AlarmClock className="size-3" />
                {t.alarmFired ? `rang ${shortWhen(t.alarmAt)}` : `at ${shortWhen(t.alarmAt)}`}
              </span>
            )}
          </p>
        )}
      </div>
      <button
        onClick={() => void onRemove(t.id)}
        title="Delete todo"
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground opacity-0 transition hover:border-red-900 hover:text-red-400 group-hover:opacity-100"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}
