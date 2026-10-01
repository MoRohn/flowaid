/**
 * The in-process half of plugin isolation, installed by the plugin host before it loads a
 * package (the runtime half is the Node permission model `host.ts` starts the process with).
 *
 * 1. **Built-in modules.** Code inside an installed plugin's directory (its entry and its bundled
 *    dependencies) may import only the built-ins in `PLUGIN_BUILTINS`: no `net`, `tls`, `http(s)`,
 *    `http2`, `dgram`, `dns`, `child_process`, `worker_threads`, `cluster`, `module`, `vm`, `v8`,
 *    `inspector`, `os`... A denied import throws `E_PLUGIN_BUILTIN_DENIED`. The check is a
 *    synchronous module hook (`module.registerHooks`), so it covers `import`, `import()` and
 *    `require`; `process.getBuiltinModule` applies the same list.
 * 2. **Provided packages.** `@flowaid/node-sdk`, `@flowaid/workflow-core` and `zod`, imported by
 *    name from plugin code, resolve to the host's own instances (one copy of the SDK and of zod,
 *    and no TypeScript sources to load in a development checkout).
 * 3. **Network globals.** `fetch`, `WebSocket` and `EventSource` throw `E_PLUGIN_NETWORK_DENIED`
 *    naming `ctx.http`, the worker's SSRF-guarded fetch that honours the workspace egress policy.
 * 4. **Signals.** `process.kill` may only signal the host itself (not the worker or a neighbour).
 *
 * This layer runs inside the plugin's own process and JavaScript realm, so it is defence in
 * depth, not a boundary: it holds only as long as no reachable object leaks a denied module. On
 * Node versions whose permission model has `--allow-net` (25+), the runtime itself refuses
 * network access; on Node 24 this layer is what stands between a plugin and a raw socket.
 */
import { isBuiltin, registerHooks } from "node:module";
import { sep } from "node:path";
import { pathToFileURL } from "node:url";

/** Built-ins a plugin may import (with or without `node:`), everything else is refused. */
export const PLUGIN_BUILTINS: ReadonlySet<string> = new Set([
  "assert",
  "assert/strict",
  "async_hooks",
  "buffer",
  "console",
  "crypto",
  "events",
  "fs",
  "fs/promises",
  "path",
  "path/posix",
  "path/win32",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "timers",
  "timers/promises",
  "url",
  "util",
  "util/types",
  "zlib",
]);

export const PROVIDED_SCHEME = "flowaid-provided:";
const PROVIDED = Symbol.for("flowaid.plugin-host.provided");

export class PluginGuardError extends Error {
  constructor(
    readonly code: "E_PLUGIN_BUILTIN_DENIED" | "E_PLUGIN_NETWORK_DENIED" | "E_PLUGIN_KILL_DENIED",
    message: string,
  ) {
    super(message);
    this.name = "PluginGuardError";
  }
}

const bare = (specifier: string) =>
  specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;

/** Whether a plugin may import this built-in (`node:` prefix optional). */
export function builtinAllowed(specifier: string): boolean {
  return PLUGIN_BUILTINS.has(bare(specifier));
}

function denyBuiltin(specifier: string): never {
  throw new PluginGuardError(
    "E_PLUGIN_BUILTIN_DENIED",
    `plugins may not import ${specifier}` +
      (/^(?:node:)?(?:net|tls|https?|http2|dgram|dns)/.test(specifier)
        ? "; reach the network through ctx.http"
        : ""),
  );
}

/** The module source re-exporting a provided namespace held by the host. */
function providedSource(name: string, namespace: Record<string, unknown>): string {
  const ref = `globalThis[Symbol.for(${JSON.stringify(PROVIDED.description)})][${JSON.stringify(name)}]`;
  const lines = [`const m = ${ref};`];
  const names: string[] = [];
  // string export names cover reserved words (zod exports `catch`) and any other key
  Object.keys(namespace).forEach((key, i) => {
    lines.push(`const e${i} = m[${JSON.stringify(key)}];`);
    names.push(`e${i} as ${JSON.stringify(key)}`);
  });
  lines.push(`export { ${names.join(", ")} };`);
  return lines.join("\n");
}

export interface PluginGuardOptions {
  /**
   * Real paths of the directories whose code is plugin code (an installed package's directory);
   * empty for a bundled package, which ships with the worker.
   */
  pluginRoots: string[];
  /** The host's own instances of the packages the platform provides to plugins. */
  provided: Record<string, Record<string, unknown>>;
}

let installed = false;

/** Installs the guard once per process; call before the plugin package is imported. */
export function installPluginGuard(options: PluginGuardOptions): void {
  if (installed) return;
  installed = true;
  (globalThis as Record<symbol, unknown>)[PROVIDED] = options.provided;
  const roots = options.pluginRoots.map((r) => pathToFileURL(r.endsWith(sep) ? r : r + sep).href);
  const fromPlugin = (parentURL: string | undefined) =>
    parentURL !== undefined && roots.some((root) => parentURL.startsWith(root));

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (fromPlugin(context.parentURL)) {
        if (isBuiltin(specifier) && !builtinAllowed(specifier)) denyBuiltin(specifier);
        if (Object.hasOwn(options.provided, specifier))
          return { url: `${PROVIDED_SCHEME}${specifier}`, format: "module", shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url.startsWith(PROVIDED_SCHEME)) {
        const name = url.slice(PROVIDED_SCHEME.length);
        const namespace = options.provided[name];
        if (!namespace) throw new Error(`${name} is not provided to plugins`);
        return { format: "module", source: providedSource(name, namespace), shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });

  if (options.pluginRoots.length > 0) {
    const getBuiltin = process.getBuiltinModule.bind(process);
    Object.defineProperty(process, "getBuiltinModule", {
      value: (id: string) => {
        if (!builtinAllowed(id)) denyBuiltin(id);
        return getBuiltin(id);
      },
      configurable: false,
      writable: false,
    });
  }

  for (const name of ["fetch", "WebSocket", "EventSource"]) {
    const deny = function denied(): never {
      throw new PluginGuardError(
        "E_PLUGIN_NETWORK_DENIED",
        `plugins may not use the global ${name}; reach the network through ctx.http`,
      );
    };
    Object.defineProperty(globalThis, name, { value: deny, configurable: false, writable: false });
  }

  const kill = process.kill.bind(process);
  Object.defineProperty(process, "kill", {
    value: (pid: number, signal?: string | number) => {
      if (pid !== process.pid)
        throw new PluginGuardError(
          "E_PLUGIN_KILL_DENIED",
          "plugins may only signal their own process",
        );
      return kill(pid, signal);
    },
    configurable: false,
    writable: false,
  });
}
