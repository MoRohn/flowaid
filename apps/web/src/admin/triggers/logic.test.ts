import { describe, expect, it } from "vitest";
import {
  channelBody,
  channelProblems,
  deliveryTone,
  draftOf,
  formatJitter,
  parseJitterSeconds,
  parseRecipients,
  toolNamesFrom,
} from "./logic";

describe("trigger helpers", () => {
  it("tones deliveries: duplicates are informational, rejections fail", () => {
    expect(deliveryTone("accepted")).toBe("ok");
    expect(deliveryTone("duplicate")).toBe("neutral");
    expect(deliveryTone("rejected")).toBe("danger");
  });

  it("formats and parses jitter within the API bound", () => {
    expect(formatJitter(0)).toBe("none");
    expect(formatJitter(30_000)).toBe("30 s");
    expect(formatJitter(120_000)).toBe("2 min");
    expect(parseJitterSeconds("45")).toBe(45_000);
    expect(parseJitterSeconds("3601")).toBeNull();
    expect(parseJitterSeconds("-1")).toBeNull();
  });

  it("reads tool names from a tools/list answer", () => {
    expect(toolNamesFrom({ result: { tools: [{ name: "refund_triage" }, {}] } })).toEqual([
      "refund_triage",
    ]);
    expect(toolNamesFrom({ error: { code: -32600 } })).toEqual([]);
  });
});

describe("notification channel drafts", () => {
  it("validates each kind", () => {
    const email = { ...draftOf(), name: "Ops", recipients: "ops@example.com, nope" };
    expect(channelProblems(email, false).recipients).toBe("nope is not an email address.");
    expect(parseRecipients("a@x.io; b@x.io\nc@x.io")).toEqual(["a@x.io", "b@x.io", "c@x.io"]);
    const slack = { ...draftOf(), kind: "slack_webhook" as const, name: "S" };
    expect(channelProblems(slack, false).slackWebhookUrl).toMatch(/Paste/);
    // editing keeps the stored URL when the field is left empty
    expect(channelProblems(slack, true).slackWebhookUrl).toBeUndefined();
    const hook = { ...draftOf(), kind: "webhook" as const, name: "H", events: [] };
    expect(channelProblems(hook, false)).toMatchObject({
      url: expect.any(String) as string,
      events: "Choose at least one event.",
    });
  });

  it("builds request bodies per kind", () => {
    expect(channelBody({ ...draftOf(), name: " Ops ", recipients: "a@x.io" })).toEqual({
      name: "Ops",
      config: { to: ["a@x.io"] },
      events: ["human_task.created", "run.failed"],
    });
    expect(
      channelBody({
        ...draftOf(),
        kind: "slack_webhook",
        name: "S",
        slackWebhookUrl: "https://hooks.slack.com/x",
      }),
    ).toMatchObject({ config: {}, slackWebhookUrl: "https://hooks.slack.com/x" });
  });
});
