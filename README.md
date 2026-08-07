🦈 Sharknote

A beautiful desktop notes app with Obsidian-style knowledge graphs and bidirectional links. Built with Wails v3, Go, React and SQLite, styled with shadcn/ui in a dark violet theme.

![stack](https://img.shields.io/badge/Wails-v3-DF4A2F) ![stack](https://img.shields.io/badge/Go-1.25-00ADD8) ![stack](https://img.shields.io/badge/React-18-61DAFB) ![stack](https://img.shields.io/badge/SQLite-modernc-003B57)

FEATURES

- Tabs, Obsidian-style: open multiple notes side by side in a tab bar. Switch with a click, close with the × button, middle click, or Ctrl+W. The knowledge graph lives in its own tab too. Ctrl or middle-click a note in the sidebar to open it in a new tab, or use the + button (Ctrl+T). Unsaved changes show as a dot on the tab.
- Open markdown files and folders: Open file imports any .md file (multi-select supported) and Open folder imports a whole vault of markdown recursively, skipping hidden folders like .git and .obsidian. The opened folder is remembered as your vault. Files opened from Windows (Open with, double-click) land in a new tab too.
- Notes with autosave: rich text editor with a serif typeface. Toggle live preview (Ctrl+E). The status bar shows save state and word count.
- Bidirectional [[wiki links]]: type [[ for inline autocomplete. Links resolve both ways: every note shows its outgoing links and backlinks with context snippets. Unresolved links stay alive and auto-resolve the moment you create the target note.
- Knowledge graph view (Ctrl+G): a force-directed canvas map of your vault (d3-force). Drag nodes, scroll to zoom, hover to highlight connections, click to open. Node size equals connectivity.
- Command palette (Ctrl+K): search notes, create notes, open files and folders, jump to the graph or settings.
- Settings (gear in the sidebar, or Ctrl+K then Settings): everything is customizable and applies live. Dark or light theme, accent color (violet, sky, emerald, amber, rose), graph theme (crimson, violet, ocean, forest, amber), editor font and font size, default preview or edit mode, autosave delay, and delete confirmation. All persisted in the database.
- Opens .md files from Windows: registered as a handler for markdown files (runtime self-registration plus installer registration). Double-click or Open with any .md file and it is imported as a note. Re-opening the same file updates it instead of duplicating. YAML frontmatter is honored: a title field names the note, and tags or aliases render as a metadata card at the top of the note.
- Full-text search: notes are indexed with SQLite FTS5 (kept in sync automatically), so searches are fast and ranked by relevance.
- Syntax-highlighted code: fenced code blocks in python, js, ts, go, rust, sql and 50+ more languages are detected (aliases like py, c++, sh included) and colored like a code editor. In preview mode every block gets its own header bar with the language name and a copy button. Mixed-language files get per-block treatment.
- Seeded vault: first launch ships with 7 linked intro notes so the graph and backlinks are immediately visible.

KEYBOARD SHORTCUTS

| Shortcut       | Action                      |
| -------------- | --------------------------- |
| `Ctrl+K`       | Command palette             |
| `Ctrl+N`       | New note                    |
| `Ctrl+T`       | New note tab                |
| `Ctrl+W`       | Close current tab           |
| `Ctrl+G`       | Open knowledge graph tab    |
| `Ctrl+E`       | Toggle edit / preview       |

TECH STACK

| Layer    | Choice                          |
| -------- | ------------------------------- |
| Shell    | Wails v3 (WebView2, no cgo)     |
| Backend  | Go + `modernc.org/sqlite`       |
| UI       | React 18 + TypeScript + Vite    |
| Styling  | Tailwind CSS v4 + shadcn/ui     |
| Graph    | d3-force on `<canvas>`          |
| Markdown | legacy import via marked + DOMPurify; notes are stored as rich text |

Notes are stored in a SQLite database at `%APPDATA%/sharknote/sharknote.db` (override with the `SHARKNOTE_DB` env var).

DEVELOPMENT

One-time setup:

```
go mod tidy
cd frontend && npm install
```

Run with hot reload (Go + Vite):

```
wails3 dev
```

Production build to `bin/sharknote.exe`:

```
wails3 task windows:build
```

BUILDING THE WINDOWS INSTALLER

Requires NSIS (install with `winget install NSIS.NSIS`). The installer registers Sharknote as a handler for .md files and cleans up on uninstall.

Per-user install (no admin prompt) to `bin/sharknote-amd64-installer.exe`:

```
wails3 task windows:package INSTALL_SCOPE=user
```

Machine-wide install (admin) to `bin/sharknote-amd64-installer.exe`:

```
wails3 task windows:package INSTALL_SCOPE=machine
```

SIGNING (WINDOWS TRUST)

Both the .exe and the installer are signed with the Sharknote code-signing
certificate (`$HOME/sharknote-signing/sharknote-code-signing.pfx`)
using `scripts/sign-windows.sh`, which requires `osslsigncode` in
`build/tools/bin/`:

```
bash scripts/sign-windows.sh
```

Note: a self-signed signature shows a publisher name and survives AV scrutiny,
but Windows SmartScreen / browser download warnings only fully disappear once
the app builds reputation or the files are signed with a certificate from a
public CA (DigiCert, Sectigo, Azure Trusted Signing). The website explains
how to run the app past the warning.

RELEASING TO THE WEBSITE

```
# 1. bump the version in build/windows/info.json, build/windows/nsis/project.nsi
#    and website/src/App.jsx, then build + sign (above)
# 2. update INSTALLER_SHA256 in website/src/App.jsx:
sha256sum bin/sharknote-amd64-installer.exe
# 3. build the site and deploy to Cloudflare Pages:
cd website && npm run deploy
```

UI-ONLY DEVELOPMENT (NO GO BACKEND)

The UI can run in a plain browser against an in-memory mock of the backend:

```
cd frontend
npm run dev
```

Open these URLs:

- http://127.0.0.1:9245/?mock=1 for the notes view
- http://127.0.0.1:9245/?mock=1&view=graph for the graph view

The mock (`frontend/src/mock.ts`) is compiled out of production builds.

PROJECT LAYOUT

```
main.go             app entry, window, service registration
noteservice.go      NoteService to frontend bindings (notes, files, settings)
store.go            SQLite store: notes, graph, backlinks, search
settings.go         user settings: defaults, validation, persistence
links.go            wiki link parsing and resolution
frontend/
  bindings/         generated TS bindings (wails3 generate bindings)
  src/
    components/     Sidebar, TabsBar, EditorView, GraphView, SettingsDialog, and more
    lib/            markdown renderer, settings, graph themes, time utils
    mock.ts         dev-only in-memory backend
```

TESTS

```
go test .   (store: CRUD, link resolution, pending-link fixup, graph, seed)
```