/**
 * Where the app's help points. The guides and design documents live in the repository, so a
 * local install and the published project read the same pages.
 */
const REPO = "https://github.com/MoRohn/flowaid";
const doc = (path: string) => `${REPO}/blob/main/${path}`;

export const HELP = {
  repository: REPO,
  issues: `${REPO}/issues/new/choose`,
  gettingStarted: doc("apps/docs/content/getting-started.md"),
  callIt: doc("apps/docs/content/getting-started.md#call-it"),
  importing: doc("apps/docs/content/importing.md"),
  documentation: doc("docs/README.md"),
  decisionContracts: doc("docs/jev/decision-contracts.md"),
  confidence: doc("docs/jev/confidence-and-consequence.md"),
  evaluations: doc("docs/design/ARCHITECTURE.md#104-evaluation-flowaidevaluation"),
  humanInTheLoop: doc("docs/design/ARCHITECTURE.md#101-human-in-the-loop"),
  knowledge: doc("docs/design/ARCHITECTURE.md#108-knowledge--rag-flowaidknowledge-p6-09"),
  pageindexSetup: doc("docs/pageindex/SETUP.md"),
  api: doc("docs/design/API.md"),
  triggers: doc("docs/design/API.md#6-webhook-ingress-and-callbacks"),
  environment: doc("packages/env/README.md"),
} as const;

/** Where to get the keys the getting-started checklist asks for. */
export const PROVIDER_KEY_URL = {
  typesafe: "https://docs.typesafe.ai",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  ollama: "https://ollama.com/download",
} as const;
