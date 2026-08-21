import { useState } from "react";
import { FolderOpen, FolderX, RefreshCw, Settings2 } from "lucide-react";
import type { AppSettings } from "../lib/settings";
import {
  ACCENT_OPTIONS,
  EDITOR_FONT_OPTIONS,
  GRAPH_THEME_OPTIONS,
  THEME_OPTIONS,
} from "../lib/settings";
import { cn } from "../lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { Separator } from "./ui/separator";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AppSettings;
  /** Live-applied on every change: persist + apply immediately. */
  onChange: (next: AppSettings) => void;
  onOpenFolder: () => void;
  /** Checks the update server; returns a short human-readable result. */
  onCheckForUpdate: () => Promise<string>;
}

/** Small segmented control (Dark/Light, Serif/Sans, Preview/Edit …). */
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg border border-border bg-secondary/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
            value === o.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A row of color swatches with a label under the selected one. */
function Swatches<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; hue: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.label}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-lg px-1 py-1 transition-opacity",
              !selected && "opacity-60 hover:opacity-100"
            )}
          >
            <span
              className={cn(
                "size-6 rounded-full border-2 transition-transform",
                selected ? "scale-110 border-foreground" : "border-transparent"
              )}
              style={{ background: `oklch(0.62 0.15 ${o.hue})` }}
            />
            <span
              className={cn(
                "text-[10px] font-medium",
                selected ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <Label className="text-[13px] font-medium text-foreground">{label}</Label>
        {hint && (
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{hint}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Toggle switch. The knob is positioned with an inline style (not Tailwind
 *  translate utilities) so it renders identically in every webview: white
 *  head sits LEFT when off and slides RIGHT when on, inside the track. */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
        checked ? "border-transparent bg-primary" : "border-border bg-input"
      )}
    >
      <span
        className="absolute rounded-full bg-white shadow transition-[left] duration-150 ease-out"
        style={{ left: checked ? 22 : 3, top: 2, width: 20, height: 20 }}
      />
    </button>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  onOpenFolder,
  onCheckForUpdate,
}: SettingsDialogProps) {
  const set = (patch: Partial<AppSettings>) => onChange({ ...settings, ...patch });

  // Update check state for the Updates row.
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const runUpdateCheck = async () => {
    setChecking(true);
    setUpdateMsg(null);
    const msg = await onCheckForUpdate();
    setChecking(false);
    setUpdateMsg(msg);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[560px] max-w-[94vw] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4" />
            Settings
          </DialogTitle>
          <DialogDescription>
            Customize how Sharknote looks and behaves. Changes apply instantly.
          </DialogDescription>
        </DialogHeader>

        {/* ---------- Appearance ---------- */}
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Appearance
          </h3>
          <Separator className="my-2" />
          <Row label="Theme" hint="Overall color scheme of the app.">
            <div className="w-44">
              <Segmented
                options={THEME_OPTIONS}
                value={settings.theme}
                onChange={(theme) => set({ theme })}
              />
            </div>
          </Row>
          <Row label="Accent color" hint="The hue used for buttons, links and highlights.">
            <Swatches
              options={ACCENT_OPTIONS}
              value={settings.accent}
              onChange={(accent) => set({ accent })}
            />
          </Row>
          <Row label="Graph theme" hint="Palette of the knowledge graph canvas.">
            <Swatches
              options={GRAPH_THEME_OPTIONS}
              value={settings.graphTheme}
              onChange={(graphTheme) => set({ graphTheme })}
            />
          </Row>
        </section>

        {/* ---------- Editor ---------- */}
        <section className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Editor
          </h3>
          <Separator className="my-2" />
          <Row label="Note font" hint="Typeface of the note body in edit and preview mode.">
            <div className="w-52">
              <Segmented
                options={EDITOR_FONT_OPTIONS}
                value={settings.editorFont}
                onChange={(editorFont) => set({ editorFont })}
              />
            </div>
          </Row>
          <Row label="Font size" hint={`${settings.editorFontSize.toFixed(1)} px`}>
            <input
              type="range"
              min={13}
              max={19}
              step={0.5}
              value={settings.editorFontSize}
              onChange={(e) => set({ editorFontSize: Number(e.target.value) })}
              className="w-44 accent-[var(--primary)]"
            />
          </Row>
          <Row label="Default view" hint="How notes open: rendered or in edit mode.">
            <div className="w-44">
              <Segmented
                options={[
                  { value: "preview", label: "Preview" },
                  { value: "edit", label: "Edit" },
                ]}
                value={settings.defaultView}
                onChange={(defaultView) => set({ defaultView })}
              />
            </div>
          </Row>
        </section>

        {/* ---------- Behavior ---------- */}
        <section className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Behavior
          </h3>
          <Separator className="my-2" />
          <Row label="Autosave delay" hint={`Saves ${settings.autosaveDelay} ms after you stop typing.`}>
            <input
              type="range"
              min={300}
              max={3000}
              step={100}
              value={settings.autosaveDelay}
              onChange={(e) => set({ autosaveDelay: Number(e.target.value) })}
              className="w-44 accent-[var(--primary)]"
            />
          </Row>
          <Row label="Confirm before deleting" hint="Ask for confirmation when a note is deleted.">
            <Toggle
              checked={settings.confirmDelete}
              onChange={(confirmDelete) => set({ confirmDelete })}
              label="Confirm before deleting"
            />
          </Row>
          <Row
            label="Show .md extension on new notes"
            hint="New note titles get a .md suffix — e.g. “Meeting notes.md”. Existing notes are never renamed."
          >
            <Toggle
              checked={settings.showMdExtension}
              onChange={(showMdExtension) => set({ showMdExtension })}
              label="Show .md extension on new notes"
            />
          </Row>
        </section>

        {/* ---------- Updates ---------- */}
        <section className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Updates
          </h3>
          <Separator className="my-2" />
          <Row
            label="Software updates"
            hint={updateMsg ?? "Sharknote checks for updates after launch. You choose when to install."}
          >
            <button
              type="button"
              onClick={() => void runUpdateCheck()}
              disabled={checking}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/60 px-2.5 py-1.5 text-[11.5px] font-medium text-foreground transition hover:bg-secondary disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3.5", checking && "animate-spin")} />
              {checking ? "Checking…" : "Check now"}
            </button>
          </Row>
        </section>

        {/* ---------- Vault ---------- */}
        <section className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Vault
          </h3>
          <Separator className="my-2" />
          <Row
            label="Current vault folder"
            hint={
              settings.vaultPath
                ? "Every .md file in this folder has been imported as a note."
                : "Open a folder of markdown files to import them all as notes."
            }
          >
            <div className="flex max-w-56 items-center gap-2">
              {settings.vaultPath ? (
                <>
                  <span className="max-w-40 truncate text-[11.5px] text-muted-foreground" title={settings.vaultPath}>
                    {settings.vaultPath}
                  </span>
                  <button
                    type="button"
                    onClick={() => set({ vaultPath: "" })}
                    title="Forget vault folder"
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    <FolderX className="size-3.5" />
                  </button>
                </>
              ) : (
                <span className="text-[11.5px] text-muted-foreground/70">None</span>
              )}
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onOpenFolder();
                }}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/60 px-2.5 py-1.5 text-[11.5px] font-medium text-foreground transition hover:bg-secondary"
              >
                <FolderOpen className="size-3.5" />
                Open folder…
              </button>
            </div>
          </Row>
        </section>
      </DialogContent>
    </Dialog>
  );
}
