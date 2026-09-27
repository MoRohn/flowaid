/**
 * `buildServer`: Fastify 5 with Zod-typed routes (API.md). Order matters: cookies and security
 * headers, error envelope, registration guard, auth (onRequest), rate limits (preHandler, keyed by
 * principal), audit (onSend), OpenAPI, then routes.
 */
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { uuidv7 } from "@flowaid/shared";
import type { ApiContext } from "./context.js";
import { registerAudit } from "./plugins/audit.js";
import { registerAuth } from "./plugins/auth.js";
import { registerErrorHandling } from "./plugins/errors.js";
import { registerRouteGuard } from "./plugins/guard.js";
import { registerOpenApi } from "./plugins/openapi.js";
import { registerRateLimit } from "./plugins/rateLimit.js";
import { apiKeyRoutes } from "./routes/apiKeys.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { catalogRoutes } from "./routes/catalog.js";
import { versionRoutes } from "./routes/versions.js";
import { runRoutes } from "./routes/runs.js";
import { credentialRoutes } from "./routes/credentials.js";
import { toolRoutes } from "./routes/tools.js";
import { ingressRoutes } from "./routes/ingress.js";
import { triggerRoutes } from "./routes/triggers.js";
import { evaluationRoutes } from "./routes/evaluations.js";
import { metricsRoutes } from "./routes/metrics.js";
import { aiRoutes } from "./routes/ai.js";
import { optimizeRoutes } from "./routes/optimize.js";
import { exportRoutes } from "./routes/export.js";
import { reviewRoutes } from "./routes/review.js";
import { mcpServerRoutes } from "./routes/mcpServer.js";
import { workflowRoutes } from "./routes/workflows.js";
import "./types.js";

export interface BuildOptions {
  logger?: FastifyServerOptions["logger"];
  /** extra route modules (later slices, tests) */
  routes?: ((app: FastifyInstance, ctx: ApiContext) => void)[];
}

export async function buildServer(ctx: ApiContext, o: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: o.logger ?? false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: ctx.config.trustProxy,
    genReqId: (req) => {
      const given = req.headers["x-request-id"];
      return typeof given === "string" && /^[A-Za-z0-9._-]{8,128}$/.test(given) ? given : uuidv7();
    },
    routerOptions: { maxParamLength: 500 },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook("onSend", async (req, reply, payload) => {
    void reply.header("x-request-id", req.id);
    return payload;
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: false, // the API serves JSON; /docs sets its own
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allowed = ctx.config.corsOrigins.includes("*")
        ? !ctx.config.production
        : ctx.config.corsOrigins.includes(origin);
      cb(null, allowed);
    },
    credentials: true,
    allowedHeaders: [
      "authorization",
      "content-type",
      "x-requested-with",
      "x-workspace",
      "if-match",
      "idempotency-key",
      "last-event-id",
      "x-request-id",
    ],
    exposedHeaders: ["x-request-id", "etag", "retry-after"],
    maxAge: 600,
  });

  registerErrorHandling(app);
  registerRouteGuard(app);
  registerAuth(app, ctx);
  await registerRateLimit(app, ctx);
  registerAudit(app, ctx);
  await registerOpenApi(app);

  healthRoutes(app, ctx);
  authRoutes(app, ctx);
  workspaceRoutes(app, ctx);
  apiKeyRoutes(app, ctx);
  catalogRoutes(app, ctx);
  workflowRoutes(app, ctx);
  versionRoutes(app, ctx);
  runRoutes(app, ctx);
  credentialRoutes(app, ctx);
  toolRoutes(app, ctx);
  triggerRoutes(app, ctx);
  ingressRoutes(app, ctx);
  evaluationRoutes(app, ctx);
  metricsRoutes(app, ctx);
  optimizeRoutes(app, ctx);
  aiRoutes(app, ctx);
  exportRoutes(app, ctx);
  reviewRoutes(app, ctx);
  mcpServerRoutes(app, ctx);
  for (const register of o.routes ?? []) register(app, ctx);
  return app;
}
