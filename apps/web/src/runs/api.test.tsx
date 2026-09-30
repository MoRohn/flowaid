import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubApi, withClient } from "~/knowledge/pageindex/testApi";

vi.mock("~/session", () => ({
  useSession: () => ({ ws: "acme", workspaceName: "Acme", features: {}, can: () => true }),
}));

const { useWorkflowNames: useNameMap } = await import("./api");
const { useWorkflowNames: useNameList } = await import("~/admin/integrations/McpTab");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Both() {
  // Runs and Human tasks read a Map; Templates, Evaluations, Triggers and Settings read the page
  const map = useNameMap("acme");
  const list = useNameList();
  return (
    <p>
      {map.data ? `map:${map.data.get("w1") ?? "?"}` : "map:…"}{" "}
      {list.data ? `list:${list.data.map((w) => w.name).join(",")}` : "list:…"}
    </p>
  );
}

describe("workflow name queries", () => {
  it("keep the id → name Map and the page apart in one cache", async () => {
    stubApi({
      "GET /v1/workflows": () => ({ items: [{ id: "w1", name: "Refunds" }], next_cursor: null }),
    });
    render(withClient(<Both />));
    await waitFor(() => expect(screen.getByText("map:Refunds list:Refunds")).toBeDefined());
  });
});
