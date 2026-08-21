import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Events } from "@wailsio/runtime";
import { NoteService, UpdaterService } from "../bindings/sharknote";
import type { Note, NoteSummary } from "../bindings/sharknote";
import { Sidebar } from "./components/layout/Sidebar";
import { EditorView } from "./components/editor/EditorView";
import { GraphView } from "./components/graph/GraphView";
import { CommandPalette } from "./components/dialogs/CommandPalette";
import { NewTabDialog } from "./components/dialogs/NewTabDialog";
import { RenameNoteDialog } from "./components/dialogs/RenameNoteDialog";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { TabsBar, type TabItem } from "./components/layout/TabsBar";
import { UpdateBanner, type UpdateState } from "./components/dialogs/UpdateBanner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { cn } from "./lib/utils";
import { applySettings, normalizeSettings, type AppSettings } from "./lib/settings";

export type View = "notes" | "graph";

let tabSeq = 0;
const nextTabKey = () => `tab-${++tabSeq}`;

export default function App() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(normalizeSettings(null));
  const [loaded, setLoaded] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefillTitle, setPrefillTitle] = useState<string | null>(null);
  // Note awaiting delete confirmation (single dialog for the whole app).
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  // Note awaiting rename confirmation (single dialog for the whole app).
  const [renameTarget, setRenameTarget] = useState<{
    id: number;
    title: string;
  } | null>(null);
  // Bumped after every rename so the editor re-fetches the note's title.
  const [titleReloadKey, setTitleReloadKey] = useState(0);
  // Remote update state (null = nothing to show).
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const updateStageRef = useRef<UpdateState["stage"] | null>(null);
  // Transient toast shown after a Save as… export or a copy action.
  const [saveToast, setSaveToast] = useState<{
    text: string;
    key: number;
    kind?: "saved" | "info";
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  // Tab that was active before the graph was opened (for its Back button).
  const lastNoteKeyRef = useRef<string | null>(null);
  // Most recently active note id — drives the graph's "active node" glow.
  const [lastNoteId, setLastNoteId] = useState<number | null>(null);

  // Remember the most recent note tab: the graph's Back button returns there,
  // its canvas highlights that node as active, and clicking graph nodes
  // reuses this tab instead of spawning new ones.
  useEffect(() => {
    const t = tabs.find((x) => x.key === activeKey);
    if (t?.kind === "note" && t.noteId != null) {
      lastNoteKeyRef.current = t.key;
      setLastNoteId(t.noteId);
    }
  }, [activeKey, tabs]);

  const refreshNotes = useCallback(async () => {
    try {
      const list = await NoteService.ListNotes();
      setNotes(list ?? []);
      return list ?? [];
    } catch (err) {
      console.error("ListNotes failed", err);
      return [];
    }
  }, []);

  // Initial load: fetch settings + notes, open the most recently edited note.
  useEffect(() => {
    (async () => {
      try {
        const s = normalizeSettings((await NoteService.GetSettings()) as AppSettings);
        setSettings(s);
        applySettings(s);
      } catch (err) {
        console.error("GetSettings failed", err);
      }
      const list = await refreshNotes();
      // Dev convenience: ?view=graph opens straight into the graph tab.
      const wantGraph =
        (window as unknown as { __SHARKNOTE_VIEW__?: string })
          .__SHARKNOTE_VIEW__ === "graph";
      // A .md file may have been opened via the OS file association before
      // the UI was ready — the backend remembers it for us.
      let firstId: number | null = null;
      try {
        const pending = await NoteService.TakePendingOpenedNote();
        if (pending > 0) firstId = pending;
      } catch (err) {
        console.error("TakePendingOpenedNote failed", err);
      }
      if (firstId == null && !wantGraph && list.length > 0) firstId = list[0].id;
      if (wantGraph) {
        const key = nextTabKey();
        setTabs([{ key, kind: "graph", title: "Graph" }]);
        setActiveKey(key);
      } else if (firstId != null) {
        const key = nextTabKey();
        setTabs([{ key, kind: "note", noteId: firstId, title: tabTitle(list, firstId) }]);
        setActiveKey(key);
      }
      setLoaded(true);
    })();
  }, [refreshNotes]);

  // ---------- Tabs ---------------------------------------------------------

  /** Opens a note. "auto" reuses the active note tab if any (Obsidian
   *  default); "new" always opens a fresh tab (deduped against existing). */
  const openNote = useCallback(
    (noteId: number, mode: "auto" | "new" = "auto") => {
      const existing = tabs.find((t) => t.kind === "note" && t.noteId === noteId);
      if (existing) {
        setActiveKey(existing.key);
        return;
      }
      const title = notes.find((n) => n.id === noteId)?.title ?? "Untitled";
      if (mode === "auto") {
        const active = tabs.find((t) => t.key === activeKey);
        if (active && active.kind === "note") {
          // Replace the current note tab, keeping its position.
          setTabs((prev) =>
            prev.map((t) =>
              t.key === active.key ? { ...t, noteId, title, dirty: false } : t
            )
          );
          return;
        }
        // The active tab isn't a note (graph view, or nothing open): reuse
        // the most recent note tab instead of spawning a fresh one per
        // click, so browsing from the graph never litters the tab bar.
        const lastKey = lastNoteKeyRef.current;
        if (lastKey && tabs.some((t) => t.key === lastKey)) {
          setTabs((prev) =>
            prev.map((t) =>
              t.key === lastKey ? { ...t, noteId, title, dirty: false } : t
            )
          );
          setActiveKey(lastKey);
          return;
        }
      }
      const key = nextTabKey();
      setTabs((prev) => [...prev, { key, kind: "note", noteId, title }]);
      setActiveKey(key);
    },
    [tabs, notes, activeKey]
  );

  // A .md file was opened while the app was already running (either via
  // "Open with" or forwarded from a second instance). Open it in a new tab.
  useEffect(() => {
    return Events.On("sharknote:file-opened", (ev) => {
      const id = ev.data as number;
      if (typeof id === "number" && id > 0) {
        refreshNotes();
        openNote(id, "new");
      }
    });
  }, [refreshNotes, openNote]);

  const openGraph = useCallback(() => {
    const existing = tabs.find((t) => t.kind === "graph");
    if (existing) {
      setActiveKey(existing.key);
      return;
    }
    const key = nextTabKey();
    // Remember where the user came from so the graph's Back button can
    // return there (Obsidian-style).
    lastNoteKeyRef.current = activeKey;
    setTabs((prev) => [...prev, { key, kind: "graph", title: "Graph" }]);
    setActiveKey(key);
  }, [tabs, activeKey]);

  const closeTab = useCallback(
    (key: string) => {
      const idx = tabs.findIndex((t) => t.key === key);
      if (idx === -1) return;
      const next = tabs.filter((t) => t.key !== key);
      setTabs(next);
      if (activeKey === key) {
        // Activate the tab to the right, else the one to the left.
        const neighbor = next[Math.min(idx, next.length - 1)];
        setActiveKey(neighbor ? neighbor.key : null);
      }
    },
    [tabs, activeKey]
  );

  const handleSaved = useCallback((note: Note) => {
    setNotes((prev) => {
      const rest = prev.filter((n) => n.id !== note.id);
      const summary: NoteSummary = {
        id: note.id,
        title: note.title,
        excerpt: "",
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      };
      return [summary, ...rest];
    });
    setTabs((prev) =>
      prev.map((t) => (t.kind === "note" && t.noteId === note.id ? { ...t, title: note.title } : t))
    );
  }, []);

  const handleDirtyChange = useCallback((noteId: number, dirty: boolean) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.kind === "note" && t.noteId === noteId ? { ...t, dirty } : t
      )
    );
  }, []);

  // Names of note tabs follow the notes list. Without this, a tab opened
  // right after an import could keep a placeholder title (the callback that
  // opened it ran before the fresh list arrived), and imported or renamed
  // notes would show “Untitled” until the user happened to edit them.
  useEffect(() => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.kind !== "note") return t;
        const fresh = notes.find((n) => n.id === t.noteId);
        return fresh ? { ...t, title: fresh.title } : t;
      })
    );
  }, [notes]);

  const handleDeleted = useCallback(
    async (id: number) => {
      try {
        await NoteService.DeleteNote(id);
      } catch (err) {
        console.error("DeleteNote failed", err);
      }
      setDeleteTarget(null);
      const next = tabs.filter((t) => t.noteId !== id);
      setTabs(next);
      if (activeKey != null && !next.some((t) => t.key === activeKey)) {
        setActiveKey(next[0]?.key ?? null);
      }
      refreshNotes();
    },
    [refreshNotes, tabs, activeKey]
  );

  const requestDelete = useCallback(
    (id: number) => {
      if (!settings.confirmDelete) {
        void handleDeleted(id);
      } else {
        setDeleteTarget(id);
      }
    },
    [settings.confirmDelete, handleDeleted]
  );

  // Opens the native save dialog for a note and announces the written path,
  // so the user always sees exactly where their file landed.
  const handleSaveNoteAs = useCallback(async (noteId: number) => {
    try {
      const res = await NoteService.SaveNoteAs(noteId);
      if (res?.savedPath) {
        setSaveToast({ text: res.savedPath, key: Date.now(), kind: "saved" });
      }
    } catch (err) {
      console.error("SaveNoteAs failed", err);
    }
  }, []);

  // Shows a short info toast at the bottom of the window (copy feedback etc.).
  const showToast = useCallback((text: string) => {
    setSaveToast({ text, key: Date.now(), kind: "info" });
  }, []);

  // Duplicates a note: full content copy under a deduped “… copy” title,
  // opened in a fresh tab.
  const handleDuplicateNote = useCallback(
    async (noteId: number) => {
      try {
        const n = await NoteService.GetNote(noteId);
        if (!n) return;
        const taken = new Set(notes.map((x) => x.title.toLowerCase()));
        const base = `${n.title} copy`;
        let t = base;
        for (let i = 2; taken.has(t.toLowerCase()); i++) t = `${base} ${i}`;
        const created = await NoteService.CreateNote(t, n.content);
        if (created) {
          await refreshNotes();
          openNote(created.id, "new");
          showToast(`Duplicated as “${t}”`);
        }
      } catch (err) {
        console.error("Duplicate note failed", err);
      }
    },
    [notes, refreshNotes, openNote, showToast]
  );

  // ---------- Remote updates ----------------------------------------------

  // Check the update manifest shortly after launch. Everything is wrapped
  // in try/catch: in browser-mock/dev mode the service doesn't exist and a
  // failed check must never disturb the app.
  useEffect(() => {
    const t = window.setTimeout(async () => {
      try {
        const info = await UpdaterService.CheckForUpdate();
        if (info?.available) {
          updateStageRef.current = info.ready ? "ready" : "available";
          setUpdateState({
            stage: info.ready ? "ready" : "available",
            latest: info.latest,
            notes: info.notes,
            percent: info.ready ? 100 : 0,
          });
        }
      } catch {
        /* offline or manifest unavailable — stay silent */
      }
    }, 4000);
    return () => window.clearTimeout(t);
  }, []);

  // Download progress events drive the banner through downloading → ready.
  useEffect(() => {
    return Events.On("sharknote:update-progress", (ev) => {
      const p = ev.data as { stage: string; percent?: number } | number;
      if (!p || typeof p !== "object") return;
      if (p.stage === "downloading") {
        if (updateStageRef.current !== "downloading") {
          updateStageRef.current = "downloading";
          setUpdateState((s) => ({
            stage: "downloading",
            latest: s?.latest ?? "",
            notes: s?.notes,
            percent: p.percent ?? 0,
          }));
        } else {
          setUpdateState((s) => (s ? { ...s, percent: p.percent ?? s.percent } : s));
        }
      } else if (p.stage === "done") {
        updateStageRef.current = "ready";
        setUpdateState((s) => (s ? { ...s, stage: "ready", percent: 100 } : s));
      } else if (p.stage === "error") {
        updateStageRef.current = "error";
        setUpdateState((s) => (s ? { ...s, stage: "error" } : s));
      }
    });
  }, []);

  const startUpdateDownload = useCallback(async () => {
    updateStageRef.current = "downloading";
    setUpdateState((s) => (s ? { ...s, stage: "downloading", percent: 0 } : s));
    try {
      await UpdaterService.DownloadUpdate();
    } catch (err) {
      console.error("DownloadUpdate failed", err);
      updateStageRef.current = "error";
      setUpdateState((s) => (s ? { ...s, stage: "error" } : s));
    }
  }, []);

  const applyUpdate = useCallback(async () => {
    try {
      await UpdaterService.ApplyUpdate(); // quits the app on success
    } catch (err) {
      console.error("ApplyUpdate failed", err);
      updateStageRef.current = "error";
      setUpdateState((s) => (s ? { ...s, stage: "error" } : s));
    }
  }, []);

  // Manual check from Settings: returns a short human-readable result line.
  const checkForUpdateManual = useCallback(async (): Promise<string> => {
    try {
      const info = await UpdaterService.CheckForUpdate();
      if (!info) return "Could not reach the update server.";
      if (info.available) {
        const stage: UpdateState["stage"] = info.ready ? "ready" : "available";
        updateStageRef.current = stage;
        setUpdateState({
          stage,
          latest: info.latest,
          notes: info.notes,
          percent: info.ready ? 100 : 0,
        });
        return info.ready
          ? `Sharknote ${info.latest} is downloaded and ready to install.`
          : `Sharknote ${info.latest} is available.`;
      }
      return `You're up to date (version ${info.version}).`;
    } catch {
      return "Could not reach the update server.";
    }
  }, []);

  // Auto-hide the toast a few seconds after it appears.
  useEffect(() => {
    if (!saveToast) return;
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setSaveToast(null), 5200);
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, [saveToast]);
  const handleRenamed = useCallback(
    async (newTitle: string) => {
      const target = renameTarget;
      if (!target) return;
      setRenameTarget(null);
      const t = newTitle.trim();
      if (!t || t === target.title) return;
      try {
        const note = await NoteService.RenameNote(target.id, t);
        if (note) {
          handleSaved(note);
          await refreshNotes();
          setTitleReloadKey((k) => k + 1);
        }
      } catch (err) {
        console.error("RenameNote failed", err);
      }
    },
    [renameTarget, handleSaved, refreshNotes]
  );

  const deleteTargetTitle =
    deleteTarget != null
      ? notes.find((n) => n.id === deleteTarget)?.title ?? "this note"
      : "this note";

  const createNote = useCallback(
    async (title: string) => {
      let t = title.trim();
      if (!t) t = "Untitled";
      // Setting: titles look like markdown files — append .md unless the
      // user already typed it.
      if (settings.showMdExtension && !t.toLowerCase().endsWith(".md")) {
        t += ".md";
      }
      try {
        const note = await NoteService.CreateNote(t, "");
        if (!note) return;
        setPrefillTitle(null);
        await refreshNotes();
        openNote(note.id, "new");
      } catch (err) {
        console.error("CreateNote failed", err);
      }
    },
    [refreshNotes, openNote, settings.showMdExtension]
  );

  // Open today's daily note ("2026-02-08"), creating it if it doesn't exist.
  const openDailyNote = useCallback(async () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const existing = notes.find(
      (n) => n.title === base || n.title === `${base}.md`
    );
    if (existing) {
      openNote(existing.id, "new");
      return;
    }
    await createNote(base);
  }, [notes, openNote, createNote]);

  // New empty note in a fresh tab (the + button / Ctrl+T).
  const newNoteTab = useCallback(() => {
    setPrefillTitle("");
  }, []);

  // ---------- Settings -----------------------------------------------------

  const updateSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    applySettings(next);
    NoteService.UpdateSettings(next)
      .then((saved) => {
        if (saved) setSettings(normalizeSettings(saved as AppSettings));
      })
      .catch((err) => console.error("UpdateSettings failed", err));
  }, []);

  // ---------- File / folder opening ---------------------------------------

  // Native multi-select dialog for markdown files; each picked file is
  // imported and opened in its own tab.
  const openFilesDialog = useCallback(async () => {
    try {
      const ids = (await NoteService.OpenFiles()) ?? [];
      if (ids.length === 0) return; // cancelled
      await refreshNotes();
      ids.forEach((id) => openNote(id, "new"));
    } catch (err) {
      console.error("OpenFiles failed", err);
    }
  }, [refreshNotes, openNote]);

  // Folder-only picker (also used from Settings to choose the vault path):
  // imports every markdown file inside and remembers the folder as vault.
  const openFolderDialog = useCallback(async () => {
    try {
      const ids = (await NoteService.OpenFolderDialog()) ?? [];
      await refreshNotes();
      // Refresh vault path in settings (backend persisted it).
      try {
        const s = normalizeSettings((await NoteService.GetSettings()) as AppSettings);
        setSettings(s);
      } catch {
        /* ignore */
      }
      if (ids.length > 0) openNote(ids[0], "new");
    } catch (err) {
      console.error("OpenFolderDialog failed", err);
    }
  }, [refreshNotes, openNote]);

  // ---------- Keyboard shortcuts ------------------------------------------

  const skipShortcuts =
    paletteOpen ||
    settingsOpen ||
    deleteTarget != null ||
    renameTarget != null ||
    prefillTitle != null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        // Never stack the palette on top of another dialog.
        if (!prefillTitle && !settingsOpen) setPaletteOpen(true);
      } else if ((k === "n" || k === "t") && !paletteOpen && !settingsOpen) {
        e.preventDefault();
        setPrefillTitle("");
      } else if (k === "g" && !skipShortcuts) {
        e.preventDefault();
        openGraph();
      } else if (k === "w" && !skipShortcuts) {
        e.preventDefault();
        if (activeKey) closeTab(activeKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openGraph, closeTab, activeKey, skipShortcuts, prefillTitle, paletteOpen, settingsOpen]);

  // Zoom guard: the app UI must stay at 100% zoom. Only the graph view
  // zooms (its canvas handles the wheel event itself in JS, which is
  // unaffected by these preventDefaults — they only stop the webview's own
  // page-zoom). Blocks Ctrl/Cmd + +/-/0 and ctrl/meta + wheel, plus
  // WKWebView/Safari pinch gestures on macOS.
  useEffect(() => {
    const onZoomKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key;
      if (
        k === "+" ||
        k === "-" ||
        k === "=" ||
        k === "0" ||
        k === "Add" ||
        k === "Subtract" ||
        k === "NumpadAdd" ||
        k === "NumpadSubtract"
      ) {
        e.preventDefault();
      }
    };
    const onZoomWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const onPinch = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", onZoomKey, true);
    window.addEventListener("wheel", onZoomWheel, { capture: true, passive: false });
    window.addEventListener("gesturestart", onPinch, true);
    window.addEventListener("gesturechange", onPinch, true);
    return () => {
      window.removeEventListener("keydown", onZoomKey, true);
      window.removeEventListener("wheel", onZoomWheel, { capture: true });
      window.removeEventListener("gesturestart", onPinch, true);
      window.removeEventListener("gesturechange", onPinch, true);
    };
  }, []);

  const activeTab = tabs.find((t) => t.key === activeKey) ?? null;
  const view: View = activeTab?.kind === "graph" ? "graph" : "notes";

  return (
    <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
      <Sidebar
        notes={notes}
        activeId={activeTab?.kind === "note" ? activeTab.noteId ?? null : null}
        query={sidebarQuery}
        onQueryChange={setSidebarQuery}
        onOpenNote={(id, newTab) => openNote(id, newTab ? "new" : "auto")}
        onNewNote={() => setPrefillTitle("")}
        onOpenGraph={openGraph}
        onDeleteNote={requestDelete}
        onOpenFiles={openFilesDialog}
        onOpenFolder={openFolderDialog}
        onOpenSettings={() => setSettingsOpen(true)}
        onRequestRename={(id, currentTitle) => setRenameTarget({ id, title: currentTitle })}
        vaultPath={settings.vaultPath}
        view={view}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <TabsBar
          tabs={tabs}
          activeKey={activeKey}
          onActivate={setActiveKey}
          onClose={closeTab}
          onNewTab={newNoteTab}
        />

        {activeTab?.kind === "graph" ? (
          <GraphView
            activeId={lastNoteId}
            onOpenNote={(id) => openNote(id, "auto")}
            onBack={() => {
              // Return to the tab the user came from, else fall back to the
              // first note tab / closing the graph tab.
              const prev = lastNoteKeyRef.current;
              const target = prev && tabs.some((t) => t.key === prev)
                ? prev
                : (tabs.find((t) => t.kind === "note")?.key ?? null);
              if (target) setActiveKey(target);
              else if (activeTab) closeTab(activeTab.key);
            }}
            theme={settings.theme}
            graphTheme={settings.graphTheme}
          />
        ) : activeTab?.kind === "note" && activeTab.noteId != null && loaded ? (
          <EditorView
            key={`${activeTab.key}:${activeTab.noteId}`}
            noteId={activeTab.noteId}
            notes={notes}
            onSaved={handleSaved}
            onRequestDelete={requestDelete}
            onOpenNote={(id) => openNote(id, "auto")}
            onCreateNote={(title) => setPrefillTitle(title)}
            onRequestRename={(currentTitle) => {
              const id = activeTab?.kind === "note" ? activeTab.noteId : null;
              if (id != null) setRenameTarget({ id, title: currentTitle });
            }}
            onSaveNoteAs={handleSaveNoteAs}
            onDuplicateNote={handleDuplicateNote}
            onToast={showToast}
            titleReloadKey={titleReloadKey}
            defaultView={settings.defaultView}
            autosaveDelay={settings.autosaveDelay}
            onDirtyChange={handleDirtyChange}
          />
        ) : (
          <EmptyState
            loaded={loaded}
            onCreate={() => setPrefillTitle("")}
            onOpenGraph={openGraph}
            onOpenFiles={openFilesDialog}
            onOpenFolder={openFolderDialog}
          />
        )}
      </main>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        notes={notes}
        activeId={activeTab?.kind === "note" ? activeTab.noteId ?? null : null}
        onOpenNote={(id) => {
          setPaletteOpen(false);
          openNote(id, "auto");
        }}
        onDeleteNote={requestDelete}
        onCreateNote={(title) => {
          setPaletteOpen(false);
          createNote(title);
        }}
        onOpenGraph={() => {
          setPaletteOpen(false);
          openGraph();
        }}
        onOpenFiles={() => {
          setPaletteOpen(false);
          void openFilesDialog();
        }}
        onOpenFolder={() => {
          setPaletteOpen(false);
          void openFolderDialog();
        }}
        onSaveNoteAs={(id) => {
          setPaletteOpen(false);
          void handleSaveNoteAs(id);
        }}
        onOpenDailyNote={() => {
          setPaletteOpen(false);
          void openDailyNote();
        }}
        onOpenSettings={() => {
          setPaletteOpen(false);
          setSettingsOpen(true);
        }}
      />

      <NewTabDialog
        prefill={prefillTitle}
        notes={notes}
        onClose={() => setPrefillTitle(null)}
        onCreate={createNote}
        onOpenNote={(id) => {
          setPrefillTitle(null);
          openNote(id, "new");
        }}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onChange={updateSettings}
        onOpenFolder={openFolderDialog}
        onCheckForUpdate={checkForUpdateManual}
      />

      {/* ---------- Rename note (global) ---------- */}
      <RenameNoteDialog
        open={renameTarget != null}
        initialTitle={renameTarget?.title ?? ""}
        onClose={() => setRenameTarget(null)}
        onRename={handleRenamed}
      />

      {/* ---------- Remote update pill ---------- */}
      <UpdateBanner
        state={updateState}
        onDownload={() => void startUpdateDownload()}
        onReload={() => void applyUpdate()}
        onDismiss={() => {
          updateStageRef.current = null;
          setUpdateState(null);
        }}
      />

      {/* ---------- “Saved to …” toast ---------- */}
      {saveToast && (
        <div
          key={saveToast.key}
          className="fixed bottom-5 left-1/2 z-[100] flex max-w-[min(90vw,44rem)] -translate-x-1/2 items-center gap-2 border border-border bg-background/95 px-4 py-2.5 text-[13px] text-foreground shadow-lg"
        >
          <Check className="size-3.5 shrink-0 text-(--link-strong)" />
          {saveToast.kind === "info" ? (
            <span className="min-w-0 truncate">{saveToast.text}</span>
          ) : (
            <span className="min-w-0 truncate">
              <span className="text-muted-foreground">Saved to </span>
              <code className="rounded-sm bg-muted px-1.5 py-0.5 text-[12px]">
                {saveToast.text}
              </code>
            </span>
          )}
        </div>
      )}

      {/* ---------- Delete confirmation (global) ---------- */}
      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTargetTitle}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This note and all links to it will be permanently removed. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleteTarget != null && handleDeleted(deleteTarget)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Resolves a note's title for the initial tab. */
function tabTitle(list: NoteSummary[], id: number): string {
  return list.find((n) => n.id === id)?.title ?? "Untitled";
}

function EmptyState({
  loaded,
  onCreate,
  onOpenGraph,
  onOpenFiles,
  onOpenFolder,
}: {
  loaded: boolean;
  onCreate: () => void;
  onOpenGraph: () => void;
  onOpenFiles: () => void;
  onOpenFolder: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-8">
      <div className="animate-fade-up flex flex-col items-center gap-5 text-center">
        <Logo size={72} />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {loaded ? "All quiet in the deep" : "Loading your vault…"}
          </h1>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            {loaded
              ? "Create a note to start weaving your knowledge graph. Every [[wiki link]] becomes a connection — or open a folder of markdown files to make them yours."
              : "Opening the vault."}
          </p>
        </div>
        {loaded && (
          <>
            <div className="flex items-center gap-3">
              <button
                onClick={onCreate}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[0_0_24px_-6px] shadow-primary/50 transition hover:bg-primary/90"
              >
                New note
              </button>
              <button
                onClick={onOpenFiles}
                title="Open .md files (multi-select)"
                className="rounded-lg border border-border bg-secondary/50 px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-secondary"
              >
                Open files…
              </button>
              <button
                onClick={onOpenFolder}
                title="Open a whole folder as your vault"
                className="rounded-lg border border-border bg-secondary/50 px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-secondary"
              >
                Open folder…
              </button>
              <button
                onClick={onOpenGraph}
                className="rounded-lg border border-border bg-secondary/50 px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-secondary"
              >
                Explore graph
              </button>
            </div>
            <div className="flex items-center gap-5 text-[11px] text-muted-foreground/80">
              <span>
                <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-sans text-[10px]">Ctrl</kbd>
                {" "}+{" "}
                <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-sans text-[10px]">K</kbd>{" "}
                command palette
              </span>
              <span>
                <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-sans text-[10px]">Ctrl</kbd>
                {" "}+{" "}
                <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-sans text-[10px]">G</kbd>{" "}
                knowledge graph
              </span>
              <span>
                <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px]">[[</kbd>{" "}
                link notes
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <div
      className={cn(
        "relative grid shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-700",
        "shadow-[0_4px_20px_-4px] shadow-violet-500/50"
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={size * 0.58}
        height={size * 0.58}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <path
          d="M12 2C7 6 4 10 4 14a8 8 0 0 0 16 0c0-4-3-8-8-12Z"
          fill="white"
          opacity="0.95"
        />
        <path
          d="M12 2C14.5 5.5 16 9 16 12.5A4 4 0 0 1 8 12.5C8 9 9.5 5.5 12 2Z"
          fill="url(#sharkGrad)"
        />
        <path d="M9 14.5c1.5-1.2 3-1.2 4.5 0" stroke="#0b0b10" strokeWidth="1.1" strokeLinecap="round" />
        <defs>
          <linearGradient id="sharkGrad" x1="8" y1="2" x2="16" y2="16">
            <stop stopColor="#a78bfa" />
            <stop offset="1" stopColor="#7c3aed" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
