/**
 * DEV-ONLY in-browser mock of the Wails RPC transport.
 *
 * Activated only when the app is served by the Vite dev server AND the URL
 * contains `?mock=1` (see main.tsx). Lets the UI run in a plain browser
 * without the Go backend, which is useful for UI development and headless
 * rendering checks. Never ships into the production bundle in a runnable form
 * (guarded by import.meta.env.DEV).
 */
import { setTransport } from "@wailsio/runtime";

// Method IDs generated from noteservice.go (see frontend/bindings).
const M = {
  CreateNote: 3901296041,
  DeleteNote: 3639942098,
  GetBacklinks: 3613702605,
  GetGraph: 3565607809,
  GetNote: 1276837971,
  GetOutgoingLinks: 3162422950,
  GetSettings: 2084625886,
  ImportFiles: 3930147207,
  ImportFolder: 2785704156,
  ListNotes: 27288930,
  OpenFiles: 1051351432,
  OpenFolderDialog: 2671632665,
  RenameNote: 2999546831,
  SearchNotes: 3427037650,
  TakePendingOpenedNote: 550119356,
  UpdateNote: 163960476,
  UpdateSettings: 1016301389,
};

interface MockNote {
  id: number;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

const now = () => new Date().toISOString();

const seed: MockNote[] = [
  {
    id: 1,
    title: "Welcome to Sharknote",
    content:
      "<h1>Welcome to Sharknote 🦈</h1><p>This is your new networked note-taking space. Notes live here like thoughts — connected, not filed.</p><h2>Try it right now</h2><ul><li>Type [[ anywhere in a note to link to another note — try linking to [[Graph view]].</li><li>Click a link in the preview to jump between notes.</li><li>Open the graph view (shortcut Ctrl+G) to see how your notes form a knowledge map.</li></ul><p>Related: [[Bidirectional links]], [[Idea vault]]</p>",
    createdAt: "2026-08-01T09:00:00Z",
    updatedAt: now(),
  },
  {
    id: 2,
    title: "Bidirectional links",
    content:
      "<h1>Bidirectional links</h1><p>When note A links to note B with [[B]], note B shows A in its backlinks panel.</p><p>Related: [[Zettelkasten method]], [[Graph view]]</p>",
    createdAt: "2026-08-01T09:05:00Z",
    updatedAt: now(),
  },
  {
    id: 3,
    title: "Graph view",
    content:
      "<h1>Graph view</h1><ul><li>Each node is a note</li><li>Each edge is a [[wiki link]]</li><li>Drag, zoom, click to open</li></ul><p>Related: [[Bidirectional links]], [[Rich text]]</p>",
    createdAt: "2026-08-01T09:10:00Z",
    updatedAt: now(),
  },
  {
    id: 4,
    title: "Rich text",
    content:
      "<h1>Rich text</h1><p>Select text, then right-click to change its color, font (try Times New Roman) or size. Use the alignment options to move a paragraph left, center or right.</p><p>Related: [[Welcome to Sharknote]], [[Idea vault]]</p>",
    createdAt: "2026-08-01T09:15:00Z",
    updatedAt: now(),
  },
  {
    id: 5,
    title: "Idea vault",
    content:
      "<h1>Idea vault</h1><p>A place for half-formed thoughts.</p><p>[[Zettelkasten method]] is a great place to start.</p>",
    createdAt: "2026-08-01T09:20:00Z",
    updatedAt: "2026-08-02T10:00:00Z",
  },
  {
    id: 6,
    title: "Zettelkasten method",
    content:
      "<h1>Zettelkasten method</h1><ol><li>One idea per note.</li><li>Link every note.</li><li>Follow links.</li></ol><p>See also: [[Idea vault]], [[Bidirectional links]]</p>",
    createdAt: "2026-08-01T09:25:00Z",
    updatedAt: "2026-08-02T11:00:00Z",
  },
  {
    id: 7,
    title: "Reading list",
    content:
      "<h1>Reading list</h1><ul><li>How to Take Smart Notes — Sönke Ahrens</li><li>The Extended Mind — Annie Murphy Paul</li></ul><p>Collect ideas into the [[Idea vault]].</p>",
    createdAt: "2026-08-01T09:30:00Z",
    updatedAt: "2026-08-03T08:00:00Z",
  },
];

const WIKI_RE = /\[\[([^\[\]]+)\]\]/g;

function targets(content: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  WIKI_RE.lastIndex = 0;
  while ((m = WIKI_RE.exec(content)) !== null) {
    const t = m[1].split("|")[0].split("#")[0].trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

function excerpt(content: string): string {
  const plain = content
    .replace(/<[^>]*>/g, " ")
    .replace(WIKI_RE, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 140 ? plain.slice(0, 140) + "…" : plain;
}

function byTitle(title: string): MockNote | undefined {
  return seed.find(
    (n) => n.title.toLowerCase() === title.toLowerCase()
  );
}

let nextId = 100;

// In-browser stand-in for the persisted settings (defaults).
let mockSettings: Record<string, unknown> = {
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

export function installMock() {
  setTransport({
    call: async (
      _objectID: number,
      _method: any,
      _windowName: string,
      descriptor: any
    ) => {
      // The runtime passes the method descriptor ({call-id, methodID, args})
      // in the args position; `method` carries the object ID.
      const methodID: number = descriptor?.methodID ?? 0;
      const [a1, a2] = (descriptor?.args ?? []) as any[];
      await new Promise((r) => setTimeout(r, 60)); // simulate latency

      switch (methodID) {
        case M.ListNotes:
          return seed.map((n) => ({
            id: n.id,
            title: n.title,
            excerpt: excerpt(n.content),
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
          }));
        case M.GetNote:
          return seed.find((n) => n.id === a1) ?? null;
        case M.CreateNote:
        case M.UpdateNote: {
          const title = String(a1).trim() || "Untitled";
          const content = String(a2 ?? "");
          let note: MockNote;
          if (methodID === M.CreateNote) {
            note = {
              id: nextId++,
              title,
              content,
              createdAt: now(),
              updatedAt: now(),
            };
            seed.push(note);
          } else {
            note = seed.find((n) => n.id === a1)!;
            note.title = title;
            note.content = content;
            note.updatedAt = now();
          }
          return { ...note };
        }
        case M.DeleteNote: {
          const i = seed.findIndex((n) => n.id === a1);
          if (i >= 0) seed.splice(i, 1);
          return null;
        }
        case M.RenameNote: {
          const id = Number(a1);
          const newTitle = String(a2 ?? "").trim();
          const note = seed.find((n) => n.id === id);
          if (!note || !newTitle) return null;
          const oldTitle = note.title;
          if (oldTitle !== newTitle) {
            note.title = newTitle;
            note.updatedAt = now();
            // Rewrite [[old title]] links in the other notes, mirroring the
            // backend's RenameNote behaviour.
            const re = new RegExp(
              "\\[\\[\\s*(" +
                oldTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                ")(\\||#|\\s*\\]\\])",
              "gi"
            );
            for (const other of seed) {
              if (other.id === id) continue;
              other.content = other.content.replace(re, (m, _t, rest) => {
                return (rest === "]]" ? "[[" + newTitle + "]]" : "[[" + newTitle + " " + rest.trim() + "]]").replace("  ", " ");
              });
            }
          }
          return { ...note };
        }
        case M.GetSettings:
          return { ...mockSettings };
        case M.UpdateSettings: {
          Object.assign(mockSettings, a1 ?? {});
          return { ...mockSettings };
        }
        case M.TakePendingOpenedNote:
          return 0;
        // File dialogs / imports need a real file system — no-ops in the browser.
        case M.OpenFiles:
        case M.OpenFolderDialog:
        case M.ImportFolder:
        case M.ImportFiles:
          return [];
        case M.SearchNotes: {
          const q = String(a1 ?? "").toLowerCase();
          return seed
            .filter(
              (n) =>
                n.title.toLowerCase().includes(q) ||
                n.content.toLowerCase().includes(q)
            )
            .map((n) => ({
              id: n.id,
              title: n.title,
              excerpt: excerpt(n.content),
              createdAt: n.createdAt,
              updatedAt: n.updatedAt,
            }));
        }
        case M.GetGraph: {
          const nodes = seed.map((n) => ({
            id: n.id,
            title: n.title,
            linkCount: targets(n.content).length,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
          }));
          const edges: { source: number; target: number }[] = [];
          const seen = new Set<string>();
          for (const n of seed) {
            for (const t of targets(n.content)) {
              const other = byTitle(t);
              if (!other || other.id === n.id) continue;
              const key =
                n.id < other.id ? `${n.id}:${other.id}` : `${other.id}:${n.id}`;
              if (seen.has(key)) continue;
              seen.add(key);
              edges.push({ source: n.id, target: other.id });
            }
          }
          return { nodes, edges };
        }
        case M.GetOutgoingLinks: {
          const note = seed.find((n) => n.id === a1);
          if (!note) return [];
          return targets(note.content).map((t) => {
            const other = byTitle(t);
            return {
              targetId: other?.id ?? 0,
              targetTitle: other?.title ?? t,
              resolved: !!other,
            };
          });
        }
        case M.GetBacklinks: {
          const note = seed.find((n) => n.id === a1);
          if (!note) return [];
          return seed
            .filter(
              (n) =>
                n.id !== note.id &&
                targets(n.content).some(
                  (t) => t.toLowerCase() === note.title.toLowerCase()
                )
            )
            .map((n) => ({
              id: n.id,
              title: n.title,
              excerpt: excerpt(n.content).slice(0, 120),
            }));
        }
        default:
          throw new Error(`Mock transport: unknown method ${methodID}`);
      }
    },
  });
}
