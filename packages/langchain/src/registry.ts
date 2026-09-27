/**
 * The LCEL runnable registry (LANGCHAIN.md §2): plugins register runnable factories by name and
 * the `langchain.runnable` node builds one per execution from its config and the node's services
 * (a `FlowaidChatModel`/`FlowaidEmbeddings` bound to the node's providers, tools, the callback
 * handler). Names are `^[a-z0-9][a-z0-9_.-]{0,127}$`, e.g. `acme.summarize`.
 */
import type { Runnable } from "@langchain/core/runnables";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Embeddings } from "@langchain/core/embeddings";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ConflictError, NotFoundError, type JsonObject } from "@flowaid/workflow-core";

export interface RunnableServices {
  /** the node's chat model (ctx.providers.generation with its model ref), when one is configured */
  chatModel?: BaseChatModel;
  embeddings?: Embeddings;
  tools: StructuredToolInterface[];
  signal: AbortSignal;
}

export interface RunnableEntry {
  name: string;
  description: string;
  factory: (config: JsonObject, services: RunnableServices) => Runnable | Promise<Runnable>;
}

const NAME = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
const registry = new Map<string, RunnableEntry>();

export function registerRunnable(
  name: string,
  factory: RunnableEntry["factory"],
  opts: { description?: string; replace?: boolean } = {},
): void {
  if (!NAME.test(name)) throw new Error(`Invalid runnable name '${name}'`);
  if (registry.has(name) && !opts.replace)
    throw new ConflictError(`A runnable named '${name}' is already registered`);
  registry.set(name, { name, description: opts.description ?? "", factory });
}

export function runnableFromRegistry(name: string): RunnableEntry {
  const entry = registry.get(name);
  if (!entry)
    throw new NotFoundError(
      `No LangChain runnable '${name}' is registered (known: ${[...registry.keys()].sort().join(", ") || "none"})`,
    );
  return entry;
}

export function listRunnables(): { name: string; description: string }[] {
  return [...registry.values()]
    .map(({ name, description }) => ({ name, description }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Test helper: forget one or every registration. */
export function unregisterRunnable(name?: string): void {
  if (name === undefined) registry.clear();
  else registry.delete(name);
}
