import { useCallback } from "react";
import { ArrowDownToLine, RefreshCw, RotateCcw, X } from "lucide-react";
import { cn } from "../lib/utils";

export interface UpdateState {
  stage: "available" | "downloading" | "ready" | "error";
  latest: string;
  notes?: string;
  percent: number;
}

interface UpdateBannerProps {
  state: UpdateState | null;
  onDownload: () => void;
  onReload: () => void;
  onDismiss: () => void;
}

/**
 * Floating update pill (bottom-right): announces a newer published version,
 * shows download progress, and finally offers the one-click "reload" that
 * runs the silent installer and brings the new build back up.
 */
export function UpdateBanner({ state, onDownload, onReload, onDismiss }: UpdateBannerProps) {
  const close = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDismiss();
    },
    [onDismiss]
  );

  if (!state) return null;

  return (
    <div
      role="status"
      className="animate-fade-up fixed bottom-5 right-5 z-[90] w-80 overflow-hidden rounded-xl border border-border bg-popover/95 shadow-2xl shadow-black/50 backdrop-blur-xl"
    >
      {/* Dismiss */}
      <button
        onClick={close}
        title="Dismiss"
        className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-accent hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>

      <div className="flex items-start gap-3 px-4 pb-3 pt-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
            state.stage === "ready" ? "bg-emerald-500/15 text-emerald-400" : "bg-(--accent-chip-bg) text-(--accent-chip)"
          )}
        >
          {state.stage === "ready" ? (
            <RotateCcw className="size-4" />
          ) : state.stage === "downloading" ? (
            <ArrowDownToLine className="size-4 animate-bounce" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1 pr-5">
          {state.stage === "available" && (
            <>
              <div className="text-[13px] font-semibold text-foreground">
                Sharknote {state.latest} is available
              </div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                Download the update? It installs when you reload.
              </p>
              <button
                onClick={onDownload}
                className="mt-2 flex h-7 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98]"
              >
                <ArrowDownToLine className="size-3.5" />
                Download update
              </button>
            </>
          )}

          {state.stage === "downloading" && (
            <>
              <div className="text-[13px] font-semibold text-foreground">
                Downloading {state.latest}…
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-(--accent-ink) transition-all duration-200"
                  style={{ width: `${Math.max(4, state.percent)}%` }}
                />
              </div>
              <div className="mt-1 text-right text-[10.5px] tabular-nums text-muted-foreground">
                {state.percent}%
              </div>
            </>
          )}

          {state.stage === "ready" && (
            <>
              <div className="text-[13px] font-semibold text-foreground">
                Update ready
              </div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                Reload Sharknote to finish updating to {state.latest}. Your
                notes are untouched.
              </p>
              <button
                onClick={onReload}
                className="mt-2 flex h-7 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[12px] font-medium text-white shadow-[0_2px_16px_-4px] shadow-emerald-600/50 transition hover:bg-emerald-500 active:scale-[0.98]"
              >
                <RotateCcw className="size-3.5" />
                Reload to update
              </button>
            </>
          )}

          {state.stage === "error" && (
            <>
              <div className="text-[13px] font-semibold text-foreground">
                Update failed
              </div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                The download couldn't be completed or verified. You can try
                again.
              </p>
              <button
                onClick={onDownload}
                className="mt-2 flex h-7 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-medium text-primary-foreground transition hover:bg-primary/90 active:scale-[0.98]"
              >
                <RefreshCw className="size-3.5" />
                Try again
              </button>
            </>
          )}
        </div>
      </div>

      {/* Progress underline while downloading */}
      {state.stage === "downloading" && (
        <div className="h-0.5 w-full bg-secondary">
          <div
            className="h-full bg-(--accent-ink) transition-all duration-200"
            style={{ width: `${Math.max(4, state.percent)}%` }}
          />
        </div>
      )}
    </div>
  );
}
