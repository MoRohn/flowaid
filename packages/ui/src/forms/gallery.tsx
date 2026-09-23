import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { startCompletion } from "@codemirror/autocomplete";
import { Cloud, KeyRound, Save, Sparkles } from "lucide-react";
import type {
  CredentialSlot,
  Diagnostic,
  JsonSchema as CoreJsonSchema,
  SecretDecl,
  SecretName,
} from "@flowaid/workflow-core";
import { CronEditor } from "./CronEditor";
import { JsonSchemaEditor } from "./JsonSchemaEditor";
import { LevelsList } from "./LevelsList";
import { TemplateEditor, type TemplateRef } from "./TemplateEditor";
import { cn } from "@/lib/cn";
import type { CredentialView, ExpressionScope, GateConfig, JsonSchema, ModelView } from "@/types";
import { Badge, Button, FieldRow, Switch } from "@/primitives";
import {
  CodeEditor,
  CredentialPicker,
  CriteriaEditor,
  ExpressionInput,
  ExpressionReferencePicker,
  ExpressionTextarea,
  KeyValueEditor,
  ModelPicker,
  ReorderableList,
  RetryPolicyEditor,
  SchemaForm,
  ThresholdField,
  type DecisionCriteria,
  type ExpressionEditorHandle,
  type ExpressionValidation,
  type KeyValueRow,
  type OptionItem,
  type RetryPolicy,
  type SchemaValues,
} from "./index";

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

function Section({
  id,
  title,
  caption,
  children,
}: {
  id: string;
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="flex flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-eyebrow">{title}</h2>
        {caption ? <p className="max-w-2xl text-xs text-ink-3">{caption}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Swatch({
  label,
  children,
  className,
  boxClassName,
  width,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
  boxClassName?: string;
  width?: number;
}) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-2", className)}
      style={width ? { width, maxWidth: "100%" } : undefined}
    >
      {label ? <p className="text-2xs font-medium text-ink-3">{label}</p> : null}
      <div
        className={cn(
          "min-w-0 rounded-md border border-border bg-surface p-4 shadow-1",
          boxClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}

function ValuesReadout({ values, valid }: { values: SchemaValues | null; valid: boolean | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <p className="text-2xs font-medium text-ink-3">onChange(values, isValid)</p>
        {valid === null ? (
          <Badge size="sm" tone="neutral" mono>
            untouched
          </Badge>
        ) : valid ? (
          <Badge size="sm" tone="ok" dot mono>
            valid
          </Badge>
        ) : (
          <Badge size="sm" tone="danger" dot mono>
            invalid
          </Badge>
        )}
      </div>
      <pre className="max-h-[420px] min-w-0 overflow-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-2xs leading-relaxed text-ink-2 tabular">
        {values ? JSON.stringify(values, null, 2) : "Edit a field to see the values."}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sample data: support-triage workflow
// ---------------------------------------------------------------------------

const SCOPE: ExpressionScope = {
  inputs: [
    { id: "message", label: "Message", type: "string", description: "Customer message body" },
    { id: "customer", label: "Customer", type: "object", description: "Account record" },
    { id: "ticket", label: "Ticket", type: "object", description: "Zendesk ticket" },
  ],
  variables: [
    { name: "locale", type: "string" },
    { name: "brand", type: "string" },
    { name: "slaHours", type: "number" },
  ],
  nodes: [
    {
      id: "intent",
      name: "Intent choice",
      outputs: [
        {
          id: "value",
          label: "Value",
          type: "string",
          description: "billing · technical · account · other",
        },
        { id: "confidence", label: "Confidence", type: "number" },
        { id: "probabilities", label: "Probabilities", type: "object" },
      ],
    },
    {
      id: "urgency",
      name: "Urgency score",
      outputs: [
        { id: "value", label: "Value", type: "number", description: "0–4 level index" },
        { id: "confidence", label: "Confidence", type: "number" },
      ],
    },
    {
      id: "escalation",
      name: "Escalation noul",
      outputs: [
        { id: "value", label: "Value", type: "boolean" },
        { id: "confidence", label: "Confidence", type: "number" },
      ],
    },
    {
      id: "lookup",
      name: "Lookup order",
      outputs: [
        { id: "status", label: "Status", type: "integer", description: "HTTP status" },
        { id: "body", label: "Body", type: "object" },
        { id: "durationMs", label: "Duration", type: "number" },
      ],
    },
  ],
};

const CREDENTIALS: CredentialView[] = [
  {
    id: "cred_zendesk",
    name: "Zendesk API (support)",
    type: "http_bearer",
    environment: "production",
    lastUsedAt: "2026-09-22T08:12:00Z",
  },
  {
    id: "cred_zendesk_stg",
    name: "Zendesk API (sandbox)",
    type: "http_bearer",
    environment: "staging",
    lastUsedAt: "2026-09-18T15:40:00Z",
  },
  {
    id: "cred_openai",
    name: "OpenAI org key",
    type: "openai",
    environment: "production",
    lastUsedAt: "2026-09-22T09:01:00Z",
  },
  {
    id: "cred_typesafe",
    name: "TypeSafe workspace",
    type: "typesafe",
    environment: "production",
    lastUsedAt: "2026-09-22T09:03:00Z",
  },
  { id: "cred_slack", name: "Slack incoming webhook", type: "webhook" },
];

const MODELS: ModelView[] = [
  {
    id: "jev-latest",
    provider: "TypeSafe",
    name: "jev-latest",
    kind: "decision",
    contextTokens: 32_000,
    inputCostPerMTok: 0.4,
    outputCostPerMTok: 0,
    health: "healthy",
  },
  {
    id: "jev-mini",
    provider: "TypeSafe",
    name: "jev-mini",
    kind: "decision",
    contextTokens: 16_000,
    inputCostPerMTok: 0.1,
    outputCostPerMTok: 0,
    health: "healthy",
  },
  {
    id: "jev-2026-06",
    provider: "TypeSafe",
    name: "jev-2026-06",
    kind: "decision",
    contextTokens: 32_000,
    inputCostPerMTok: 0.4,
    outputCostPerMTok: 0,
    health: "degraded",
  },
  {
    id: "rule-adapter",
    provider: "rule",
    name: "Rule adapter",
    kind: "decision",
    health: "healthy",
  },
  {
    id: "llm-adapter",
    provider: "llm",
    name: "LLM adapter (gpt-5-mini)",
    kind: "decision",
    contextTokens: 400_000,
    inputCostPerMTok: 0.25,
    outputCostPerMTok: 2,
    health: "healthy",
  },
  {
    id: "gpt-5",
    provider: "OpenAI",
    name: "gpt-5",
    kind: "generation",
    contextTokens: 400_000,
    inputCostPerMTok: 1.25,
    outputCostPerMTok: 10,
    health: "healthy",
  },
  {
    id: "gpt-5-mini",
    provider: "OpenAI",
    name: "gpt-5-mini",
    kind: "generation",
    contextTokens: 400_000,
    inputCostPerMTok: 0.25,
    outputCostPerMTok: 2,
    health: "healthy",
  },
  {
    id: "claude-sonnet-4-5",
    provider: "Anthropic",
    name: "claude-sonnet-4-5",
    kind: "generation",
    contextTokens: 200_000,
    inputCostPerMTok: 3,
    outputCostPerMTok: 15,
    health: "healthy",
  },
  {
    id: "claude-haiku-4-5",
    provider: "Anthropic",
    name: "claude-haiku-4-5",
    kind: "generation",
    contextTokens: 200_000,
    inputCostPerMTok: 1,
    outputCostPerMTok: 5,
    health: "degraded",
  },
  {
    id: "gemini-2.5-flash",
    provider: "Google",
    name: "gemini-2.5-flash",
    kind: "generation",
    contextTokens: 1_000_000,
    inputCostPerMTok: 0.3,
    outputCostPerMTok: 2.5,
    health: "down",
  },
  {
    id: "llama3.1:8b",
    provider: "Ollama",
    name: "llama3.1:8b",
    kind: "generation",
    contextTokens: 128_000,
    local: true,
    health: "healthy",
  },
  {
    id: "qwen2.5:14b",
    provider: "vLLM",
    name: "qwen2.5:14b",
    kind: "generation",
    contextTokens: 32_000,
    local: true,
    health: "unknown",
  },
  {
    id: "text-embedding-3-small",
    provider: "OpenAI",
    name: "text-embedding-3-small",
    kind: "embedding",
    contextTokens: 8_191,
    inputCostPerMTok: 0.02,
    health: "healthy",
  },
];

const CONFIDENCE_SAMPLES: number[] = [
  0.97, 0.95, 0.94, 0.93, 0.93, 0.92, 0.92, 0.91, 0.91, 0.9, 0.9, 0.89, 0.88, 0.88, 0.87, 0.86,
  0.85, 0.85, 0.84, 0.83, 0.82, 0.81, 0.81, 0.79, 0.78, 0.77, 0.76, 0.75, 0.74, 0.72, 0.71, 0.7,
  0.68, 0.66, 0.64, 0.62, 0.61, 0.59, 0.57, 0.55, 0.52, 0.51, 0.48, 0.44, 0.41, 0.38, 0.33, 0.29,
  0.96, 0.9, 0.89, 0.86, 0.83, 0.8, 0.79, 0.77, 0.74, 0.73, 0.69, 0.65, 0.6, 0.58, 0.54, 0.47,
];

const RETRY_DEF: JsonSchema = {
  type: "object",
  title: "Retry policy",
  properties: {
    maxAttempts: { type: "integer", minimum: 1, maximum: 10, default: 3 },
    initialDelayMs: { type: "integer", minimum: 0, default: 500 },
    backoff: { type: "string", enum: ["fixed", "exponential"], default: "exponential" },
    maxDelayMs: { type: "integer", minimum: 0, default: 10000 },
    jitter: { type: "boolean", default: true },
    retryableErrorCodes: {
      type: "array",
      items: { type: "string" },
      default: ["TIMEOUT", "RATE_LIMITED", "PROVIDER_UNAVAILABLE", "NETWORK"],
    },
  },
};

const CHOICE_NODE_SCHEMA: JsonSchema = {
  type: "object",
  title: "Intent choice",
  $defs: { RetryPolicy: RETRY_DEF },
  properties: {
    question: {
      type: "string",
      title: "Question",
      description: "Asked of the decision model with the criteria below.",
      minLength: 8,
      format: "multiline",
      default: "What is the customer asking for?",
      "x-ui": { order: 1, group: "Decision", placeholder: "What does this message ask for?" },
    },
    criteria: {
      type: "object",
      title: "Criteria",
      properties: { kind: { const: "choice" } },
      default: {
        kind: "choice",
        options: [
          { key: "billing", description: "Charges, invoices, refunds or payment methods" },
          { key: "technical", description: "Bugs, outages, integrations or the API" },
          { key: "account", description: "Login, seats, permissions or data export" },
          { key: "other", description: "Anything that does not fit the above" },
        ],
      },
      "x-ui": { widget: "criteria", order: 2, group: "Decision" },
    },
    model: {
      type: "string",
      title: "Model",
      default: "jev-latest",
      "x-ui": { widget: "model", order: 3, group: "Model" },
      "x-ui-ext": { modelKind: "decision" },
    },
    thresholds: {
      type: "object",
      title: "Confidence gate",
      properties: { review: { type: "number" }, auto: { type: "number" } },
      default: { review: 0.7, auto: 0.9 },
      "x-ui": { order: 4, group: "Model" },
      "x-ui-ext": { widget: "threshold" },
    },
    cacheDecisions: {
      type: "boolean",
      title: "Cache identical inputs",
      description: "Reuse the answer for the same message within the run window.",
      default: true,
      "x-ui": { order: 5, group: "Model" },
    },
    timeoutMs: {
      type: "integer",
      title: "Timeout",
      description: "Milliseconds before the decision fails over.",
      minimum: 500,
      maximum: 60000,
      default: 8000,
      "x-ui": { collapsed: true, group: "Model" },
    },
    retry: { $ref: "#/$defs/RetryPolicy", "x-ui": { collapsed: true, group: "Model" } },
  },
  required: ["question", "criteria", "model", "thresholds"],
};

const HTTP_NODE_SCHEMA: JsonSchema = {
  type: "object",
  title: "Lookup order",
  $defs: { RetryPolicy: RETRY_DEF },
  properties: {
    method: {
      type: "string",
      title: "Method",
      enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      default: "GET",
      "x-ui": { widget: "select", order: 1, group: "Request" },
    },
    url: {
      type: "string",
      title: "URL",
      format: "uri",
      description: "Template; references resolve at run time.",
      default: "https://api.zendesk.com/v2/tickets/{{ input.ticket.id }}",
      "x-ui": { widget: "template", order: 2, group: "Request" },
    },
    headers: {
      type: "object",
      title: "Headers",
      additionalProperties: { type: "string" },
      default: { Accept: "application/json", "X-Workflow-Run": "{{ run.id }}" },
      "x-ui": { widget: "keyvalue", order: 3, group: "Request" },
    },
    body: {
      type: "object",
      title: "Body",
      description:
        "Sent as JSON for POST, PUT and PATCH: a literal, or bound to an upstream value.",
      default: { ticket: { status: "open", priority: "normal" } },
      "x-ui": {
        widget: "json",
        order: 4,
        group: "Request",
        bindable: true,
        showWhen: { path: "/method", oneOf: ["POST", "PUT", "PATCH"] },
      },
    },
    auth: {
      title: "Authentication",
      oneOf: [
        {
          type: "object",
          title: "Credential",
          description: "A stored credential, injected at run time",
          properties: {
            type: { const: "credential" },
            credentialId: {
              type: "string",
              title: "Credential",
              "x-ui-ext": { widget: "credential", credentialType: "http_bearer" },
            },
          },
          required: ["credentialId"],
        },
        {
          type: "object",
          title: "Header value",
          description: "A raw header, for internal services",
          properties: {
            type: { const: "header" },
            headerName: { type: "string", title: "Header name", default: "Authorization" },
            headerValue: { type: "string", title: "Value", "x-secret": true },
          },
          required: ["headerName", "headerValue"],
        },
        { type: "object", title: "None", properties: { type: { const: "none" } } },
      ],
      "x-ui": { order: 5, group: "Auth" },
    },
    timeoutMs: {
      type: "integer",
      title: "Timeout",
      minimum: 100,
      maximum: 120000,
      default: 15000,
      "x-ui": { collapsed: true, group: "Auth" },
    },
    followRedirects: {
      type: "boolean",
      title: "Follow redirects",
      default: true,
      "x-ui": { collapsed: true, group: "Auth" },
    },
    retry: { $ref: "#/$defs/RetryPolicy", "x-ui": { order: 6, group: "Reliability" } },
  },
  required: ["method", "url"],
};

const GENERATION_NODE_SCHEMA: JsonSchema = {
  type: "object",
  title: "Draft reply",
  properties: {
    model: {
      type: "string",
      title: "Model",
      default: "claude-sonnet-4-5",
      "x-ui": { widget: "model", order: 1 },
      "x-ui-ext": { modelKind: "generation" },
    },
    prompt: {
      type: "string",
      title: "Prompt",
      format: "prompt",
      minLength: 20,
      default:
        "You are a support agent for {{ variables.brand }}. The customer wrote:\n\n{{ input.message }}\n\nIntent: {{ nodes.intent.output.value }} (confidence {{ nodes.intent.output.confidence }}). Urgency level {{ nodes.urgency.output.value }}.\nReply in {{ variables.locale }}, in under 120 words, and never promise a refund.",
      "x-ui": { widget: "template", order: 2 },
    },
    temperature: {
      type: "number",
      title: "Temperature",
      minimum: 0,
      maximum: 2,
      multipleOf: 0.05,
      default: 0.3,
      "x-ui": { widget: "slider", order: 3 },
    },
    maxTokens: {
      type: "integer",
      title: "Max tokens",
      minimum: 16,
      maximum: 8192,
      default: 400,
      "x-ui": { order: 4 },
    },
    stopSequences: {
      type: "array",
      title: "Stop sequences",
      items: { type: "string", minLength: 1 },
      maxItems: 4,
      default: ["\n\nCustomer:"],
      "x-ui": { widget: "list", order: 5 },
    },
    stream: { type: "boolean", title: "Stream tokens", default: true, "x-ui": { order: 6 } },
    responseFormat: {
      type: "string",
      title: "Response format",
      enum: ["text", "markdown", "json"],
      default: "markdown",
      "x-ui": { collapsed: true },
      "x-ui-ext": { widget: "radio" },
    },
    seed: { type: "integer", title: "Seed", minimum: 0, "x-ui": { collapsed: true } },
  },
  required: ["model", "prompt"],
};

/** Every RFC-0012 `x-ui` hint in one form (an MCP-tool-like node). */
const HINTS_NODE_SCHEMA: JsonSchema = {
  type: "object",
  title: "Search issues",
  properties: {
    serverId: {
      type: "string",
      title: "MCP server",
      "x-ui": { optionsProvider: "servers", order: 1, group: "Tool" },
    },
    tool: {
      type: "string",
      title: "Tool",
      "x-ui": {
        optionsProvider: "tools",
        order: 2,
        group: "Tool",
        help: "Loaded from the selected server. Pick “Broken server” to see the error state.",
      },
    },
    schedule: {
      type: "string",
      title: "Schedule",
      format: "cron",
      default: "0 9 * * 1-5",
      "x-ui": { order: 3, group: "Trigger" },
    },
    notBefore: {
      type: "string",
      title: "Not before",
      format: "date-time",
      "x-ui": { order: 4, group: "Trigger" },
    },
    threshold: {
      type: "number",
      title: "Confidence threshold",
      minimum: 0,
      maximum: 1,
      default: 0.85,
      "x-ui": {
        widget: "slider",
        bindable: true,
        step: 0.01,
        order: 5,
        group: "Gate",
        help: "A literal, or bound to a variable / upstream value.",
      },
    },
    mode: {
      title: "Result mode",
      oneOf: [
        {
          type: "object",
          title: "Summary",
          description: "A short prose summary",
          properties: {
            kind: { const: "summary" },
            maxWords: { type: "integer", title: "Max words", minimum: 10, default: 120 },
          },
        },
        {
          type: "object",
          title: "Structured",
          description: "Validated JSON",
          properties: {
            kind: { const: "structured" },
            schemaName: { type: "string", title: "Schema name", minLength: 1 },
          },
          required: ["schemaName"],
        },
        {
          type: "object",
          title: "Raw",
          description: "The tool result as returned",
          properties: { kind: { const: "raw" } },
        },
      ],
      "x-ui": { order: 6, group: "Output" },
    },
    includeMetadata: {
      type: "boolean",
      title: "Include metadata",
      default: false,
      "x-ui": { order: 7, group: "Output" },
    },
    metadataKeys: {
      type: "array",
      title: "Metadata keys",
      items: { type: "string", minLength: 1 },
      default: ["labels"],
      "x-ui": {
        widget: "list",
        min: 1,
        max: 5,
        order: 8,
        group: "Output",
        showWhen: { path: "/includeMetadata", truthy: true },
      },
    },
    limits: {
      type: "object",
      title: "Limits",
      properties: {
        maxCalls: { type: "integer", title: "Max calls", minimum: 1, default: 5 },
        timeoutMs: { type: "integer", title: "Timeout (ms)", minimum: 100, default: 30000 },
      },
      "x-ui": { collapsed: true, order: 9 },
    },
    traceTag: {
      type: "string",
      title: "Trace tag",
      default: "gallery",
      "x-ui": { widget: "hidden" },
    },
  },
  required: ["serverId", "tool"],
};

const MCP_SERVERS: OptionItem[] = [
  {
    value: "srv_github",
    label: "GitHub",
    description: "github-mcp · 42 tools",
    group: "Connected",
  },
  {
    value: "srv_linear",
    label: "Linear",
    description: "linear-mcp · 18 tools",
    group: "Connected",
  },
  {
    value: "srv_broken",
    label: "Broken server",
    description: "Fails to list tools",
    group: "Unhealthy",
  },
];

const MCP_TOOLS: Record<string, OptionItem[]> = {
  srv_github: [
    {
      value: "search_issues",
      label: "search_issues",
      description: "Search issues and pull requests",
    },
    { value: "create_issue", label: "create_issue", description: "Open an issue", group: "Writes" },
  ],
  srv_linear: [
    { value: "list_issues", label: "list_issues", description: "List issues in a team" },
  ],
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Stand-in for `POST /v1/nodes/:type/options/:name`. */
async function galleryLoadOptions(
  _nodeType: string,
  name: string,
  config: SchemaValues,
  search: string,
): Promise<OptionItem[]> {
  await delay(700);
  const needle = search.toLowerCase();
  const match = (o: OptionItem) => needle === "" || o.label.toLowerCase().includes(needle);
  if (name === "servers") return MCP_SERVERS.filter(match);
  const server = typeof config.serverId === "string" ? config.serverId : "";
  if (server === "srv_broken") throw new Error("server unreachable (ECONNREFUSED)");
  return (MCP_TOOLS[server] ?? []).filter(match);
}

const GITHUB_SLOTS: CredentialSlot[] = [
  {
    name: "github",
    types: ["github.token"],
    required: true,
    description: "Token used for tool calls.",
    scopes: ["repo:read"],
  },
  { name: "proxy", types: ["http.bearer"], required: false },
];

const WORKFLOW_SECRETS: SecretDecl[] = [
  {
    name: "GITHUB_TOKEN",
    credentialType: "github.token",
    required: true,
    description: "Org bot token",
  },
  { name: "GITHUB_TOKEN_READONLY", credentialType: "github.token", required: true },
  { name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key", required: true },
];

/** Copy of `packages/workflow-core/fixtures/manifests/flowaid.tools.http.json` `configSchema`. */
const HTTP_MANIFEST_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    method: {
      type: "string",
      enum: ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"],
      default: "GET",
      "x-ui": { widget: "select" },
    },
    url: {
      type: "string",
      minLength: 1,
      "x-ui": { widget: "template", placeholder: "https://api.example.com/items/{{ start.id }}" },
    },
    headers: {
      type: "object",
      additionalProperties: { type: "string" },
      default: {},
      "x-ui": { widget: "keyvalue" },
    },
    query: {
      type: "object",
      additionalProperties: { type: "string" },
      default: {},
      "x-ui": { widget: "keyvalue" },
    },
    body: {
      "x-ui": {
        widget: "json",
        showWhen: { path: "/method", oneOf: ["POST", "PUT", "PATCH"] },
        bindable: true,
      },
    },
    responseType: { type: "string", enum: ["json", "text", "binary"], default: "json" },
    timeoutMs: { type: "integer", minimum: 1, maximum: 120000, default: 30000 },
  },
  required: ["method", "url"],
  additionalProperties: false,
};

const HTTP_SLOTS: CredentialSlot[] = [
  {
    name: "auth",
    types: ["http.bearer", "http.basic", "http.header"],
    required: false,
    description: "Applied as Authorization or a custom header.",
  },
];

const HTTP_SECRETS: SecretDecl[] = [
  { name: "SUPPORT_API_TOKEN", credentialType: "http.bearer", required: true },
];

const CHOICE_CRITERIA: DecisionCriteria = {
  kind: "choice",
  options: [
    { key: "billing", description: "Charges, invoices, refunds or payment methods" },
    { key: "technical", description: "Bugs, outages, integrations or the API" },
    { key: "account", description: "Login, seats, permissions or data export" },
    { key: "other", description: "Anything that does not fit the above" },
  ],
};

const SCORE_CRITERIA: DecisionCriteria = {
  kind: "score",
  levels: [
    "No urgency: a question or feedback",
    "Low: minor inconvenience, workaround exists",
    "Medium: blocked on a non-critical task",
    "High: production impact for one customer",
    "Critical: outage, data loss or security",
  ],
};

const BOOLEAN_CRITERIA: DecisionCriteria = {
  kind: "boolean",
  trueCriteria:
    "The customer threatens to cancel, mentions legal action, or reports a security incident",
  falseCriteria: "A routine request with no threat, deadline or safety signal",
};

const INVALID_CRITERIA: DecisionCriteria = {
  kind: "choice",
  options: [
    { key: "Billing", description: "Charges and invoices" },
    { key: "technical", description: "Bugs and outages" },
    { key: "technical", description: "Integrations" },
  ],
};

const HEADER_ROWS: KeyValueRow[] = [
  { key: "Accept", value: "application/json" },
  { key: "X-Api-Key", value: "sk_live_4f1c9b2e7a", secret: true },
  { key: "X-Workflow-Run", value: "{{ run.id }}" },
];

const ENV_ROWS: KeyValueRow[] = [
  { key: "ZENDESK_SUBDOMAIN", value: "flowaid" },
  { key: "ZENDESK_TOKEN", value: "zd_9c2a…", secret: true },
];

const TRANSFORM_SOURCE = `// Normalise the ticket before the decision runs.
export default function transform(input: TicketInput): TriageInput {
  const message = input.message.trim().slice(0, 4000);
  return {
    message,
    customer: { id: input.customer.id, tier: input.customer.plan ?? "free" },
    ticket: { id: input.ticket.id, createdAt: new Date(input.ticket.created_at) },
  };
}
`;

const JSON_SOURCE = `{
  "ticket": { "status": "open", "priority": "normal" },
  "tags": ["triage", "auto"],
  "metadata": { "workflow": "support-triage", "version": 7 }
}`;

const BROKEN_JSON = `{
  "ticket": { "status": "open", "priority": "normal" },
  "tags": ["triage", "auto"],
}`;

// ---------------------------------------------------------------------------
// Demos
// ---------------------------------------------------------------------------

function useFormState() {
  const [values, setValues] = useState<SchemaValues | null>(null);
  const [valid, setValid] = useState<boolean | null>(null);
  const onChange = (v: SchemaValues, ok: boolean) => {
    setValues(v);
    setValid(ok);
  };
  return { values, valid, onChange };
}

function ChoiceNodeForm() {
  const state = useFormState();
  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Swatch label="Inspector · 320px · layout=stacked" boxClassName="p-3" width={320}>
        <SchemaForm
          schema={CHOICE_NODE_SCHEMA}
          models={MODELS}
          credentials={CREDENTIALS}
          confidenceSamples={CONFIDENCE_SAMPLES}
          onChange={state.onChange}
          onSubmit={(v) => state.onChange(v, true)}
          aria-label="Intent choice configuration"
        >
          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <Button size="sm" variant="ghost">
              Reset
            </Button>
            <Button size="sm" variant="primary" type="submit" leadingIcon={<Save />}>
              Save
            </Button>
          </div>
        </SchemaForm>
      </Swatch>
      <ValuesReadout values={state.values} valid={state.valid} />
    </div>
  );
}

function HttpNodeForm() {
  const state = useFormState();
  const [irreversible, setIrreversible] = useState(false);
  const onCreateCredential = (type?: string) =>
    state.onChange(
      { ...(state.values ?? {}), _createCredential: type ?? "any" },
      state.valid ?? false,
    );
  return (
    <div className="flex flex-col gap-4">
      <label className="flex w-fit cursor-pointer items-center gap-2 text-xs font-medium text-ink-2">
        <Switch
          checked={irreversible}
          onCheckedChange={setIrreversible}
          aria-label="Node flagged irreversible"
        />
        Node flagged irreversible
      </label>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Swatch label="Wide · layout=wide · two columns above 448px">
          <SchemaForm
            schema={HTTP_NODE_SCHEMA}
            layout="wide"
            credentials={CREDENTIALS}
            models={MODELS}
            scope={SCOPE}
            irreversible={irreversible}
            onCreateCredential={onCreateCredential}
            onChange={state.onChange}
            aria-label="HTTP tool configuration"
          />
        </Swatch>
        <ValuesReadout values={state.values} valid={state.valid} />
      </div>
    </div>
  );
}

function GenerationNodeForm() {
  const state = useFormState();
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Swatch label="Generation node · expression prompt with scope">
        <SchemaForm
          schema={GENERATION_NODE_SCHEMA}
          models={MODELS}
          scope={SCOPE}
          onChange={state.onChange}
          aria-label="Draft reply configuration"
        />
      </Swatch>
      <ValuesReadout values={state.values} valid={state.valid} />
    </div>
  );
}

function HintsNodeForm() {
  const state = useFormState();
  const [bindings, setBindings] = useState<Record<string, SecretName>>({ github: "GITHUB_TOKEN" });
  const [declared, setDeclared] = useState<string | null>(null);
  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Swatch
        label="Inspector · every x-ui hint · credential slots above the config"
        boxClassName="p-3"
        width={360}
      >
        <SchemaForm
          schema={HINTS_NODE_SCHEMA}
          nodeType="flowaid.tools.mcp"
          loadOptions={galleryLoadOptions}
          scope={SCOPE}
          secretSlots={{
            slots: GITHUB_SLOTS,
            secrets: WORKFLOW_SECRETS,
            value: bindings,
            onChange: setBindings,
            onDeclareSecret: (slot) => setDeclared(slot.name),
          }}
          onChange={state.onChange}
          aria-label="Search issues configuration"
        />
        {declared ? (
          <p className="mt-2 font-mono text-2xs text-ink-3">declare secret for slot “{declared}”</p>
        ) : null}
      </Swatch>
      <div className="flex min-w-0 flex-col gap-3">
        <ValuesReadout values={state.values} valid={state.valid} />
        <pre className="min-w-0 overflow-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-2xs text-ink-2">
          {`node.credentials = ${JSON.stringify(bindings)}`}
        </pre>
      </div>
    </div>
  );
}

function ManifestHttpForm() {
  const state = useFormState();
  const [bindings, setBindings] = useState<Record<string, SecretName>>({});
  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Swatch label="flowaid.tools.http manifest · as shipped" boxClassName="p-3" width={320}>
        <SchemaForm
          schema={HTTP_MANIFEST_SCHEMA}
          nodeType="flowaid.tools.http"
          scope={SCOPE}
          secretSlots={{
            slots: HTTP_SLOTS,
            secrets: HTTP_SECRETS,
            value: bindings,
            onChange: setBindings,
          }}
          onChange={state.onChange}
          aria-label="HTTP request configuration"
        />
      </Swatch>
      <ValuesReadout values={state.values} valid={state.valid} />
    </div>
  );
}

function AutocompleteDemo() {
  const ref = useRef<ExpressionEditorHandle>(null);
  const [value, setValue] = useState("{{ nodes.intent.output. }}");
  const [view, setView] = useState<ExpressionEditorHandle["view"]>(null);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (ref.current?.view) {
        setView(ref.current.view);
        window.clearInterval(timer);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!view) return;
    const timer = window.setTimeout(() => {
      view.focus();
      view.dispatch({ selection: { anchor: Math.max(0, view.state.doc.length - 3) } });
      startCompletion(view);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [view]);
  return (
    <ExpressionInput
      ref={ref}
      scope={SCOPE}
      value={value}
      onChange={setValue}
      aria-label="Autocomplete demo"
    />
  );
}

function ValidationReadout({ label, initial }: { label: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const [result, setResult] = useState<ExpressionValidation | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-2xs font-medium text-ink-3">{label}</p>
      <ExpressionInput
        scope={SCOPE}
        value={value}
        onChange={setValue}
        onValidate={setResult}
        aria-label={label}
      />
      <p className="font-mono text-2xs text-ink-3 tabular">
        {result
          ? `${result.references.length} refs · ${result.issues.length} issues · valid=${String(result.valid)}`
          : "…"}
      </p>
    </div>
  );
}

function CriteriaDemos() {
  const [choice, setChoice] = useState(CHOICE_CRITERIA);
  const [score, setScore] = useState(SCORE_CRITERIA);
  const [bool, setBool] = useState(BOOLEAN_CRITERIA);
  const [invalid, setInvalid] = useState(INVALID_CRITERIA);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Swatch label="Choice · 4 options">
        <CriteriaEditor kind="choice" value={choice} onChange={setChoice} />
      </Swatch>
      <Swatch label="Score · 5 ordered levels · drag or arrow keys on the grip">
        <CriteriaEditor kind="score" value={score} onChange={setScore} />
      </Swatch>
      <Swatch label="Boolean · optional criteria texts">
        <CriteriaEditor kind="boolean" value={bool} onChange={setBool} />
      </Swatch>
      <Swatch label="Invalid · kind switcher · API messages (snake_case, duplicate)">
        <CriteriaEditor value={invalid} onChange={setInvalid} invalid />
      </Swatch>
    </div>
  );
}

function PickersDemo() {
  const [credential, setCredential] = useState<string | null>("cred_zendesk");
  const [openaiCred, setOpenaiCred] = useState<string | null>(null);
  const [decisionModel, setDecisionModel] = useState<string | null>("jev-latest");
  const [genModel, setGenModel] = useState<string | null>(null);
  const [lastCreate, setLastCreate] = useState<string | null>(null);
  const typeIcon = (c: CredentialView) =>
    c.type === "openai" || c.type === "typesafe" ? (
      <Sparkles strokeWidth={1.75} />
    ) : c.type === "webhook" ? (
      <Cloud strokeWidth={1.75} />
    ) : (
      <KeyRound strokeWidth={1.75} />
    );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Swatch label="CredentialPicker · filtered to http_bearer · type icon, environment chip, last used">
        <div className="flex flex-col gap-3">
          <FieldRow
            label="Credential"
            hint="Only bearer-token credentials are listed for this node."
          >
            <CredentialPicker
              credentials={CREDENTIALS}
              credentialType="http_bearer"
              value={credential}
              onValueChange={setCredential}
              onCreate={(t) => setLastCreate(t ?? "any")}
              typeIcon={typeIcon}
            />
          </FieldRow>
          <FieldRow label="Any type · placeholder">
            <CredentialPicker
              credentials={CREDENTIALS}
              value={openaiCred}
              onValueChange={setOpenaiCred}
              onCreate={(t) => setLastCreate(t ?? "any")}
              typeIcon={typeIcon}
            />
          </FieldRow>
          <FieldRow label="Disabled">
            <CredentialPicker
              credentials={CREDENTIALS}
              credentialType="http_bearer"
              value="cred_zendesk_stg"
              disabled
              typeIcon={typeIcon}
            />
          </FieldRow>
          <FieldRow label="Empty · no credential of type anthropic">
            <CredentialPicker
              credentials={CREDENTIALS}
              credentialType="anthropic"
              onCreate={(t) => setLastCreate(t ?? "any")}
            />
          </FieldRow>
          <p className="font-mono text-2xs text-ink-3">onCreate → {lastCreate ?? "—"}</p>
        </div>
      </Swatch>
      <Swatch label="ModelPicker · grouped by provider · context, price per M tokens, health, local chip">
        <div className="flex flex-col gap-3">
          <FieldRow
            label="Decision model"
            hint="Only TypeSafe jev-* models and the rule/LLM adapters can answer a decision."
          >
            <ModelPicker
              models={MODELS}
              kind="decision"
              value={decisionModel}
              onValueChange={setDecisionModel}
            />
          </FieldRow>
          <FieldRow label="Generation model · placeholder">
            <ModelPicker
              models={MODELS}
              kind="generation"
              value={genModel}
              onValueChange={setGenModel}
            />
          </FieldRow>
          <FieldRow label="Local model selected">
            <ModelPicker models={MODELS} kind="generation" value="llama3.1:8b" />
          </FieldRow>
          <FieldRow label="Disabled">
            <ModelPicker models={MODELS} kind="decision" value="jev-mini" disabled />
          </FieldRow>
          <FieldRow label="Embedding · none configured">
            <ModelPicker models={MODELS.filter((m) => m.kind !== "embedding")} kind="embedding" />
          </FieldRow>
        </div>
      </Swatch>
    </div>
  );
}

function CodeDemos() {
  const [jsonText, setJsonText] = useState(JSON_SOURCE);
  const [ts, setTs] = useState(TRANSFORM_SOURCE);
  const [broken, setBroken] = useState(BROKEN_JSON);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Swatch label="JSON · Format JSON in the status line">
        <CodeEditor
          language="json"
          value={jsonText}
          onChange={setJsonText}
          minRows={5}
          aria-label="Request body"
        />
      </Swatch>
      <Swatch label="TypeScript · bracket matching, folding, autocomplete">
        <CodeEditor
          language="typescript"
          value={ts}
          onChange={setTs}
          minRows={5}
          aria-label="Transform"
        />
      </Swatch>
      <Swatch label="Invalid JSON · press Format JSON to see the parse error">
        <CodeEditor
          language="json"
          value={broken}
          onChange={setBroken}
          minRows={4}
          invalid
          aria-label="Broken body"
        />
      </Swatch>
      <Swatch label="Read-only · YAML · no line numbers">
        <CodeEditor
          language="yaml"
          value={
            "name: support-triage\nversion: 7\nnodes:\n  - id: intent\n    type: decision.choice\n  - id: urgency\n    type: decision.score\n"
          }
          readOnly
          lineNumbers={false}
          minRows={4}
          aria-label="Workflow YAML"
        />
      </Swatch>
    </div>
  );
}

function KeyValueDemos() {
  const [headers, setHeaders] = useState(HEADER_ROWS);
  const [env, setEnv] = useState(ENV_ROWS);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Swatch label="Headers · secret row masked · paste “Key: Value” lines into a key">
        <KeyValueEditor
          value={headers}
          onChange={setHeaders}
          keyPlaceholder="Header"
          valuePlaceholder="Value"
        />
      </Swatch>
      <Swatch label="Environment variables · duplicate flagged">
        <KeyValueEditor
          value={[...env, { key: "zendesk_subdomain", value: "eu" }]}
          onChange={(rows) => setEnv(rows)}
          keyPlaceholder="KEY"
          valuePlaceholder="value"
        />
      </Swatch>
      <Swatch label="Read-only · and empty">
        <div className="flex flex-col gap-4">
          <KeyValueEditor value={HEADER_ROWS} readOnly />
          <KeyValueEditor value={[]} emptyText="No query parameters." addLabel="Add parameter" />
        </div>
      </Swatch>
    </div>
  );
}

function ThresholdDemos() {
  const [t, setT] = useState({ review: 0.7, auto: 0.9 });
  const [gate, setGate] = useState<GateConfig>({ threshold: 0.85 });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Swatch label="Default · controlled">
        <ThresholdField value={t} onChange={setT} label="Confidence gate" />
      </Swatch>
      <Swatch label="With 64 historic confidences">
        <ThresholdField
          defaultValue={{ review: 0.65, auto: 0.88 }}
          samples={CONFIDENCE_SAMPLES}
          label="Confidence gate"
        />
      </Swatch>
      <Swatch label="Disabled · slider only">
        <ThresholdField
          defaultValue={{ review: 0.5, auto: 0.95 }}
          disabled
          hideInputs
          label="Confidence gate"
        />
      </Swatch>
      <Swatch label="Runtime config · two-way until a floor is set">
        <ThresholdField gate={gate} onGateChange={setGate} label="Confidence gate" />
        <p className="mt-2 font-mono text-2xs text-ink-3">{JSON.stringify(gate)}</p>
      </Swatch>
    </div>
  );
}

function RetryDemos() {
  const [policy, setPolicy] = useState<RetryPolicy | undefined>(undefined);
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Swatch label="Default · exponential with jitter">
        <RetryPolicyEditor value={policy} onChange={setPolicy} />
      </Swatch>
      <Swatch label="Irreversible node · never retried">
        <RetryPolicyEditor
          defaultValue={{
            maxAttempts: 4,
            initialDelayMs: 250,
            backoff: "exponential",
            maxDelayMs: 4000,
            jitter: false,
            retryableErrorCodes: ["TIMEOUT"],
          }}
          irreversible
        />
      </Swatch>
      <Swatch label="Single attempt · fixed">
        <RetryPolicyEditor
          defaultValue={{
            maxAttempts: 1,
            initialDelayMs: 1000,
            backoff: "fixed",
            maxDelayMs: 1000,
            jitter: false,
            retryableErrorCodes: [],
          }}
        />
      </Swatch>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ReferencePickerDemo() {
  const [inserted, setInserted] = useState<string[]>([]);
  return (
    <div className="flex flex-wrap items-start gap-6">
      <FieldRow
        label="Default trigger"
        hint="Opens the scope tree with a filter; picking a row inserts its dotted path."
      >
        <div className="flex items-center gap-2">
          <ExpressionReferencePicker
            scope={SCOPE}
            onInsert={(path) => setInserted((xs) => [path, ...xs].slice(0, 4))}
          />
          <span className="text-xs text-ink-3">
            {inserted.length ? `${inserted.length} inserted` : "Nothing inserted yet"}
          </span>
        </div>
      </FieldRow>
      <FieldRow label="Custom trigger">
        <ExpressionReferencePicker
          scope={SCOPE}
          label="Pick a reference"
          onInsert={(path) => setInserted((xs) => [path, ...xs].slice(0, 4))}
          trigger={
            <Button size="sm" variant="secondary">
              Insert reference
            </Button>
          }
        />
      </FieldRow>
      <FieldRow label="Disabled">
        <ExpressionReferencePicker scope={SCOPE} onInsert={() => undefined} disabled />
      </FieldRow>
      <ul
        className="m-0 flex min-w-60 list-none flex-col gap-1 p-0 font-mono text-2xs text-ink-2"
        aria-label="Inserted references"
      >
        {inserted.map((path, i) => (
          <li key={`${path}-${i}`}>{`{{ ${path} }}`}</li>
        ))}
      </ul>
    </div>
  );
}

interface Step {
  id: string;
  label: string;
  detail: string;
}

const STEPS: Step[] = [
  { id: "classify", label: "Classify intent", detail: "choice · 4 options" },
  { id: "lookup", label: "Look up account", detail: "http · GET /v1/customers/:id" },
  { id: "draft", label: "Draft reply", detail: "generation · claude" },
  { id: "review", label: "Human review", detail: "approval · 30 min SLA" },
];

function ReorderDemo() {
  const [steps, setSteps] = useState(STEPS);
  const [lastOrder, setLastOrder] = useState<number[] | null>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Swatch label="Drag the grip, or focus it and use ↑ ↓ Home End">
        <ReorderableList
          label="Pipeline steps"
          items={steps}
          keyOf={(step) => step.id}
          onReorder={(next, order) => {
            setSteps(next);
            setLastOrder(order);
          }}
          renderItem={(step, index, handle) => (
            <div className="flex items-center gap-2 rounded-sm border border-border bg-surface px-2 py-1.5">
              {handle}
              <span className="w-4 font-mono text-2xs text-ink-3 tabular">{index + 1}</span>
              <span className="text-sm text-ink">{step.label}</span>
              <span className="ml-auto text-xs text-ink-3">{step.detail}</span>
            </div>
          )}
        />
        <p className="mt-3 font-mono text-2xs text-ink-3">
          order: {lastOrder ? `[${lastOrder.join(", ")}]` : "unchanged"}
        </p>
      </Swatch>
      <Swatch label="Disabled">
        <ReorderableList
          label="Locked steps"
          items={STEPS.slice(0, 3)}
          keyOf={(step) => step.id}
          onReorder={() => undefined}
          disabled
          renderItem={(step, _index, handle) => (
            <div className="flex items-center gap-2 rounded-sm border border-border bg-surface-2 px-2 py-1.5">
              {handle}
              <span className="text-sm text-ink-2">{step.label}</span>
            </div>
          )}
        />
      </Swatch>
    </div>
  );
}

const TEMPLATE_REFS: TemplateRef[] = [
  { ref: { kind: "port", node: "intent", port: "value" }, schema: { type: "string" } },
  { ref: { kind: "port", node: "intent", port: "confidence" }, schema: { type: "number" } },
  { ref: { kind: "port", node: "ticket", port: "message" }, schema: { type: "string" } },
  { ref: { kind: "port", node: "lookup", port: "status" }, schema: { type: "integer" } },
];

function TemplateEditorDemo() {
  const [value, setValue] = useState(
    "Reply to the customer about {{ ticket.message }}.\nTeam: {{ upper(intent.value) }} ({{ intent.confidence }}).\nTone: {{ $vars.tone }} · run {{ $run.id }} · status {{ lookp.status }}",
  );
  const start = value.indexOf("lookp.status");
  const diagnostics = [
    {
      code: "E_UNKNOWN_REF",
      severity: "error",
      message: "Unknown node 'lookp' (did you mean 'lookup'?)",
      location: { range: { start, end: start + "lookp".length } },
    },
  ] as unknown as Diagnostic[];
  return (
    <TemplateEditor
      aria-label="Prompt template"
      value={value}
      onChange={setValue}
      refs={TEMPLATE_REFS}
      variables={["tone", "team_channel"]}
      diagnostics={start >= 0 ? diagnostics : []}
    />
  );
}

function LevelsDemo() {
  const [levels, setLevels] = useState([
    "No impact",
    "Minor inconvenience",
    "Blocks a workflow",
    "Outage or data loss",
  ]);
  return <LevelsList aria-label="Urgency levels" value={levels} onChange={setLevels} />;
}

function CronDemo() {
  const [cron, setCron] = useState("0 9 * * 1-5");
  const [tz, setTz] = useState("Europe/Berlin");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {["UTC", "Europe/Berlin", "America/New_York", "Asia/Tokyo"].map((zone) => (
          <Button
            key={zone}
            size="sm"
            variant={zone === tz ? "secondary" : "ghost"}
            onClick={() => setTz(zone)}
          >
            {zone}
          </Button>
        ))}
      </div>
      <CronEditor
        aria-label="Schedule"
        value={cron}
        onChange={setCron}
        timezone={tz}
        now={new Date("2026-09-23T08:00:00.000Z")}
      />
    </div>
  );
}

function SchemaEditorDemo() {
  const [schema, setSchema] = useState<CoreJsonSchema>({
    type: "object",
    properties: {
      team: { type: "string", description: "Queue that owns the ticket" },
      urgency: { type: "integer" },
      tags: { type: "array", items: { type: "string" } },
      customer: {
        type: "object",
        properties: { id: { type: "string" }, tier: { type: "string" } },
        required: ["id"],
      },
    },
    required: ["team", "urgency"],
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <JsonSchemaEditor aria-label="Output schema" value={schema} onChange={setSchema} />
      <pre className="whitespace-pre-wrap break-all rounded-sm bg-surface-2 p-2 font-mono text-2xs text-ink-2">
        {JSON.stringify(schema, null, 2)}
      </pre>
    </div>
  );
}

export default function FormsGallery() {
  const [prompt, setPrompt] = useState(
    "Summarise the ticket for the on-call engineer.\n\nCustomer ({{ input.customer.tier }} plan) wrote: {{ input.message }}\nIntent: {{ nodes.intent.output.value }} · urgency {{ nodes.urgency.output.value }}\nOrder lookup returned HTTP {{ nodes.lookup.output.status }} in {{ nodes.lookup.output.durationMs }} ms.",
  );
  const scopeSummary = useMemo(
    () =>
      `${SCOPE.inputs.length} inputs · ${SCOPE.variables.length} variables · ${SCOPE.nodes.length} nodes`,
    [],
  );

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-10 p-6 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Forms</h1>
        <p className="max-w-2xl text-sm text-ink-2">
          Node configuration editing: a JSON-Schema-driven form and the special editors it composes.
          Every form below is live; the readout shows the values and validity reported through{" "}
          <code className="font-mono text-xs">onChange</code>.
        </p>
      </header>

      <Section
        id="schema-choice"
        title="SchemaForm · TypeSafe Choice node"
        caption="Grouped sections, criteria/model/threshold widgets, an Advanced disclosure with the timeout and the retry policy ($ref). Stacked layout at the inspector width."
      >
        <ChoiceNodeForm />
      </Section>

      <Section
        id="schema-http"
        title="SchemaForm · HTTP tool node"
        caption="Wide layout. Method enum, URL template with scope, headers as a key/value map, a bindable JSON body shown for POST / PUT / PATCH, a discriminated-union auth block (credential picker / x-secret header / none) and the retry policy. Flag the node irreversible to see the retry note."
      >
        <HttpNodeForm />
      </Section>

      <Section
        id="schema-generation"
        title="SchemaForm · Generation node"
        caption="Model picker filtered to generation models, a prompt template with chips and reference autocomplete, a temperature slider with mono readout, a list of stop sequences and a radio enum (x-ui-ext) under Advanced."
      >
        <GenerationNodeForm />
      </Section>

      <Section
        id="schema-hints"
        title="SchemaForm · x-ui hints (RFC-0012)"
        caption="optionsProvider comboboxes with loading / error / refresh (pick “Broken server”), format: cron and date-time, a bindable slider (Literal ⇄ Ref / Template / Expr), a discriminated oneOf as a segmented control, showWhen (the metadata list appears with the switch), a repeatable list with min/max, a collapsed fieldset and a hidden field. Credential slots render above the config."
      >
        <HintsNodeForm />
      </Section>

      <Section
        id="schema-manifest"
        title="SchemaForm · fixture manifest"
        caption="The flowaid.tools.http configSchema exactly as the node manifest ships it: the body appears for POST / PUT / PATCH and is bindable; the URL is a template."
      >
        <ManifestHttpForm />
      </Section>

      <Section
        id="expression"
        title="ExpressionInput / ExpressionTextarea"
        caption={`Single-line and multi-line template editors over a scope of ${scopeSummary}. Regions render as chips, unknown references are underlined with a message, and the braces button inserts a reference from the scope tree.`}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Swatch label="Autocomplete after “.” (opens on load)">
            <AutocompleteDemo />
          </Swatch>
          <Swatch label="States">
            <div className="flex flex-col gap-3">
              <ValidationReadout
                label="Valid · comparison"
                initial="{{ nodes.intent.output.confidence >= 0.9 && nodes.escalation.output.value == false }}"
              />
              <ValidationReadout
                label="Unknown reference"
                initial="Hello {{ input.mesage }}, ticket {{ nodes.lookup.output.id }}"
              />
              <ValidationReadout
                label="Unbalanced braces"
                initial="{{ variables.brand }} support: {{ input.message"
              />
              <FieldRow label="Disabled">
                <ExpressionInput scope={SCOPE} value="{{ variables.locale }}" disabled />
              </FieldRow>
              <FieldRow label="Read-only · no picker">
                <ExpressionInput
                  scope={SCOPE}
                  value="{{ nodes.urgency.output.value }} of 4"
                  readOnly
                  referencePicker={false}
                />
              </FieldRow>
            </div>
          </Swatch>
          <Swatch label="ExpressionTextarea · prompt template" className="lg:col-span-2">
            <FieldRow
              label="Prompt"
              hint="The whole text is a template. References become chips; the footer counts them."
            >
              <ExpressionTextarea scope={SCOPE} value={prompt} onChange={setPrompt} minRows={5} />
            </FieldRow>
          </Swatch>
        </div>
      </Section>

      <Section
        id="reference-picker"
        title="ExpressionReferencePicker"
        caption="The insert-reference popover the expression editors use, on its own: the scope as a tree (inputs, variables, nodes → outputs) with a filter box. It returns the dotted path; the caller wraps it in braces."
      >
        <ReferencePickerDemo />
      </Section>

      <Section
        id="reorderable"
        title="ReorderableList"
        caption="The drag-and-keyboard list behind criteria options and repeatable schema lists. onReorder receives the new items and the index permutation; layout moves animate unless reduced motion is on."
      >
        <ReorderDemo />
      </Section>

      <Section
        id="criteria"
        title="CriteriaEditor"
        caption="TypeSafe question criteria for the three decision kinds, with the API's validation rules and a live uniform-distribution preview drawn with the decision visuals."
      >
        <CriteriaDemos />
      </Section>

      <Section
        id="pickers"
        title="CredentialPicker / ModelPicker"
        caption="Selection controls that show the facts a person needs to choose: environment and last use for credentials; provider, context window, price and health for models."
      >
        <PickersDemo />
      </Section>

      <Section
        id="code"
        title="CodeEditor"
        caption="Editable CodeMirror 6 with the shared theme: line numbers, bracket matching, closing brackets, folding, autocomplete, soft-wrap toggle and a cursor readout. Escape then Tab leaves the editor."
      >
        <CodeDemos />
      </Section>

      <Section
        id="keyvalue"
        title="KeyValueEditor"
        caption="Rows for headers, query parameters and environment variables. Secret rows mask their value; pasting multi-line “Key: Value” text into a key field expands into rows."
      >
        <KeyValueDemos />
      </Section>

      <Section
        id="template-editor"
        title="TemplateEditor"
        caption="The template widget over FlowExpr references: type {{ to complete node ports, $vars, $scope, $run and functions. A compiler diagnostic with a character range is underlined where it points."
      >
        <TemplateEditorDemo />
      </Section>

      <Section
        id="levels"
        title="LevelsList"
        caption="Ordered score levels, lowest first (2–10). Drag the grip or focus it and use the arrow keys, Home and End."
      >
        <LevelsDemo />
      </Section>

      <Section
        id="cron"
        title="CronEditor"
        caption="Five-field cron with presets, a plain-language summary and the next runs in the schedule's time zone, computed by croner like the scheduler."
      >
        <CronDemo />
      </Section>

      <Section
        id="json-schema"
        title="JsonSchemaEditor"
        caption="Edit a schema as fields (names, types, required, descriptions, nested objects, array items) or as JSON validated against the platform's schema rules."
      >
        <SchemaEditorDemo />
      </Section>

      <Section
        id="threshold"
        title="ThresholdField"
        caption="The confidence gate as a form field: the decision group's editor with an optional histogram of historic confidences."
      >
        <ThresholdDemos />
      </Section>

      <Section
        id="retry"
        title="RetryPolicyEditor"
        caption="Attempts, delays, backoff, jitter and retryable error codes, with the resulting schedule in mono. Irreversible nodes are never retried and say so."
      >
        <RetryDemos />
      </Section>
    </div>
  );
}
