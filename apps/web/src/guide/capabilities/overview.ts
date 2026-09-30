import type { CapabilityGuide } from "./types";

export const OVERVIEW: CapabilityGuide = {
  id: "overview",
  title: "Overview",
  what: "See at a glance what is waiting for a person, which workflows are failing, what changed recently, and how runs, speed and AI cost look over a period.",
  when: "At the start of the day, or after publishing a change, to decide what to look at first. For one run in detail, open it from Runs.",
  needs:
    "Nothing to set up for reading it. The numbers fill in as workflows run; the Get started list above covers keys and a first workflow.",
  start:
    "Pick a time range, and a workflow or environment to narrow it. Then open anything under Needs attention: each row links to where you act on it.",
  result:
    "A place to decide what to do next. The page itself changes nothing: approving, retrying or deploying happens on the page each link opens.",
  reading: {
    title: "How to read it",
    items: [
      "Needs attention: approvals waiting for a person (oldest first, and how many expire within a day), and workflows whose runs failed in the chosen period.",
      "What changed: a workflow whose failure rate, speed, cost per run or decision confidence got worse compared with the four periods before. Only production runs count; evaluations, replays and forks are left out.",
      "A change is listed only when there are enough runs (at least 20 finished runs, or 20 values, in both periods), it passes a statistical test, and it is large enough to matter. Few runs means no insight, not no problem.",
      "When a new version ran most of the recent runs, it is named beside the change. That is a coincidence in time, not proof it caused it: compare the versions and look at failed runs before rolling back.",
      "Tiles count runs started from the builder, the API, triggers and subflows; evaluations, replays and forks are left out. Success rate is completed out of finished runs. Latency p95 is the time 95% of finished runs took. AI cost is what model and decision calls recorded, not an estimate. Human review rate is the share of runs that asked a person; retry rate the share where a step needed another attempt.",
      "Decision confidence shows how sure TypeSafe was across decision steps. Many answers near the middle usually means a question or its options need clearer wording.",
    ],
  },
  quality: {
    title: "What to do next",
    items: [
      "Answer approvals first: those runs are paused until someone does.",
      "For a failing workflow, open its failed runs, read the first failed step, and fix the draft in the builder. Retrying only helps with passing problems like a provider timeout.",
      "After a fix, publish and deploy it explicitly, then come back after enough runs to see whether the change disappears.",
    ],
  },
};
