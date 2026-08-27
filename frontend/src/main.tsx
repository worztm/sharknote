import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/lora";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import App from "./App";

// Dev-only: run the UI in a plain browser against an in-memory mock of the
// Go backend. Activate with `?mock=1` on the Vite dev server. This branch is
// compiled out of production builds (import.meta.env.DEV is statically false).
if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock")) {
  const { installMock } = await import("./mock");
  installMock();
  // Dev convenience: ?view=graph opens directly into the graph view.
  if (new URLSearchParams(location.search).get("view") === "graph") {
    (window as unknown as { __SHARKNOTE_VIEW__?: string }).__SHARKNOTE_VIEW__ = "graph";
  }
}

// Splash hand-off: the static splash in index.html painted instantly at
// startup. Once React has mounted the real UI, fade the splash out and
// remove it so it never intercepts clicks.
function hideSplash() {
  const el = document.getElementById("splash");
  if (!el) return;
  el.classList.add("splash-hide");
  window.setTimeout(() => el.remove(), 400);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Wait one frame past the render call so the first real UI frame exists
// before the splash starts fading.
requestAnimationFrame(() => requestAnimationFrame(hideSplash));
