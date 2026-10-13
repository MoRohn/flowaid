#!/usr/bin/env node
/**
 * Serve site/dist the way GitHub project Pages will: under /flowaid/.
 * Build first with `node site/build.mjs`.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("./dist/", import.meta.url));
const PREFIX = "/flowaid";
const PORT = Number(process.env.PORT || 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".ttf": "font/ttf",
};

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/") {
    res.writeHead(302, { Location: `${PREFIX}/` });
    res.end();
    return;
  }
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) {
    send(res, 404, "not found");
    return;
  }
  let rel = decodeURIComponent(url.pathname.slice(PREFIX.length));
  if (rel === "" || rel.endsWith("/")) rel += "/index.html";
  const file = normalize(join(DIST, rel));
  if (!file.startsWith(DIST)) {
    send(res, 403, "forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    send(res, 200, body, TYPES[extname(file)] || "application/octet-stream");
  } catch {
    send(res, 404, "not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`FlowAId site at http://127.0.0.1:${PORT}${PREFIX}/`);
});
