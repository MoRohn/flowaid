import type { CapabilityGuide } from "./types";

export const AGENTS: CapabilityGuide = {
  id: "agents",
  title: "Agents",
  what: "Set up reusable AI helpers that decide for themselves which tools to call, such as looking up an order or opening a ticket, within limits you choose.",
  when: "When a step has to work something out in several moves, like answering “where is my order?” by checking the order system and then the shipping carrier. For one fixed question, a Decision or Generate step is simpler, faster and cheaper.",
  needs:
    "A text model with a key (OpenAI, Anthropic or Ollama). Tools are optional: connect an MCP server or import an OpenAPI document under Integrations, or expose a workflow as a tool under Triggers.",
  start:
    "Press New agent. Five short steps cover its job, model, instructions, tools and limits, then you review it before creating.",
  result:
    "A saved agent preset. On its own it does nothing: add an Agent step to a workflow, pick this preset, and run the draft. The run's trace shows every model turn and tool call.",
  quality: {
    title: "What makes an agent work well",
    items: [
      "Instructions that state the goal, what to do when it is unsure, and what the answer should look like.",
      "Only the tools the job needs. Every extra tool is another way to pick the wrong one.",
      "Approval for any tool that changes data, sends messages or spends money.",
      "Tight limits to start. If runs stop at a limit, the trace shows why; raise it only then.",
    ],
  },
};
