import type { CapabilityGuide } from "./types";

/** The draft → publish → deploy path every trigger follows, said the same way on each tab. */
const LIFECYCLE =
  "Adding one writes it into the workflow's draft; it goes live in an environment only when you publish a version that has it and deploy that version there.";

export const TRIGGERS_WEBHOOKS: CapabilityGuide = {
  id: "triggers-webhooks",
  title: "Webhooks",
  what: "Give a workflow a web address that other systems call to start a run. The JSON they send becomes the run's input.",
  when: "When something happens elsewhere and a workflow should react at once: a form is submitted, an order is placed, a ticket changes. For a timetable use Schedules; to call a workflow from your own code, an API key under Settings also works.",
  needs: `A workflow whose input matches what the sender posts. ${LIFECYCLE}`,
  start:
    "Press Add webhook. Choose the workflow, name the URL, choose how callers prove who they are and what they get back, then review and add it to the draft.",
  result:
    "After you publish and deploy, the webhook is listed here once per environment with its URL. Generate its signing secret, give both to the sender, and each call starts a run you can open from Deliveries.",
  reading: {
    title: "Reading this list",
    items: [
      "Only deployed webhooks are listed. One only in a draft shows up after publish and deploy.",
      "“No signing secret: calls are refused” means exactly that: press Generate secret for that environment.",
      "Deliveries shows every call and why a rejected one failed; a Duplicate started no second run.",
      "Replay protection: a signature older than 5 minutes, or one already used, is refused.",
    ],
  },
  quality: {
    title: "Reliable webhooks",
    items: [
      "Keep signing on; use a shared token only for senders that cannot sign.",
      "Set the idempotency header to the sender's delivery id, so a retried call does not start a second run.",
      "Send the example request under the webhook once before handing the URL out, and read the run it starts.",
    ],
  },
};

export const TRIGGERS_SCHEDULES: CapabilityGuide = {
  id: "triggers-schedules",
  title: "Schedules",
  what: "Start a workflow on a timetable, such as every weekday at 09:00, with the same input each time.",
  when: "For regular jobs nobody asks for: a morning summary, an hourly sync, a weekly report. If the work should follow an event elsewhere, a webhook reacts sooner.",
  needs: `A workflow that can run from a fixed input. ${LIFECYCLE}`,
  start:
    "Press Add schedule. Choose the workflow, pick when it runs and in which time zone, set its input, then review and add it to the draft.",
  result:
    "After you publish and deploy, each environment gets its own schedule here with its next run time. Every tick starts a real run of the deployed version, like any other run.",
  reading: {
    title: "Reading this list",
    items: [
      "Only deployed schedules are listed, once per environment.",
      "A red line under a schedule is why its last tick did not start a run.",
      "Overlap, missed runs and jitter are set here per environment, not in the workflow.",
      "Run now starts one real run at once with the schedule's input.",
    ],
  },
  quality: {
    title: "Schedules that behave",
    items: [
      "Use the time zone of the people who read the result; daylight-saving changes are handled.",
      "Start with a slower cadence: every run can call models and cost money.",
      "Keep secrets out of the input; read them through the workflow's secrets instead.",
    ],
  },
};

export const TRIGGERS_MCP: CapabilityGuide = {
  id: "triggers-mcp",
  title: "MCP tools",
  what: "Let MCP clients, such as desktop assistants and coding agents, call your deployed workflows as tools.",
  when: "When you want an assistant you already use to run a workflow for you, for example asking it to triage a refund with your Refund desk workflow.",
  needs:
    "A workflow with a version deployed to the environment you pick, and a token for each client. Exposing takes effect at once; it does not publish or deploy anything.",
  start:
    "Press Expose workflow to choose the workflow, environment, tool name and description. Then press Mint token for the client and copy the configuration it shows.",
  result:
    "A tool that clients holding a token for it list and call. Each call runs the deployed version and returns its output; a run that takes over 110 seconds or waits for a person returns a link to the run instead.",
  reading: {
    title: "Reading this list",
    items: [
      "Each tool runs one workflow in one environment, and clients see it only while that environment has a deployed version.",
      "The switch on each tool is yours: deploying, redeploying or rolling back the workflow leaves it as you set it. An Off tool stays listed here but clients do not see it.",
      "Waiting for a deployment: the tool is on, but nothing is deployed to its environment yet, so clients do not see it.",
      "Tokens are listed under Settings, API keys, as “mcp: <name>”. Revoke one there; they expire after a year.",
    ],
  },
  quality: {
    title: "Tools a model uses well",
    items: [
      "A description that says what the tool does, when to use it and what it returns: the client's model decides from it alone.",
      "Clear names and descriptions on the workflow's input fields: they become the tool's arguments.",
      "One token per client, pinned to only the workflows it needs.",
    ],
  },
};
