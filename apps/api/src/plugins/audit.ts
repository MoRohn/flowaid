/** Every successful mutation writes an `audit_events` row before the response leaves (API.md §1). */
import type { FastifyInstance } from "fastify";
import { recordAudit } from "@flowaid/database";
import type { ApiContext } from "../context.js";

export function registerAudit(app: FastifyInstance, ctx: ApiContext): void {
  app.addHook("onSend", async (req, reply, payload) => {
    const spec = req.routeOptions.config.audit;
    if (!spec || reply.statusCode >= 400) return payload;
    const actor =
      req.audit.actor ??
      (req.principal
        ? { type: req.principal.type, id: req.principal.id }
        : req.sessionOnly
          ? { type: "user" as const, id: req.sessionOnly.userId }
          : null);
    if (!actor) return payload;
    const params = (req.params ?? {}) as Record<string, string>;
    const workspaceId =
      req.audit.workspaceId !== undefined
        ? req.audit.workspaceId
        : (req.principal?.workspaceId ?? null);
    try {
      await ctx.db.system((tx) =>
        recordAudit(tx, {
          workspaceId,
          actorType: actor.type,
          actorId: actor.id,
          action: spec.action,
          resourceType: spec.resource,
          resourceId: req.audit.resourceId ?? params[spec.idParam ?? "id"] ?? "-",
          details: req.audit.details ?? {},
          ip: req.ip,
          userAgent:
            typeof req.headers["user-agent"] === "string"
              ? req.headers["user-agent"].slice(0, 500)
              : null,
          requestId: req.id,
        }),
      );
    } catch (error) {
      req.log.error({ err: error, action: spec.action }, "audit write failed");
    }
    return payload;
  });
}
