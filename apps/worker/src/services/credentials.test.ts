import { describe, expect, it } from "vitest";
import type { CredentialService } from "@flowaid/credentials";
import type { CredentialRepository, ExecutionPlan } from "@flowaid/workflow-core";
import type { ExecutionCall } from "@flowaid/workflow-runtime";
import { RunCredentialCache, credentialAccessFor } from "./credentials.js";

const call = {
  runId: "r1",
  workflowId: "w1",
  workflowVersionId: "v1",
  environmentId: "e1",
  environment: "dev",
  node: { op: { kind: "task", credentials: { typesafe: "TYPESAFE_API_KEY", crm: "CRM_TOKEN" } } },
} as unknown as ExecutionCall;

const plan = {
  secrets: [
    { name: "TYPESAFE_API_KEY", credentialType: "typesafe.api_key", required: true },
    { name: "CRM_TOKEN", credentialType: "http.bearer", required: true },
  ],
} as unknown as ExecutionPlan;

const repo = (bound: Record<string, string>) =>
  ({
    resolveBinding: (_w: string, _e: string, secret: string) =>
      Promise.resolve(bound[secret] ?? null),
  }) as unknown as CredentialRepository;

const cache = new RunCredentialCache({
  forRun: () => ({ get: (id: string) => Promise.resolve({ apiKey: `bound:${id}` }) }),
} as unknown as CredentialService);

describe("credentialAccessFor", () => {
  it("prefers the credential bound in the environment", async () => {
    const access = credentialAccessFor(call, repo({ TYPESAFE_API_KEY: "c1" }), cache, plan, {
      typesafe: "ts-server-key",
    });
    await expect(access.get("typesafe")).resolves.toEqual({ apiKey: "bound:c1" });
  });

  it("falls back to the server's key for the secret's credential type", async () => {
    const access = credentialAccessFor(call, repo({}), cache, plan, { typesafe: "ts-server-key" });
    await expect(access.get("typesafe")).resolves.toEqual({ apiKey: "ts-server-key" });
  });

  it("refuses when nothing is bound and the server has no key for the type", async () => {
    const access = credentialAccessFor(call, repo({}), cache, plan, { typesafe: "ts-server-key" });
    await expect(access.get("crm")).rejects.toThrow(
      "secret CRM_TOKEN is not bound in environment dev and the server has no key for http.bearer",
    );
    const noKeys = credentialAccessFor(call, repo({}), cache, plan);
    await expect(noKeys.get("typesafe")).rejects.toThrow(/not bound/);
  });
});
