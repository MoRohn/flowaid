import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { BUILDER_SAMPLE_TEMPLATES } from "./sampleTemplates";
import { TemplateGallery, filterTemplates } from "./TemplateGallery";

installDomStubs();
afterEach(cleanup);

describe("filterTemplates", () => {
  it("matches name, description, tags and category labels case-insensitively", () => {
    expect(filterTemplates(BUILDER_SAMPLE_TEMPLATES, "github", "all").map((t) => t.id)).toEqual([
      "github-issue-triage",
    ]);
    expect(filterTemplates(BUILDER_SAMPLE_TEMPLATES, "Retrieval", "all")).toHaveLength(3);
    expect(filterTemplates(BUILDER_SAMPLE_TEMPLATES, "supervisor", "all").map((t) => t.id)).toEqual(
      ["agent-supervisor"],
    );
  });

  it("narrows by category and combines with search", () => {
    expect(filterTemplates(BUILDER_SAMPLE_TEMPLATES, "", "human").map((t) => t.id)).toEqual([
      "typesafe-support-router",
      "document-processing",
      "agent-supervisor",
    ]);
    expect(filterTemplates(BUILDER_SAMPLE_TEMPLATES, "pdf", "human").map((t) => t.id)).toEqual([
      "document-processing",
    ]);
  });
});

describe("TemplateGallery", () => {
  it("renders every template with a preview and fires onUse", async () => {
    const onUse = vi.fn();
    render(<TemplateGallery templates={BUILDER_SAMPLE_TEMPLATES} onUse={onUse} />);
    expect(screen.getAllByRole("button", { name: "Use template" })).toHaveLength(5);
    expect(screen.getByRole("img", { name: "Research Agent preview" })).toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Use template" })[1] as HTMLElement,
    );
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ id: "research-agent" }));
  });

  it("filters by search and shows the empty state with a reset", async () => {
    render(<TemplateGallery templates={BUILDER_SAMPLE_TEMPLATES} onUse={() => undefined} />);
    const box = screen.getByRole("searchbox", { name: "Search templates" });
    await userEvent.type(box, "invoice");
    expect(screen.getByText("No templates match")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("button", { name: "Use template" })).toHaveLength(5);
    await userEvent.type(box, "research");
    expect(screen.getAllByRole("button", { name: "Use template" })).toHaveLength(1);
    expect(screen.getByText("1 of 5")).toBeInTheDocument();
  });
});
