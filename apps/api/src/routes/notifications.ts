/**
 * Notification channels (API.md §3.10): `email`, `slack_webhook` and `webhook` channels a
 * workspace admin subscribes to events (`GET /v1/notifications/events`). Secrets never come back:
 * a Slack webhook URL is sealed as a credential when it is set, and a `webhook` channel's HMAC
 * signing secret is generated on create (and on rotate) and returned once. `POST /:id/test`
 * delivers a test message now and reports the outcome.
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { credentials, notifications, type Tx } from "@flowaid/database";
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_LABELS,
  deliverNotification,
  withPrivateNetworkFix,
} from "@flowaid/observability";
import { uuidv7 } from "@flowaid/shared";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  type JsonObject,
} from "@flowaid/workflow-core";
import type { Principal } from "../auth/principal.js";
import type { ApiContext } from "../context.js";
import { IdParams, NoContent, PageQuery, afterCursor, page, toPage } from "../dto/common.js";
import { channelSecret } from "../services/notify.js";

type Row = typeof notifications.$inferSelect;

const EventSchema = z.enum(NOTIFICATION_EVENTS);
const KindSchema = z.enum(["email", "slack_webhook", "webhook"]);
const EmailConfig = z.strictObject({ to: z.array(z.email()).min(1).max(20) });
const WebhookConfig = z.strictObject({ url: z.url({ protocol: /^https?$/ }) });

export const NotificationChannelSchema = z.object({
  id: z.uuid(),
  kind: KindSchema,
  name: z.string(),
  config: z.record(z.string(), z.unknown()),
  events: z.array(z.string()),
  enabled: z.boolean(),
  /** a Slack URL or signing secret is stored (never returned) */
  secretSet: z.boolean(),
  createdAt: z.string(),
});

const CreateSchema = z.object({
  kind: KindSchema,
  name: z.string().min(1).max(100),
  config: z.record(z.string(), z.unknown()).default({}),
  events: z.array(EventSchema).min(1).max(NOTIFICATION_EVENTS.length),
  enabled: z.boolean().default(true),
  /** `slack_webhook` only: the incoming-webhook URL (stored as a credential) */
  slackWebhookUrl: z.url({ protocol: /^https$/ }).optional(),
});

const PatchSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    events: z.array(EventSchema).min(1).max(NOTIFICATION_EVENTS.length).optional(),
    enabled: z.boolean().optional(),
    slackWebhookUrl: z.url({ protocol: /^https$/ }).optional(),
  })
  .strict();

const dto = (r: Row) => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  config: r.config,
  events: r.events,
  enabled: r.enabled,
  secretSet: r.credentialId !== null,
  createdAt: r.createdAt.toISOString(),
});

/**
 * The kind's config, validated. A `webhook` URL is not called here: a private or local one is
 * accepted, and its sends are refused (saying how to allow them) until the server allows such
 * addresses.
 */
function checkConfig(kind: Row["kind"], config: unknown): JsonObject {
  const schema =
    kind === "email" ? EmailConfig : kind === "webhook" ? WebhookConfig : z.strictObject({});
  const r = schema.safeParse(config);
  if (!r.success)
    throw new BadRequestError(
      `invalid ${kind} configuration: ${r.error.issues[0]?.message ?? ""}`,
      {
        issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    );
  return r.data;
}

export function notificationRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const need = (p: Principal | null): Principal => {
    if (!p) throw new ForbiddenError("no principal");
    return p;
  };
  const load = async (tx: Tx, p: Principal, id: string): Promise<Row> => {
    const [row] = await tx
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.workspaceId, p.workspaceId)));
    if (!row) throw new NotFoundError("notification channel not found");
    return row;
  };
  /**
   * Seals a secret as an `http.header` credential that belongs to the channel: left out of the
   * credentials list and deleted with the channel. It replaces the channel's previous secret, which
   * is deleted first (it stops working now, and it would hold the name).
   */
  const sealSecret = async (
    tx: Tx,
    p: Principal,
    channelId: string,
    label: string,
    name: string,
    value: string,
  ) => {
    await tx.delete(credentials).where(eq(credentials.ownerNotificationId, channelId));
    const id = uuidv7();
    const sealed = await ctx.credentials.seal(id, "http.header", { name, value });
    await tx.insert(credentials).values({
      id,
      workspaceId: p.workspaceId,
      name: label,
      type: "http.header",
      storage: "db",
      ciphertext: sealed.ciphertext,
      wrappedDataKey: sealed.wrappedDataKey,
      keyVersion: sealed.keyVersion,
      publicFields: sealed.publicFields,
      ownerNotificationId: channelId,
      createdBy: p.userId,
    });
    await tx.update(notifications).set({ credentialId: id }).where(eq(notifications.id, channelId));
    return id;
  };
  const newSigningSecret = () => `nfsec_${randomBytes(32).toString("base64url")}`;

  r.get(
    "/v1/notifications/events",
    {
      config: {
        auth: "session_or_api_key",
        scope: "admin",
        cli: { noun: "notification", verb: "events" },
      },
      schema: {
        tags: ["notifications"],
        summary: "The events a channel can subscribe to",
        response: {
          200: z.array(z.object({ id: z.string(), label: z.string() })),
        },
      },
    },
    () => NOTIFICATION_EVENTS.map((id) => ({ id, label: NOTIFICATION_EVENT_LABELS[id] })),
  );

  r.get(
    "/v1/notifications",
    {
      config: {
        auth: "session_or_api_key",
        scope: "admin",
        cli: { noun: "notification", verb: "list" },
      },
      schema: {
        tags: ["notifications"],
        querystring: PageQuery,
        response: { 200: page(NotificationChannelSchema) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const { limit, cursor } = req.query;
      const rows = await ctx.db.tenant(p.workspaceId, (tx) =>
        tx
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.workspaceId, p.workspaceId),
              afterCursor(notifications.name, notifications.id, cursor),
            ),
          )
          .orderBy(asc(notifications.name), asc(notifications.id))
          .limit(limit + 1),
      );
      return toPage(rows, limit, (n) => [n.name, n.id], dto);
    },
  );

  r.post(
    "/v1/notifications",
    {
      config: {
        auth: "session_or_api_key",
        scope: "admin",
        audit: { action: "notification.create", resource: "notification" },
        cli: { noun: "notification", verb: "create" },
      },
      schema: {
        tags: ["notifications"],
        body: CreateSchema,
        response: {
          201: z.object({
            channel: NotificationChannelSchema,
            /** `webhook` channels: the HMAC signing secret, shown once */
            signingSecret: z.string().optional(),
          }),
        },
      },
    },
    async (req, reply) => {
      const p = need(req.principal);
      const b = req.body;
      const config = checkConfig(b.kind, b.config);
      if (b.kind === "slack_webhook" && !b.slackWebhookUrl)
        throw new BadRequestError("a Slack channel needs its incoming-webhook URL");
      if (b.kind !== "slack_webhook" && b.slackWebhookUrl)
        throw new BadRequestError("slackWebhookUrl applies to slack_webhook channels only");
      const signingSecret = b.kind === "webhook" ? newSigningSecret() : undefined;
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        // the channel first: its secret belongs to it
        const [created] = await tx
          .insert(notifications)
          .values({
            id: uuidv7(),
            workspaceId: p.workspaceId,
            kind: b.kind,
            name: b.name,
            config,
            credentialId: null,
            events: b.events,
            enabled: b.enabled,
          })
          .returning();
        const channel = created as Row;
        const credentialId =
          b.kind === "slack_webhook" && b.slackWebhookUrl
            ? await sealSecret(
                tx,
                p,
                channel.id,
                `notification ${b.name} (Slack)`,
                "Slack-Webhook-URL",
                b.slackWebhookUrl,
              )
            : signingSecret
              ? await sealSecret(
                  tx,
                  p,
                  channel.id,
                  `notification ${b.name} (signing)`,
                  "X-FlowAId-Signature",
                  signingSecret,
                )
              : null;
        return { ...channel, credentialId };
      });
      req.audit = { resourceId: row.id, details: { kind: row.kind, events: row.events } };
      return reply
        .code(201)
        .send({ channel: dto(row), ...(signingSecret ? { signingSecret } : {}) });
    },
  );

  r.patch(
    "/v1/notifications/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "admin",
        audit: { action: "notification.update", resource: "notification" },
        cli: { noun: "notification", verb: "update", positional: ["id"] },
      },
      schema: {
        tags: ["notifications"],
        params: IdParams,
        body: PatchSchema,
        response: { 200: NotificationChannelSchema },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const b = req.body;
      const row = await ctx.db.tenant(p.workspaceId, async (tx) => {
        const cur = await load(tx, p, req.params.id);
        if (b.slackWebhookUrl && cur.kind !== "slack_webhook")
          throw new BadRequestError("slackWebhookUrl applies to slack_webhook channels only");
        const credentialId = b.slackWebhookUrl
          ? await sealSecret(
              tx,
              p,
              cur.id,
              `notification ${b.name ?? cur.name} (Slack)`,
              "Slack-Webhook-URL",
              b.slackWebhookUrl,
            )
          : undefined;
        const [u] = await tx
          .update(notifications)
          .set({
            ...(b.name !== undefined ? { name: b.name } : {}),
            ...(b.config !== undefined ? { config: checkConfig(cur.kind, b.config) } : {}),
            ...(b.events !== undefined ? { events: b.events } : {}),
            ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
            ...(credentialId ? { credentialId } : {}),
          })
          .where(eq(notifications.id, cur.id))
          .returning();
        return u as Row;
      });
      return dto(row);
    },
  );

  r.post(
    "/v1/notifications/:id/rotate-secret",
    {
      config: {
        auth: "session_or_api_key",
        scope: "admin",
        audit: { action: "notification.rotate_secret", resource: "notification" },
        cli: { noun: "notification", verb: "rotate-secret", positional: ["id"] },
      },
      schema: {
        tags: ["notifications"],
        summary: "A new HMAC signing secret for a webhook channel (returned once)",
        params: IdParams,
        response: { 200: z.object({ signingSecret: z.string() }) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const signingSecret = newSigningSecret();
      await ctx.db.tenant(p.workspaceId, async (tx) => {
        const cur = await load(tx, p, req.params.id);
        if (cur.kind !== "webhook")
          throw new BadRequestError("only webhook channels have a signing secret");
        await sealSecret(
          tx,
          p,
          cur.id,
          `notification ${cur.name} (signing)`,
          "X-FlowAId-Signature",
          signingSecret,
        );
      });
      return { signingSecret };
    },
  );

  r.delete(
    "/v1/notifications/:id",
    {
      config: {
        auth: "session_or_api_key",
        scope: "admin",
        audit: { action: "notification.delete", resource: "notification" },
        cli: { noun: "notification", verb: "delete", positional: ["id"] },
      },
      schema: { tags: ["notifications"], params: IdParams, response: { 204: NoContent } },
    },
    async (req, reply) => {
      const p = need(req.principal);
      await ctx.db.tenant(p.workspaceId, async (tx) => {
        const cur = await load(tx, p, req.params.id);
        // its own secret goes with it (cascade); delete the one it points at for older rows too
        await tx.delete(notifications).where(eq(notifications.id, cur.id));
        if (cur.credentialId)
          await tx.delete(credentials).where(eq(credentials.id, cur.credentialId));
      });
      return reply.code(204).send(null);
    },
  );

  r.post(
    "/v1/notifications/:id/test",
    {
      config: {
        auth: "session_or_api_key",
        scope: "admin",
        rateLimit: { max: 20, timeWindow: 60_000 },
        audit: { action: "notification.test", resource: "notification" },
        cli: { noun: "notification", verb: "test", positional: ["id"] },
      },
      schema: {
        tags: ["notifications"],
        summary: "Send a test message now",
        params: IdParams,
        response: { 200: z.object({ ok: z.boolean(), error: z.string().optional() }) },
      },
    },
    async (req) => {
      const p = need(req.principal);
      const row = await ctx.db.tenant(p.workspaceId, (tx) => load(tx, p, req.params.id));
      try {
        await deliverNotification(
          { id: row.id, kind: row.kind, name: row.name, config: row.config },
          {
            event: "test",
            workspaceId: p.workspaceId,
            title: "Test notification",
            text: `This is a test of the "${row.name}" channel. It will receive: ${row.events.join(", ")}.`,
            url: `${ctx.config.webUrl.replace(/\/$/, "")}/${p.workspaceSlug}/settings?tab=notifications`,
            at: new Date(ctx.clock.now()).toISOString(),
          },
          {
            fetch: ctx.http,
            secret: await channelSecret(ctx.credentials, row.credentialId),
            smtp: ctx.smtp,
          },
        );
        req.audit.details = { ok: true };
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        req.audit.details = { ok: false, error: message.slice(0, 300) };
        return { ok: false, error: withPrivateNetworkFix(message) };
      }
    },
  );
}
