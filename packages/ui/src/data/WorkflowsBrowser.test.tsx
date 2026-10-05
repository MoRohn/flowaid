/** WorkflowsBrowser says when there is nothing to show, in the grid as in the list (roadmap B-12). */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { installDomStubs } from "@/primitives/testStubs";
import { TooltipProvider } from "@/primitives";
import { WorkflowsBrowser } from "./WorkflowsTable";

beforeAll(() => installDomStubs());
afterEach(cleanup);

const show = (emptyState?: React.ReactNode) =>
  render(
    <TooltipProvider>
      <WorkflowsBrowser
        workflows={[]}
        environments={[]}
        defaultView="grid"
        {...(emptyState !== undefined ? { emptyState } : {})}
      />
    </TooltipProvider>,
  );

describe("WorkflowsBrowser with nothing to show", () => {
  it("says so in the grid instead of an empty space", () => {
    show();
    expect(screen.getByText("No workflows")).toBeTruthy();
  });

  it("shows the page's own message (a search that matched nothing)", () => {
    show(<p>No workflows match “refund”</p>);
    expect(screen.getByText("No workflows match “refund”")).toBeTruthy();
    expect(screen.queryByText("Nothing matches yet.")).toBeNull();
  });
});
