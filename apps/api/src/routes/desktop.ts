/**
 * `/v1/desktop` (API.md §7): FlowAId as a desktop application, when `./flowaid` started it. The
 * app's Close window and Quit FlowAId ask the launcher to close FlowAId's window or stop
 * everything it started; `features.desktop` says whether a launcher is there. Session-only (no
 * API keys) and `admin`: quitting stops the application for everyone using it.
 */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { ApiContext } from "../context.js";
import { ApiError } from "../plugins/errors.js";
import {
  ActivitySchema,
  LauncherClient,
  LauncherStatusSchema,
  activityCounts,
} from "../services/desktop.js";

export function desktopRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const launcher = ctx.config.launcher ? new LauncherClient(ctx.config.launcher) : null;
  const need = (): LauncherClient => {
    if (!launcher)
      throw new ApiError(
        409,
        "DESKTOP_UNAVAILABLE",
        "FlowAId was not started with ./flowaid on this computer, so it has no window or launcher to control",
      );
    return launcher;
  };

  r.get(
    "/v1/desktop",
    {
      config: { auth: "session", scope: "admin", cli: { noun: "desktop", verb: "status" } },
      schema: {
        tags: ["desktop"],
        summary:
          "What the launcher manages (FlowAId's window, its menu bar icon) and what runs in the background",
        response: {
          200: LauncherStatusSchema.extend({
            /** across workspaces: what Quit FlowAId would interrupt */
            activity: ActivitySchema,
          }),
        },
      },
    },
    async () => ({ ...(await need().status()), activity: await activityCounts(ctx.db) }),
  );

  r.post(
    "/v1/desktop/window/close",
    {
      config: {
        auth: "session",
        scope: "admin",
        audit: { action: "application.close_window", resource: "application" },
        cli: { noun: "desktop", verb: "close-window" },
      },
      schema: {
        tags: ["desktop"],
        summary: "Close FlowAId's window; FlowAId keeps running in the menu bar",
        response: {
          200: z.object({
            /** false: FlowAId is in a browser tab the launcher cannot close; the page closes itself */
            closed: z.boolean(),
          }),
        },
      },
    },
    async () => ({ closed: await need().closeWindow() }),
  );

  r.post(
    "/v1/desktop/quit",
    {
      config: {
        auth: "session",
        scope: "admin",
        audit: { action: "application.quit", resource: "application" },
        cli: { noun: "desktop", verb: "quit" },
      },
      schema: {
        tags: ["desktop"],
        summary: "Quit FlowAId: stop the web app, the worker and the API",
        response: { 202: z.object({ stopping: z.literal(true) }) },
      },
    },
    async (_req, reply) => {
      await need().quit();
      return reply.code(202).send({ stopping: true as const });
    },
  );
}
