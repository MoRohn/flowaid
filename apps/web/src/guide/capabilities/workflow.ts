/** The pages of one workflow besides the builder: runs, versions, compare, deployments, settings. */
import type { CapabilityGuide } from "./types";

const LIFECYCLE =
  "The draft is what you edit and run in the builder. Publishing freezes the draft as a numbered version that never changes. Deploying puts one version live in an environment; the API, webhooks and schedules there run that version.";

export const WORKFLOW_RUNS: CapabilityGuide = {
  id: "workflow-runs",
  title: "this workflow's runs",
  what: "Every run of this workflow, newest first: from the builder, the API, webhooks, schedules and evaluations.",
  when: "After a change, to check that runs complete; or when someone reports a wrong result and you need to find that run.",
  needs: "Nothing: runs appear as soon as the workflow runs anywhere.",
  start:
    "Filter by status (failed, waiting for a person), environment, where it started, or a time range, then open a run to read its trace.",
  result:
    "The run that answers your question, with each step's input, output, decision confidence and recorded cost.",
  reading: {
    title: "Reading a run from here",
    items: [
      "Each run records the version it ran, shown when you open it; runs started from the builder ran the draft.",
      "Waiting runs are paused on a person or an event, not stuck; the Human tasks page lists what they wait for.",
    ],
  },
};

export const WORKFLOW_VERSIONS: CapabilityGuide = {
  id: "workflow-versions",
  title: "Versions",
  what: "Every published version of this workflow, where each one is deployed, and ways to compare, export, deploy or copy one back into the draft.",
  when: "Before deploying, to see what differs from what is live; or when a change made things worse and you want the previous version back.",
  needs: "At least one published version. Publish from the builder's Publish button.",
  start:
    "Tick two versions and press Compare, or use Deploy on a version to open the deployment step for it.",
  result: `${LIFECYCLE} Restoring a version only replaces the draft; published versions and what is live stay as they are.`,
};

export const VERSION_COMPARE: CapabilityGuide = {
  id: "workflow-compare",
  title: "Compare versions",
  what: "What changed between two published versions: steps added, removed or edited, connections, inputs, outputs and settings, and evaluation scores when both were evaluated.",
  when: "Before promoting a version to production, or when a change in the Overview points at a new version.",
  needs:
    "Two published versions. Evaluation scores appear only when the workflow's evaluation set was run on both.",
  start:
    "Choose the base (the older one) and the candidate. Read the summary first, then the full definition diff for detail.",
  result:
    "A clear picture of the difference. Deploy or roll back only from the Deployments page, with its own confirmation.",
  reading: {
    title: "Reading the comparison",
    items: [
      "A changed step shows the exact settings that differ; a question reworded is a real change in how TypeSafe answers.",
      "Better evaluation scores on a small set are a hint, not proof. Look at the cases that changed.",
    ],
  },
};

export const WORKFLOW_DEPLOYMENTS: CapabilityGuide = {
  id: "workflow-deployments",
  title: "Deployments",
  what: "Choose which published version runs in each environment, with its variable overrides, and roll back or promote between environments.",
  when: "After publishing a version you have tried, to make it live; or to undo a bad release with Roll back.",
  needs:
    "A published version, and every required secret bound for the environment (Settings, Secrets). Protected environments need an admin.",
  start:
    "Press Deploy on an environment, pick the version, check the changes and press Deploy in the dialog. Nothing deploys without that last press.",
  result:
    "The version live in that environment. Its webhooks and schedules switch to it at once; runs already going finish on the version they started with.",
  reading: {
    title: "Before you deploy",
    items: [
      LIFECYCLE,
      "Try it first: run the draft in the builder, or deploy to dev or staging before production.",
      "Deploying again with the same version re-applies variable overrides and triggers.",
    ],
  },
};

export const WORKFLOW_SETTINGS: CapabilityGuide = {
  id: "workflow-settings",
  title: "Workflow settings",
  what: "Name and describe the workflow, connect its secrets to credentials per environment, manage its webhooks and schedules, link an evaluation set, and archive or delete it.",
  when: "Before the first deploy (secrets), when other systems should start it (triggers), or when you want a publish gate (evaluation).",
  needs:
    "Secrets appear here once a step needs a key; credentials to bind them to live under Credentials.",
  start:
    "Pick a section. Each saves on its own; unsaved edits in one section are kept while you look at another.",
  result:
    "Settings that apply per environment when a version is deployed. Changing them does not publish or deploy anything.",
};
