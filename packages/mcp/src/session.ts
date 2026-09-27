/** A connected MCP server: typed wrappers over the SDK client with per-call timeouts and abort. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JsonObject, JsonValue } from "@flowaid/workflow-core";

export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    title?: string;
  };
}
export interface McpResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}
export interface McpResourceTemplateInfo {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}
export interface McpPromptInfo {
  name: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
}
export interface McpContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  resource?: { uri: string; text?: string; blob?: string; mimeType?: string };
}
export interface McpCallResult {
  content: McpContent[];
  structuredContent?: JsonObject;
  isError: boolean;
}
export interface McpResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}
export interface McpPromptMessage {
  role: "user" | "assistant";
  content: McpContent;
}

export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 60_000;

const opts = (o: CallOptions = {}) => ({
  timeout: o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  ...(o.signal ? { signal: o.signal } : {}),
});

export class McpSession {
  private closed = false;
  constructor(
    readonly client: Client,
    private readonly transport: Transport,
  ) {
    transport.onclose = () => {
      this.closed = true;
    };
  }

  static async connect(
    transport: Transport,
    o: CallOptions & { name?: string; version?: string } = {},
  ): Promise<McpSession> {
    const client = new Client(
      { name: o.name ?? "flowaid", version: o.version ?? "0.1.0" },
      { capabilities: {} },
    );
    await client.connect(transport, opts(o));
    return new McpSession(client, transport);
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  get serverInfo(): { name: string; version: string } | undefined {
    return this.client.getServerVersion();
  }

  /** Every tool, following pagination (bounded to 50 pages). */
  async listTools(o?: CallOptions): Promise<McpToolInfo[]> {
    const out: McpToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const r = await this.client.listTools(cursor ? { cursor } : {}, opts(o));
      out.push(...(r.tools as unknown as McpToolInfo[]));
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    return out;
  }

  async callTool(name: string, args: JsonValue, o?: CallOptions): Promise<McpCallResult> {
    const r = await this.client.callTool(
      { name, arguments: (args ?? {}) as Record<string, unknown> },
      undefined,
      opts(o),
    );
    return {
      content: (r.content ?? []) as McpContent[],
      ...(r.structuredContent ? { structuredContent: r.structuredContent as JsonObject } : {}),
      isError: r.isError === true,
    };
  }

  async listResources(
    o?: CallOptions,
  ): Promise<{ resources: McpResourceInfo[]; templates: McpResourceTemplateInfo[] }> {
    if (!this.client.getServerCapabilities()?.resources) return { resources: [], templates: [] };
    const resources: McpResourceInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const r = await this.client.listResources(cursor ? { cursor } : {}, opts(o));
      resources.push(...(r.resources as McpResourceInfo[]));
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    const t = await this.client
      .listResourceTemplates({}, opts(o))
      .catch(() => ({ resourceTemplates: [] }));
    return { resources, templates: t.resourceTemplates as McpResourceTemplateInfo[] };
  }

  async readResource(uri: string, o?: CallOptions): Promise<McpResourceContents[]> {
    const r = await this.client.readResource({ uri }, opts(o));
    return r.contents;
  }

  async listPrompts(o?: CallOptions): Promise<McpPromptInfo[]> {
    if (!this.client.getServerCapabilities()?.prompts) return [];
    const r = await this.client.listPrompts({}, opts(o));
    return r.prompts;
  }

  async getPrompt(
    name: string,
    args: Record<string, string>,
    o?: CallOptions,
  ): Promise<{ description?: string; messages: McpPromptMessage[] }> {
    const r = await this.client.getPrompt({ name, arguments: args }, opts(o));
    return { ...(r.description ? { description: r.description } : {}), messages: r.messages };
  }

  async ping(o?: CallOptions): Promise<void> {
    await this.client.ping(opts(o));
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.client.close();
  }
}
