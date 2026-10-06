import type { CapabilityGuide } from "./types";

/** Which Integrations tab fits which need, the same on every tab. */
const WHICH: NonNullable<CapabilityGuide["reading"]> = {
  title: "Which tab do I need?",
  items: [
    "MCP servers: the service offers an MCP server (many developer tools and business apps do). Its tools are discovered for you.",
    "OpenAPI tools: the service has a REST API with an OpenAPI (Swagger) document. Each operation becomes a tool.",
    "Providers & models: the AI models steps use. Keys go under Credentials; this tab shows which providers are ready.",
    "Plugins: new kinds of steps from npm packages, installed by an admin.",
  ],
};

export const INTEGRATIONS_MCP: CapabilityGuide = {
  id: "integrations-mcp",
  title: "MCP servers",
  what: "Connect MCP servers so workflows and agents can call the tools they offer.",
  when: "When a service you use offers an MCP server, such as an issue tracker or a file store, and an MCP step or an agent should use its tools.",
  needs:
    "The server's address, and its key stored under Credentials if it needs one. Servers on this computer or your network also need the api and worker started with FLOWAID_ALLOW_PRIVATE_NETWORK=true.",
  start:
    "Press Connect server: say where it runs and how FlowAId signs in, review and save. Then test it and discover its tools.",
  result:
    "Its discovered tools, usable in an MCP step (pick the server, then the tool) and in agents' tool lists. A tool policy limits which of them may be called.",
  reading: WHICH,
  quality: {
    title: "Safer tool use",
    items: [
      "Discover again after the server changes its tools: the list here is a snapshot.",
      "Block tools that delete or send things you never want automated.",
      "Mark tools that change data as needing approval, so agents ask a person first.",
    ],
  },
};

export const INTEGRATIONS_OPENAPI: CapabilityGuide = {
  id: "integrations-openapi",
  title: "OpenAPI tools",
  what: "Turn a REST API's OpenAPI document into typed tools, one per operation.",
  when: "When a service has a REST API with an OpenAPI (Swagger) document but no MCP server. For a single call, an HTTP request step needs no import.",
  needs:
    "The document's address or text, and the API's key stored under Credentials if it needs one. APIs on this computer or your network need FLOWAID_ALLOW_PRIVATE_NETWORK=true.",
  start:
    "Press Import OpenAPI: read the document, choose the operations, point at the server and credential, then review and import.",
  result:
    "A toolset whose operations appear in the OpenAPI step (pick the toolset, then the operation) and in agents' tool lists. Importing calls nothing. Its Details list the operations and let you rename it or change its credential.",
  reading: WHICH,
  quality: {
    title: "Tools that stay reliable",
    items: [
      "Import only the operations workflows need; fewer tools are easier for an agent to choose from.",
      "Use a key with the least access that works.",
      "Run a draft that calls each operation once, and read the call in the trace, before relying on it.",
    ],
  },
};

export const INTEGRATIONS_PROVIDERS: CapabilityGuide = {
  id: "integrations-providers",
  title: "Providers & models",
  what: "See which AI model providers are ready to use, and every model they offer with its list price.",
  when: "Before choosing a model for a step or an agent, or when a step says its provider has no key.",
  needs:
    "A key for each provider you use: set on the server in FlowAId's environment, or added as a credential under Credentials.",
  start:
    "Check the provider cards. For one without a key, follow its Add credential link; the models table lists what each provider offers.",
  result:
    "Providers with a key can be chosen wherever a step or agent asks for a model. Prices are the providers' list prices per million tokens, not a quote for your runs.",
  reading: WHICH,
};

export const INTEGRATIONS_PLUGINS: CapabilityGuide = {
  id: "integrations-plugins",
  title: "Plugins",
  what: "Add new kinds of steps from node packages, and turn installed ones on or off.",
  when: "When the step you need is not in the palette and a package for it exists, such as a connector your team published.",
  needs:
    "Admin rights, and a package the server's allow-list (FLOWAID_PLUGIN_ALLOWED_SCOPES) permits; by default only @flowaid packages.",
  start:
    "Search under Discover for packages with the flowaid-node keyword, or type a package name under Install a package.",
  result:
    "The package's steps join the palette once the workers restart. Bundled packages are always there and cannot be removed.",
  reading: WHICH,
  quality: {
    title: "Installing with care",
    items: [
      "Pin the integrity when you have reviewed an exact release.",
      "Check which workflows use a package's steps before removing it: they stop compiling until it is installed again.",
    ],
  },
};
