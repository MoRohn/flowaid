import { describe, expect, it } from "vitest";
import { ContainerSandbox, containerArgs, containerRuntimeAvailable } from "./container.js";
import { transpile, transpileCacheSize } from "./transpile.js";

describe("containerArgs", () => {
  it("isolates the container: no network, read-only, bounded, unprivileged", () => {
    const args = containerArgs(
      {
        name: "c1",
        image: "alpine:3.22",
        memoryMb: 64,
        pidsLimit: 32,
        runtime: "runsc",
        env: { A: "1" },
      },
      ["sh", "-c", "echo hi"],
    );
    const joined = args.join(" ");
    for (const part of [
      "--network none",
      "--read-only",
      "--memory 64m",
      "--memory-swap 64m",
      "--pids-limit 32",
      "--cap-drop ALL",
      "--security-opt no-new-privileges",
      "--user 65534:65534",
      "--runtime runsc",
      "--env A=1",
      "--rm",
    ])
      expect(joined).toContain(part);
    expect(args.slice(-4)).toEqual(["alpine:3.22", "sh", "-c", "echo hi"]);
    expect(() =>
      containerArgs({ name: "c", image: "x", memoryMb: 1, pidsLimit: 1, env: { "A;B": "x" } }, []),
    ).toThrow(/invalid environment/);
  });

  it("refuses images outside the allow-list and bridged requests", async () => {
    const sandbox = new ContainerSandbox();
    await expect(
      sandbox.shell(
        { script: "id", image: "evil/image", timeoutMs: 1000 },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      sandbox.run(
        {
          language: "javascript",
          code: "return 1",
          inputs: {},
          timeoutMs: 1000,
          allowNetwork: true,
          allowedHosts: ["x"],
          tools: [],
        },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ code: "SANDBOX_ERROR" });
  });
});

describe("transpile", () => {
  it("caches by content hash", async () => {
    const before = transpileCacheSize();
    const a = await transpile("return 1;", "javascript");
    expect(await transpile("return 1;", "javascript")).toBe(a);
    expect(transpileCacheSize()).toBe(before + 1);
  });
});

const docker = await containerRuntimeAvailable();
describe.skipIf(!docker)("ContainerSandbox with a container runtime", () => {
  const sandbox = new ContainerSandbox();
  it("runs shell scripts without network", async () => {
    const r = await sandbox.shell(
      {
        script:
          "echo hello; cat; (wget -q -T 2 -O- http://example.com >/dev/null 2>&1 && echo online) || echo offline",
        stdin: "from stdin",
        timeoutMs: 60_000,
      },
      new AbortController().signal,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("hello");
    expect(r.stdout).toContain("from stdin");
    expect(r.stdout).toContain("offline");
  }, 120_000);

  it("runs code", async () => {
    const r = await sandbox.run(
      {
        language: "typescript",
        code: "const n: number = inputs.n; console.log('hi'); return n * 2;",
        inputs: { n: 4 },
        timeoutMs: 60_000,
        allowNetwork: false,
        allowedHosts: [],
        tools: [],
      },
      { signal: new AbortController().signal },
    );
    expect(r).toMatchObject({ output: 8, logs: [{ level: "info", message: "hi" }] });
  }, 120_000);
});
