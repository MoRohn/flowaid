/**
 * Ask FlowAId in the web app (FLOWAID_V2_ROADMAP 4.2): the answer types of
 * `POST /v1/assistant/ask` and the pure helpers the panel renders with.
 */
import { ApiError } from "~/api/client";

export type StatementKind = "fact" | "calculation" | "recommendation" | "uncertain";
export type SourceKind = "workflow" | "run" | "task" | "insight" | "metrics";

export interface AssistantSource {
  id: string;
  kind: SourceKind;
  label: string;
  workflowId?: string;
}

export interface AssistantAnswer {
  statements: { text: string; kind: StatementKind; sources: string[]; unverified?: true }[];
  sources: AssistantSource[];
  toolCalls: { name: string; ok: boolean }[];
  rounds: number;
  stopped: "rounds" | "budget" | null;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  promptHash: string;
  model: { provider: string; model: string };
}

export interface Turn {
  id: string;
  question: string;
  answer?: AssistantAnswer;
  error?: string;
}

/** How each kind of statement is labelled, so a reader can tell facts from suggestions. */
export const KIND_META: Record<
  StatementKind,
  { label: string; tone: "neutral" | "info" | "accent" | "warn"; hint: string }
> = {
  fact: { label: "Fact", tone: "neutral", hint: "Read from your workspace" },
  calculation: { label: "Calculation", tone: "info", hint: "Worked out from your workspace data" },
  recommendation: { label: "Suggestion", tone: "accent", hint: "Something you could do" },
  uncertain: { label: "Unconfirmed", tone: "warn", hint: "Not confirmed by your workspace data" },
};

/** Where a cited record opens in the app. */
export function sourceHref(ws: string, s: AssistantSource): string {
  switch (s.kind) {
    case "run":
      return `/${ws}/runs/${s.id}`;
    case "workflow":
      return `/${ws}/workflows/${s.id}`;
    case "task":
      return `/${ws}/human-tasks/${s.id}`;
    case "insight":
    case "metrics":
      return `/${ws}`;
  }
}

/** Earlier turns as model history: the question, then the answer's statements as text. */
export function historyFor(
  turns: readonly Turn[],
): { role: "user" | "assistant"; content: string }[] {
  return turns
    .filter((t) => t.answer)
    .slice(-3)
    .flatMap((t) => [
      { role: "user" as const, content: t.question },
      {
        role: "assistant" as const,
        content: (t.answer?.statements ?? [])
          .map((s) => `[${s.kind}] ${s.text}`)
          .join("\n")
          .slice(0, 4000),
      },
    ]);
}

/** What went wrong, in words a person can act on. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409)
      return "Ask FlowAId needs a generation model. Add an Anthropic, OpenAI or Ollama credential, then ask again.";
    if (error.status === 429)
      return "That was a lot of questions in a minute. Wait a moment and ask again.";
    if (error.status === 400) return "Questions need at least a few words.";
    return error.message;
  }
  return "The question could not be sent. Check that FlowAId is running and try again.";
}

/** "fake/m · 3 lookups · 1,240 tokens · $0.0031" */
export function provenance(a: AssistantAnswer): string {
  const lookups = a.toolCalls.length;
  const tokens = a.usage.inputTokens + a.usage.outputTokens;
  const cost = a.costUsd < 0.01 ? a.costUsd.toFixed(4) : a.costUsd.toFixed(2);
  return [
    `${a.model.provider}/${a.model.model}`,
    `${lookups} ${lookups === 1 ? "lookup" : "lookups"}`,
    `${tokens.toLocaleString("en-US")} tokens`,
    `$${cost}`,
  ].join(" · ");
}

export const SUGGESTED_QUESTIONS = [
  "What failed in the last 24 hours, and why?",
  "Did anything get slower or more expensive this week?",
  "What is waiting for my approval?",
] as const;
