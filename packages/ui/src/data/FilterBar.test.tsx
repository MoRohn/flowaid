import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import {
  applyRunFilters,
  countActiveFilters,
  FilterBar,
  normalizeFilters,
  parseFilters,
  serializeFilters,
  type RunFilters,
} from "./FilterBar";
import { SAMPLE_ENVIRONMENTS, makeSampleRuns } from "./sample";

afterEach(cleanup);
beforeAll(() => installDomStubs());

const NOW = new Date("2026-09-22T12:00:00.000Z");

describe("serializeFilters / parseFilters", () => {
  it("round-trips every facet", () => {
    const filters: RunFilters = {
      search: "refund 503",
      status: ["failed", "timed_out"],
      workflow: ["wf_support_triage"],
      version: ["12", "draft"],
      environment: ["env_prod"],
      provider: ["typesafe"],
      model: ["jev-1.13.0", "gpt-5-mini"],
      origin: ["api", "webhook"],
      range: { preset: "7d" },
    };
    const s = serializeFilters(filters);
    expect(s).toBe(
      "q=refund+503&status=failed%2Ctimed_out&workflow=wf_support_triage&version=12%2Cdraft&env=env_prod&provider=typesafe&model=jev-1.13.0%2Cgpt-5-mini&origin=api%2Cwebhook&range=7d",
    );
    expect(parseFilters(s)).toEqual(filters);
    expect(parseFilters(`?${s}`)).toEqual(filters);
    expect(parseFilters(new URLSearchParams(s))).toEqual(filters);
  });

  it("round-trips a custom date range", () => {
    const filters: RunFilters = {
      range: { preset: "custom", from: "2026-09-01T00:00:00.000Z", to: "2026-09-22T23:59:59.999Z" },
    };
    expect(parseFilters(serializeFilters(filters))).toEqual(filters);
  });

  it("drops unknown statuses and origins and keeps environment ids as given", () => {
    const parsed = parseFilters("status=failed,bogus&origin=api,cron,restart&env=env_prod,moon");
    expect(parsed).toEqual({
      status: ["failed"],
      origin: ["api", "restart"],
      environment: ["env_prod", "moon"],
    });
  });

  it("ignores empty values and blank search", () => {
    expect(serializeFilters({ search: "  ", status: [], workflow: [] })).toBe("");
    expect(parseFilters("q=&status=&range=nope")).toEqual({});
  });

  it("normalises duplicates and counts active facets", () => {
    const n = normalizeFilters({ status: ["failed", "failed"], search: " x " });
    expect(n).toEqual({ status: ["failed"], search: "x" });
    expect(countActiveFilters(n)).toBe(2);
    expect(countActiveFilters({})).toBe(0);
    expect(countActiveFilters({ range: { preset: "1h" }, model: ["m"] })).toBe(2);
  });
});

describe("applyRunFilters", () => {
  const runs = makeSampleRuns(60, NOW.getTime());

  it("filters by status, workflow, origin and environment", () => {
    const failed = applyRunFilters(runs, { status: ["failed"] }, NOW);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((r) => r.status === "failed")).toBe(true);
    const wf = applyRunFilters(runs, { workflow: ["wf_support_triage"] }, NOW);
    expect(wf.every((r) => r.workflowId === "wf_support_triage")).toBe(true);
    const env = applyRunFilters(runs, { environment: ["env_stg"] }, NOW);
    expect(env.length).toBeGreaterThan(0);
    expect(env.every((r) => r.environment?.id === "env_stg")).toBe(true);
    const origin = applyRunFilters(runs, { origin: ["schedule", "ui"] }, NOW);
    expect(origin.length).toBeGreaterThan(0);
    expect(origin.every((r) => r.origin === "schedule" || r.origin === "ui")).toBe(true);
  });

  it("filters by version, provider and model through node decisions", () => {
    const draft = applyRunFilters(runs, { version: ["draft"] }, NOW);
    expect(draft.every((r) => r.version === "draft")).toBe(true);
    const llm = applyRunFilters(runs, { provider: ["llm"] }, NOW);
    expect(llm.length).toBeGreaterThan(0);
    expect(llm.every((r) => r.nodeRuns.some((n) => n.decision?.provider === "llm"))).toBe(true);
    const model = applyRunFilters(runs, { model: ["jev-mini-1.2.0"] }, NOW);
    expect(model.every((r) => r.nodeRuns.some((n) => n.decision?.model === "jev-mini-1.2.0"))).toBe(
      true,
    );
  });

  it("filters by a relative range and free text", () => {
    const recent = applyRunFilters(runs, { range: { preset: "1h" } }, NOW);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every((r) => NOW.getTime() - new Date(r.createdAt).getTime() <= 3_600_000)).toBe(
      true,
    );
    const first = runs[0];
    if (!first) throw new Error("no runs");
    const byId = applyRunFilters(runs, { search: first.id.slice(4, 12).toLowerCase() }, NOW);
    expect(byId.some((r) => r.id === first.id)).toBe(true);
    const byError = applyRunFilters(runs, { search: "503" }, NOW);
    expect(byError.every((r) => r.error?.message.includes("503"))).toBe(true);
  });

  it("returns everything for empty filters", () => {
    expect(applyRunFilters(runs, {}, NOW)).toHaveLength(60);
  });
});

describe("FilterBar", () => {
  it("renders active chips, removes them and clears all", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterBar
        value={{ status: ["failed", "timed_out"], workflow: ["wf_support_triage"], search: "x" }}
        onChange={onChange}
        options={{ workflow: [{ value: "wf_support_triage", label: "Support triage" }] }}
      />,
    );
    expect(screen.getByText("Failed, Timed out")).toBeInTheDocument();
    expect(screen.getByText("Support triage")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Status filter" }));
    expect(onChange).toHaveBeenLastCalledWith({ workflow: ["wf_support_triage"], search: "x" });
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("adds a facet from the menu and toggles options", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterBar value={{}} onChange={onChange} facets={["status", "origin"]} />);
    await user.click(screen.getByRole("button", { name: /Filter/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Origin" }));
    const list = await screen.findByRole("listbox", { name: "Origin" });
    expect(within(list).getAllByRole("option")).toHaveLength(10);
    await user.click(within(list).getByRole("option", { name: "Webhook" }));
    expect(onChange).toHaveBeenLastCalledWith({ origin: ["webhook"] });
  });

  it("offers the workspace environments as the environment facet", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterBar
        value={{}}
        onChange={onChange}
        facets={["environment"]}
        environments={SAMPLE_ENVIRONMENTS}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Filter/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Environment" }));
    const list = await screen.findByRole("listbox", { name: "Environment" });
    await user.click(within(list).getByRole("option", { name: "Staging" }));
    expect(onChange).toHaveBeenLastCalledWith({ environment: ["env_stg"] });
  });

  it("emits search text", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState<RunFilters>({});
      return (
        <FilterBar
          value={value}
          onChange={(v) => {
            setValue(v);
            onChange(v);
          }}
        />
      );
    }
    render(<Harness />);
    await user.type(screen.getByRole("searchbox"), "ref");
    expect(onChange).toHaveBeenLastCalledWith({ search: "ref" });
    expect(screen.getByRole("button", { name: "Clear all" })).toBeInTheDocument();
  });
});
