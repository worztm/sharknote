import { Window } from "@wailsio/runtime";

/**
 * Frontend mirror of the backend Settings model, plus the logic that turns a
 * Settings object into live CSS state (theme class, accent hue, editor font).
 */

export interface AppSettings {
  theme: "dark" | "light";
  accent: "violet" | "sky" | "emerald" | "amber" | "rose";
  graphTheme: "crimson" | "violet" | "ocean" | "forest" | "amber";
  editorFont: "serif" | "sans" | "mono";
  editorFontSize: number;
  defaultView: "preview" | "edit";
  autosaveDelay: number;
  confirmDelete: boolean;
  /** Append ".md" to new note titles (e.g. “Notes.md”). */
  showMdExtension: boolean;
  vaultPath: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  accent: "violet",
  graphTheme: "crimson",
  editorFont: "serif",
  editorFontSize: 15.5,
  defaultView: "preview",
  autosaveDelay: 800,
  confirmDelete: true,
  showMdExtension: true,
  vaultPath: "",
};

export const THEME_OPTIONS: { value: AppSettings["theme"]; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

export const ACCENT_OPTIONS: {
  value: AppSettings["accent"];
  label: string;
  hue: number;
}[] = [
  { value: "violet", label: "Violet", hue: 292 },
  { value: "sky", label: "Sky", hue: 230 },
  { value: "emerald", label: "Emerald", hue: 160 },
  { value: "amber", label: "Amber", hue: 55 },
  { value: "rose", label: "Rose", hue: 350 },
];

export const GRAPH_THEME_OPTIONS: {
  value: AppSettings["graphTheme"];
  label: string;
  hue: number;
}[] = [
  { value: "crimson", label: "Crimson", hue: 25 },
  { value: "violet", label: "Violet", hue: 292 },
  { value: "ocean", label: "Ocean", hue: 210 },
  { value: "forest", label: "Forest", hue: 150 },
  { value: "amber", label: "Amber", hue: 60 },
];

export const EDITOR_FONT_OPTIONS: {
  value: AppSettings["editorFont"];
  label: string;
}[] = [
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Sans" },
  { value: "mono", label: "Mono" },
];

/** Normalizes an arbitrary settings blob into a complete valid AppSettings. */
export function normalizeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  const d = DEFAULT_SETTINGS;
  return {
    theme: raw?.theme === "light" || raw?.theme === "dark" ? raw.theme : d.theme,
    accent: ACCENT_OPTIONS.some((a) => a.value === raw?.accent)
      ? (raw!.accent as AppSettings["accent"])
      : d.accent,
    graphTheme: GRAPH_THEME_OPTIONS.some((g) => g.value === raw?.graphTheme)
      ? (raw!.graphTheme as AppSettings["graphTheme"])
      : d.graphTheme,
    editorFont: EDITOR_FONT_OPTIONS.some((f) => f.value === raw?.editorFont)
      ? (raw!.editorFont as AppSettings["editorFont"])
      : d.editorFont,
    editorFontSize:
      typeof raw?.editorFontSize === "number" &&
      raw.editorFontSize >= 13 &&
      raw.editorFontSize <= 19
        ? raw.editorFontSize
        : d.editorFontSize,
    defaultView: raw?.defaultView === "edit" || raw?.defaultView === "preview"
      ? raw.defaultView
      : d.defaultView,
    autosaveDelay:
      typeof raw?.autosaveDelay === "number" &&
      raw.autosaveDelay >= 300 &&
      raw.autosaveDelay <= 3000
        ? raw.autosaveDelay
        : d.autosaveDelay,
    confirmDelete: typeof raw?.confirmDelete === "boolean"
      ? raw.confirmDelete
      : d.confirmDelete,
    showMdExtension: typeof raw?.showMdExtension === "boolean"
      ? raw.showMdExtension
      : d.showMdExtension,
    vaultPath: typeof raw?.vaultPath === "string" ? raw.vaultPath : d.vaultPath,
  };
}

const WINDOW_BG: Record<AppSettings["theme"], [number, number, number]> = {
  dark: [9, 9, 11],
  light: [248, 248, 251],
};

/**
 * Pushes a Settings object into the DOM: theme class, color scheme, accent
 * hue (CSS var), editor font family + size (CSS vars), and the native window
 * background so resizes don't flash the wrong color.
 */
export function applySettings(s: AppSettings) {
  const root = document.documentElement;
  root.classList.toggle("dark", s.theme === "dark");
  root.style.colorScheme = s.theme;
  root.dataset.accent = s.accent;
  root.dataset.editorFont = s.editorFont;
  root.style.setProperty("--editor-font-size", `${s.editorFontSize}px`);
  // Best-effort: keep the native window chrome color in sync with the theme.
  const [r, g, b] = WINDOW_BG[s.theme];
  try {
    void Window.SetBackgroundColour(r, g, b, 255).catch(() => {});
  } catch {
    /* mock / browser mode: no window API */
  }
}
