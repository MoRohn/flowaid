import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/api/client";

const nav = vi.hoisted(() => ({ pathname: "/acme/runs" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

const { ErrorPanel, errorMessage, isMissing, listFor } = await import("./states");

afterEach(cleanup);

describe("ErrorPanel", () => {
  it("says a missing item is gone and links back instead of offering a retry", () => {
    const retry = vi.fn();
    render(
      <ErrorPanel
        error={new ApiError(404, "NOT_FOUND", "run 123 not found")}
        onRetry={retry}
        back={{ href: "/acme/runs", label: "All runs" }}
      />,
    );
    expect(screen.getByText("Not found")).toBeDefined();
    expect(screen.getByText(/Run 123 not found\. It may have been deleted/)).toBeDefined();
    expect(screen.getByRole("link", { name: "All runs" }).getAttribute("href")).toBe("/acme/runs");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("offers a retry for other failures, with the code and request id on demand", () => {
    const retry = vi.fn();
    render(
      <ErrorPanel
        error={new ApiError(503, "UNAVAILABLE", "the database is down", undefined, "req-1")}
        onRetry={retry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/request req-1/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
    expect(screen.getByText("HTTP 503 · UNAVAILABLE · request req-1")).toBeDefined();
  });

  it("explains an API that cannot be reached", () => {
    expect(errorMessage(new TypeError("Failed to fetch"))).toMatch(/Could not reach FlowAId's API/);
  });

  // F-06: /acme/runs/not-a-uuid said "request params is invalid" with a Try again that cannot help
  it("treats a link whose id is malformed as not found", () => {
    nav.pathname = "/acme/runs/not-a-uuid";
    const bad = new ApiError(400, "BAD_REQUEST", "request params is invalid");
    expect(isMissing(bad)).toBe(true);
    expect(isMissing(new ApiError(400, "BAD_REQUEST", "request body is invalid"))).toBe(false);
    render(<ErrorPanel error={bad} onRetry={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Not found" })).toBeDefined();
    expect(screen.getByText(/The id in this link is not valid/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Runs" }).getAttribute("href")).toBe(
      "/acme/runs",
    );
  });

  it("links a missing item back to its list from the URL when the page names none", () => {
    nav.pathname = "/acme/knowledge/0000";
    render(<ErrorPanel error={new ApiError(404, "NOT_FOUND", "knowledge source not found")} />);
    expect(screen.getByRole("link", { name: "Back to Knowledge" }).getAttribute("href")).toBe(
      "/acme/knowledge",
    );
    expect(listFor("/acme/evaluations/sets/1")).toEqual({
      href: "/acme/evaluations",
      label: "Back to Evaluations",
    });
    expect(listFor("/acme/workflows")).toBeUndefined();
  });

  it("is the page's heading only when it stands for the whole page", () => {
    const { unmount } = render(<ErrorPanel error={new Error("x")} onRetry={vi.fn()} />);
    expect(screen.queryByRole("heading")).toBeNull();
    unmount();
    render(<ErrorPanel error={new Error("x")} onRetry={vi.fn()} page />);
    expect(screen.getByRole("heading", { level: 1, name: "Could not load this" })).toBeDefined();
  });
});
