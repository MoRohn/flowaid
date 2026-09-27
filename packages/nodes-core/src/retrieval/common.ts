/** Shared schemas of the retrieval nodes (ARCHITECTURE.md §10.8). */
import { z } from "zod";

export const documentSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().optional(),
  uri: z.string().optional(),
  mimeType: z.string().default("text/plain"),
  text: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const chunkSchema = z.object({
  /** the document the chunk came from */
  externalId: z.string().min(1),
  ordinal: z.int().min(0),
  content: z.string(),
  tokens: z.int().min(0),
  metadata: z.record(z.string(), z.unknown()).default({}),
  embedding: z.array(z.number()).optional(),
});

export const hitSchema = z
  .object({
    chunkId: z.string(),
    documentId: z.string(),
    sourceId: z.string(),
    ordinal: z.int(),
    content: z.string(),
    metadata: z.record(z.string(), z.unknown()),
    score: z.number(),
    title: z.string().nullable(),
    uri: z.string().nullable(),
  })
  .loose();

export const filterSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional()
  .meta({ "x-ui": { widget: "keyvalue", help: "Only chunks whose metadata has these values." } });

export const sourceIdsSchema = z
  .array(z.string().min(1))
  .max(50)
  .default([])
  .meta({
    "x-ui": {
      help: "Knowledge sources to search (ids from Knowledge). Empty: every ready source of the workspace.",
    },
  });

export type Hit = z.infer<typeof hitSchema>;
