/**
 * Registration guard (API.md §3): every `/v1`, `/hooks`, `/mcp` route declares `config.auth`, a CLI
 * verb, and — for mutations — what it audits. A route without them fails at startup.
 */
import type { FastifyInstance } from "fastify";

const GUARDED = /^\/(?:v1|hooks|mcp|\.well-known)(?:\/|$)/;
const READS = new Set(["GET", "HEAD", "OPTIONS"]);

export function registerRouteGuard(app: FastifyInstance): void {
  app.addHook("onRoute", (route) => {
    if (!GUARDED.test(route.url)) return;
    const config = (route.config ?? {}) as { auth?: string; audit?: unknown; cli?: unknown };
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const where = `${methods.join(",")} ${route.url}`;
    if (!config.auth) throw new Error(`route ${where} declares no config.auth`);
    if (route.url.startsWith("/v1") && !config.cli)
      throw new Error(`route ${where} declares no config.cli`);
    const mutates = methods.some((m) => !READS.has(m));
    if (mutates && config.audit === undefined)
      throw new Error(`route ${where} mutates but declares no config.audit`);
  });
}
