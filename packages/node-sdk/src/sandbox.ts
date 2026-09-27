/**
 * `bindSandbox` (RFC-0019): binds a `SandboxExecutor` to one node's context. The bridges enforce the
 * request's own limits — `fetch` only with `allowNetwork` and to allow-listed hosts, `tools.call`
 * only for `req.tools`, state keys prefixed `run:<id>:` — on top of the context's services, so a
 * code node needs only the `sandbox` capability.
 */
import {
  ForbiddenError,
  SandboxError,
  type JsonValue,
  type SandboxBridges,
  type SandboxExecutor,
  type SandboxRunRequest,
  type SandboxShellRequest,
} from "@flowaid/workflow-core";
import type { ExecutionContext, SandboxAccess } from "./types.js";

/** `api.example.com` matches itself; `*.example.com` matches subdomains (not the apex). */
export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((a) => {
    const rule = a.toLowerCase();
    return rule.startsWith("*.")
      ? h.endsWith(rule.slice(1)) && h.length > rule.length - 1
      : h === rule;
  });
}

type BindableContext = Pick<
  ExecutionContext<unknown>,
  "http" | "tools" | "state" | "signal" | "run"
>;

export function sandboxBridges(
  ctx: BindableContext,
  req: Pick<SandboxRunRequest, "allowNetwork" | "allowedHosts" | "tools">,
): SandboxBridges {
  const prefix = `run:${ctx.run.id}:`;
  return {
    signal: ctx.signal,
    ...(req.allowNetwork
      ? {
          fetch: (
            url: string,
            init?: RequestInit & { maxRedirects?: number; maxBytes?: number },
          ) => {
            let host: string;
            try {
              host = new URL(url).hostname;
            } catch {
              return Promise.reject(new ForbiddenError(`sandbox fetch: not a URL: ${url}`));
            }
            if (!hostAllowed(host, req.allowedHosts))
              return Promise.reject(
                new ForbiddenError(`sandbox fetch: ${host} is not in allowedHosts`),
              );
            return ctx.http(url, {
              ...init,
              signal: init?.signal ? AbortSignal.any([init.signal, ctx.signal]) : ctx.signal,
            });
          },
        }
      : {}),
    ...(req.tools.length > 0
      ? {
          callTool: async (name: string, args: JsonValue) => {
            if (!req.tools.includes(name))
              throw new ForbiddenError(`sandbox tools.call: ${name} is not in config.tools`);
            const tool = (await ctx.tools.list()).find((t) => t.name === name);
            if (!tool) throw new ForbiddenError(`sandbox tools.call: unknown tool ${name}`);
            if (tool.approvalRequired)
              throw new SandboxError(
                `SandboxToolNeedsApproval: ${name} requires approval and cannot be called from code`,
              );
            const r = await ctx.tools.call(tool.source, name, args);
            if (!r.ok)
              throw new SandboxError(`tool ${name} failed: ${r.error?.message ?? r.content}`);
            return r.structured ?? r.content;
          },
        }
      : {}),
    stateGet: (key: string) => ctx.state.get("run", prefix + key),
    stateSet: (key: string, value: JsonValue) => ctx.state.set("run", prefix + key, value),
  };
}

const unavailable = () =>
  Promise.reject(new SandboxError("SANDBOX_UNAVAILABLE: this worker pool has no sandbox executor"));

export function bindSandbox(
  executor: SandboxExecutor | undefined,
  ctx: BindableContext,
): SandboxAccess {
  if (!executor) return { run: unavailable, shell: unavailable };
  return {
    run: (req: SandboxRunRequest) => executor.run(req, sandboxBridges(ctx, req)),
    shell: (req: SandboxShellRequest) =>
      executor.shell
        ? executor.shell(req, ctx.signal)
        : Promise.reject(
            new SandboxError(
              `SANDBOX_UNAVAILABLE: the ${executor.kind} sandbox cannot run shell scripts`,
            ),
          ),
  };
}
