/**
 * flowaid.ai.agent on the real worker: a preset from the agents table, a workflow called as a
 * tool (a child run of its deployed version), and the approval pause — the run waits for a person
 * with the agent's state saved, and continues where it stopped once approved.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, humanTasks, runs, tools } from "@flowaid/database";
import { describeDb } from "@flowaid/database/testing";
import { uuidv7 } from "@flowaid/shared";
import type { GenerationProvider, GenerationRequest, ToolDefinition } from "@flowaid/workflow-core";
import { createHarness, fakeTypesafeRegistry, type Harness } from "./test/setup.js";

const requests: GenerationRequest[] = [];

/** Calls `lookup` first; once a tool result is in the conversation, answers with it. */
const scriptedModel: GenerationProvider = {
  id: "openai",
  model: "gpt-test",
  capabilities: {
    tools: true,
    jsonSchema: false,
    vision: false,
    streaming: false,
    thinking: false,
    maxContext: 128_000,
  },
  generate: (req) => {
    requests.push(structuredClone(req));
    const result = req.messages.find((m) => m.role === "tool");
    const base = {
      usage: { inputTokens: 50, outputTokens: 5 },
      costUsd: 0.0001,
      priceSnapshot: null,
      latencyMs: 3,
      provider: "openai",
      model: "gpt-test",
    };
    return Promise.resolve(
      result
        ? {
            ...base,
            text: `Found: ${typeof result.content === "string" ? result.content : JSON.stringify(result.content)}`,
            toolCalls: [],
            finishReason: "stop",
          }
        : {
            ...base,
            text: "",
            toolCalls: [{ id: "c1", name: "lookup", args: { order: "1182" } }],
            finishReason: "tool_calls",
          },
    );
  },
  stream: () => {
    throw new Error("not streamed");
  },
  health: () => ({
    status: "healthy",
    errorRate1m: 0,
    p95LatencyMs: 0,
    consecutiveFailures: 0,
    checkedAt: new Date().toISOString(),
  }),
};

describeDb("the agent node on the worker (Postgres)", () => {
  let h: Harness;
  let agentId: string;
  let toolWorkflowId: string;
  beforeAll(async () => {
    const registry = fakeTypesafeRegistry();
    registry.register({ id: "openai", kind: "generation", create: () => scriptedModel } as never);
    h = await createHarness({ registry });

    // the workflow the agent calls as a tool
    const lookup = await h.deploy("Order lookup", {
      inputs: { type: "object", properties: { order: { type: "string" } }, required: ["order"] },
      outputs: { type: "object", properties: { status: { type: "string" } } },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "status",
          kind: "task",
          type: "flowaid.data.template",
          typeVersion: "1.0.0",
          name: "Status",
          config: { template: "order {{ start.order }} shipped" },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: {
            kind: "object",
            fields: {
              status: { kind: "ref", ref: { kind: "port", node: "status", port: "text" } },
            },
          },
        },
      ],
    });
    toolWorkflowId = lookup.workflowId;
    const def: ToolDefinition = {
      name: "lookup",
      description: "Look up an order",
      inputSchema: { type: "object", properties: { order: { type: "string" } } },
      idempotency: "safe",
      approvalRequired: false,
      source: { kind: "workflow", workflowId: toolWorkflowId },
    };
    agentId = uuidv7();
    await h.db.app.system(async (tx) => {
      await tx.insert(tools).values({
        id: uuidv7(),
        workspaceId: h.workspaceId,
        name: "Order lookup",
        kind: "workflow",
        definitions: [def],
        source: { workflowId: toolWorkflowId },
      });
      await tx.insert(agents).values({
        id: agentId,
        workspaceId: h.workspaceId,
        name: "Support agent",
        config: {
          model: { provider: "openai", model: "gpt-test" },
          system: "You are the support agent.",
          tools: [{ name: "lookup", approval: "always" }],
          maxSteps: 4,
        },
      });
    });
  });
  afterAll(() => h.close());

  it("pauses for approval, then calls the workflow tool and answers", async () => {
    const { workflowId, versionId } = await h.deploy("Agent", {
      inputs: { type: "object", properties: { task: { type: "string" } }, required: ["task"] },
      outputs: { type: "object", properties: { answer: { type: "string" } } },
      nodes: [
        { id: "start", kind: "input", name: "Input" },
        {
          id: "agent",
          kind: "task",
          type: "flowaid.ai.agent",
          typeVersion: "1.0.0",
          name: "Agent",
          config: { agentId, maxSteps: 4 },
          inputs: { task: { kind: "ref", ref: { kind: "port", node: "start", port: "task" } } },
        },
        {
          id: "done",
          kind: "output",
          name: "Done",
          value: {
            kind: "object",
            fields: {
              answer: { kind: "ref", ref: { kind: "port", node: "agent", port: "answer" } },
            },
          },
        },
      ],
      edges: [
        { id: "e1", from: { node: "start", port: "done" }, to: { node: "agent" } },
        { id: "e2", from: { node: "agent", port: "done" }, to: { node: "done" } },
      ],
    });
    const runId = await h.start(workflowId, versionId, { task: "Where is order 1182?" });
    await h.waitFor(runId, ["waiting_for_human"]);
    const [task] = await h.db.app.system((tx) =>
      tx.select().from(humanTasks).where(eq(humanTasks.runId, runId)),
    );
    expect(task?.request).toMatchObject({ title: "Approve lookup", mode: { type: "approval" } });
    expect(requests[0]?.messages[0]?.content).toBe("You are the support agent.");

    await h.store.respondHumanTask(task?.id as string, { action: "approve" }, "user:1");
    await h.queue.enqueue("run:general", { type: "run.resume", runId, reason: "human" });
    const run = await h.waitFor(runId, ["completed", "failed"], 30_000);
    expect(run.error).toBeNull();
    expect(run.output).toEqual({ answer: 'Found: {"status":"order 1182 shipped"}' });

    // the tool call ran the lookup workflow as its own run, labelled with the caller
    const children = await h.db.app.system((tx) =>
      tx.select().from(runs).where(eq(runs.workflowId, toolWorkflowId)),
    );
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ status: "completed", origin: "subflow" });
    expect(children[0]?.labels).toMatchObject({ "tool.caller_run": runId });
    const types = (await h.store.listEvents(runId, 0, 1000)).map((e) => e.type);
    expect(types).toContain("TOOL_CALLED");
    expect(types).toContain("TOOL_RETURNED");
  });
});
