import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/api/client";
import { ErrorPanel, errorMessage } from "./states";

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
});
