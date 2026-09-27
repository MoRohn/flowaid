/**
 * The docs site model: which sources become which pages, Markdown → HTML with link rewriting,
 * and the generated references (nodes from the manifests, the HTTP API from the OpenAPI
 * document). Pure functions over file contents; `build.ts` does the I/O.
 */
import { posix } from "node:path";
import { Marked, type Tokens } from "marked";
import type { NodeManifest } from "@flowaid/workflow-core";

export const REPO_URL = "https://github.com/MoRohn/flowaid";

export interface Source {
  /** page path, "" for the home page */
  slug: string;
  title: string;
  section: string;
  /** repository-relative Markdown file */
  file: string;
}

export interface Page {
  slug: string;
  title: string;
  section: string;
  /** the page's HTML body (without the layout) */
  body: string;
  /** repository-relative file the page came from, when it has one */
  file?: string;
}

/** The hand-written and repository pages, in navigation order. */
export const SOURCES: Source[] = [
  { slug: "", title: "Introduction", section: "Start", file: "apps/docs/content/index.md" },
  {
    slug: "getting-started",
    title: "Getting started",
    section: "Start",
    file: "apps/docs/content/getting-started.md",
  },
  {
    slug: "guides/importing-external-flows",
    title: "Importing external flows",
    section: "Guides",
    file: "apps/docs/content/importing.md",
  },
  {
    slug: "guides/self-hosting",
    title: "Self-hosting with Docker",
    section: "Guides",
    file: "docker/README.md",
  },
  {
    slug: "guides/configuration",
    title: "Configuration",
    section: "Guides",
    file: "packages/env/README.md",
  },
  { slug: "guides/security", title: "Security", section: "Guides", file: "SECURITY.md" },
  {
    slug: "guides/node-authoring",
    title: "Writing nodes and plugins",
    section: "Guides",
    file: "packages/node-sdk/README.md",
  },
  {
    slug: "clients/sdk",
    title: "TypeScript SDK",
    section: "Clients",
    file: "packages/workflow-sdk/README.md",
  },
  {
    slug: "clients/cli",
    title: "Command line",
    section: "Clients",
    file: "packages/cli/README.md",
  },
  {
    slug: "langchain",
    title: "Overview",
    section: "LangChain",
    file: "docs/langchain/overview.md",
  },
  {
    slug: "langchain/providers",
    title: "Providers",
    section: "LangChain",
    file: "docs/langchain/providers.md",
  },
  {
    slug: "langchain/tools",
    title: "Tools",
    section: "LangChain",
    file: "docs/langchain/tools.md",
  },
  {
    slug: "langchain/nodes",
    title: "Nodes",
    section: "LangChain",
    file: "docs/langchain/nodes.md",
  },
  {
    slug: "langchain/rag",
    title: "Retrieval (RAG)",
    section: "LangChain",
    file: "docs/langchain/rag.md",
  },
  {
    slug: "langchain/agents",
    title: "Agents",
    section: "LangChain",
    file: "docs/langchain/agents.md",
  },
  {
    slug: "langchain/callbacks-and-tracing",
    title: "Callbacks and tracing",
    section: "LangChain",
    file: "docs/langchain/callbacks-and-tracing.md",
  },
  {
    slug: "langchain/importing-external-flows",
    title: "Importing external flows",
    section: "LangChain",
    file: "docs/langchain/importing-external-flows.md",
  },
  { slug: "langchain/faq", title: "FAQ", section: "LangChain", file: "docs/langchain/faq.md" },
  {
    slug: "jev",
    title: "Decision contracts (Jev)",
    section: "Concepts",
    file: "docs/jev/overview.md",
  },
  {
    slug: "design/architecture",
    title: "Architecture",
    section: "Design",
    file: "docs/design/ARCHITECTURE.md",
  },
  { slug: "design/api", title: "API design", section: "Design", file: "docs/design/API.md" },
  {
    slug: "design/code-export",
    title: "Code export",
    section: "Design",
    file: "docs/design/CODE_EXPORT.md",
  },
  {
    slug: "design/langchain",
    title: "LangChain design",
    section: "Design",
    file: "docs/design/LANGCHAIN.md",
  },
];

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escaped text with `backtick` spans as code, for manifest descriptions. */
export function inline(text: string): string {
  return escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** The file a page is written to. */
export function pageFile(slug: string): string {
  return slug ? `${slug}/index.html` : "index.html";
}

/** A relative link from one page to another (works from `file://` and any sub-path). */
export function linkBetween(fromSlug: string, toSlug: string, hash = ""): string {
  const fromDir = posix.dirname(`/${pageFile(fromSlug)}`);
  return `${posix.relative(fromDir, `/${pageFile(toSlug)}`) || "index.html"}${hash}`;
}

/** Markdown → HTML; relative links to published sources point at their pages, the rest at GitHub. */
export function renderMarkdown(
  markdown: string,
  from: { slug: string; file: string },
  bySource: Map<string, string>,
  /** receives each repository file linked to on GitHub, so the caller can check it exists */
  onRepoLink: (target: string) => void = () => undefined,
): string {
  const marked = new Marked({ gfm: true });
  marked.use({
    walkTokens(raw) {
      if (raw.type !== "link" && raw.type !== "image") return;
      const token = raw as Tokens.Link | Tokens.Image;
      const href: string = token.href;
      if (!href || /^([a-z]+:|#|\/\/)/i.test(href)) return;
      const [path = "", hash = ""] = href.split(/(?=#)/);
      if (path.startsWith("/")) {
        // A site path: "/nodes", "/reference/api".
        token.href = linkBetween(from.slug, path.replace(/^\/+|\/+$/g, ""), hash);
        return;
      }
      const target = posix.normalize(posix.join(posix.dirname(from.file), path));
      const slug = bySource.get(target);
      if (slug !== undefined && token.type === "link")
        token.href = linkBetween(from.slug, slug, hash);
      else {
        onRepoLink(target);
        token.href = `${REPO_URL}/blob/main/${target}${hash}`;
      }
    },
  });
  return marked.parse(markdown, { async: false });
}

const TYPE = (schema: unknown): string => {
  if (!schema || typeof schema !== "object") return "any";
  const s = schema as Record<string, unknown>;
  if (typeof s.type === "string")
    return s.type === "array" && s.items ? `${TYPE(s.items)}[]` : s.type;
  if (Array.isArray(s.type)) return s.type.join(" | ");
  if (Array.isArray(s.enum)) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) return "one of several";
  return "any";
};

function table(head: string[], rows: string[][]): string {
  if (rows.length === 0) return "<p><em>None.</em></p>";
  return `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

export function nodeSlug(id: string): string {
  return `nodes/${id.replace(/^@/, "").replace(/[/]/g, "-")}`;
}

/** One reference page per node manifest. */
export function nodePage(m: NodeManifest, packageName: string): Page {
  const props =
    (m.configSchema as { properties?: Record<string, Record<string, unknown>> }).properties ?? {};
  const required = new Set((m.configSchema as { required?: string[] }).required ?? []);
  const help = (p: Record<string, unknown>) => {
    const ui = p["x-ui"] as { help?: string } | undefined;
    const text = ui?.help ?? p.description;
    return typeof text === "string" ? inline(text) : "";
  };
  const body = [
    `<p class="lead">${inline(m.metadata.description)}</p>`,
    `<p class="meta"><code>${escapeHtml(m.id)}</code> · version ${escapeHtml(m.version)} · ${escapeHtml(m.metadata.category)} · ${escapeHtml(packageName)}</p>`,
    m.metadata.deprecated
      ? `<p class="warn">Deprecated since ${escapeHtml(m.metadata.deprecated.since)}: ${escapeHtml(m.metadata.deprecated.message)}</p>`
      : "",
    "<h2>Inputs</h2>",
    table(
      ["Port", "Type", "Required", "Description"],
      m.inputs.map((p) => [
        `<code>${escapeHtml(p.name)}</code>`,
        escapeHtml(TYPE(p.schema)),
        p.required ? "yes" : "no",
        inline(p.description ?? ""),
      ]),
    ),
    "<h2>Outputs</h2>",
    table(
      ["Port", "Type", "Description"],
      m.outputs.map((p) => [
        `<code>${escapeHtml(p.name)}</code>`,
        escapeHtml(TYPE(p.schema)),
        inline(p.description ?? ""),
      ]),
    ),
    ...(m.controlPorts.length
      ? [
          "<h2>Control ports</h2>",
          table(
            ["Port", "Description"],
            m.controlPorts.map((c) => [
              `<code>${escapeHtml(c.name)}</code>`,
              inline(c.description ?? c.label ?? ""),
            ]),
          ),
        ]
      : []),
    "<h2>Configuration</h2>",
    table(
      ["Field", "Type", "Required", "Default", "Notes"],
      Object.entries(props).map(([k, p]) => [
        `<code>${escapeHtml(k)}</code>`,
        escapeHtml(TYPE(p)),
        required.has(k) ? "yes" : "no",
        p.default === undefined ? "" : `<code>${escapeHtml(JSON.stringify(p.default))}</code>`,
        help(p),
      ]),
    ),
    ...(m.credentials.length
      ? [
          "<h2>Credentials</h2>",
          table(
            ["Slot", "Types", "Required"],
            m.credentials.map((c) => [
              `<code>${escapeHtml(c.name)}</code>`,
              c.types.map((t) => `<code>${escapeHtml(t)}</code>`).join(", "),
              c.required ? "yes" : "no",
            ]),
          ),
        ]
      : []),
    `<h2>Behaviour</h2><p>Capabilities: ${m.capabilities.map((c) => `<code>${escapeHtml(c)}</code>`).join(", ") || "none"}. Worker pool: <code>${escapeHtml(m.pool)}</code>.${m.streams ? " Streams its output." : ""}${m.decision ? ` Decision kind: <code>${escapeHtml(m.decision.kind)}</code>.` : ""}</p>`,
  ].join("\n");
  return { slug: nodeSlug(m.id), title: m.metadata.name, section: "Nodes", body };
}

/** The node catalog index, grouped by category. */
export function nodeIndex(manifests: { manifest: NodeManifest; pkg: string }[]): Page {
  const byCategory = new Map<string, { manifest: NodeManifest; pkg: string }[]>();
  for (const x of manifests) {
    const list = byCategory.get(x.manifest.metadata.category) ?? [];
    list.push(x);
    byCategory.set(x.manifest.metadata.category, list);
  }
  const body = [
    `<p class="lead">Every node in the catalog: the ${manifests.filter((m) => m.pkg === "@flowaid/nodes-core").length} core nodes and the bundled LangChain nodes, generated from their manifests.</p>`,
    ...[...byCategory]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([category, list]) =>
          `<h2>${escapeHtml(category)}</h2>` +
          table(
            ["Node", "Id", "What it does"],
            list.map(({ manifest: m }) => [
              `<a href="${linkBetween("nodes", nodeSlug(m.id))}">${escapeHtml(m.metadata.name)}</a>`,
              `<code>${escapeHtml(m.id)}</code>`,
              inline(m.metadata.description),
            ]),
          ),
      ),
  ].join("\n");
  return { slug: "nodes", title: "Node reference", section: "Nodes", body };
}

interface OpenApi {
  info?: { version?: string };
  paths: Record<
    string,
    Record<
      string,
      { summary?: string; tags?: string[]; "x-cli"?: { noun?: string; verb?: string } }
    >
  >;
}

/** The HTTP API reference from the OpenAPI document. */
export function apiPage(doc: OpenApi): Page {
  const groups = new Map<string, string[][]>();
  const methods = ["get", "post", "put", "patch", "delete"];
  for (const [path, ops] of Object.entries(doc.paths).sort(([a], [b]) => a.localeCompare(b))) {
    for (const method of methods) {
      const op = ops[method];
      if (!op) continue;
      const tag = op.tags?.[0] ?? "other";
      const cli =
        op["x-cli"]?.noun && op["x-cli"].verb
          ? `<code>flowaid ${escapeHtml(op["x-cli"].noun)} ${escapeHtml(op["x-cli"].verb)}</code>`
          : "";
      const rows = groups.get(tag) ?? [];
      rows.push([
        `<code>${method.toUpperCase()}</code>`,
        `<code>${escapeHtml(path)}</code>`,
        escapeHtml(op.summary ?? ""),
        cli,
      ]);
      groups.set(tag, rows);
    }
  }
  const count = [...groups.values()].reduce((n, r) => n + r.length, 0);
  const body = [
    `<p class="lead">${count} operations${doc.info?.version ? ` (API ${escapeHtml(doc.info.version)})` : ""}. A running API serves the interactive reference at <code>/docs</code> and the OpenAPI 3.1 document at <code>/v1/openapi.json</code>; every operation is also a CLI command.</p>`,
    ...[...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([tag, rows]) =>
          `<h2>${escapeHtml(tag)}</h2>` + table(["Method", "Path", "Summary", "CLI"], rows),
      ),
  ].join("\n");
  return { slug: "reference/api", title: "HTTP API reference", section: "Clients", body };
}

/** The page's HTML document. */
export function layout(page: Page, pages: Page[]): string {
  const sections = new Map<string, Page[]>();
  for (const p of pages) {
    if (p.section === "Nodes" && p.slug !== "nodes") continue; // nodes are listed on their index
    const list = sections.get(p.section) ?? [];
    list.push(p);
    sections.set(p.section, list);
  }
  const nav = [...sections]
    .map(
      ([section, list]) =>
        `<h3>${escapeHtml(section)}</h3><ul>${list
          .map(
            (p) =>
              `<li${p.slug === page.slug ? ' class="current"' : ""}><a href="${linkBetween(page.slug, p.slug)}">${escapeHtml(p.title)}</a></li>`,
          )
          .join("")}</ul>`,
    )
    .join("");
  const asset = (name: string) =>
    posix.relative(posix.dirname(`/${pageFile(page.slug)}`), `/assets/${name}`);
  const edit = page.file
    ? `<p class="edit"><a href="${REPO_URL}/blob/main/${page.file}">View the source of this page</a></p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)} · FlowAId docs</title>
<link rel="icon" href="${asset("favicon.svg")}" type="image/svg+xml">
<link rel="stylesheet" href="${asset("tokens.css")}">
<link rel="stylesheet" href="${asset("site.css")}">
</head>
<body>
<header><a class="brand" href="${linkBetween(page.slug, "")}"><img src="${asset("logo-mark.svg")}" alt="" width="22" height="22"> FlowAId <span>docs</span></a><a class="repo" href="${REPO_URL}">GitHub</a></header>
<div class="shell">
<nav aria-label="Documentation">${nav}</nav>
<main><h1>${escapeHtml(page.title)}</h1>
${page.body}
${edit}</main>
</div>
</body>
</html>
`;
}

/** Relative `href`/`src` targets in a document that do not resolve to a written file. */
export function brokenLinks(files: Map<string, string>): { file: string; href: string }[] {
  const out: { file: string; href: string }[] = [];
  for (const [file, html] of files) {
    if (!file.endsWith(".html")) continue;
    for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      const href = m[1] as string;
      if (/^([a-z]+:|#|\/\/)/i.test(href)) continue;
      const path = href.split("#")[0] as string;
      const target = posix.normalize(posix.join(posix.dirname(file), path));
      if (!files.has(target)) out.push({ file, href });
    }
  }
  return out;
}
