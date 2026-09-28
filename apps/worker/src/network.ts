/**
 * The worker's outbound address policy (ARCHITECTURE.md §10.6). By default every connection a
 * workflow makes refuses loopback, private and reserved addresses; FLOWAID_ALLOW_PRIVATE_NETWORK
 * lifts that for the safe fetch (HTTP, GraphQL and AI nodes, knowledge loaders, OpenAPI tools,
 * HTTP MCP servers, notification webhooks) and the database query node together.
 */
import type { Env } from "@flowaid/env";
import { dbQueryConnector } from "@flowaid/nodes-core";
import { createSafeFetch } from "@flowaid/providers";
import type { SafeFetch } from "@flowaid/workflow-core";

export interface WorkerNetwork {
  allowPrivateNetwork: boolean;
  http: SafeFetch;
}

/** Builds the worker's safe fetch and sets the database query node's (process-wide) policy. */
export function workerNetworkFromEnv(
  env: Pick<Env, "FLOWAID_ALLOW_PRIVATE_NETWORK">,
): WorkerNetwork {
  const allowPrivateNetwork = env.FLOWAID_ALLOW_PRIVATE_NETWORK;
  dbQueryConnector.network = { ...dbQueryConnector.network, allowPrivate: allowPrivateNetwork };
  return {
    allowPrivateNetwork,
    http: createSafeFetch({
      timeoutMs: 120_000,
      userAgent: "FlowAId-Worker/1",
      allowPrivate: allowPrivateNetwork,
    }),
  };
}
