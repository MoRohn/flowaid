/**
 * Refusals of private and local addresses (the outbound guard, THREAT_MODEL.md): FlowAId runs on
 * the person's own computer, so a server on localhost is a normal thing to try. Every refusal says
 * how to allow it, and answers 400 rather than the guard's 403, which reads as "you have no access".
 */
import { isPrivateRefusal, withPrivateNetworkFix } from "@flowaid/observability";
import { BadRequestError } from "@flowaid/workflow-core";

export { withPrivateNetworkFix };

/** A private-address refusal as a 400 naming the fix (`E_TOOL_SERVER_PRIVATE`); others unchanged. */
export function explainPrivateNetwork(error: unknown): unknown {
  if (!(error instanceof Error) || !isPrivateRefusal(error.message)) return error;
  return new BadRequestError(withPrivateNetworkFix(error.message), {
    diagnostic: "E_TOOL_SERVER_PRIVATE",
  });
}
