/**
 * `@flowaid/node-sdk` — write flowaid nodes (CONTRACTS.ts §16, ARCHITECTURE.md §3). The test
 * harness is exported separately from `@flowaid/node-sdk/testing`.
 */
export * from "./types.js";
export { defineNode, definePackage } from "./define.js";
export { toManifest, jsonSchemaOf } from "./toManifest.js";
export {
  normalizePackage,
  idPrefixFor,
  type NormalizeResult,
  type PackageJsonInfo,
} from "./normalizePackage.js";
export { scopeContext, CAPABILITY_SERVICES } from "./context.js";
export { ok, suspend, fail } from "./result.js";
