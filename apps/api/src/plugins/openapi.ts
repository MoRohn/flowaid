/** OpenAPI 3.1 at `GET /v1/openapi.json` (with `x-cli` per operation) and the Scalar reference at `/docs`. */
import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import scalar from "@scalar/fastify-api-reference";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

export const API_VERSION = "1.1.0";

/**
 * Recursive Zod schemas (JSON values inside `HumanResponse`) come out of the type provider as
 * `#/components/schemas/schemaN` references whose definitions it never emits; the document
 * registers no components, so such a reference would dangle. Inline them as `{}` (any JSON).
 */
function inlineDanglingRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inlineDanglingRefs);
  if (value === null || typeof value !== "object") return value;
  const ref = (value as { $ref?: unknown }).$ref;
  if (typeof ref === "string" && ref.startsWith("#/components/schemas/")) return {};
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, inlineDanglingRefs(v)] as const),
  );
}

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "FlowAId API",
        version: API_VERSION,
        description:
          "Typed decision workflows: build, run, observe and evaluate. See docs/design/API.md.",
      },
      components: {
        securitySchemes: {
          apiKey: {
            type: "http",
            scheme: "bearer",
            description: "`fa_live_…` / `fa_test_…` API key",
          },
          session: { type: "apiKey", in: "cookie", name: "__Host-fa_session" },
        },
      },
      security: [{ apiKey: [] }, { session: [] }],
    },
    transform: (input) => {
      const transformed = jsonSchemaTransform(input);
      const out = {
        ...transformed,
        schema: inlineDanglingRefs(transformed.schema) as typeof transformed.schema,
      };
      const config = (input.route.config ?? {}) as {
        cli?: unknown;
        auth?: string;
        scope?: unknown;
      };
      const schema = out.schema as Record<string, unknown>;
      if (config.cli) schema["x-cli"] = config.cli;
      if (config.auth) schema["x-auth"] = config.auth;
      if (config.scope)
        schema["x-scopes"] = typeof config.scope === "string" ? [config.scope] : config.scope;
      if (config.auth === "public") schema.security = [];
      return out;
    },
  });
  app.get(
    "/v1/openapi.json",
    { config: { auth: "public", cli: { noun: "api", verb: "schema" } }, schema: { hide: true } },
    () => app.swagger(),
  );
  await app.register(scalar, {
    routePrefix: "/docs",
    configuration: { url: "/v1/openapi.json", title: "FlowAId API" },
  });
}
