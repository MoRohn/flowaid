import "@fastify/cookie";
/** Route-level contract every `/v1` route declares (API.md §1, §3): auth, scopes, audit, CLI verb. */
import type { JsonObject } from "@flowaid/workflow-core";
import type { AuthMode, Principal, SessionOnly } from "./auth/principal.js";
import type { Scope } from "./auth/scopes.js";

export interface AuditSpec {
  /** e.g. `workflow.publish` */
  action: string;
  /** e.g. `workflow` */
  resource: string;
  /** route param holding the resource id (default `id`) */
  idParam?: string;
}

export interface CliSpec {
  noun: string;
  verb: string;
  positional?: string[];
}

declare module "fastify" {
  interface FastifyContextConfig {
    auth?: AuthMode;
    scope?: Scope | readonly Scope[];
    /** `false` only for GET/HEAD; mutations must declare what they audit */
    audit?: AuditSpec | false;
    cli?: CliSpec;
    /** sessions may call it without a workspace (e.g. creating the first one) */
    allowNoWorkspace?: boolean;
  }
  interface FastifyRequest {
    principal: Principal | null;
    sessionOnly: SessionOnly | null;
    /** filled by handlers: the id of the resource the mutation touched and extra audit details */
    audit: {
      resourceId?: string;
      workspaceId?: string | null;
      details?: JsonObject;
      actor?: { type: Principal["type"]; id: string };
    };
  }
}

export {};
