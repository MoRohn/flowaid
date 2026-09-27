/**
 * Gallery fixtures for the nodes-core slice 3 catalog (UPGRADE_PLAN P6-03): one card per node as
 * the canvas draws it (the card is picked by `cardVariantFor`, exactly as on the canvas).
 */
import type { ReactNode } from "react";
import type { WorkflowNodeView } from "@/types";
import { NodeCard } from "./NodeCard";
import { VARIANT_CARDS } from "./nodeTypes";
import { cardVariantFor } from "./nodeUtils";

const port = (id: string, type: string) => ({ id, label: id, type });

function view(
  id: string,
  nodeType: string,
  category: WorkflowNodeView["category"],
  name: string,
  description: string,
  inputs: string[][],
  outputs: string[][],
  routes?: string[],
  meta?: { label: string; value: string }[],
): WorkflowNodeView {
  return {
    id,
    kind: "task",
    nodeType,
    category,
    name,
    description,
    inputs: inputs.map(([p, t]) => port(p ?? "", t ?? "any")),
    outputs: outputs.map(([p, t]) => port(p ?? "", t ?? "any")),
    ...(routes ? { routes: routes.map((r) => ({ id: r, label: r })) } : {}),
    ...(meta ? { meta } : {}),
  };
}

export const SLICE3_NODES: WorkflowNodeView[] = [
  view(
    "graphql",
    "flowaid.tools.graphql",
    "tool",
    "GraphQL",
    "query IssueByNumber",
    [["variables", "object"]],
    [
      ["data", "any"],
      ["errors", "array"],
    ],
    undefined,
    [{ label: "credential", value: "github_token" }],
  ),
  view(
    "db_query",
    "flowaid.tools.db_query",
    "tool",
    "Database query",
    "select * from orders where id = $1",
    [["params", "array"]],
    [
      ["rows", "array"],
      ["row_count", "integer"],
      ["truncated", "boolean"],
    ],
    undefined,
    [{ label: "credential", value: "orders_db" }],
  ),
  view(
    "prompt",
    "flowaid.ai.prompt",
    "generation",
    "Prompt",
    "System, history and the user turn",
    [["history", "array"]],
    [
      ["messages", "array"],
      ["count", "integer"],
    ],
  ),
  view(
    "rerank",
    "flowaid.ai.rerank",
    "retrieval",
    "Rerank",
    "Top passages for the question",
    [
      ["query", "string"],
      ["documents", "array"],
    ],
    [
      ["documents", "array"],
      ["scores", "array"],
      ["indices", "array"],
    ],
    undefined,
    [
      { label: "index", value: "cohere/rerank-v3.5" },
      { label: "top_k", value: "5" },
    ],
  ),
  view(
    "vision",
    "flowaid.ai.vision",
    "generation",
    "Vision",
    "What does the receipt say?",
    [["images", "array"]],
    [
      ["text", "string"],
      ["usage", "object"],
    ],
    undefined,
    [{ label: "model", value: "gpt-5-mini" }],
  ),
  view(
    "speech",
    "flowaid.ai.speech",
    "generation",
    "Speech",
    "Transcribe the voicemail",
    [
      ["audio", "object"],
      ["text", "string"],
    ],
    [
      ["text", "string"],
      ["audio", "object"],
    ],
    undefined,
    [{ label: "model", value: "gpt-4o-mini-transcribe" }],
  ),
  view(
    "image",
    "flowaid.ai.image",
    "generation",
    "Generate image",
    "A product shot on white",
    [],
    [
      ["artifacts", "array"],
      ["revised_prompts", "array"],
    ],
    undefined,
    [{ label: "model", value: "gpt-image-1" }],
  ),
  view(
    "policy",
    "flowaid.safety.policy_check",
    "safety",
    "Policy check",
    "Refund policy",
    [["subject", "any"]],
    [
      ["allowed", "boolean"],
      ["violations", "array"],
    ],
    ["allow", "deny"],
    [{ label: "policy", value: "refunds-v2" }],
  ),
  view(
    "limit",
    "flowaid.safety.rate_limit",
    "safety",
    "Rate limit",
    "10 per minute per customer",
    [["value", "any"]],
    [
      ["allowed", "boolean"],
      ["remaining", "number"],
    ],
    ["pass", "limited"],
    [{ label: "policy", value: "customer:{{id}}" }],
  ),
  view(
    "perm",
    "flowaid.safety.permission_check",
    "safety",
    "Permission check",
    "refunds:write",
    [["scopes", "array"]],
    [
      ["granted", "boolean"],
      ["missing", "array"],
    ],
    ["granted", "denied"],
  ),
  view(
    "test",
    "flowaid.dev.test",
    "developer",
    "Test",
    "3 assertions",
    [["actual", "any"]],
    [
      ["passed", "boolean"],
      ["results", "array"],
    ],
    ["pass", "fail"],
    [{ label: "language", value: "flowexpr" }],
  ),
  view(
    "debug",
    "flowaid.dev.debug",
    "developer",
    "Debug",
    "Log the ticket's shape",
    [["value", "any"]],
    [["value", "any"]],
  ),
  view(
    "trace",
    "flowaid.dev.trace",
    "developer",
    "Trace marker",
    "after_lookup",
    [["value", "any"]],
    [
      ["value", "any"],
      ["at", "string"],
    ],
  ),
  view(
    "session",
    "flowaid.state.session",
    "state",
    "Session memory",
    "Last 20 turns, 1 day TTL",
    [["turn", "any"]],
    [
      ["turns", "array"],
      ["count", "integer"],
    ],
    undefined,
    [{ label: "memory", value: "conversation" }],
  ),
  view(
    "checkpoint",
    "flowaid.state.checkpoint",
    "state",
    "Checkpoint",
    "Save the plan",
    [
      ["value", "any"],
      ["expected_version", "integer"],
    ],
    [
      ["value", "any"],
      ["version", "integer"],
    ],
    undefined,
    [{ label: "memory", value: "checkpoint" }],
  ),
];

/** The card the canvas would draw for a slice 3 node (none of them is a note). */
export function Slice3Card({ node }: { node: WorkflowNodeView }): ReactNode {
  const variant = cardVariantFor(node);
  const Card = variant === "note" ? NodeCard : VARIANT_CARDS[variant];
  return <Card node={node} />;
}
