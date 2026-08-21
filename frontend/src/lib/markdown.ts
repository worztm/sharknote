import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import markedKatex from "marked-katex-extension";
import hljs from "highlight.js/lib/core";
import DOMPurify from "dompurify";

// --- Syntax highlighting ---------------------------------------------------
// Register a curated set of languages so every fenced code block in a note is
// detected and colored like a text editor. The core build of highlight.js is
// tiny; each language adds a few KB on top.

import python from "highlight.js/lib/languages/python";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import bash from "highlight.js/lib/languages/bash";
import powershell from "highlight.js/lib/languages/powershell";
import ruby from "highlight.js/lib/languages/ruby";
import perl from "highlight.js/lib/languages/perl";
import lua from "highlight.js/lib/languages/lua";
import php from "highlight.js/lib/languages/php";
import r from "highlight.js/lib/languages/r";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import java from "highlight.js/lib/languages/java";
import kotlin from "highlight.js/lib/languages/kotlin";
import swift from "highlight.js/lib/languages/swift";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import dart from "highlight.js/lib/languages/dart";
import scala from "highlight.js/lib/languages/scala";
import objectivec from "highlight.js/lib/languages/objectivec";
import ada from "highlight.js/lib/languages/ada";
import fortran from "highlight.js/lib/languages/fortran";
import d from "highlight.js/lib/languages/d";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import less from "highlight.js/lib/languages/less";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import http from "highlight.js/lib/languages/http";
import sql from "highlight.js/lib/languages/sql";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import makefile from "highlight.js/lib/languages/makefile";
import nginx from "highlight.js/lib/languages/nginx";
import apache from "highlight.js/lib/languages/apache";
import protobuf from "highlight.js/lib/languages/protobuf";
import diff from "highlight.js/lib/languages/diff";
import plaintext from "highlight.js/lib/languages/plaintext";
import latex from "highlight.js/lib/languages/latex";
import vbnet from "highlight.js/lib/languages/vbnet";
import groovy from "highlight.js/lib/languages/groovy";
import haskell from "highlight.js/lib/languages/haskell";
import elixir from "highlight.js/lib/languages/elixir";
import erlang from "highlight.js/lib/languages/erlang";
import clojure from "highlight.js/lib/languages/clojure";
import matlab from "highlight.js/lib/languages/matlab";
import julia from "highlight.js/lib/languages/julia";

const languages: Record<string, unknown> = {
  python,
  javascript,
  typescript,
  bash,
  powershell,
  ruby,
  perl,
  lua,
  php,
  r,
  c,
  cpp,
  csharp,
  java,
  kotlin,
  swift,
  go,
  rust,
  dart,
  scala,
  objectivec,
  ada,
  fortran,
  d,
  xml,
  css,
  scss,
  less,
  json,
  yaml,
  markdown,
  http,
  sql,
  graphql,
  ini,
  dockerfile,
  makefile,
  nginx,
  apache,
  protobuf,
  diff,
  plaintext,
  latex,
  vbnet,
  groovy,
  haskell,
  elixir,
  erlang,
  clojure,
  matlab,
  julia,
};
for (const [name, lang] of Object.entries(languages)) {
  hljs.registerLanguage(name, lang as any);
}

/** Common fence aliases → registered highlight.js names. */
const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  jsx: "javascript",
  py: "python",
  py3: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  rb: "ruby",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  md: "markdown",
  mdx: "markdown",
  yml: "yaml",
  ps1: "powershell",
  rs: "rust",
  kt: "kotlin",
  kts: "kotlin",
  html: "xml",
  htm: "xml",
  xhtml: "xml",
  vue: "xml",
  svg: "xml",
  json5: "json",
  jsonc: "json",
  gradle: "groovy",
  conf: "ini",
  cfg: "ini",
  txt: "plaintext",
  text: "plaintext",
  plain: "plaintext",
  docker: "dockerfile",
  dockerfile: "dockerfile",
  toml: "ini",
  makefile: "makefile",
  mk: "makefile",
};

/** Maps a fence/class language name to a registered hljs language. */
function resolveLang(lang: string | null | undefined): string | null {
  if (!lang) return null;
  const name = lang.trim().split(/[\s.]+/)[0].toLowerCase();
  if (!name) return null;
  if (name === "mermaid") return "mermaid";
  // Canonical aliases first (js → javascript, py → python, …) so fences and
  // labels read nicely; then let hljs resolve its own aliases (c++ → cpp…).
  const canonical = LANG_ALIASES[name];
  if (canonical && hljs.getLanguage(canonical)) return canonical;
  if (hljs.getLanguage(name)) return name;
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

marked.setOptions({
  gfm: true,
  breaks: true,
});

// --- Obsidian-style extensions ---------------------------------------------

// ==inline highlight== → <mark>…</mark>
marked.use({
  extensions: [
    {
      name: "inlineMark",
      level: "inline",
      start(src: string) {
        return src.indexOf("==");
      },
      tokenizer(src: string) {
        const m = /^==(?![=\s])([\s\S]+?)==/.exec(src);
        if (m) {
          return {
            type: "inlineMark",
            raw: m[0],
            tokens: this.lexer.inlineTokens(m[1]),
          } as never;
        }
        return undefined as never;
      },
      renderer(token) {
        const inner = this.parser.parseInline(token.tokens ?? []);
        return `<mark>${inner}</mark>`;
      },
    },
  ],
  // Task list checkboxes stay interactive (no `disabled` attribute) so the
  // editor and preview can toggle them.
  renderer: {
    checkbox(token: { checked?: boolean }) {
      return `<input type="checkbox" class="task-checkbox"${token.checked ? " checked" : ""}>`;
    },
  },
});

// $inline math$ and $$display math$$ via KaTeX (HTML output only — MathML
// would be stripped by the sanitizer).
marked.use(markedKatex({ throwOnError: false, output: "html" }));

// Fenced code blocks are highlighted as the editor tokenizes them: the hljs
// spans live in the note's rich text, so colors persist in edit mode too.
marked.use(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code: string, lang: string) {
      const name = resolveLang(lang);
      try {
        if (name) return hljs.highlight(code, { language: name }).value;
        return hljs.highlightAuto(code).value;
      } catch {
        return escapeHtml(code);
      }
    },
  })
);

export interface WikiLinkToken {
  target: string; // note title the link resolves to
  alias: string; // display text
  raw: string; // full inner text of the [[...]]
}

const WIKI_LINK_RE = /\[\[([^\[\]]+)\]\]/g;

/** Extracts all wiki-link tokens from raw note content. */
export function extractWikiLinks(content: string): WikiLinkToken[] {
  const out: WikiLinkToken[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  WIKI_LINK_RE.lastIndex = 0;
  while ((m = WIKI_LINK_RE.exec(content)) !== null) {
    const inner = m[1].trim();
    let [target, alias] = inner.split("|");
    target = (target || "").trim();
    alias = (alias || target).trim();
    const key = target.toLowerCase();
    if (!target || seen.has(key)) continue;
    seen.add(key);
    out.push({ target, alias, raw: inner });
  }
  return out;
}

/**
 * True when the stored content is already rich text (HTML) rather than
 * legacy markdown / plain text. Used to migrate old notes on open.
 */
export function looksLikeHtml(content: string): boolean {
  return /<[a-z][^>]*>/i.test(content);
}

// --- Frontmatter -----------------------------------------------------------
// A YAML metadata block at the very top of a markdown file (--- delimited).
// When present it becomes a non-editable metadata card inside the editor.

const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const FM_KEY_RE = /^([A-Za-z0-9_-]+):\s*(.*)$/;
const FM_ITEM_RE = /^\s*-\s+(.+?)\s*$/;

interface Frontmatter {
  title: string;
  tags: string[];
  aliases: string[];
}

/** Extracts the leading frontmatter block, returning it and the rest. */
export function extractFrontmatter(
  source: string
): { fm: Frontmatter | null; body: string } {
  const m = FM_RE.exec(source);
  if (!m) return { fm: null, body: source };
  const fm: Frontmatter = { title: "", tags: [], aliases: [] };
  const lines = m[1].split("\n");
  let list: string[] | null = null;
  for (const line of lines) {
    const item = FM_ITEM_RE.exec(line);
    if (item && list) {
      list.push(unquote(item[1]));
      continue;
    }
    list = null;
    const kv = FM_KEY_RE.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const val = kv[2].trim();
    if (key === "title") {
      fm.title = unquote(val);
    } else if (key === "tags") {
      if (val !== "") fm.tags.push(...splitList(val));
      else list = fm.tags;
    } else if (key === "aliases") {
      if (val !== "") fm.aliases.push(...splitList(val));
      else list = fm.aliases;
    }
  }
  return { fm, body: source.slice(m[0].length) };
}

function unquote(s: string): string {
  s = s.trim();
  if (s.length >= 2) {
    if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function splitList(s: string): string[] {
  s = s.trim();
  if (s.startsWith("[")) s = s.slice(1);
  if (s.endsWith("]")) s = s.slice(0, -1);
  return s
    .split(",")
    .map((p) => unquote(p))
    .filter(Boolean);
}

/** Renders the frontmatter block as a subtle metadata card. */
function frontmatterCardHtml(fm: Frontmatter): string {
  const chips = [...fm.tags, ...fm.aliases]
    .map((c) => `<span class="fm-chip">${escapeHtml(c)}</span>`)
    .join("");
  const title = fm.title
    ? `<div class="fm-card-title">${escapeHtml(fm.title)}</div>`
    : `<div class="fm-card-title fm-card-title-empty">Note properties</div>`;
  return `<div class="fm-card" contenteditable="false">${title}${
    chips ? `<div class="fm-card-chips">${chips}</div>` : ""
  }</div>`;
}

/**
 * Converts legacy markdown notes into editor HTML. Wiki links stay as literal
 * [[...]] text — the preview renderer turns them into clickable pills.
 * Code fences are syntax-highlighted; a frontmatter block (if any) becomes a
 * metadata card at the top; Obsidian callouts become styled blocks.
 */
export function markdownToEditorHtml(source: string): string {
  const { fm, body } = extractFrontmatter(source);
  const html = marked.parse(body) as string;
  const processed = enhanceCallouts(html);
  return fm ? frontmatterCardHtml(fm) + processed : processed;
}

// --- Callouts (> [!tip] Title) ----------------------------------------------

const CALLOUT_ICON_SVGS: Record<string, string> = {
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  check: '<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  list: '<path d="M16 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="M19 10v4"/><path d="M21 12h-4"/>',
  quote:
    '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
};

/** Obsidian callout type → [icon key, css modifier] (defaults to note). */
const CALLOUT_TYPES: Record<string, [string, string]> = {
  note: ["pencil", "note"],
  abstract: ["list", "abstract"], summary: ["list", "abstract"], tldr: ["list", "abstract"],
  info: ["info", "info"],
  todo: ["check", "todo"],
  tip: ["flame", "tip"], hint: ["flame", "tip"], important: ["flame", "tip"],
  success: ["check", "success"], done: ["check", "success"],
  question: ["help", "question"], help: ["help", "question"], faq: ["help", "question"],
  warning: ["alert", "warning"], caution: ["alert", "warning"], attention: ["alert", "warning"],
  failure: ["zap", "failure"], fail: ["zap", "failure"], missing: ["zap", "failure"],
  danger: ["zap", "danger"], error: ["zap", "danger"],
  bug: ["bug", "bug"],
  example: ["list", "example"],
  quote: ["quote", "quote"], cite: ["quote", "quote"],
};

const CALLOUT_HEAD_RE = /^\[!([A-Za-z]+)\][+-]?[ \t]*(.*)$/;

function calloutIcon(key: string): string {
  const path = CALLOUT_ICON_SVGS[key] ?? CALLOUT_ICON_SVGS.pencil;
  return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

/**
 * Upgrades blockquotes whose first line is `[!type] Title` into styled
 * callout blocks (Obsidian syntax). Runs on converted markdown so the
 * resulting HTML persists in storage; plain quotes are left untouched.
 */
export function enhanceCallouts(html: string): string {
  if (!html.includes("blockquote")) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  let changed = false;
  for (const bq of Array.from(doc.querySelectorAll("blockquote"))) {
    const first = bq.firstElementChild;
    if (!first) continue;
    // The marker can be its own paragraph or lead a mixed one.
    const walker = doc.createTreeWalker(first, NodeFilter.SHOW_TEXT);
    const firstText = walker.nextNode() as Text | null;
    if (!firstText) continue;
    const m = CALLOUT_HEAD_RE.exec(firstText.textContent?.trim() ?? "");
    if (!m) continue;
    const rawType = m[1].toLowerCase();
    const [iconKey, mod] = CALLOUT_TYPES[rawType] ?? ["pencil", "note"];
    const titleText = m[2]?.trim() || rawType.charAt(0).toUpperCase() + rawType.slice(1);

    // Remove the marker (and, if it filled the whole node, the node).
    const rest = firstText.textContent!.slice(
      firstText.textContent!.indexOf("]") + 1
    );
    firstText.textContent = rest.replace(/^[ \t+-]+/, "");
    if (!first.textContent?.trim()) first.remove();

    const div = doc.createElement("div");
    div.className = `callout callout-${mod}`;
    div.setAttribute("data-callout", mod);
    const titleEl = doc.createElement("div");
    titleEl.className = "callout-title";
    titleEl.innerHTML = calloutIcon(iconKey) + `<span></span>`;
    (titleEl.lastElementChild as HTMLElement).textContent = titleText;
    const content = doc.createElement("div");
    content.className = "callout-content";
    while (bq.firstChild) content.appendChild(bq.firstChild);
    div.appendChild(titleEl);
    div.appendChild(content);
    bq.replaceWith(div);
    changed = true;
  }
  return changed ? doc.body.innerHTML : html;
}

/**
 * Renders stored rich-text content for the preview: sanitizes the HTML, turns
 * [[wiki links]] into clickable pills (walking text nodes only, so tag
 * attributes are never touched), colors any un-highlighted code blocks and
 * wraps every code block in a header with its language and a copy button.
 */
export function renderRichContent(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ADD_ATTR: ["data-wiki-target", "contenteditable", "data-callout", "data-mermaid", "data-mermaid-source"],
  });
  const doc = new DOMParser().parseFromString(`<body>${clean}</body>`, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const t of textNodes) convertWikiTextNode(t);
  enhanceCodeBlocks(doc.body);
  return doc.body.innerHTML;
}

/** Replaces a text node's [[...]] occurrences with clickable pill anchors. */
function convertWikiTextNode(text: Text) {
  const content = text.textContent ?? "";
  if (!content.includes("[[")) return;
  WIKI_LINK_RE.lastIndex = 0;
  const frag = document.createDocumentFragment();
  let last = 0;
  let found = false;
  let m: RegExpExecArray | null;
  while ((m = WIKI_LINK_RE.exec(content)) !== null) {
    found = true;
    if (m.index > last) {
      frag.appendChild(document.createTextNode(content.slice(last, m.index)));
    }
    const inner = m[1].trim();
    let [target, alias] = inner.split("|");
    target = (target || "").trim();
    alias = (alias || target).trim();
    if (target) {
      const a = document.createElement("a");
      a.className = "wiki-link";
      a.setAttribute("data-wiki-target", target);
      a.title = `Open ${target}`;
      a.textContent = alias;
      frag.appendChild(a);
    }
    last = m.index + m[0].length;
  }
  if (!found) return;
  if (last < content.length) {
    frag.appendChild(document.createTextNode(content.slice(last)));
  }
  text.replaceWith(frag);
}

// --- Code block chrome -----------------------------------------------------

const COPY_ICON_SVG =
  '<svg class="ic-copy" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const CHECK_ICON_SVG =
  '<svg class="ic-copied" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/**
 * Highlights and frames every <pre><code> block in the preview document:
 * a header bar shows the language and provides a copy button. Each block in
 * a note is handled independently, so mixed-language files get per-language
 * coloring. Blocks that already carry hljs spans (migrated markdown) are left
 * untouched; others get language-aware or auto-detected highlighting.
 * Mermaid fences are kept as raw source for async diagram rendering.
 */
function enhanceCodeBlocks(root: HTMLElement) {
  const preBlocks = Array.from(root.querySelectorAll("pre"));
  for (const pre of preBlocks) {
    const code = pre.querySelector("code");
    if (!code) continue;
    let lang = resolveLang(
      Array.from(code.classList).find((c) => c.startsWith("language-"))?.slice(9)
    );

    // Mermaid: keep the source verbatim; diagrams render asynchronously via
    // renderMermaidBlocks() after the preview mounts.
    if (lang === "mermaid") {
      const wrapper = document.createElement("div");
      wrapper.className = "code-block mermaid-block";
      const head = document.createElement("div");
      head.className = "code-block-head";
      head.innerHTML = '<span class="code-lang">mermaid</span>';
      pre.replaceWith(wrapper);
      wrapper.appendChild(head);
      wrapper.appendChild(pre);
      code.removeAttribute("class");
      code.setAttribute("data-mermaid", code.textContent ?? "");
      continue;
    }

    const isHighlighted = code.querySelector(".hljs-keyword, .hljs-string, .hljs-comment, .hljs-title");
    if (!isHighlighted) {
      const text = code.textContent ?? "";
      try {
        if (lang) {
          code.innerHTML = hljs.highlight(text, { language: lang }).value;
        } else {
          const auto = hljs.highlightAuto(text);
          lang = resolveLang(auto.language) ?? "plaintext";
          code.innerHTML = auto.value;
        }
        code.classList.add("hljs");
      } catch {
        code.innerHTML = escapeHtml(text);
      }
    }
    code.classList.add("language-" + (lang ?? "plaintext"));

    const label = lang
      ? `<span class="code-lang">${escapeHtml(lang)}</span>`
      : '<span class="code-lang">code</span>';
    const btn = `<button type="button" class="cp-btn" data-copy-code title="Copy code">${COPY_ICON_SVG}${CHECK_ICON_SVG}</button>`;
    const header = document.createElement("div");
    header.className = "code-block-head";
    header.innerHTML = label + btn;
    const wrapper = document.createElement("div");
    wrapper.className = "code-block";
    pre.replaceWith(wrapper);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  }
}

/** Finds the text immediately before a caret position that follows `[[`. */
export function findWikiQuery(
  text: string,
  caret: number
): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const open = before.lastIndexOf("[[");
  if (open === -1) return null;
  const after = text.slice(open + 2, caret);
  // Don't suggest if the link is already closed
  if (after.includes("]]")) return null;
  // Don't suggest across a newline
  const lastNewline = before.lastIndexOf("\n");
  if (lastNewline > open) return null;
  return { query: after, start: open };
}

/** Plain text extracted from rich-text HTML (word counts, excerpts). */
export function stripHtml(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent ?? "";
}

// --- Mermaid diagrams --------------------------------------------------------

let mermaidLib: typeof import("mermaid").default | null = null;
let mermaidTheme = "";

/**
 * Renders every `[data-mermaid]` source block under `root` into an SVG
 * diagram. The mermaid bundle is huge, so it's dynamically imported on
 * first use — the main app bundle never pays for it.
 */
export async function renderMermaidBlocks(root: ParentNode, dark: boolean): Promise<number> {
  const blocks = Array.from(root.querySelectorAll("[data-mermaid]"));
  if (blocks.length === 0) return 0;
  if (!mermaidLib || mermaidTheme !== (dark ? "dark" : "default")) {
    const mod = await import("mermaid");
    mermaidLib = mod.default;
    mermaidTheme = dark ? "dark" : "default";
    mermaidLib.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: mermaidTheme as "dark" | "default",
    });
  }
  let rendered = 0;
  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i] as HTMLElement;
    const src = el.getAttribute("data-mermaid") ?? "";
    try {
      const { svg } = await mermaidLib.render(`mermaid-${Date.now()}-${i}`, src);
      // Keep the source on the holder so restoreMermaidBlocks can swap the
      // diagram back out for its source before content is saved.
      const holder = document.createElement("div");
      holder.className = "mermaid-diagram";
      holder.setAttribute("data-mermaid-source", src);
      // foreignObject carries mermaid's HTML labels — without it, node text
      // silently disappears.
      holder.innerHTML = DOMPurify.sanitize(svg, {
        ADD_TAGS: ["foreignObject"],
        ADD_ATTR: ["aria-roledescription"],
      });
      el.replaceWith(holder);
      rendered++;
    } catch {
      // Invalid syntax → keep the raw source visible in the code block.
      el.removeAttribute("data-mermaid");
    }
  }
  return rendered;
}

/**
 * Swaps every rendered .mermaid-diagram back into a source code block.
 * Called before reading preview DOM into note content, so rendered SVGs are
 * never baked into storage (and edit mode keeps showing the source).
 */
export function restoreMermaidBlocks(root: ParentNode): void {
  for (const holder of Array.from(root.querySelectorAll(".mermaid-diagram[data-mermaid-source]"))) {
    const src = (holder as HTMLElement).getAttribute("data-mermaid-source") ?? "";
    const wrapper = document.createElement("div");
    wrapper.className = "code-block mermaid-block";
    const head = document.createElement("div");
    head.className = "code-block-head";
    head.innerHTML = '<span class="code-lang">mermaid</span>';
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.className = "language-mermaid";
    code.textContent = src;
    pre.appendChild(code);
    wrapper.appendChild(head);
    wrapper.appendChild(pre);
    holder.replaceWith(wrapper);
  }
}

// --- Outline (headings) ------------------------------------------------------

export interface HeadingEntry {
  level: number;
  text: string;
}

/** Extracts the h1–h3 outline from stored rich-text HTML. */
export function extractHeadings(html: string): HeadingEntry[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: HeadingEntry[] = [];
  for (const h of Array.from(doc.querySelectorAll("h1, h2, h3"))) {
    const text = (h.textContent ?? "").trim();
    if (!text) continue;
    out.push({ level: Number(h.tagName.slice(1)), text });
  }
  return out;
}
