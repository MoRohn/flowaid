/** @flowaid/sandbox — code-pool executors (ARCHITECTURE.md §10.7, RFC-0019). */
export { SANDBOX_LIMITS } from "./limits.js";
export { transpile, transpileCacheSize } from "./transpile.js";
export {
  IsolatedVmSandbox,
  isolatedVmAvailable,
  loadIsolatedVm,
  type IsolatedVmOptions,
} from "./isolatedVm.js";
export {
  ContainerSandbox,
  containerArgs,
  containerRuntimeAvailable,
  type ContainerSandboxOptions,
} from "./container.js";

import type { SandboxExecutor } from "@flowaid/workflow-core";
import { ContainerSandbox, type ContainerSandboxOptions } from "./container.js";
import { IsolatedVmSandbox } from "./isolatedVm.js";

/** The executor for `SANDBOX_MODE` (`isolated-vm` by default, `container` for multi-tenant production). */
export function createSandbox(
  mode: "isolated-vm" | "container" = "isolated-vm",
  container?: ContainerSandboxOptions,
): SandboxExecutor {
  return mode === "container" ? new ContainerSandbox(container) : new IsolatedVmSandbox();
}
