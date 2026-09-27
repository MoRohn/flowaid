/**
 * `@flowaid/plugins` — plugin discovery, resolution and install checks (ARCHITECTURE.md §3.5).
 * Pure data handling: it never imports or runs plugin code.
 */
export {
  compare,
  isValidRange,
  isValidVersion,
  maxSatisfying,
  parseRange,
  parseVersion,
  satisfies,
  type SemVer,
} from "./semver.js";
export { isAllowed, isPackageName, parsePluginSpec, scopeOf, type PluginSpec } from "./spec.js";
export {
  MAX_UNPACKED_BYTES,
  integrityOf,
  packTarball,
  readTarball,
  verifyIntegrity,
  type TarEntry,
} from "./tarball.js";
export {
  DISCOVERY_KEYWORD,
  RegistryClient,
  RegistryError,
  type FetchLike,
  type Packument,
  type PackumentVersion,
  type RegistryClientOptions,
  type SearchResult,
} from "./registry.js";
export {
  PLATFORM_SDK_VERSION,
  PluginProblem,
  checkPluginVersion,
  idPrefixFor,
  manifestsFromFiles,
  resolvePlugin,
  type PluginProblemCode,
  type ResolveOptions,
  type ResolvedPlugin,
} from "./resolve.js";
