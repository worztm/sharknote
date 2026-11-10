import glassCss from "./glass.css?raw";

const STYLE_ID = "sharknote-liquid-glass";

/**
 * Turns the Liquid Glass material on or off by injecting its stylesheet.
 *
 * The stylesheet is injected at runtime instead of being bundled into the
 * app CSS on purpose: the build's CSS optimizer rewrites `backdrop-filter`
 * into its -webkit- form, which this WebView2 does not honour — the frost
 * would silently never render. Raw CSS keeps the standard property intact.
 */
export function setGlassEnabled(enabled: boolean) {
  const existing = document.getElementById(STYLE_ID);
  if (!enabled) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = glassCss;
  document.head.appendChild(style);
}
