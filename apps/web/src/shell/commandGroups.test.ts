import { describe, expect, it } from "vitest";
import { commandGroups, runIdQuery, type CommandInput } from "./commandGroups";

const base: CommandInput = {
  ws: "default",
  local: true,
  dashboard: true,
  can: () => true,
  features: { knowledge: true, evaluations: true, settings_notifications: true },
  workflows: [
    { id: "w1", name: "Refund desk", latestVersion: 2 },
    { id: "w2", name: "Triage", latestVersion: null },
  ],
  runs: [{ id: "01a0e530-5ea8-7143", workflowId: "w1", status: "waiting_for_human" }],
  templates: [{ id: "t1", name: "Research Agent" }],
};

const ids = (g: { items: { id: string }[] }[]) => g.flatMap((x) => x.items.map((i) => i.id));

describe("command menu groups", () => {
  it("offers creating before the pages, and the workspace's lists after them", () => {
    const { leading, trailing } = commandGroups(base);
    expect(leading.map((g) => g.heading)).toEqual(["Create"]);
    expect(trailing.map((g) => g.heading)).toEqual([
      "Workflows",
      "Recent runs",
      "Templates",
      "Settings",
      "Help",
    ]);
    const [create] = leading;
    const [workflows, runs, templates] = trailing;
    expect(create?.items.map((i) => i.to)).toContain("/default/workflows/new");
    expect(workflows?.items.map((i) => [i.label, i.meta, i.to])).toEqual([
      ["Refund desk", "v2", "/default/workflows/w1"],
      ["Triage", "draft", "/default/workflows/w2"],
    ]);
    expect(runs?.items[0]).toMatchObject({
      label: "Refund desk",
      description: "waiting for a person · 01a0e530",
      to: "/default/runs/01a0e530-5ea8-7143",
    });
    expect(templates?.items[0]?.to).toBe("/default/templates?use=t1");
  });

  it("leaves out account settings in local mode and what the role cannot do", () => {
    const local = ids(commandGroups(base).trailing);
    expect(local).not.toContain("settings-members");
    expect(local).not.toContain("settings-profile");
    expect(local).toContain("help-shortcuts");

    const viewer = commandGroups({
      ...base,
      local: false,
      can: (s) => s.endsWith(":read"),
      templates: [{ id: "t1", name: "Research Agent" }],
    });
    expect(ids(viewer.leading)).not.toContain("create-workflow");
    expect(viewer.trailing.map((g) => g.heading)).not.toContain("Templates");
    expect(ids(viewer.trailing)).toContain("settings-members");
  });

  it("drops empty groups", () => {
    const { leading, trailing } = commandGroups({
      ...base,
      workflows: [],
      runs: [],
      templates: [],
    });
    expect(leading.map((g) => g.heading)).toEqual(["Create"]);
    expect(trailing.map((g) => g.heading)).toEqual(["Settings", "Help"]);
  });
  it("recognises a run id or its first eight characters, and nothing shorter", () => {
    const uuid = "01a0e530-5ea8-7143-8b2c-3d4e5f607182";
    expect(runIdQuery(uuid)).toEqual({ kind: "id", value: uuid });
    expect(runIdQuery(` ${uuid.toUpperCase()} `)).toEqual({ kind: "id", value: uuid });
    expect(runIdQuery("01a0e530")).toEqual({ kind: "prefix", value: "01a0e530" });
    expect(runIdQuery("01a0e53")).toBeNull();
    expect(runIdQuery("refund desk")).toBeNull();
  });

  it("offers going to a typed run id first", () => {
    const uuid = "01a0e530-5ea8-7143-8b2c-3d4e5f607182";
    const full = commandGroups({ ...base, query: uuid }).leading[0];
    expect(full?.heading).toBe("Go to");
    expect(full?.items[0]).toMatchObject({
      label: `Go to run ${uuid}`,
      to: `/default/runs/${uuid}`,
    });
    expect(full?.items[0]?.keywords).toContain(uuid);
    // a prefix one recent run matches goes straight to it; otherwise the list searches by it
    expect(commandGroups({ ...base, query: "01a0e530" }).leading[0]?.items[0]?.to).toBe(
      "/default/runs/01a0e530-5ea8-7143",
    );
    expect(commandGroups({ ...base, query: "ffffffff" }).leading[0]?.items[0]).toMatchObject({
      label: "Find runs starting with ffffffff",
      to: "/default/runs?q=ffffffff",
    });
    expect(commandGroups({ ...base, query: "triage" }).leading[0]?.heading).toBe("Create");
    expect(ids(commandGroups({ ...base, query: uuid, can: () => false }).leading)).not.toContain(
      "goto-run",
    );
  });

  it("lists up to five pending approvals with a way to the rest", () => {
    const task = (n: number) => ({
      id: `t${n}`,
      nodeId: "approve_refund",
      ...(n === 1 ? { nodeName: "Finance approval" } : {}),
      workflowId: "w1",
      runId: `0${n}a0e530-5ea8`,
    });
    const two = commandGroups({ ...base, pending: [task(1), task(2)] }).leading;
    const pending = two.find((g) => g.heading === "Pending approvals");
    expect(pending?.items.map((i) => [i.label, i.description, i.to])).toEqual([
      ["Finance approval", "Refund desk · run 01a0e530", "/default/human-tasks/t1"],
      ["Approve refund", "Refund desk · run 02a0e530", "/default/human-tasks/t2"],
    ]);
    const seven = commandGroups({
      ...base,
      pending: [1, 2, 3, 4, 5, 6, 7].map(task),
    }).leading.find((g) => g.heading === "Pending approvals");
    expect(seven?.items).toHaveLength(6);
    expect(seven?.items[5]).toMatchObject({
      label: "All pending approvals (7)",
      to: "/default/human-tasks",
    });
  });

  it("offers Ask FlowAId with the typed question when the assistant is on", () => {
    const on = { ...base, features: { ...base.features, assistant: true } };
    const ask = (query?: string) =>
      commandGroups({ ...on, ...(query !== undefined ? { query } : {}) }).trailing.find(
        (g) => g.id === "ask",
      )?.items;
    expect(ask()).toMatchObject([{ label: "Ask FlowAId…", action: "ask" }]);
    expect(ask()?.[0]?.question).toBeUndefined();
    expect(ask("why did triage fail?")).toMatchObject([
      {
        label: "Ask FlowAId: “why did triage fail?”",
        action: "ask",
        question: "why did triage fail?",
      },
    ]);
    // a run id is not a question
    expect(ask("01a0e530-5ea8")?.[0]?.question).toBeUndefined();
    expect(commandGroups(base).trailing.some((g) => g.id === "ask")).toBe(false);
    expect(
      commandGroups({ ...on, can: (s) => s !== "runs:read" }).trailing.some((g) => g.id === "ask"),
    ).toBe(false);
  });

  // F-10 / R12: Ask led the menu, so Enter on any typed text sent a paid question
  it("puts Ask last, as the fallback Enter takes only when nothing else matches", () => {
    const on = { ...base, features: { ...base.features, assistant: true } };
    const { leading, trailing } = commandGroups({ ...on, query: "runs" });
    expect(leading.some((g) => g.id === "ask")).toBe(false);
    expect(trailing.at(-1)).toMatchObject({ id: "ask", fallback: true });
    expect(trailing.filter((g) => g.fallback).map((g) => g.id)).toEqual(["ask"]);
  });

  it("lists five templates and a way to the rest", () => {
    const templates = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `t${n}`, name: `Template ${n}` }));
    const group = commandGroups({ ...base, templates }).trailing.find((g) => g.id === "templates");
    expect(group?.items).toHaveLength(6);
    expect(group?.items[5]).toMatchObject({ label: "All templates (7)", to: "/default/templates" });
  });
});
