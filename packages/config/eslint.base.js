// Shared flat ESLint config for all flowaid packages.
import tseslint from "typescript-eslint";

/**
 * AST selectors matching any read of `process.env` (`process.env.X`, `process.env["X"]`,
 * `const { X } = process.env`, `globalThis.process.env`, …). Only `@flowaid/env` may read the
 * environment (ARCHITECTURE.md §1.1, "Environment boundary"); `packages/env` and
 * `packages/cli` switch the rule off in their own eslint.config.js.
 */
export const PROCESS_ENV_SELECTORS = Object.freeze([
  'MemberExpression[object.type="Identifier"][object.name="process"][property.type="Identifier"][property.name="env"]',
  'MemberExpression[object.type="Identifier"][object.name="process"][property.type="Literal"][property.value="env"]',
  'MemberExpression[object.type="MemberExpression"][object.object.name="globalThis"][object.property.name="process"][property.name="env"]',
]);

export const PROCESS_ENV_MESSAGE =
  "Only @flowaid/env reads process.env: call loadEnv() once at process start and pass the typed Env down (ARCHITECTURE.md §1.1).";

/** `no-restricted-syntax` options banning `process.env` reads. */
export const processEnvRestrictedSyntax = Object.freeze(
  PROCESS_ENV_SELECTORS.map((selector) => ({ selector, message: PROCESS_ENV_MESSAGE })),
);

/**
 * Flat-config entry that lifts the `process.env` ban. Only `packages/env` (the sanctioned
 * reader) and `packages/cli` (which builds the env for local runs) may use it.
 * @type {import("eslint").Linter.Config}
 */
export const allowProcessEnv = Object.freeze({
  name: "flowaid/allow-process-env",
  rules: { "no-restricted-syntax": "off" },
});

export default tseslint.config(
  // Build output and tooling config files (vite/vitest/playwright configs at any depth) are
  // not linted: they are Node tooling, not shipped code, so package boundaries do not apply.
  { ignores: ["dist/**", ".next/**", "coverage/**", "node_modules/**", "**/*.config.*"] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    name: "flowaid/base",
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "no-restricted-syntax": ["error", ...processEnvRestrictedSyntax],
    },
  },
);
