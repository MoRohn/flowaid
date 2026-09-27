/** @flowaid/api — the HTTP API as a library (the entrypoint is `main.ts`). */
export { buildServer, type BuildOptions } from "./server.js";
export {
  configFromEnv,
  defaultConfig,
  type ApiConfig,
  type ApiContext,
  type Clock,
} from "./context.js";
export { AuthService } from "./auth/service.js";
export { JwtKeys } from "./auth/jwt.js";
export { generateApiKey, parseApiKey, hashSecret } from "./auth/apiKey.js";
export { firstBoot } from "./bootstrap/firstBoot.js";
export { SCOPES, ROLE_SCOPES, type Scope } from "./auth/scopes.js";
