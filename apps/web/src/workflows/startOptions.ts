/**
 * The ways to start a new workflow, and what each fits and produces. The new-workflow page
 * offers only those this server has turned on (the AI builder and templates are features).
 */

export type StartMethod = "describe" | "blank" | "template" | "import";

export interface StartOption {
  id: StartMethod;
  title: string;
  /** when to choose it */
  fits: string;
  /** what pressing its create button leaves you with */
  produces: string;
  /** what it needs beyond a name */
  needs: string;
}

export const START_OPTIONS: readonly StartOption[] = [
  {
    id: "describe",
    title: "Describe it",
    fits: "You know the job but not the steps.",
    produces:
      "A drafted workflow and a plan to read first: its decisions, steps, tools and the keys it needs. Apply saves it; nothing runs.",
    needs: "A text model with a key (OpenAI, Anthropic or Ollama).",
  },
  {
    id: "blank",
    title: "Blank",
    fits: "You know the steps and want to place them yourself.",
    produces: "An input and an output, connected. You add steps from the palette in the builder.",
    needs: "Nothing else.",
  },
  {
    id: "template",
    title: "From a template",
    fits: "A template matches the job closely, like support triage or one of the finance, sales, IT and customer service flows.",
    produces:
      "Your own copy of a tested workflow. Each template says which keys it needs and whether it is ready to run.",
    needs: "Whatever the template lists; you name the copy in the template's dialog.",
  },
  {
    id: "import",
    title: "Import",
    fits: "The definition already exists: a FlowAId export, or a flow exported from another visual builder.",
    produces:
      "The imported workflow with a report of anything the compiler migrated. External exports show what each step becomes before saving.",
    needs: "The JSON or YAML file, or its text.",
  },
];

/** The options this server offers, in order. */
export function startOptions(o: { aiBuilder: boolean; templates: boolean }): StartOption[] {
  return START_OPTIONS.filter(
    (x) => (x.id !== "describe" || o.aiBuilder) && (x.id !== "template" || o.templates),
  );
}

export interface NewWorkflowDraft {
  name: string;
  description: string;
  /** "" until one is chosen */
  method: StartMethod | "";
  /** Describe it: the text typed but not yet sent to the AI builder */
  idea?: string;
}

export const emptyNewWorkflow = (): NewWorkflowDraft => ({ name: "", description: "", method: "" });

/** A kept method the server no longer offers counts as not chosen. */
export function chosenMethod(
  draft: NewWorkflowDraft,
  offered: readonly StartOption[],
): StartMethod | undefined {
  return offered.find((o) => o.id === draft.method)?.id;
}

/** Examples for the AI builder: editable starting points, not templates. */
export const DESCRIBE_EXAMPLES = [
  "When a support email arrives, decide whether it is about billing, a bug or an account change, and how urgent it is. Send urgent billing emails to a person to approve before replying.",
  "Read an expense claim, check it against the policy (receipts over $75, no alcohol), approve small valid claims automatically, and ask a manager about the rest.",
  "Answer questions about our HR handbook from its documents, cite the pages, and say so when the handbook does not cover the question.",
];
