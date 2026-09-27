import { z } from "zod";
import { defineNode, ok } from "@flowaid/node-sdk";
import { NetworkError } from "@flowaid/workflow-core";
import { errorFromResponse } from "@flowaid/providers";
import { openaiEndpoint } from "../common.js";
import { sniffImage } from "./vision.js";

export const imageNode = defineNode({
  id: "flowaid.ai.image",
  version: "1.0.0",
  metadata: {
    name: "Generate image",
    description:
      "Generates images from a prompt with an OpenAI-compatible /images/generations endpoint and stores each as an artifact.",
    category: "generation",
    icon: "image",
    tags: ["image", "generation"],
    summary: "{{ config.model }} {{ config.size }}",
  },
  configSchema: z.strictObject({
    model: z.string().min(1).max(200).default("gpt-image-1"),
    prompt: z
      .string()
      .min(1)
      .max(32000)
      .meta({ "x-ui": { widget: "template" } }),
    size: z
      .enum(["auto", "1024x1024", "1024x1536", "1536x1024", "512x512", "256x256"])
      .default("1024x1024")
      .meta({ "x-ui": { widget: "select" } }),
    count: z.int().min(1).max(10).default(1),
    quality: z
      .enum(["auto", "low", "medium", "high"])
      .default("auto")
      .meta({ "x-ui": { widget: "select" } }),
  }),
  inputSchema: z.object({}),
  outputSchema: z.object({
    artifacts: z.array(z.object({ $artifact: z.string() })),
    revised_prompts: z.array(z.string()),
  }),
  credentials: [{ name: "llm", types: ["openai.api_key"], required: true }],
  capabilities: ["network", "credentials", "artifacts"],
  // every call creates new images and costs money
  idempotency: "none",
  defaultPolicy: { timeoutMs: 300000 },
  execute: async (ctx) => {
    const { base, headers } = openaiEndpoint(await ctx.credentials.get("llm"));
    let res: Response;
    try {
      res = await ctx.http(`${base}/images/generations`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          model: ctx.config.model,
          prompt: ctx.config.prompt,
          n: ctx.config.count,
          size: ctx.config.size,
          ...(ctx.config.quality !== "auto" ? { quality: ctx.config.quality } : {}),
          // dall-e models return URLs unless asked; gpt-image-1 always returns base64
          ...(ctx.config.model.startsWith("dall-e") ? { response_format: "b64_json" } : {}),
        }),
        signal: ctx.signal,
      });
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      throw new NetworkError(
        `/images/generations failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!res.ok) throw errorFromResponse("openai", res.status, res.headers, await res.text());
    const body = (await res.json()) as {
      data?: { b64_json?: unknown; revised_prompt?: unknown }[];
    };
    const artifacts: { $artifact: string }[] = [];
    const revised: string[] = [];
    for (const [i, item] of (body.data ?? []).entries()) {
      if (typeof item.b64_json !== "string") continue;
      const bytes = Uint8Array.from(Buffer.from(item.b64_json, "base64"));
      const mime = sniffImage(bytes) ?? "image/png";
      artifacts.push(await ctx.artifacts.put(`image-${i + 1}.${mime.split("/")[1]}`, bytes, mime));
      if (typeof item.revised_prompt === "string") revised.push(item.revised_prompt);
    }
    if (artifacts.length === 0) throw new NetworkError("the image response had no images");
    return ok({ artifacts, revised_prompts: revised });
  },
});
