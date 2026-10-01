import type { CapabilityGuide } from "./types";

/** Settings is one page with tabs: its "Start here" follows the open tab. */
export const SETTINGS_WORKSPACE: CapabilityGuide = {
  id: "settings-workspace",
  title: "Workspace settings",
  what: "Name the workspace and set its limits: how long old run data and the audit log are kept, how many runs may wait in the queue, and the monthly budget runs may spend.",
  when: "Once when you set FlowAId up, and again when runs start being turned away (the queue limit or the budget) or you want to keep data for a different time.",
  needs: "Admin rights. Every field is optional: empty ones use the server's defaults.",
  start: "Change a field and press Save changes. Switching tabs keeps unsaved edits.",
  result:
    "Saved settings. The queue limit and the budget apply to the next run: once this month's spend reaches the budget, new runs are refused until next month. Retention values apply at the next nightly clean-up.",
};

export const SETTINGS_API_KEYS: CapabilityGuide = {
  id: "settings-api-keys",
  title: "API keys",
  what: "Create keys that let your own scripts, CI jobs and services call FlowAId: start runs of deployed workflows, read results, or publish from CI.",
  when: "When something outside this app needs to call a workflow, for example your website sending a support request, or a CI job publishing a new version.",
  needs:
    "A workflow with a version deployed to the environment the key calls. Keys can never do more than your own role allows.",
  start:
    "Press New API key. Steps cover the name, what the key may do, where it works, and how long it lasts, then you review it.",
  result:
    "A key shown exactly once, with an example request. FlowAId stores only a hash: copy it into your secret store straight away. Rotate or revoke it here at any time.",
  quality: {
    title: "Least privilege",
    items: [
      "Start from “Run workflows” and add scopes only when a call fails for lack of one.",
      "Pin keys used in production to the prod environment and to the workflows they call.",
      "Prefer a short expiry and rotate; an unused key still works until it expires or is revoked.",
      "Never paste a key into a workflow, a prompt or a ticket.",
    ],
  },
};

export const SETTINGS_ENVIRONMENTS: CapabilityGuide = {
  id: "settings-environments",
  title: "Environments",
  what: "The stages a workflow moves through, dev, staging and prod by default. Each has its own deployed version, secret bindings, variables, webhooks and schedules.",
  when: "To try a new version against test keys and data before it answers real requests, or to give one stage different settings (a sandbox URL, a smaller limit).",
  needs:
    "Nothing to start: every workspace has dev, staging and prod. Draft runs from the builder use dev.",
  start:
    "Edit an environment to add variables or protect it, or press New environment for another stage.",
  result:
    "An environment workflows can deploy to. A deploy only succeeds when every required secret is bound there or answered by a key set on the server; webhooks and schedules start the version deployed to their environment.",
  reading: {
    title: "How the stages differ",
    items: [
      "dev: where Run draft runs. Bind test keys here.",
      "staging: deploy a published version and try it with its webhooks and schedules before prod.",
      "prod: protected, so only admins deploy there. Bind the real keys here.",
      "Variables are plain settings ($vars.NAME); keys and passwords belong in Credentials.",
    ],
  },
};

export const SETTINGS_NOTIFICATIONS: CapabilityGuide = {
  id: "settings-notifications",
  title: "Notifications",
  what: "Send an email, a Slack message or a signed webhook when a run waits for a person, a run fails, a schedule cannot start, or a webhook call is rejected.",
  when: "When nobody watches the app all day but someone has to answer human tasks or fix failures quickly.",
  needs:
    "Somewhere to send to: email addresses (the server needs SMTP_URL to deliver them), a Slack incoming-webhook URL, or your own https endpoint.",
  start:
    "Press Add channel. Steps cover where to send, which events, and a review; you can send a test once it is added.",
  result:
    "A channel that receives the chosen events from now on. Nothing is sent while you set it up; a test goes out only when you press Send a test.",
};

export const SETTINGS_AUDIT: CapabilityGuide = {
  id: "settings-audit",
  title: "Audit log",
  what: "A record of every change to workflows, credentials, keys, environments and runs: what changed, who or what did it, and from where.",
  when: "To find out who published or deployed a version, when a credential was rotated, or what a key did before you revoked it.",
  needs: "The audit:read permission. Nothing to set up: every change is recorded as it happens.",
  start:
    "Narrow the list by period and resource, or type an exact action name, then open an event.",
  result:
    "The matching events, newest first. Opening one shows its request id, IP address and details; secret values are never recorded.",
  reading: {
    title: "Reading the log",
    items: [
      "The Action filter matches the whole name exactly, such as credential.rotate or workflow.publish.",
      "Red actions remove or revoke something; amber ones rotate keys or change access; blue ones publish or deploy.",
      "The actor is a person, an API key or the system; the request id ties an event to the server's logs.",
      "Load more fetches older events within the chosen period.",
    ],
  },
};

export const SETTINGS_GUIDES: Readonly<Record<string, CapabilityGuide>> = {
  workspace: SETTINGS_WORKSPACE,
  "api-keys": SETTINGS_API_KEYS,
  environments: SETTINGS_ENVIRONMENTS,
  notifications: SETTINGS_NOTIFICATIONS,
  audit: SETTINGS_AUDIT,
};
