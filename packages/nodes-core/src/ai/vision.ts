import { z } from "zod";
import { defineNode, ok, type ExecutionContext } from "@flowaid/node-sdk";
import { BadRequestError, type ContentPart } from "@flowaid/workflow-core";
import { callCtx, modelRef, usageSchema } from "../common.js";

/** Image MIME type from its first bytes (PNG, JPEG, GIF, WebP), or null. */
export function sniffImage(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return "image/webp";
  return null;
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const imageRef = z.union([
  z.object({ $artifact: z.string().min(1) }),
  z.string().min(1).describe("A data: URL or base64 image"),
]);

/** One image input → an inline image part (artifacts are read and sniffed; data URLs are parsed). */
export async function imagePart(
  ctx: ExecutionContext<unknown>,
  ref: z.infer<typeof imageRef>,
): Promise<ContentPart> {
  let bytes: Uint8Array;
  let declared: string | null = null;
  if (typeof ref === "string") {
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(ref);
    if (m) declared = m[1] ?? null;
    bytes = Uint8Array.from(Buffer.from(m ? (m[2] ?? "") : ref, "base64"));
  } else {
    bytes = await ctx.artifacts.get(ref.$artifact);
  }
  if (bytes.length === 0) throw new BadRequestError("an image is empty");
  if (bytes.length > MAX_IMAGE_BYTES)
    throw new BadRequestError(`an image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MiB`);
  const mimeType = sniffImage(bytes) ?? declared;
  if (!mimeType?.startsWith("image/"))
    throw new BadRequestError("an input is not a PNG, JPEG, GIF or WebP image");
  return { type: "image", mimeType, data: Buffer.from(bytes).toString("base64") };
}

export const visionNode = defineNode({
  id: "flowaid.ai.vision",
  version: "1.0.0",
  metadata: {
    name: "Vision",
    description:
      "Asks a vision-capable chat model about one or more images (artifacts or data URLs) and returns its answer.",
    category: "generation",
    icon: "scan-eye",
    tags: ["llm", "vision", "image"],
    summary: "{{ config.model.provider }}/{{ config.model.model }}",
  },
  configSchema: z.strictObject({
    model: modelRef,
    prompt: z
      .string()
      .min(1)
      .max(32000)
      .meta({ "x-ui": { widget: "template" } }),
    system: z
      .string()
      .max(32000)
      .optional()
      .meta({ "x-ui": { widget: "template" } }),
    temperature: z.number().min(0).max(2).default(0.2),
    maxOutputTokens: z.int().min(1).max(65536).default(1024),
  }),
  inputSchema: z.object({ images: z.array(imageRef).min(1).max(16) }),
  outputSchema: z.object({ text: z.string(), finish_reason: z.string(), usage: usageSchema }),
  credentials: [
    { name: "llm", types: ["openai.api_key", "anthropic.api_key", "ollama.none"], required: true },
  ],
  capabilities: ["generation", "credentials", "artifacts"],
  idempotency: "safe",
  generation: true,
  defaultPolicy: { timeoutMs: 120000 },
  execute: async (ctx, input) => {
    const parts: ContentPart[] = [{ type: "text", text: ctx.config.prompt }];
    for (const ref of input.images) parts.push(await imagePart(ctx, ref));
    const provider = ctx.providers.generation(ctx.config.model, { credentialSlot: "llm" });
    const r = await provider.generate(
      {
        messages: [
          ...(ctx.config.system ? [{ role: "system" as const, content: ctx.config.system }] : []),
          { role: "user", content: parts },
        ],
        temperature: ctx.config.temperature,
        maxOutputTokens: ctx.config.maxOutputTokens,
      },
      callCtx(ctx),
    );
    return ok(
      { text: r.text, finish_reason: r.finishReason, usage: r.usage },
      { usage: r.usage, costUsd: r.costUsd },
    );
  },
});
