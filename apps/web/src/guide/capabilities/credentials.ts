import type { CapabilityGuide } from "./types";

export const CREDENTIALS: CapabilityGuide = {
  id: "credentials",
  title: "Credentials",
  what: "Store the keys and passwords FlowAId uses to reach other services, such as a TypeSafe or OpenAI key, a GitHub token or a database connection. They are encrypted and never shown again.",
  when: "Before a workflow calls a service that needs a key, or to use a different key from the one set on the server, for example a separate key per environment.",
  needs:
    "The key itself, from the service's own dashboard. Keys set on the server (in .env.local) can cover TypeSafe, OpenAI, Anthropic and Ollama for steps whose secret is optional.",
  start:
    "Press New credential. Four short steps cover the service, the secret, where it may be used, and a review with an optional connection test.",
  result:
    "An encrypted credential. Workflows use it through a named secret: a step's credential slot names the secret, and the workflow's Settings → Secrets binds that secret to this credential for each environment.",
  quality: {
    title: "Keeping keys safe",
    items: [
      "One credential per purpose and environment, so rotating or revoking one does not break the others.",
      "Limit a production key to the prod environment and to the workflows that need it.",
      "Use the smallest permissions the service offers (a read-only or project-scoped key when it has one).",
      "A passed connection test means the service accepted the key, not that it has the quota or permissions every step needs.",
    ],
  },
};
