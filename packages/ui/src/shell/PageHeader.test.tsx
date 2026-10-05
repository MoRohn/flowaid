/**
 * F-10: one filled button per screen. List pages pass the same create button to the header and to
 * the empty state, which made two filled buttons on Evaluations, Knowledge and Credentials.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button, EmptyState } from "@/primitives";
import { PageHeader } from "./PageHeader";

afterEach(cleanup);

const filled = (el: HTMLElement) => el.className.includes("bg-accent");

describe("PageHeader and EmptyState", () => {
  it("keeps the header's primary button the only filled one", () => {
    const newSet = <Button variant="primary">New set</Button>;
    render(
      <>
        <PageHeader title="Evaluations" actions={newSet} />
        <EmptyState title="No sets yet" primaryAction={newSet} />
      </>,
    );
    const [header, empty] = screen.getAllByRole("button", { name: "New set" });
    expect(header && filled(header)).toBe(true);
    expect(empty && filled(empty)).toBe(false);
  });

  it("leaves an empty state's primary button filled when the header has none", () => {
    render(
      <>
        <PageHeader title="Overview" />
        <EmptyState
          title="No runs"
          primaryAction={<Button variant="primary">Run a workflow</Button>}
        />
      </>,
    );
    expect(filled(screen.getByRole("button", { name: "Run a workflow" }))).toBe(true);
  });
});
