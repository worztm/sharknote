import type { AppSettings } from "./settings";

/**
 * Graph canvas palettes. Each theme is a hue rotation of one carefully tuned
 * palette (crimson is the original look), with a separate lightness pass for
 * light mode so nodes/edges stay readable on a pale background.
 *
 * Some fields are stored WITHOUT the closing paren (e.g. "oklch(0.92 0.11 25")
 * because the draw loop appends "/ alpha)" dynamically for animated
 * transparency (aurora breathing, pulses, halos).
 */
export interface GraphPalette {
  label: string;
  labelDim: string;
  labelBright: string;
  labelStroke: string;
  dimNode: string;
  orbIdle: [string, string, string];
  orbHover: [string, string, string];
  orbActive: [string, string, string];
  edgeGlow: string;
  edgeGlowDim: string;
  edgeCore: string;
  edgeCoreDim: string;
  hotEdge: string;
  hotEdgeSoft: string;
  hotEdgeCore: string;
  hotEdgeCoreSoft: string;
  /** Base (no closing paren) — alpha appended by the draw loop. */
  pulse: string;
  haloActive: string;
  haloHover: string;
  haloConnected: string;
  ringPulse: string;
  ringStatic: string;
  ringHover: string;
  auroraA: string;
  auroraB: string;
  dust: string;
  vignette: string;
  /** Chrome accents (toolbar icon, hover chip). */
  accent: string;
  accentSoft: string;
  accentText: string;
}

const GRAPH_HUES: Record<AppSettings["graphTheme"], number> = {
  crimson: 25,
  violet: 292,
  ocean: 210,
  forest: 150,
  amber: 60,
};

export function graphPalette(
  theme: AppSettings["graphTheme"],
  isLight: boolean
): GraphPalette {
  const h = GRAPH_HUES[theme] ?? 25;
  if (isLight) {
    return {
      label: `oklch(0.3 0.03 ${h})`,
      labelDim: `oklch(0.35 0.02 ${h} / 0.4)`,
      labelBright: `oklch(0.16 0.02 ${h})`,
      labelStroke: "oklch(1 0 0 / 0.85)",
      dimNode: `oklch(0.55 0.05 ${h} / 0.45)`,
      orbIdle: [`oklch(0.88 0.07 ${h})`, `oklch(0.72 0.1 ${h})`, `oklch(0.55 0.11 ${h})`],
      orbHover: [`oklch(0.95 0.05 ${h})`, `oklch(0.82 0.09 ${h})`, `oklch(0.6 0.13 ${h})`],
      orbActive: [`oklch(0.9 0.08 ${h})`, `oklch(0.72 0.13 ${h})`, `oklch(0.5 0.14 ${h})`],
      edgeGlow: `oklch(0.5 0.1 ${h} / 0.07)`,
      edgeGlowDim: `oklch(0.5 0.1 ${h} / 0.04)`,
      edgeCore: `oklch(0.45 0.08 ${h} / 0.22)`,
      edgeCoreDim: `oklch(0.45 0.06 ${h} / 0.08)`,
      hotEdge: `oklch(0.5 0.16 ${h} / 0.35)`,
      hotEdgeSoft: `oklch(0.5 0.16 ${h} / 0.2)`,
      hotEdgeCore: `oklch(0.45 0.14 ${h} / 0.85)`,
      hotEdgeCoreSoft: `oklch(0.45 0.14 ${h} / 0.5)`,
      pulse: `oklch(0.5 0.15 ${h}`,
      haloActive: `oklch(0.5 0.16 ${h}`,
      haloHover: `oklch(0.55 0.14 ${h}`,
      haloConnected: `oklch(0.48 0.14 ${h}`,
      ringPulse: `oklch(0.5 0.14 ${h}`,
      ringStatic: `oklch(0.5 0.13 ${h} / 0.8)`,
      ringHover: `oklch(0.5 0.11 ${h} / 0.8)`,
      auroraA: `oklch(0.85 0.06 ${h}`,
      auroraB: `oklch(0.88 0.04 ${h}`,
      dust: `oklch(0.55 0.06 ${h}`,
      vignette: `oklch(0.93 0.008 ${h} / 0.5)`,
      accent: `oklch(0.5 0.15 ${h})`,
      accentSoft: `oklch(0.5 0.15 ${h} / 0.35)`,
      accentText: `oklch(0.5 0.12 ${h} / 0.9)`,
    };
  }
  return {
    label: `oklch(0.93 0.015 ${h})`,
    labelDim: `oklch(0.92 0.01 ${h} / 0.28)`,
    labelBright: `oklch(0.97 0.02 ${h})`,
    labelStroke: `oklch(0.1 0.012 ${h} / 0.85)`,
    dimNode: `oklch(0.45 0.06 ${h} / 0.28)`,
    orbIdle: [`oklch(0.82 0.11 ${h})`, `oklch(0.63 0.15 ${h})`, `oklch(0.42 0.18 ${h})`],
    orbHover: [`oklch(0.95 0.07 ${h})`, `oklch(0.8 0.14 ${h})`, `oklch(0.52 0.2 ${h})`],
    orbActive: [`oklch(0.93 0.09 ${h})`, `oklch(0.72 0.2 ${h})`, `oklch(0.46 0.21 ${h})`],
    edgeGlow: `oklch(0.74 0.13 ${h} / 0.07)`,
    edgeGlowDim: `oklch(0.72 0.12 ${h} / 0.05)`,
    edgeCore: `oklch(0.83 0.05 ${h} / 0.18)`,
    edgeCoreDim: `oklch(0.86 0.04 ${h} / 0.06)`,
    hotEdge: `oklch(0.75 0.17 ${h} / 0.32)`,
    hotEdgeSoft: `oklch(0.75 0.17 ${h} / 0.18)`,
    hotEdgeCore: `oklch(0.88 0.12 ${h} / 0.85)`,
    hotEdgeCoreSoft: `oklch(0.88 0.12 ${h} / 0.45)`,
    pulse: `oklch(0.92 0.11 ${h}`,
    haloActive: `oklch(0.75 0.2 ${h}`,
    haloHover: `oklch(0.85 0.15 ${h}`,
    haloConnected: `oklch(0.7 0.16 ${h}`,
    ringPulse: `oklch(0.82 0.15 ${h}`,
    ringStatic: `oklch(0.87 0.12 ${h} / 0.8)`,
    ringHover: `oklch(0.92 0.09 ${h} / 0.8)`,
    auroraA: `oklch(0.4 0.13 ${h}`,
    auroraB: `oklch(0.33 0.09 ${h}`,
    dust: `oklch(0.88 0.07 ${h}`,
    vignette: `oklch(0.125 0.01 ${h} / 0.55)`,
    accent: `oklch(0.75 0.16 ${h})`,
    accentSoft: `oklch(0.65 0.17 ${h} / 0.35)`,
    accentText: `oklch(0.82 0.1 ${h} / 0.9)`,
  };
}
