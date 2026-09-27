/** A plugin package for the plugin-host tests: exercises the proxied context, crashes on demand. */
import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";

const metadata = (name: string) => ({
  name,
  description: `Test node ${name}`,
  category: "developer" as const,
  icon: "flask-conical",
  tags: ["test"],
});

export const echo = defineNode({
  id: "acme-plugin.echo",
  version: "1.0.0",
  metadata: metadata("Echo"),
  configSchema: z.strictObject({ url: z.string() }),
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({
    text: z.string(),
    secret: z.string(),
    status: z.number(),
    body: z.string(),
    stored: z.unknown(),
    pid: z.number(),
  }),
  credentials: [{ name: "api", types: ["http.bearer"], required: true }],
  capabilities: ["network", "state"],
  idempotency: "safe",
  execute: async (ctx, input) => {
    ctx.logger.info("echoing", { text: input.text });
    ctx.events.stream("text", input.text);
    const creds = ctx.credentials.has("api") ? await ctx.credentials.get("api") : {};
    const res = await ctx.http(ctx.config.url, { method: "POST", body: input.text });
    await ctx.state.set("run", "last", input.text);
    return ok({
      text: input.text,
      secret: creds.token ?? "",
      status: res.status,
      body: await res.text(),
      stored: await ctx.state.get("run", "last"),
      pid: process.pid,
    });
  },
});

export const crash = defineNode({
  id: "acme-plugin.crash",
  version: "1.0.0",
  metadata: metadata("Crash"),
  configSchema: z.strictObject({}),
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  capabilities: [],
  idempotency: "safe",
  execute: () => {
    setTimeout(() => process.exit(3), 5);
    return new Promise(() => undefined);
  },
});

export const wait = defineNode({
  id: "acme-plugin.wait",
  version: "1.0.0",
  metadata: metadata("Wait"),
  configSchema: z.strictObject({}),
  inputSchema: z.object({}),
  outputSchema: z.object({ aborted: z.boolean() }),
  capabilities: [],
  idempotency: "safe",
  execute: (ctx) =>
    new Promise((resolve) =>
      ctx.signal.addEventListener("abort", () => resolve(ok({ aborted: true }))),
    ),
});

export const nodes = [echo, crash, wait];
