import { useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Italic,
  Underline,
} from "lucide-react";
import { cn } from "../lib/utils";

/** A single formatting action requested from the right-click menu. */
export type FormatCommand =
  | { type: "color"; value: string | null } // null = reset to default color
  | { type: "font"; value: string | null } // null = reset to default font
  | { type: "size"; value: number }
  | { type: "align"; value: "left" | "center" | "right" | "justify" }
  | { type: "inline"; value: "bold" | "italic" | "underline" }
  | { type: "clear" };

interface FormatMenuProps {
  x: number;
  y: number;
  onCommand: (cmd: FormatCommand) => void;
  onClose: () => void;
}

const COLORS: { name: string; value: string | null }[] = [
  { name: "Default", value: null },
  { name: "White", value: "#f8fafc" },
  { name: "Gray", value: "#a1a1aa" },
  { name: "Red", value: "#f87171" },
  { name: "Orange", value: "#fb923c" },
  { name: "Amber", value: "#fbbf24" },
  { name: "Green", value: "#4ade80" },
  { name: "Teal", value: "#2dd4bf" },
  { name: "Blue", value: "#60a5fa" },
  { name: "Violet", value: "#a78bfa" },
  { name: "Pink", value: "#f472b6" },
];

const FONTS: { name: string; value: string | null }[] = [
  { name: "Default", value: null },
  { name: "Inter", value: "Inter" },
  { name: "Lora", value: "Lora" },
  { name: "Times New Roman", value: "Times New Roman" },
  { name: "Arial", value: "Arial" },
  { name: "Georgia", value: "Georgia" },
  { name: "Verdana", value: "Verdana" },
  { name: "Courier New", value: "Courier New" },
  { name: "JetBrains Mono", value: "JetBrains Mono" },
];

const SIZES = [9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </div>
  );
}

/** One full-width vertical row: icon + label (+ optional shortcut hint). */
function MenuRow({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: typeof Bold;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] text-foreground/85 transition-colors hover:bg-accent"
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] tabular-nums text-muted-foreground/60">{hint}</span>}
    </button>
  );
}

/**
 * Docs-style formatting menu shown on right-click inside the editor.
 * Every option is a vertical row; colors and sizes also offer custom values
 * (any color from the native picker, any pixel size typed in).
 */
export function FormatMenu({ x, y, onCommand, onClose }: FormatMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [customSize, setCustomSize] = useState("");

  const [pos, setPos] = useState(() => ({
    x: Math.max(8, Math.min(x, window.innerWidth - 264)),
    y: Math.max(8, Math.min(y, window.innerHeight - 640)),
  }));

  // Clamp to the viewport once the real size is known.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);

  // Close on outside click or Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const applyCustomSize = () => {
    const px = parseInt(customSize, 10);
    if (Number.isFinite(px) && px >= 1 && px <= 300) {
      onCommand({ type: "size", value: px });
    }
  };

  return (
    <div
      ref={menuRef}
      onMouseDown={(e) => {
        // Keep the editor selection alive when clicking buttons, but let
        // inputs (custom size, color picker) receive focus normally.
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") {
          e.preventDefault();
        }
      }}
      className="fixed z-50 w-64 overflow-y-auto rounded-xl border border-border bg-popover/95 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-xl"
      style={{ left: pos.x, top: pos.y, maxHeight: "calc(100vh - 16px)" }}
    >
      {/* Bold / italic / underline */}
      <div className="flex flex-col gap-0.5 px-1 pt-1">
        <MenuRow
          icon={Bold}
          label="Bold"
          hint="Ctrl+B"
          onClick={() => onCommand({ type: "inline", value: "bold" })}
        />
        <MenuRow
          icon={Italic}
          label="Italic"
          hint="Ctrl+I"
          onClick={() => onCommand({ type: "inline", value: "italic" })}
        />
        <MenuRow
          icon={Underline}
          label="Underline"
          hint="Ctrl+U"
          onClick={() => onCommand({ type: "inline", value: "underline" })}
        />
      </div>

      <div className="mx-1 my-1.5 h-px bg-border" />

      {/* Text color */}
      <Label>Text color</Label>
      <div className="grid grid-cols-6 gap-1.5 px-2 pb-1">
        {COLORS.map((c) => (
          <button
            key={c.name}
            type="button"
            title={c.name}
            onClick={() => onCommand({ type: "color", value: c.value })}
            className="flex h-6 items-center justify-center rounded-md border border-border/60 bg-secondary/50 transition-colors hover:bg-accent"
          >
            {c.value ? (
              <span
                className="size-3.5 rounded-full border border-black/30"
                style={{ backgroundColor: c.value }}
              />
            ) : (
              <span className="text-[10px] font-semibold italic text-muted-foreground">A</span>
            )}
          </button>
        ))}
        {/* Custom color — native picker hidden under a + swatch */}
        <label
          title="Custom color"
          className="relative flex h-6 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-border/60 bg-secondary/50 transition-colors hover:bg-accent"
        >
          <input
            type="color"
            defaultValue="#a78bfa"
            onChange={(e) => onCommand({ type: "color", value: e.target.value })}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          <span className="pointer-events-none text-[12px] font-bold leading-none text-muted-foreground">
            +
          </span>
        </label>
      </div>

      <div className="mx-1 my-1.5 h-px bg-border" />

      {/* Font family */}
      <Label>Font</Label>
      <div className="px-1 pb-1">
        {FONTS.map((f) => (
          <button
            key={f.name}
            type="button"
            onClick={() => onCommand({ type: "font", value: f.value })}
            className="block w-full rounded-md px-2 py-1 text-left text-[12.5px] text-foreground/85 transition-colors hover:bg-accent"
            style={{ fontFamily: f.value ?? undefined }}
          >
            {f.name}
          </button>
        ))}
      </div>

      <div className="mx-1 my-1.5 h-px bg-border" />

      {/* Font size */}
      <Label>Size</Label>
      <div className="grid grid-cols-6 gap-1 px-2 pb-1.5">
        {SIZES.map((s) => (
          <button
            key={s}
            type="button"
            title={`${s} px`}
            onClick={() => onCommand({ type: "size", value: s })}
            className={cn(
              "flex h-7 items-center justify-center rounded-md border border-border/60 bg-secondary/50 text-[11px] tabular-nums text-foreground/80 transition-colors hover:bg-accent",
              s === 16 && "border-(--accent-soft-border-strong) text-(--accent-head)"
            )}
          >
            {s}
          </button>
        ))}
      </div>
      {/* Custom size — type any value */}
      <div className="flex items-center gap-1.5 px-2 pb-1">
        <input
          type="number"
          min={1}
          max={300}
          value={customSize}
          onChange={(e) => setCustomSize(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyCustomSize();
          }}
          placeholder="Custom size"
          className="h-7 w-full min-w-0 flex-1 rounded-md border border-border/60 bg-secondary/50 px-2 text-[11.5px] tabular-nums text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-(--accent-soft-border-strong)"
        />
        <span className="text-[10.5px] text-muted-foreground">px</span>
        <button
          type="button"
          onClick={applyCustomSize}
          className="h-7 shrink-0 rounded-md border border-border/60 bg-secondary/50 px-2.5 text-[11px] font-medium text-foreground/80 transition-colors hover:bg-accent"
        >
          Apply
        </button>
      </div>

      <div className="mx-1 my-1.5 h-px bg-border" />

      {/* Alignment */}
      <Label>Align</Label>
      <div className="flex flex-col gap-0.5 px-1 pb-1">
        <MenuRow
          icon={AlignLeft}
          label="Align left"
          onClick={() => onCommand({ type: "align", value: "left" })}
        />
        <MenuRow
          icon={AlignCenter}
          label="Align center"
          onClick={() => onCommand({ type: "align", value: "center" })}
        />
        <MenuRow
          icon={AlignRight}
          label="Align right"
          onClick={() => onCommand({ type: "align", value: "right" })}
        />
        <MenuRow
          icon={AlignJustify}
          label="Justify"
          onClick={() => onCommand({ type: "align", value: "justify" })}
        />
      </div>

      <div className="mx-1 my-1.5 h-px bg-border" />

      {/* Clear formatting */}
      <MenuRow
        icon={Eraser}
        label="Clear formatting"
        onClick={() => onCommand({ type: "clear" })}
      />
    </div>
  );
}
