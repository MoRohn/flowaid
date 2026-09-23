/**
 * §14 Tools: the result of a tool call as returned to nodes and models.
 */
import { z } from "zod";
import { JsonPointerSchema, JsonValueSchema } from "./json.js";
import { TokenUsageSchema } from "./decision.js";
import { ErrorInfoSchema } from "./errors.js";

/** Result of `ctx.tools.call()`. */
export const ToolResultSchema = z.object({
  ok: z.boolean(),
  /** text for a model */
  content: z.string(),
  /** parsed output when outputSchema exists */
  structured: JsonValueSchema.optional(),
  artifacts: z
    .array(z.object({ artifactId: z.uuid(), name: z.string(), mimeType: z.string() }))
    .optional(),
  sources: z
    .array(
      z.object({
        title: z.string().optional(),
        url: z.string().optional(),
        snippet: z.string().optional(),
        score: z.number().optional(),
      }),
    )
    .optional(),
  usage: TokenUsageSchema.optional(),
  error: ErrorInfoSchema.optional(),
  /** argument coercions applied before validation (trace-visible) */
  coerced: z
    .array(z.object({ path: JsonPointerSchema, from: z.string(), to: z.string() }))
    .optional(),
  latencyMs: z.int().min(0),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;
