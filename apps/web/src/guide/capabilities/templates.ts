import type { CapabilityGuide } from "./types";

export const TEMPLATES: CapabilityGuide = {
  id: "templates",
  title: "Templates",
  what: "Start a workflow from a working example instead of a blank canvas: business flows for everyday operations, and smaller technical templates that show one pattern each.",
  when: "When a template is close to what you need. Business flows (finance, sales, IT, customer service) are complete processes to adapt; the others show one technique, such as routing on a decision or retrieving documents, to build on.",
  needs:
    "Whatever the template lists on its card: usually a TypeSafe key for its decision steps, sometimes a text model, an MCP server or a knowledge source. The checks beside this say what the workspace already has.",
  start:
    "Pick a template and press Use template. The dialog shows what it needs, lets you name your copy and choose its servers, then creates it.",
  result:
    "Your own copy of the workflow, as a draft in the builder. Nothing runs, publishes or deploys until you press Run draft, Publish or Deploy there; the template itself never changes.",
  quality: {
    title: "Choosing a template",
    items: [
      "Pick by the decisions it makes, not the name: open the card and read its steps.",
      "“Ready to run” means the keys and servers it needs exist; it does not mean its answers suit your cases yet.",
      "Try the copy with a few real examples from your own work before relying on it.",
    ],
  },
};
