import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NODE_RUN_STATUSES, RUN_STATUSES, STATUS_LABEL } from "@/lib/categories";
import { StatusChip, statusIsActive, statusLabel, statusTone } from "./StatusChip";

afterEach(cleanup);

describe("StatusChip", () => {
  it.each(RUN_STATUSES)("renders the label for run status %s", (status) => {
    render(<StatusChip status={status} />);
    expect(screen.getByText(STATUS_LABEL[status])).toBeInTheDocument();
    expect(statusLabel(status)).toBe(STATUS_LABEL[status]);
  });

  it.each(NODE_RUN_STATUSES)("renders a label for node-run status %s", (status) => {
    const { container } = render(<StatusChip status={status} />);
    expect(container.textContent?.trim().length).toBeGreaterThan(0);
    expect(container.firstElementChild).toHaveAttribute("data-status", status);
  });

  it("maps statuses to tones", () => {
    expect(statusTone("queued")).toBe("queued");
    expect(statusTone("pending")).toBe("queued");
    expect(statusTone("starting")).toBe("running");
    expect(statusTone("running")).toBe("running");
    expect(statusTone("retrying")).toBe("running");
    expect(statusTone("waiting")).toBe("waiting");
    expect(statusTone("waiting_for_human")).toBe("waiting");
    expect(statusTone("completed")).toBe("ok");
    expect(statusTone("failed")).toBe("failed");
    expect(statusTone("timed_out")).toBe("failed");
    expect(statusTone("cancelled")).toBe("neutral");
    expect(statusTone("skipped")).toBe("neutral");
    expect(statusTone("retry_wait")).toBe("waiting");
    expect(statusTone("reused")).toBe("reused");
  });

  it("draws a reused node run as a green dashed chip", () => {
    const { container } = render(<StatusChip status="reused" />);
    expect(container.firstElementChild?.className).toMatch(/border-dashed/);
    expect(container.firstElementChild?.className).toMatch(/text-ok-text/);
  });

  it("pulses only while active", () => {
    const { container: running } = render(<StatusChip status="running" />);
    expect(running.querySelector(".fa-pulse")).not.toBeNull();
    const { container: done } = render(<StatusChip status="completed" />);
    expect(done.querySelector(".fa-pulse")).toBeNull();
    expect(statusIsActive("retrying")).toBe(true);
    expect(statusIsActive("waiting")).toBe(false);
  });

  it("supports label override, meta and compact mode", () => {
    render(<StatusChip status="retrying" label="3 retries" meta="2/3" />);
    expect(screen.getByText("3 retries")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    const { container } = render(<StatusChip status="failed" compact />);
    // Compact chips carry no native title: the label is sr-only text (and a hover tooltip).
    expect(container.firstElementChild).not.toHaveAttribute("title");
    expect(container.querySelector(".sr-only")?.textContent).toBe("Failed");
  });
});
