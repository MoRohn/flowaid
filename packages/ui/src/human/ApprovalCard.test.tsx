import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import { HumanResponseSchema } from "@flowaid/workflow-core";
import type { HumanResponse } from "@/types";
import {
  ApprovalCard,
  choiceOptions,
  humanizeKey,
  parseReviewValue,
  reviewValueText,
  shapeContext,
} from "./ApprovalCard";
import { approvalOutcomeFor } from "./ApprovalOutcomeBadge";
import {
  APPROVE_REJECT_REQUEST,
  EDIT_OUTPUT_REQUEST,
  ESCALATION_TARGETS,
  FIXTURE_NOW,
  FORM_REQUEST,
  SELECT_REQUEST,
  TOOL_APPROVAL_REQUEST,
} from "./fixtures";

beforeAll(installDomStubs);
afterEach(cleanup);

function setup(
  request = APPROVE_REJECT_REQUEST,
  extra: Partial<Parameters<typeof ApprovalCard>[0]> = {},
) {
  const onRespond = vi.fn<(r: HumanResponse) => void>();
  const utils = render(
    <ApprovalCard
      request={request}
      workflowName="Support triage"
      onRespond={onRespond}
      now={FIXTURE_NOW}
      escalationTargets={ESCALATION_TARGETS}
      {...extra}
    />,
  );
  return { onRespond, ...utils };
}

/** Every response the card emits must be a spec-exact `HumanResponse`. */
function lastResponse(
  onRespond: ReturnType<typeof vi.fn<(r: HumanResponse) => void>>,
): HumanResponse {
  const last = onRespond.mock.lastCall?.[0];
  if (!last) throw new Error("no response emitted");
  return HumanResponseSchema.parse(last);
}

describe("shapeContext", () => {
  it("lifts the message, keeps primitives as pairs and counts nested values", () => {
    const shape = shapeContext({
      message: "Hello",
      customer: "Amara",
      priorTickets: 2,
      meta: { a: 1 },
      tags: [],
    });
    expect(shape.message).toBe("Hello");
    expect(shape.pairs).toEqual([
      { key: "customer", value: "Amara" },
      { key: "priorTickets", value: 2 },
    ]);
    expect(shape.nested).toBe(2);
    expect(shapeContext("plain")).toEqual({ message: "plain", pairs: [], nested: 0 });
    expect(shapeContext(undefined).nested).toBe(0);
  });

  it("humanizes keys", () => {
    expect(humanizeKey("accountAgeDays")).toBe("Account age days");
    expect(humanizeKey("ticket_id")).toBe("Ticket id");
  });

  it("round-trips review values through text", () => {
    expect(reviewValueText("hi")).toBe("hi");
    expect(reviewValueText({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(parseReviewValue("hi", "edited")).toBe("edited");
    expect(parseReviewValue({ a: 1 }, '{"a": 2}')).toEqual({ a: 2 });
    expect(parseReviewValue({ a: 1 }, "{not json")).toBeUndefined();
  });

  it("annotates choice options with the decision's probabilities", () => {
    expect(choiceOptions(SELECT_REQUEST).map((o) => `${o.id}:${o.probability ?? "-"}`)).toEqual([
      "security:0.71",
      "billing:0.18",
      "technical:0.08",
      "sales:0.03",
    ]);
    expect(choiceOptions(APPROVE_REJECT_REQUEST)).toEqual([]);
  });
});

describe("ApprovalCard", () => {
  it("renders the header, reason, decision, context and actions", () => {
    setup();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Refund $180.00 to Amara Okafor",
    );
    expect(screen.getByText("Support triage")).toBeInTheDocument();
    expect(screen.getByText("Why you are seeing this").parentElement).toHaveTextContent(
      "Confidence 0.78 is below the pass threshold 0.90",
    );
    expect(screen.getByRole("timer")).toHaveAttribute("data-sla", "ok");
    expect(screen.getByText("Requested 4 min ago")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Priya Shah" })).toBeInTheDocument();
    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(screen.getByText("Amara Okafor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Reject/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Escalate/ })).toBeEnabled();
  });

  it("shows the origin badge for an agent tool approval", () => {
    const { container } = setup(TOOL_APPROVAL_REQUEST, { hotkeys: false });
    expect(container.firstElementChild).toHaveAttribute("data-origin", "task_suspend");
    expect(screen.getByText("Agent tool approval")).toBeInTheDocument();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("approval mode emits approve / reject with the trimmed comment", async () => {
    const user = userEvent.setup();
    const { onRespond } = setup();
    await user.type(screen.getByRole("textbox", { name: /Comment/ }), "  Looks right  ");
    await user.click(screen.getByRole("button", { name: /Approve/ }));
    expect(lastResponse(onRespond)).toEqual({ action: "approve", comment: "Looks right" });
    await user.click(screen.getByRole("button", { name: /Reject/ }));
    expect(lastResponse(onRespond)).toEqual({ action: "reject", comment: "Looks right" });
  });

  it("omits an empty comment", async () => {
    const user = userEvent.setup();
    const { onRespond } = setup();
    await user.click(screen.getByRole("button", { name: /Approve/ }));
    expect(lastResponse(onRespond)).toEqual({ action: "approve" });
  });

  it("review mode emits the edited value and relabels the primary action when edited", async () => {
    const user = userEvent.setup();
    const { onRespond } = setup(EDIT_OUTPUT_REQUEST, { hotkeys: false });
    await user.click(screen.getByRole("button", { name: /Approve/ }));
    expect(lastResponse(onRespond)).toEqual({ action: "approve" });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByRole("textbox", { name: "Proposed by the model" });
    await user.clear(box);
    await user.type(box, "Hi Amara, refund issued.");
    const primary = screen.getByRole("button", { name: /Approve with edits/ });
    await user.click(primary);
    expect(lastResponse(onRespond)).toEqual({
      action: "approve",
      value: "Hi Amara, refund issued.",
    });
  });

  it("choice mode stays disabled until a choice and emits the option", async () => {
    const user = userEvent.setup();
    const { onRespond } = setup(SELECT_REQUEST, { hotkeys: false });
    const primary = screen.getByRole("button", { name: /Confirm choice/ });
    expect(primary).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Security/ })).toHaveAttribute(
      "data-model-pick",
      "true",
    );
    await user.click(screen.getByRole("radio", { name: /Billing/ }));
    expect(primary).toBeEnabled();
    await user.click(primary);
    expect(lastResponse(onRespond)).toEqual({ action: "choose", option: "billing" });
  });

  it("form mode submits the schema values seeded with defaults and has no comment field", async () => {
    const user = userEvent.setup();
    const { onRespond } = setup(FORM_REQUEST, { hotkeys: false });
    expect(screen.queryByRole("textbox", { name: /Comment/ })).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Account credit" }));
    await user.click(screen.getByRole("button", { name: /Submit/ }));
    expect(lastResponse(onRespond)).toEqual({
      action: "submit",
      value: { amountUsd: 180, method: "account_credit", notifyCustomer: true },
    });
  });

  it("keyboard shortcuts approve, reject and open escalation outside text fields", async () => {
    const user = userEvent.setup();
    const { onRespond } = setup();
    await user.keyboard("a");
    expect(lastResponse(onRespond)).toEqual({ action: "approve" });
    await user.keyboard("r");
    expect(lastResponse(onRespond)).toEqual({ action: "reject" });
    screen.getByRole("textbox", { name: /Comment/ }).focus();
    await user.keyboard("a");
    expect(onRespond).toHaveBeenCalledTimes(2);
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("e");
    expect(await screen.findByRole("dialog", { name: "Escalate review" })).toBeInTheDocument();
  });

  it("escalation flows through the dialog to onRespond as a list of targets", async () => {
    const user = userEvent.setup();
    const { onRespond } = setup(undefined, { hotkeys: false });
    await user.click(screen.getByRole("button", { name: /Escalate/ }));
    const dialog = await screen.findByRole("dialog", { name: "Escalate review" });
    const escalate = within(dialog).getByRole("button", { name: "Escalate" });
    expect(escalate).toBeDisabled();
    await user.click(within(dialog).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Billing team/ }));
    await user.type(
      within(dialog).getByRole("textbox", { name: /Reason/ }),
      "Needs a billing specialist",
    );
    await user.click(escalate);
    expect(lastResponse(onRespond)).toEqual({
      action: "escalate",
      to: ["team-billing"],
      comment: "Needs a billing specialist",
    });
  });

  it("locks the card while submitting and when responded", () => {
    const { rerender } = setup(undefined, { submitting: true, hotkeys: false });
    expect(screen.getByRole("button", { name: /Approve/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Reject/ })).toBeDisabled();
    rerender(
      <ApprovalCard
        request={APPROVE_REJECT_REQUEST}
        onRespond={vi.fn()}
        now={FIXTURE_NOW}
        hotkeys={false}
        responded={{
          response: { action: "reject", comment: "Only one invoice is a duplicate." },
          by: "Priya Shah",
          at: new Date(FIXTURE_NOW - 120_000).toISOString(),
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.getAllByText("Rejected").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Priya Shah").length).toBeGreaterThan(0);
    expect(screen.getByText("2 min ago")).toBeInTheDocument();
    expect(screen.getByText("Only one invoice is a duplicate.")).toBeInTheDocument();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("maps responses to outcomes", () => {
    expect(approvalOutcomeFor({ action: "approve" })).toBe("approved");
    expect(approvalOutcomeFor({ action: "approve", value: "x" })).toBe("edited");
    expect(approvalOutcomeFor({ action: "reject" })).toBe("rejected");
    expect(approvalOutcomeFor({ action: "escalate", to: ["t"] })).toBe("escalated");
    expect(approvalOutcomeFor({ action: "choose", option: "a" })).toBe("approved");
    expect(approvalOutcomeFor({ action: "submit", value: {} })).toBe("approved");
  });
});
