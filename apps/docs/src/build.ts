/**
 * Builds the static docs site into `dist/`, or with `--check` verifies it without writing:
 * every source exists, every core manifest has a page, and every internal link resolves.
 *
 *   pnpm --filter @flowaid/docs build     # → apps/docs/dist
 *   pnpm docs:check
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { coreManifestPackage, coreManifests } from "@flowaid/nodes-core/manifest";
import type { NodeManifest } from "@flowaid/workflow-core";
import { SITE_CSS } from "./css.js";
import {
  apiPage,
  brokenLinks,
  layout,
  nodeIndex,
  nodePage,
  nodeSlug,
  pageFile,
  renderMarkdown,
  SOURCES,
  type Page,
} from "./site.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

export interface Site {
  files: Map<string, string>;
  problems: string[];
}

/** Every page and asset of the site, in memory. */
export function buildSite(): Site {
  const problems: string[] = [];
  const bySource = new Map(SOURCES.map((s) => [s.file, s.slug]));
  const pages: Page[] = [];

  for (const source of SOURCES) {
    if (!existsSync(join(ROOT, source.file))) {
      problems.push(`missing source ${source.file} (page "${source.title}")`);
      continue;
    }
    // The page supplies its own <h1>; drop a leading Markdown one.
    const markdown = read(source.file).replace(/^\s*# .*\n/, "");
    const body = renderMarkdown(markdown, source, bySource, (target) => {
      if (!existsSync(join(ROOT, target)))
        problems.push(`broken link in ${source.file}: ${target}`);
    });
    pages.push({ ...source, body });
  }

  const langchain = JSON.parse(read("packages/nodes-langchain/manifest.json")) as {
    nodes: NodeManifest[];
  };
  const manifests = [
    ...coreManifests.map((manifest) => ({ manifest, pkg: coreManifestPackage.name })),
    ...langchain.nodes.map((manifest) => ({ manifest, pkg: "@flowaid/nodes-langchain" })),
  ];
  pages.push(nodeIndex(manifests));
  for (const { manifest, pkg } of manifests) pages.push(nodePage(manifest, pkg));
  pages.push(
    apiPage(
      JSON.parse(read("packages/workflow-sdk/openapi.json")) as Parameters<typeof apiPage>[0],
    ),
  );

  const files = new Map<string, string>();
  for (const page of pages) files.set(pageFile(page.slug), layout(page, pages));
  files.set("assets/tokens.css", read("brand/tokens.css"));
  files.set("assets/site.css", SITE_CSS);
  files.set("assets/favicon.svg", read("brand/favicon.svg"));
  files.set("assets/logo-mark.svg", read("brand/logo-mark.svg"));

  for (const m of coreManifests) {
    if (!files.has(pageFile(nodeSlug(m.id)))) problems.push(`core node ${m.id} has no page`);
  }
  for (const { file, href } of brokenLinks(files)) problems.push(`broken link in ${file}: ${href}`);
  return { files, problems };
}

function main(): void {
  const check = process.argv.includes("--check");
  const { files, problems } = buildSite();
  if (problems.length) {
    for (const p of problems) console.error(`docs: ${p}`);
    process.exitCode = 1;
    return;
  }
  if (check) {
    console.log(`docs: ${files.size} files, all sources present, no broken links`);
    return;
  }
  const out = resolve(ROOT, "apps/docs/dist");
  rmSync(out, { recursive: true, force: true });
  for (const [file, content] of files) {
    mkdirSync(dirname(join(out, file)), { recursive: true });
    writeFileSync(join(out, file), content);
  }
  console.log(`docs: wrote ${files.size} files to apps/docs/dist`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
