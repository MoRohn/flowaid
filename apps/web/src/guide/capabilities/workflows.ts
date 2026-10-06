import type { CapabilityGuide } from "./types";

export const WORKFLOWS: CapabilityGuide = {
  id: "workflows",
  title: "Workflows",
  what: "Find, open and create workflows: the steps that take a request, make decisions on it, call models and tools, ask a person when needed, and return a result.",
  when: "Whenever a repeated task follows the same shape, like sorting incoming messages, approving refunds or answering questions from your documents.",
  needs:
    "A TypeSafe key for decision steps, and a text model (OpenAI, Anthropic or Ollama) for steps that write text. A workflow of plain data steps needs neither.",
  start:
    "Press New workflow to describe one, start blank, pick a template or import a file. To change an existing one, open it: the builder opens on its draft.",
  result:
    "A workflow with a draft you can edit and run from the builder. Publishing freezes a numbered version; deploying that version to an environment is what the API, webhooks and schedules run.",
  reading: {
    title: "Reading the list",
    items: [
      "Each row shows the latest published version and where it is deployed. A workflow that was never published runs only from the builder.",
      "Last run and Runs · 24h show recent activity; open a workflow and its Runs tab to see the runs themselves.",
    ],
  },
};

export const NEW_WORKFLOW: CapabilityGuide = {
  id: "workflows-new",
  title: "New workflow",
  what: "Create a workflow blank, from a template, or by importing a definition you already have; with a text model set up, you can also describe it in words and let the AI builder draft it.",
  when: "Describe it when you know the job but not the steps. Blank when you know the steps. A template when one matches the job closely. Import when the definition exists elsewhere.",
  needs:
    "A name. Describe it needs a text model with a key; the draft it produces may use decision steps, which need a TypeSafe key to run.",
  start: "Give it a name, then choose how to start. The steps below walk through both.",
  result:
    "A saved workflow whose draft opens in the builder. Nothing is saved until you press Create, Apply or Import; nothing runs, is published or deployed until you do it yourself.",
  quality: {
    title: "What makes a good starting description",
    items: [
      "Say what comes in, what should come out, and who or what decides in between.",
      "Name the decisions in plain words and their options, like “is this a refund request: yes or no”.",
      "Say when a person should check the result, for example over a refund amount.",
      "The draft is a starting point: read every step on the plan before applying it, then try it on real examples in the builder.",
    ],
  },
};
