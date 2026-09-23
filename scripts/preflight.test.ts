import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkDependencies,
  checkDocker,
  checkNode,
  checkPnpm,
  checkPort,
  compareVersions,
  formatReport,
  hasFailures,
  minimumFromRange,
  parseVersion,
  readManifest,
} from "./preflight.ts";

describe("versions", () => {
  it("parses versions with or without a v prefix and ignores suffixes", () => {
    expect(parseVersion("v24.1.0")).toEqual([24, 1, 0]);
    expect(parseVersion("12.5.1\n")).toEqual([12, 5, 1]);
    expect(parseVersion("25.0.0-nightly")).toEqual([25, 0, 0]);
    expect(parseVersion("next")).toBeNull();
  });

  it("compares component by component", () => {
    expect(compareVersions([24, 0, 0], [24, 0, 0])).toBe(0);
    expect(compareVersions([24, 10, 0], [24, 9, 9])).toBe(1);
    expect(compareVersions([23, 99, 99], [24, 0, 0])).toBe(-1);
  });

  it("reads the lower bound of an engines range", () => {
    expect(minimumFromRange(">=24.0.0")).toEqual([24, 0, 0]);
    expect(minimumFromRange("^24.1")).toEqual([24, 1, 0]);
    expect(minimumFromRange("*")).toBeNull();
  });
});

describe("checkNode", () => {
  it("passes at or above the engines minimum", () => {
    expect(checkNode("24.0.0", ">=24.0.0").status).toBe("ok");
    expect(checkNode("25.2.1", ">=24.0.0").status).toBe("ok");
  });

  it("fails below it, with a fix", () => {
    const r = checkNode("22.12.0", ">=24.0.0");
    expect(r.status).toBe("fail");
    expect(r.fix).toContain("Node.js 24");
  });

  it("matches the repository's own engines field", () => {
    expect(checkNode(process.versions.node, readManifest().engines?.node).status).toBe("ok");
  });
});

describe("checkPnpm", () => {
  it("passes on the pinned version", () => {
    expect(checkPnpm("12.5.1", "pnpm@12.5.1").status).toBe("ok");
  });

  it("warns on a different minor or patch and fails on another major", () => {
    expect(checkPnpm("12.4.0", "pnpm@12.5.1").status).toBe("warn");
    const major = checkPnpm("9.15.0", "pnpm@12.5.1");
    expect(major.status).toBe("fail");
    expect(major.fix).toBe("corepack enable && corepack prepare pnpm@12.5.1 --activate");
  });

  it("fails when pnpm is missing", () => {
    expect(checkPnpm(null, "pnpm@12.5.1").status).toBe("fail");
  });
});

describe("checkDependencies", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function repo(): string {
    dir = mkdtempSync(join(tmpdir(), "flowaid-preflight-"));
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    return dir;
  }

  function install(root: string, at: Date): void {
    mkdirSync(join(root, "node_modules/.pnpm"), { recursive: true });
    const snapshot = join(root, "node_modules/.pnpm/lock.yaml");
    writeFileSync(snapshot, "lockfileVersion: '9.0'\n");
    utimesSync(snapshot, at, at);
  }

  it("reports a fresh clone as not installed", () => {
    const r = checkDependencies(repo());
    expect(r).toMatchObject({ status: "warn", detail: "not installed", fix: "pnpm install" });
  });

  it("is current when the install is newer than the lockfile", () => {
    const root = repo();
    utimesSync(join(root, "pnpm-lock.yaml"), new Date(1_000_000), new Date(1_000_000));
    install(root, new Date(2_000_000));
    expect(checkDependencies(root).status).toBe("ok");
  });

  it("is stale when the lockfile changed after the install", () => {
    const root = repo();
    install(root, new Date(1_000_000));
    utimesSync(join(root, "pnpm-lock.yaml"), new Date(2_000_000), new Date(2_000_000));
    expect(checkDependencies(root).detail).toBe("out of date with pnpm-lock.yaml");
  });
});

describe("checkPort", () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  it("fails on a port that is in use and suggests the next one", async () => {
    server = createServer();
    const port = await new Promise<number>((resolve) => {
      server?.listen(0, "127.0.0.1", () => {
        const address = server?.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    const busy = await checkPort("127.0.0.1", port);
    expect(busy.status).toBe("fail");
    expect(busy.fix).toContain(`--port ${port + 1}`);

    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    expect((await checkPort("127.0.0.1", port)).status).toBe("ok");
  });
});

describe("report", () => {
  it("never blocks on Docker", () => {
    expect(checkDocker(null, false).status).toBe("info");
    expect(checkDocker("Compose 2.39.0", true).detail).toBe("Compose 2.39.0; daemon running");
  });

  it("aligns names, prints fixes under problems and flags failures", () => {
    const results = [checkNode("24.1.0", ">=24.0.0"), checkPnpm(null, "pnpm@12.5.1")];
    expect(formatReport(results)).toBe(
      [
        "  ✓ Node.js  v24.1.0 (requires >=24.0.0)",
        "  ✗ pnpm     not found on PATH",
        "             → corepack enable && corepack prepare pnpm@12.5.1 --activate",
      ].join("\n"),
    );
    expect(hasFailures(results)).toBe(true);
    expect(hasFailures(results.slice(0, 1))).toBe(false);
  });
});
