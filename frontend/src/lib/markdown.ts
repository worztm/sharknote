import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
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
 * metadata card at the top.
 */
export function markdownToEditorHtml(source: string): string {
  const { fm, body } = extractFrontmatter(source);
  const html = marked.parse(body) as string;
  return fm ? frontmatterCardHtml(fm) + html : html;
}

/**
 * Renders stored rich-text content for the preview: sanitizes the HTML, turns
 * [[wiki links]] into clickable pills (walking text nodes only, so tag
 * attributes are never touched), colors any un-highlighted code blocks and
 * wraps every code block in a header with its language and a copy button.
 */
export function renderRichContent(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ADD_ATTR: ["data-wiki-target", "contenteditable"],
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
 */
function enhanceCodeBlocks(root: HTMLElement) {
  const preBlocks = Array.from(root.querySelectorAll("pre"));
  for (const pre of preBlocks) {
    const code = pre.querySelector("code");
    if (!code) continue;
    let lang = resolveLang(
      Array.from(code.classList).find((c) => c.startsWith("language-"))?.slice(9)
    );
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
