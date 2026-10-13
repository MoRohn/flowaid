#!/usr/bin/env node
/**
 * Build the FlowAId landing site into site/dist.
 *
 * Version comes from the first "## x.y.z" heading in the repo CHANGELOG.md.
 * Asset URLs in the page are relative, so the same output works at the
 * domain root and under the GitHub Pages project path (/flowaid/).
 *
 *   node site/build.mjs
 *   SITE_URL=https://morohn.github.io/flowaid node site/build.mjs
 *   node site/build.mjs --og    # also re-render site/og.png (needs Chrome)
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile, copyFile, access } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(SITE_DIR);
const SRC = join(SITE_DIR, "src");
const DIST = join(SITE_DIR, "dist");

const SITE_URL = (process.env.SITE_URL || "https://morohn.github.io/flowaid").replace(/\/+$/, "");

const SCREENSHOTS = [
  "templates",
  "flow-expense-approval",
  "flow-it-helpdesk-routing",
  "flow-refund-requests",
  "run-trace",
  "review",
  "overview",
  "evaluation",
  "closeup-calibration",
  "closeup-webhook",
  "closeup-desktop-menu",
];

const FONTS = [
  "InstrumentSans-Regular.ttf",
  "InstrumentSans-Medium.ttf",
  "InstrumentSans-SemiBold.ttf",
  "JetBrainsMono-Regular.ttf",
  "JetBrainsMono-Medium.ttf",
  "OFL-InstrumentSans.txt",
  "OFL-JetBrainsMono.txt",
];

const BRAND_FILES = ["favicon.svg", "favicon-32.png", "apple-touch-icon.png", "icon-512.png", "tokens.css"];

function innerSvg(source) {
  return source
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replaceAll("#2f5be8", "var(--accent)");
}

async function sprite() {
  const mark = await readFile(join(ROOT, "brand/logo-mark-accent.svg"), "utf8");
  const word = await readFile(join(ROOT, "brand/logo-wordmark.svg"), "utf8");
  const viewBox = word.match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) throw new Error("logo-wordmark.svg has no viewBox");
  return [
    `<symbol id="mark" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${innerSvg(mark)}</symbol>`,
    `<symbol id="wordmark" viewBox="${viewBox}">${innerSvg(word)}</symbol>`,
  ].join("");
}

async function versionFromChangelog() {
  const changelog = await readFile(join(ROOT, "CHANGELOG.md"), "utf8");
  const match = changelog.match(/^##\s+(\d+\.\d+\.\d+)\b/m);
  if (!match) throw new Error("CHANGELOG.md has no ## x.y.z heading");
  return match[1];
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function walkRefs(cssOrHtml, baseDir) {
  const refs = [];
  const attr = /(?:href|src|srcset)\s*=\s*"([^"]+)"/g;
  for (const match of cssOrHtml.matchAll(attr)) refs.push(match[1]);
  const urls = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  for (const match of cssOrHtml.matchAll(urls)) refs.push(match[2]);
  return refs
    .flatMap((value) => value.split(",").map((part) => part.trim().split(/\s+/)[0]))
    .filter((value) => value && !value.startsWith("#") && !/^[a-z]+:/i.test(value))
    .map((value) => ({ raw: value, file: join(baseDir, value.split("#")[0].split("?")[0]) }));
}

async function validate(html, css, version) {
  const errors = [];
  if (!html.includes(version)) errors.push("built HTML is missing the changelog version");
  if (!html.includes(`${SITE_URL}/`)) errors.push("built HTML is missing the site URL");
  if ((html.match(/<h1[\s>]/g) || []).length !== 1) errors.push("page must have exactly one h1");
  for (const token of [
    "<title>",
    'name="description"',
    'property="og:title"',
    'property="og:description"',
    'property="og:image:alt"',
    'name="twitter:card" content="summary_large_image"',
    'rel="canonical"',
    'rel="icon"',
    `property="og:url" content="${SITE_URL}/"`,
    `property="og:image" content="${SITE_URL}/og.png"`,
    'property="og:image:width" content="1200"',
    'property="og:image:height" content="630"',
    `name="twitter:image" content="${SITE_URL}/og.png"`,
  ]) {
    if (!html.includes(token)) errors.push(`missing ${token}`);
  }
  if (/property="og:image" content="(?!https:\/\/)/.test(html)) {
    errors.push("og:image must be an absolute https URL");
  }
  const rootRelative = /(?:href|src|srcset)\s*=\s*"\/(?!\/)/;
  if (rootRelative.test(html) || /url\(\s*['"]?\//.test(css)) {
    errors.push("root-relative asset URL found; Pages project sites need relative paths");
  }
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  for (const match of html.matchAll(/href="#([^"]+)"/g)) {
    if (!ids.has(match[1])) errors.push(`missing target for #${match[1]}`);
  }
  for (const { raw, file } of [...walkRefs(html, DIST), ...walkRefs(css, DIST)]) {
    if (!(await exists(file))) errors.push(`missing asset ${raw}`);
  }
  const png = await readFile(join(DIST, "og.png"));
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== 1200 || height !== 630) errors.push(`og.png is ${width}x${height}, expected 1200x630`);
  if (!html.includes("git clone https://github.com/MoRohn/flowaid.git")) {
    errors.push("quick start command is missing");
  }
  if (errors.length) {
    throw new Error(errors.map((error) => `- ${error}`).join("\n"));
  }
}

async function renderOg() {
  const chrome = process.env.CHROME || "google-chrome";
  const htmlPath = join(SITE_DIR, "og.html");
  const out = join(SITE_DIR, "og.png");
  await new Promise((resolve, reject) => {
    const child = spawn(
      chrome,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
        "--user-data-dir=/tmp/flowaid-og-chrome",
        "--force-device-scale-factor=1",
        "--virtual-time-budget=8000",
        "--timeout=8000",
        "--window-size=1200,630",
        `--screenshot=${out}`,
        `file://${htmlPath}`,
      ],
      { stdio: "inherit" },
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  const png = await readFile(out);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== 1200 || height !== 630) {
    throw new Error(`rendered og.png is ${width}x${height}, expected 1200x630`);
  }
  console.log(`rendered ${relative(ROOT, out)} (${width}x${height})`);
}

async function main() {
  if (process.argv.includes("--og")) await renderOg();
  const version = await versionFromChangelog();
  await rm(DIST, { recursive: true, force: true });
  await mkdir(join(DIST, "assets/screenshots"), { recursive: true });
  await mkdir(join(DIST, "fonts"), { recursive: true });

  for (const name of BRAND_FILES) {
    await copyFile(join(ROOT, "brand", name), join(DIST, name));
  }
  for (const name of FONTS) {
    await copyFile(join(ROOT, "brand/fonts", name), join(DIST, "fonts", name));
  }
  for (const name of SCREENSHOTS) {
    for (const theme of ["light", "dark"]) {
      const file = `${name}-${theme}.webp`;
      await copyFile(join(ROOT, "docs/assets/screenshots", file), join(DIST, "assets/screenshots", file));
    }
  }
  await copyFile(join(SITE_DIR, "og.png"), join(DIST, "og.png"));
  await copyFile(join(SRC, "styles.css"), join(DIST, "styles.css"));
  await copyFile(join(SRC, "main.js"), join(DIST, "main.js"));

  const html = (await readFile(join(SRC, "index.html"), "utf8"))
    .replaceAll("__SPRITE__", await sprite())
    .replaceAll("__FLOWAID_VERSION__", version)
    .replaceAll("__SITE_URL__", SITE_URL);
  await writeFile(join(DIST, "index.html"), html);

  const versionJson = {
    version,
    channel: "public beta",
    source: "CHANGELOG.md",
  };
  await writeFile(join(DIST, "version.json"), `${JSON.stringify(versionJson, null, 2)}\n`);

  const manifest = {
    name: "FlowAId",
    short_name: "FlowAId",
    description:
      "Open-source platform for building, running and evaluating AI agents and workflows on your own computer.",
    start_url: "./",
    display: "browser",
    background_color: "#f5f5f7",
    theme_color: "#f5f5f7",
    icons: [
      { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
  await writeFile(join(DIST, "site.webmanifest"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    join(DIST, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
  );
  await writeFile(
    join(DIST, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}/</loc></url>\n</urlset>\n`,
  );

  await validate(html, await readFile(join(DIST, "styles.css"), "utf8"), version);
  console.log(`built site/dist for ${version} at ${SITE_URL}/`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
