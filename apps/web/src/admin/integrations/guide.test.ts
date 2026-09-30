import { describe, expect, it } from "vitest";
import {
  emptyServer,
  importNotes,
  integrationPageChecks,
  isPrivateUrl,
  parseGlobs,
  policyPreview,
  serverBody,
  serverNotes,
  serverProblems,
  toolsetName,
} from "./guide";

describe("private addresses", () => {
  it("matches the server's literal rule", () => {
    for (const url of [
      "http://localhost:8080/mcp",
      "http://127.0.0.1/x",
      "http://10.1.2.3",
      "http://192.168.1.4:3000",
      "http://172.20.0.1",
      "http://printer.local",
      "http://intranet",
      "http://[::1]:9000",
    ])
      expect(isPrivateUrl(url), url).toBe(true);
    for (const url of ["https://mcp.example.com/mcp", "http://8.8.8.8", "not a url"])
      expect(isPrivateUrl(url), url).toBe(false);
  });
});

describe("MCP server drafts", () => {
  it("requires a name, an address or an absolute command, and a credential when auth is on", () => {
    expect(Object.keys(serverProblems(emptyServer())).sort()).toEqual(["name", "url"]);
    const stdio = { ...emptyServer(), name: "files", transport: "stdio" as const, command: "npx" };
    expect(serverProblems(stdio).command).toMatch(/full path/);
    expect(serverProblems({ ...stdio, command: "/usr/local/bin/mcp-files" })).toEqual({});
    const auth = {
      ...emptyServer(),
      name: "gh",
      url: "https://x.io/mcp",
      authKind: "headers" as const,
    };
    expect(serverProblems(auth).credentialId).toBeDefined();
  });

  it("builds the request body for each transport", () => {
    expect(
      serverBody({ ...emptyServer(), name: " gh ", url: " https://x.io/mcp ", credentialId: "c1" }),
    ).toEqual({
      name: "gh",
      transport: "streamable_http",
      url: "https://x.io/mcp",
      authKind: "none",
      credentialId: null,
    });
    expect(
      serverBody({
        ...emptyServer(),
        name: "files",
        transport: "stdio",
        command: "/bin/mcp",
        args: "--root\n\n /srv ",
      }),
    ).toMatchObject({ command: "/bin/mcp", args: ["--root", "/srv"] });
  });

  it("explains local addresses, plain http and stdio", () => {
    const local = serverNotes(
      { ...emptyServer(), url: "http://localhost:8931/mcp" },
      { admin: true },
    );
    expect(local.find((n) => n.id === "private")?.message).toContain(
      "FLOWAID_ALLOW_PRIVATE_NETWORK",
    );
    const plain = serverNotes({ ...emptyServer(), url: "http://mcp.example.com" }, { admin: true });
    expect(plain.map((n) => n.id)).toContain("plain-http");
    const stdio = { ...emptyServer(), transport: "stdio" as const };
    expect(serverNotes(stdio, { admin: false })[0]?.state).toBe("blocker");
    expect(serverNotes(stdio, { admin: true })[0]?.message).toContain("MCP_STDIO_ENABLED");
  });
});

describe("tool policies", () => {
  it("parses globs and previews them like the server: deny wins, empty allow allows all", () => {
    expect(parseGlobs("get_*\n, delete_* ,get_*")).toEqual(["get_*", "delete_*"]);
    const names = ["get_issue", "delete_repo", "create_issue"];
    expect(
      policyPreview({ allow: [], deny: ["delete_*"], approvalRequired: ["create_*"] }, names),
    ).toEqual([
      { name: "get_issue", verdict: "allowed" },
      { name: "delete_repo", verdict: "blocked" },
      { name: "create_issue", verdict: "approval" },
    ]);
    expect(
      policyPreview({ allow: ["get_*"], deny: [], approvalRequired: [] }, names).map(
        (x) => x.verdict,
      ),
    ).toEqual(["allowed", "blocked", "blocked"]);
  });
});

describe("OpenAPI imports", () => {
  const base = {
    authSchemes: { apiKey: {} },
    credentialId: "",
    serverUrl: "https://api.example.com",
    operations: [
      { name: "listOrders", method: "get" },
      { name: "cancelOrder", method: "post" },
    ],
    include: ["listOrders", "cancelOrder"],
    taken: ["orders"],
    name: "shop",
  };

  it("warns about missing credentials and data-changing operations", () => {
    const notes = importNotes(base);
    expect(notes.find((n) => n.id === "auth")?.state).toBe("warning");
    expect(notes.find((n) => n.id === "changes")?.message).toContain("1 of the chosen");
  });

  it("blocks a taken name or no operations, and flags a private server", () => {
    const notes = importNotes({
      ...base,
      name: "orders",
      include: [],
      serverUrl: "http://localhost:4000",
    });
    expect(notes.filter((n) => n.state === "blocker").map((n) => n.id)).toEqual(["name", "ops"]);
    expect(notes.find((n) => n.id === "private")).toBeDefined();
    expect(importNotes({ ...base, serverUrl: "" }).find((n) => n.id === "server")?.state).toBe(
      "warning",
    );
  });

  it("suggests a toolset name from the title", () => {
    expect(toolsetName("Acme Orders API (v2)")).toBe("acme-orders-api-v2");
    expect(toolsetName("!!!")).toBe("api");
  });
});

describe("integrations page checks", () => {
  it("flags failing and undiscovered servers", () => {
    const checks = integrationPageChecks("mcp", {
      servers: [
        { status: "error", toolCount: 0, transport: "streamable_http" },
        { status: "pending", toolCount: 0, transport: "streamable_http" },
        { status: "connected", toolCount: 4, transport: "sse" },
        { status: "pending", toolCount: 0, transport: "stdio" },
      ],
      can: () => true,
    });
    expect(checks.map((c) => [c.id, c.state])).toEqual([
      ["broken", "warning"],
      ["undiscovered", "warning"],
      ["tools", "ok"],
    ]);
    expect(checks[1]?.label).toContain("1 server has");
  });

  it("counts OpenAPI operations and plugin health, and notes the role", () => {
    expect(
      integrationPageChecks("openapi", {
        toolsets: [
          { kind: "openapi", definitions: [1, 2] },
          { kind: "workflow", definitions: [1] },
        ],
        can: () => false,
      }).map((c) => c.label),
    ).toEqual([
      "2 operations from 1 toolset",
      "Your role can view toolsets but not import or delete them",
    ]);
    expect(
      integrationPageChecks("plugins", {
        plugins: [{ status: "error", source: "npm" }],
        can: () => true,
      })[0]?.state,
    ).toBe("warning");
    expect(integrationPageChecks("mcp", { can: () => true })[0]?.state).toBe("checking");
  });
});
