import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDomStubs } from "@/primitives/testStubs";
import { ApiError } from "~/api/client";
import { fieldLabel } from "./credentials/CredentialDialogs";
import { settingsPatch, spendLine } from "./settings/WorkspaceTab";
import { Notice, OneTimeSecretDialog, QueryView } from "./ui";

beforeAll(() => installDomStubs());
afterEach(() => cleanup());

function withClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

function Probe({ fn }: { fn: () => Promise<string[]> }) {
  const q = useQuery({ queryKey: ["probe", fn], queryFn: fn });
  return (
    <QueryView query={q}>
      {(rows) =>
        rows.length === 0 ? (
          <p>Nothing here</p>
        ) : (
          <ul>
            {rows.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )
      }
    </QueryView>
  );
}

describe("QueryView", () => {
  it("shows a busy skeleton while loading", () => {
    render(withClient(<Probe fn={() => new Promise(() => undefined)} />));
    expect(screen.getByLabelText("Loading").getAttribute("aria-busy")).toBe("true");
  });

  it("renders the empty and loaded states from the data", async () => {
    render(withClient(<Probe fn={() => Promise.resolve([])} />));
    expect(await screen.findByText("Nothing here")).toBeTruthy();
    cleanup();
    render(withClient(<Probe fn={() => Promise.resolve(["alpha", "beta"])} />));
    expect(await screen.findByText("beta")).toBeTruthy();
  });

  it("shows the API's message on errors and retries", async () => {
    const fn = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL", "the database is down"))
      .mockResolvedValueOnce(["recovered"]);
    render(withClient(<Probe fn={fn} />));
    expect(await screen.findByText("the database is down")).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    await waitFor(() => expect(screen.getByText("recovered")).toBeTruthy());
  });

  it("says 'Not found' for 404s and hides details of 403s", async () => {
    render(
      withClient(
        <Probe fn={() => Promise.reject(new ApiError(404, "NOT_FOUND", "set not found"))} />,
      ),
    );
    expect(await screen.findByText("Not found")).toBeTruthy();
    cleanup();
    render(
      withClient(
        <Probe fn={() => Promise.reject(new ApiError(403, "FORBIDDEN", "scope workflows:read"))} />,
      ),
    );
    expect(await screen.findByText("You do not have access to this.")).toBeTruthy();
  });
});

describe("OneTimeSecretDialog", () => {
  it("shows the secret once and closes on acknowledgement", () => {
    const onClose = vi.fn();
    render(<OneTimeSecretDialog secret="fa_live_abc" title="API key created" onClose={onClose} />);
    expect(screen.getByTestId("one-time-secret").textContent).toBe("fa_live_abc");
    fireEvent.click(screen.getByRole("button", { name: "I have copied it" }));
    expect(onClose).toHaveBeenCalled();
  });
  it("renders nothing without a secret", () => {
    render(<OneTimeSecretDialog secret={null} title="x" onClose={() => undefined} />);
    expect(screen.queryByTestId("one-time-secret")).toBeNull();
  });
});

describe("Notice", () => {
  it("announces danger notices as alerts", () => {
    render(<Notice tone="danger">Required secrets are not bound</Notice>);
    expect(screen.getByRole("alert").textContent).toContain("Required secrets");
  });
});

describe("credential field labels", () => {
  it("sentence-cases names and keeps acronyms", () => {
    expect(fieldLabel({ name: "apiKey" })).toBe("API key");
    expect(fieldLabel({ name: "baseUrl" })).toBe("Base URL");
    expect(fieldLabel({ name: "client_id" })).toBe("Client ID");
    expect(fieldLabel({ name: "organization" })).toBe("Organization");
  });
});

describe("workspace settings patch", () => {
  const draft = {
    name: "Acme",
    runsDays: 30,
    auditDays: null,
    artifactsDays: null,
    maxQueuedRuns: null,
    monthlyCostUsd: 250,
  };
  it("writes only the fields that are set and keeps unknown settings", () => {
    expect(
      settingsPatch(draft, { retention: { auditDays: 365 }, maxQueuedRuns: 10, custom: true }),
    ).toEqual({
      custom: true,
      retention: { runsDays: 30 },
      budgets: { monthlyCostUsd: 250 },
    });
  });
});

describe("spend against the monthly budget", () => {
  it("says what was spent, of how much, and when runs are refused", () => {
    const b = { month: "2030-03", spentUsd: 12.4, monthlyCostUsd: 100, reached: false };
    expect(spendLine(b)).toBe("Spent this month (UTC): $12.40 of $100.00 (12%).");
    expect(spendLine({ ...b, spentUsd: 100, reached: true })).toBe(
      "Spent this month (UTC): $100.00 of $100.00 (100%). New runs are refused until next month.",
    );
    expect(spendLine({ ...b, monthlyCostUsd: null })).toBe(
      "Spent this month (UTC): $12.40; no budget set.",
    );
  });
});
