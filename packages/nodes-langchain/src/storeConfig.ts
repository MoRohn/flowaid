/** The store discriminator shared by `vector_store` and `retriever`. */
import { z } from "zod";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { ExecutionContext } from "@flowaid/node-sdk";
import { BadRequestError, CredentialError, type CredentialSlot } from "@flowaid/workflow-core";
import {
  PineconeVectorStore,
  QdrantVectorStore,
  WorkspaceVectorStore,
  type FlowaidVectorStore,
} from "./stores.js";

export const storeFields = {
  store: z
    .enum(["workspace", "qdrant", "pinecone"])
    .default("workspace")
    .meta({
      "x-ui": {
        widget: "select",
        help: "workspace: durable workspace state (small corpora); qdrant / pinecone: external vector databases.",
      },
    }),
  collection: z
    .string()
    .regex(/^[A-Za-z0-9_.-]{1,128}$/)
    .default("knowledge")
    .meta({
      "x-ui": { help: "Collection (Qdrant), namespace (Pinecone) or workspace collection." },
    }),
  url: z
    .string()
    .max(2000)
    .optional()
    .meta({
      "x-ui": {
        showWhen: { path: "/store", oneOf: ["qdrant", "pinecone"] },
        placeholder: "https://…",
        help: "Qdrant base URL or Pinecone index host.",
      },
    }),
};

export const STORE_SLOT: CredentialSlot = {
  name: "store",
  types: ["http.api_key"],
  required: false,
  description: "API key of the external vector database (Qdrant api-key, Pinecone Api-Key).",
};

export async function openStore(
  ctx: ExecutionContext<unknown>,
  config: {
    store: "workspace" | "qdrant" | "pinecone";
    collection: string;
    url?: string | undefined;
  },
  embeddings: EmbeddingsInterface,
): Promise<FlowaidVectorStore> {
  if (config.store === "workspace")
    return new WorkspaceVectorStore(embeddings, config.collection, ctx.state);
  if (!config.url) throw new BadRequestError(`the ${config.store} store needs \`url\``);
  const apiKey = ctx.credentials.has("store")
    ? (await ctx.credentials.get("store")).key
    : undefined;
  if (config.store === "qdrant")
    return new QdrantVectorStore(embeddings, config.collection, {
      http: ctx.http,
      url: config.url,
      ...(apiKey ? { apiKey } : {}),
    });
  if (!apiKey) throw new CredentialError("the pinecone store needs an API key in the `store` slot");
  return new PineconeVectorStore(embeddings, config.collection, {
    http: ctx.http,
    url: config.url,
    apiKey,
  });
}
