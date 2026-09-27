/**
 * Node mapping for agent-flow exports (ARCHITECTURE.md §10.9): each source node type → a
 * FlowAId node, in two phases. `plan` fixes every node's id, result port and control ports so
 * templates can reference nodes mapped later; `build` writes the node.
 */
import type { Binding, JsonObject, JsonValue, WorkflowNode } from "@flowaid/workflow-core";
import { snake, TYPESAFE_SECRET, type Builder, type Mapped } from "./builder.js";
import { chatProvider, embeddingProvider } from "./providers.js";
import { sanitizeInputs } from "./sanitize.js";
import { textBinding, translateTemplate, unwrapRichText, valueExpression } from "./templates.js";
import type { SourceNode } from "./types.js";

type Inputs = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    : [];
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const REQUESTS = /^requests(Get|Post|Put|Delete|Patch)$/;

/** Branch case ports and router route ids, derived once so edges and nodes agree. */
function routeIds(scenarios: string[]): string[] {
  const taken = new Set<string>();
  return scenarios.map((s, i) => {
    let id = snake(s).slice(0, 40) || `route_${i + 1}`;
    if (!/^[a-z0-9_]{1,64}$/.test(id) || taken.has(id) || id === "review") id = `route_${i + 1}`;
    taken.add(id);
    return id;
  });
}

function scenarios(inputs: Inputs): string[] {
  return arr(inputs.conditionAgentScenarios).map((s) => str(s.scenario) || "Scenario");
}

/** Phase 1: the id, result port and control ports each source node will have. */
export function plan(src: SourceNode, b: Builder): Mapped | undefined {
  const name = src.data.name;
  const inputs = obj(src.data.inputs);
  switch (name) {
    case "startAgentflow":
      return { id: b.reserve("start"), port: "question", donePort: "done" };
    case "llmAgentflow":
      return { id: b.id(src.id), port: "text", donePort: "done" };
    case "agentAgentflow":
      return { id: b.id(src.id), port: "answer", donePort: "done" };
    case "retrieverAgentflow":
      return { id: b.id(src.id), port: "context", donePort: "done" };
    case "httpAgentflow":
      return { id: b.id(src.id), port: "body", donePort: "done" };
    case "customFunctionAgentflow":
      return { id: b.id(src.id), port: "result", donePort: "done" };
    case "executeFlowAgentflow":
      return { id: b.id(src.id), port: "output", donePort: "done" };
    case "toolAgentflow": {
      const tool = str(inputs.toolAgentflowSelectedTool);
      if (REQUESTS.test(tool)) return { id: b.id(src.id), port: "body", donePort: "done" };
      if (/mcp/i.test(tool)) return { id: b.id(src.id), port: "result", donePort: "done" };
      return { id: b.id(src.id), port: "output", donePort: "done" };
    }
    case "humanInputAgentflow":
      return {
        id: b.id(src.id),
        port: "decision",
        donePort: "approved",
        ports: { "0": "approved", "1": "rejected" },
      };
    case "conditionAgentflow": {
      const n = arr(inputs.conditions).length;
      const ports: Record<string, string> = {};
      for (let i = 0; i < n; i++) ports[String(i)] = `case_${i + 1}`;
      ports[String(n)] = "else";
      return { id: b.id(src.id), donePort: "else", ports };
    }
    case "conditionAgentAgentflow": {
      const ids = routeIds(scenarios(inputs));
      const ports: Record<string, string> = {};
      ids.forEach((id, i) => (ports[String(i)] = id));
      ports[String(ids.length)] = "review";
      return { id: b.id(src.id), port: "route", donePort: "review", ports };
    }
    case "iterationAgentflow":
      return { id: b.id(src.id), port: "results", donePort: "done" };
    case "loopAgentflow":
      // becomes a loop container around its body (see importExternalFlow)
      return { id: b.id(src.id), port: "result", donePort: "exhausted" };
    case "directReplyAgentflow":
      return { id: b.id(src.id), donePort: "done" };
    case "stickyNoteAgentflow":
      return { id: b.id(src.id), donePort: "done" };
    default:
      return { id: b.id(src.id), port: "output", donePort: "done" };
  }
}

function messages(list: unknown): { system: string[]; user: string[]; assistant: number } {
  const out = { system: [] as string[], user: [] as string[], assistant: 0 };
  for (const m of arr(list)) {
    const content = unwrapRichText(str(m.content));
    if (!content) continue;
    const role = str(m.role);
    if (role === "system" || role === "developer") out.system.push(content);
    else if (role === "assistant") out.assistant += 1;
    else out.user.push(content);
  }
  return out;
}

function warnStateUpdates(src: SourceNode, inputs: Inputs, b: Builder, nodeId: string): boolean {
  const key = Object.keys(inputs).find((k) => /UpdateState$/.test(k) && arr(inputs[k]).length > 0);
  if (!key) return false;
  b.issue(
    "W_IMPORT_APPROXIMATE",
    `${src.data.label ?? src.id}: flow-state updates are not imported; later nodes read $vars defaults. Use a state node or a code node to carry values.`,
    { nodeId, sourceId: src.id },
  );
  return true;
}

function credentialIssues(src: SourceNode, removed: string[], b: Builder, nodeId: string): void {
  if (removed.length === 0) return;
  b.issue(
    "W_IMPORT_CREDENTIAL_REMOVED",
    `${src.data.label ?? src.id}: removed ${removed.join(", ")}; bind the node's secret in the workflow settings instead`,
    { nodeId, sourceId: src.id },
  );
}

function conditionExpr(c: Record<string, unknown>, b: Builder, sourceId: string): string {
  const type = str(c.type) || "string";
  const op = str(c.operation) || "equal";
  const a = valueExpression(c.value1, b, sourceId);
  const empty = `len(to_string(coalesce(${a}, ""))) == 0`;
  if (op === "isEmpty") return empty;
  if (op === "notEmpty") return `!(${empty})`;
  if (type === "number") {
    const x = `to_number(${a})`;
    const y = valueExpression(c.value2, b, sourceId);
    const cmp: Record<string, string> = {
      equal: "==",
      notEqual: "!=",
      smaller: "<",
      smallerEqual: "<=",
      larger: ">",
      largerEqual: ">=",
    };
    return `${x} ${cmp[op] ?? "=="} to_number(${y})`;
  }
  if (type === "boolean") {
    const y = String(c.value2) === "true" || c.value2 === true ? "true" : "false";
    return op === "notEqual" ? `${a} != ${y}` : `${a} == ${y}`;
  }
  const x = `to_string(${a})`;
  const y = valueExpression(c.value2 ?? "", b, sourceId);
  switch (op) {
    case "notEqual":
      return `${x} != ${y}`;
    case "contains":
      return `contains(${x}, ${y})`;
    case "notContains":
      return `!contains(${x}, ${y})`;
    case "startsWith":
      return `starts_with(${x}, ${y})`;
    case "endsWith":
      return `ends_with(${x}, ${y})`;
    case "regex":
      return `regex_test(${x}, ${JSON.stringify(str(c.value2))})`;
    default:
      return `${x} == ${y}`;
  }
}

function task(
  id: string,
  name: string,
  type: string,
  config: JsonObject,
  inputs: Record<string, Binding> = {},
  credentials: Record<string, string> = {},
): WorkflowNode {
  return {
    id,
    kind: "task",
    name,
    type,
    typeVersion: "1.0.0",
    config,
    inputs,
    credentials,
    disabled: false,
  };
}

/** Phase 2: writes the FlowAId node for one source node. Returns its id, or undefined when it adds none. */
export function build(src: SourceNode, m: Mapped, b: Builder): void {
  const name = src.data.label ?? src.data.name;
  const { value: inputs, removed } = sanitizeInputs(src);
  const at = src.position;
  const sid = src.id;
  switch (src.data.name) {
    case "startAgentflow": {
      if (str(inputs.startInputType) === "formInput") {
        for (const f of arr(inputs.formInputTypes)) {
          const key = snake(str(f.name) || str(f.label) || "field");
          const type = str(f.type);
          const schema: JsonObject =
            type === "number"
              ? { type: "number" }
              : type === "boolean"
                ? { type: "boolean" }
                : type === "options" && Array.isArray(f.options)
                  ? {
                      type: "string",
                      enum: arr(f.options)
                        .map((o) => str(o.name) || str(o.label))
                        .filter(Boolean),
                    }
                  : { type: "string" };
          b.input(key, schema, true);
        }
      } else {
        b.input("question", { type: "string" }, true);
      }
      for (const s of arr(inputs.startState)) {
        const key = str(s.key);
        if (!key) continue;
        const name = /^[a-z][a-zA-Z0-9_]{0,63}$/.test(key) ? key : snake(key);
        b.variable(name, (s.value ?? null) as JsonValue, "definition");
      }
      b.add({ id: m.id, kind: "input", name: name || "Start", disabled: false }, at);
      b.report(src, "imported", { nodeId: m.id, targetType: "input" });
      return;
    }

    case "llmAgentflow": {
      const cfg = obj(inputs.llmModelConfig);
      const p = chatProvider(str(inputs.llmModel), cfg, b, { nodeId: m.id, sourceId: sid });
      const msgs = messages(inputs.llmMessages);
      const userMsg = unwrapRichText(str(inputs.llmUserMessage));
      const userText =
        [...msgs.user, ...(userMsg ? [userMsg] : [])].join("\n\n") || "{{ question }}";
      const system = msgs.system.join("\n\n");
      const config: JsonObject = {
        model: { provider: p.provider, model: p.model },
        ...(system ? { system: translateTemplate(system, b, sid) } : {}),
        ...(typeof cfg.temperature === "number" ? { temperature: cfg.temperature } : {}),
      };
      b.secret(p.secret.name, p.secret.credentialType);
      b.add(
        task(
          m.id,
          name,
          "flowaid.ai.generate",
          config,
          { prompt: textBinding(userText, b, sid) },
          {
            llm: p.secret.name,
          },
        ),
        at,
      );
      let changed = p.provider !== providerOf(str(inputs.llmModel));
      if (msgs.assistant > 0) {
        changed = true;
        b.issue(
          "W_IMPORT_APPROXIMATE",
          `${name}: ${msgs.assistant} assistant example message(s) were dropped; add them to the system prompt if they matter`,
          { nodeId: m.id, sourceId: sid },
        );
      }
      if (arr(inputs.llmStructuredOutput).length > 0) {
        changed = true;
        b.issue(
          "W_IMPORT_APPROXIMATE",
          `${name}: structured output was not imported; use a Structured generation node for typed output`,
          { nodeId: m.id, sourceId: sid },
        );
      }
      if (warnStateUpdates(src, inputs, b, m.id)) changed = true;
      credentialIssues(src, removed, b, m.id);
      b.report(src, changed ? "converted" : "imported", {
        nodeId: m.id,
        targetType: "flowaid.ai.generate",
      });
      return;
    }

    case "agentAgentflow": {
      const cfg = obj(inputs.agentModelConfig);
      const p = chatProvider(str(inputs.agentModel), cfg, b, { nodeId: m.id, sourceId: sid });
      const msgs = messages(inputs.agentMessages);
      const userMsg = unwrapRichText(str(inputs.agentUserMessage));
      const system = msgs.system.join("\n\n");
      const systemHasHoles = /\{\{/.test(system);
      const taskText = [
        ...(systemHasHoles ? [system] : []),
        ...msgs.user,
        ...(userMsg ? [userMsg] : []),
      ].join("\n\n");
      b.secret(p.secret.name, p.secret.credentialType);
      b.add(
        task(
          m.id,
          name,
          "@flowaid/nodes-langchain.agent",
          {
            model: { provider: p.provider, model: p.model },
            ...(system && !systemHasHoles ? { system } : {}),
            tools: [],
            maxSteps: 10,
          },
          { task: textBinding(taskText || "{{ question }}", b, sid) },
          { llm: p.secret.name },
        ),
        at,
      );
      // agents need a spend bound (E_AGENT_UNBOUNDED)
      (b.nodes.at(-1) as WorkflowNode).policy = { onError: "fail", maxCostUsd: 0.5 };
      const tools = arr(inputs.agentTools).length;
      const stores = arr(inputs.agentKnowledgeDocumentStores).length;
      b.issue(
        "W_IMPORT_APPROXIMATE",
        `${name}: runs as the LangChain agent node${tools ? `; its ${tools} tool(s) were not imported — add workflow tools to the agent` : ""}${stores ? `; its ${stores} knowledge store(s) were not imported` : ""}`,
        { nodeId: m.id, sourceId: sid },
      );
      warnStateUpdates(src, inputs, b, m.id);
      credentialIssues(src, removed, b, m.id);
      b.report(src, tools || stores ? "needs_config" : "converted", {
        nodeId: m.id,
        targetType: "@flowaid/nodes-langchain.agent",
        message: tools ? "add the agent's tools" : undefined,
      });
      return;
    }

    case "retrieverAgentflow": {
      const e = embeddingProvider("openAIEmbeddings", {}, b, { nodeId: m.id, sourceId: sid });
      b.secret(e.secret.name, e.secret.credentialType);
      b.add(
        task(
          m.id,
          name,
          "@flowaid/nodes-langchain.retriever",
          { embeddingModel: { provider: e.provider, model: e.model }, store: "workspace" },
          { query: textBinding(str(inputs.retrieverQuery) || "{{ question }}", b, sid) },
          { llm: e.secret.name },
        ),
        at,
      );
      b.issue(
        "W_IMPORT_NEEDS_CONFIG",
        `${name}: document stores are not imported; load documents into the workspace collection 'knowledge' (vector store node) before retrieving`,
        { nodeId: m.id, sourceId: sid },
      );
      b.report(src, "needs_config", {
        nodeId: m.id,
        targetType: "@flowaid/nodes-langchain.retriever",
        message: "fill the 'knowledge' collection",
      });
      return;
    }

    case "conditionAgentflow": {
      const cases = arr(inputs.conditions).map((c, i) => ({
        port: m.ports?.[String(i)] ?? `case_${i + 1}`,
        when: conditionExpr(c, b, sid),
        label: `${str(c.operation) || "equal"} ${typeof c.value2 === "string" ? c.value2 : ""}`
          .trim()
          .slice(0, 80),
      }));
      b.add(
        {
          id: m.id,
          kind: "branch",
          name,
          mode: "first",
          cases: cases.length ? cases : [{ port: "case_1", when: "true" }],
          defaultPort: "else",
          disabled: false,
        },
        at,
      );
      b.report(src, "imported", { nodeId: m.id, targetType: "branch" });
      return;
    }

    case "conditionAgentAgentflow": {
      const list = scenarios(inputs);
      const ids = routeIds(list);
      const routes: Record<string, string> = {};
      ids.forEach((id, i) => (routes[id] = (list[i] ?? id).slice(0, 255)));
      if (ids.length < 2) routes.other = "None of the above";
      b.secret(TYPESAFE_SECRET.name, TYPESAFE_SECRET.credentialType);
      const instructions = unwrapRichText(str(inputs.conditionAgentInstructions));
      b.add(
        task(
          m.id,
          name,
          "flowaid.decision.router",
          {
            instructions: (instructions || "Which scenario matches the input?").slice(0, 4000),
            routes,
          },
          {
            state: textBinding(str(inputs.conditionAgentInput) || "{{ question }}", b, sid),
          },
          { typesafe: TYPESAFE_SECRET.name },
        ),
        at,
      );
      b.issue(
        "W_IMPORT_PROVIDER_CHANGED",
        `${name}: the LLM classification is now a TypeSafe decision with calibrated confidence; low-confidence inputs take the 'review' port`,
        { nodeId: m.id, sourceId: sid },
      );
      credentialIssues(src, removed, b, m.id);
      b.report(src, "converted", { nodeId: m.id, targetType: "flowaid.decision.router" });
      return;
    }

    case "humanInputAgentflow": {
      const description = unwrapRichText(str(inputs.humanInputDescription)) || "Please review";
      b.add(
        {
          id: m.id,
          kind: "human",
          name,
          mode: { type: "approval" },
          title: textBinding(description, b, sid),
          context: {},
          assignees: [],
          onExpire: "fail",
          externalReview: false,
          disabled: false,
        },
        at,
      );
      b.report(src, "imported", { nodeId: m.id, targetType: "human" });
      return;
    }

    case "httpAgentflow": {
      const headers: Record<string, string> = {};
      for (const h of arr(inputs.headers))
        if (str(h.key)) headers[str(h.key)] = translateTemplate(str(h.value), b, sid);
      const query: Record<string, string> = {};
      for (const q of arr(inputs.queryParams))
        if (str(q.key)) query[str(q.key)] = translateTemplate(str(q.value), b, sid);
      const method = (str(inputs.method) || "GET").toUpperCase();
      const config: JsonObject = {
        method,
        url: translateTemplate(str(inputs.url), b, sid),
        headers,
        query,
      };
      const templated = Object.values({ ...headers, ...query }).some((v) => v.includes("{{"));
      if (
        ["POST", "PUT", "PATCH"].includes(method) &&
        inputs.body !== undefined &&
        inputs.body !== ""
      ) {
        const body = inputs.body;
        if (typeof body === "string") {
          try {
            config.body = JSON.parse(body) as JsonValue;
          } catch {
            config.body = textBinding(body, b, sid);
          }
        } else if (Array.isArray(body)) {
          const fields: Record<string, string> = {};
          for (const f of arr(body)) if (str(f.key)) fields[str(f.key)] = str(f.value);
          config.body = fields;
        } else config.body = body as JsonValue;
      }
      const credentials: Record<string, string> = {};
      if (removed.some((r) => /header/i.test(r) || /authorization/i.test(r))) {
        const secret = `${m.id.toUpperCase()}_AUTH`.replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
        b.secret(secret, "http.bearer");
        credentials.auth = secret;
      }
      b.add(task(m.id, name, "flowaid.tools.http", config, {}, credentials), at);
      credentialIssues(src, removed, b, m.id);
      if (templated)
        b.issue(
          "W_IMPORT_APPROXIMATE",
          `${name}: headers and query values are sent as written; references in them are not filled in`,
          { nodeId: m.id, sourceId: sid },
        );
      b.report(src, removed.length || templated ? "converted" : "imported", {
        nodeId: m.id,
        targetType: "flowaid.tools.http",
      });
      return;
    }

    case "customFunctionAgentflow": {
      const vars = arr(inputs.customFunctionInputVariables).filter((v) => str(v.variableName));
      const fields: Record<string, Binding> = {};
      const props: JsonObject = {};
      const prelude: string[] = [];
      for (const v of vars) {
        const key = snake(str(v.variableName));
        fields[key] = textBinding(str(v.variableValue), b, sid);
        props[key] = {};
        prelude.push(`const $${str(v.variableName)} = inputs.${key};`);
      }
      const code = [
        "// Imported function: runs in the FlowAId sandbox (no Node APIs; inputs arrive as `inputs`).",
        ...prelude,
        str(inputs.customFunctionJavascriptFunction) || "return null;",
      ].join("\n");
      b.add(
        task(
          m.id,
          name,
          "flowaid.tools.code",
          { language: "javascript", code, inputs: { type: "object", properties: props } },
          vars.length ? { inputs: { kind: "object", fields } } : {},
        ),
        at,
      );
      b.issue(
        "W_IMPORT_APPROXIMATE",
        `${name}: review the function — it now runs sandboxed, without Node modules or $flow`,
        { nodeId: m.id, sourceId: sid },
      );
      b.report(src, "converted", { nodeId: m.id, targetType: "flowaid.tools.code" });
      return;
    }

    case "executeFlowAgentflow": {
      b.add(
        {
          id: m.id,
          kind: "subflow",
          name,
          workflowId: NIL_UUID,
          version: "deployed",
          inputs: {
            question: textBinding(str(inputs.executeFlowInput) || "{{ question }}", b, sid),
          },
          disabled: false,
        },
        at,
      );
      b.issue(
        "W_IMPORT_NEEDS_CONFIG",
        `${name}: import the flow it calls, then choose it as this subflow's workflow`,
        { nodeId: m.id, sourceId: sid },
      );
      b.report(src, "needs_config", {
        nodeId: m.id,
        targetType: "subflow",
        message: "choose the called workflow",
      });
      return;
    }

    case "toolAgentflow": {
      const tool = str(inputs.toolAgentflowSelectedTool);
      const args: Record<string, unknown> = {};
      for (const a of arr(inputs.toolInputArgs))
        if (str(a.inputArgName)) args[str(a.inputArgName)] = a.inputArgValue;
      if (REQUESTS.test(tool)) {
        const method = tool.replace("requests", "").toUpperCase();
        const url = translateTemplate(str(args.url), b, sid);
        b.add(task(m.id, name, "flowaid.tools.http", { method, url, headers: {}, query: {} }), at);
        b.report(src, url ? "converted" : "needs_config", {
          nodeId: m.id,
          targetType: "flowaid.tools.http",
          ...(url ? {} : { message: "set the URL" }),
        });
        return;
      }
      if (/mcp/i.test(tool)) {
        const key = snake(tool).slice(0, 40);
        const toolName = str(args.toolName) || str(args.tool);
        b.add(
          task(m.id, name, "flowaid.tools.mcp", {
            serverId: `$template.mcp.${key}`,
            tool: /^[A-Za-z0-9_-]{1,64}$/.test(toolName) ? toolName : "choose_tool",
          }),
          at,
        );
        b.issue("W_IMPORT_NEEDS_CONFIG", `${name}: choose the MCP server and tool`, {
          nodeId: m.id,
          sourceId: sid,
        });
        b.report(src, "needs_config", {
          nodeId: m.id,
          targetType: "flowaid.tools.mcp",
          message: "choose the MCP server and tool",
        });
        return;
      }
      b.todo(
        src,
        `the tool '${tool || "unknown"}' has no FlowAId equivalent; use an HTTP, MCP or OpenAPI node`,
        ["done"],
        inputs,
        m.id,
      );
      return;
    }

    case "directReplyAgentflow": {
      b.outputProps.set("answer", {});
      b.add(
        {
          id: m.id,
          kind: "output",
          name,
          value: {
            kind: "object",
            fields: { answer: textBinding(str(inputs.directReplyMessage), b, sid) },
          },
          earlyExit: false,
          disabled: false,
        },
        at,
      );
      b.report(src, "imported", { nodeId: m.id, targetType: "output" });
      return;
    }

    case "stickyNoteAgentflow": {
      b.add(
        {
          id: m.id,
          kind: "note",
          name: "Note",
          text: unwrapRichText(str(inputs.note)).slice(0, 4000),
          disabled: false,
        },
        at,
      );
      b.report(src, "imported", { nodeId: m.id, targetType: "note" });
      return;
    }

    default:
      b.todo(
        src,
        "this node type has no FlowAId equivalent",
        Object.values(m.ports ?? { done: "done" }),
        inputs,
        m.id,
      );
  }
}

function providerOf(component: string): string {
  if (component === "chatAnthropic") return "anthropic";
  if (component === "chatOllama") return "ollama";
  if (["chatOpenAI", "azureChatOpenAI", "chatOpenAICustom"].includes(component)) return "openai";
  return "other";
}

/** The source nodes handled as containers by the orchestrator (not by `build`). */
export const CONTAINERS = new Set(["iterationAgentflow", "loopAgentflow"]);
