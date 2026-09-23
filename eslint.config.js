// Root ESLint flat config: the shared base plus the dependency boundaries of every package.
// Running `eslint .` here checks the whole monorepo; each package's own eslint.config.js
// composes the same pieces for `pnpm --filter <pkg> lint`.
import base, { allowProcessEnv } from "@flowaid/config/eslint";
import { reactConfigs } from "@flowaid/config/eslint-react";
import { boundaryConfigs } from "./eslint.boundaries.js";

/** Packages linted with the React preset (their own eslint.config.js uses eslint-react). */
const REACT_DIRS = ["packages/ui", "apps/web"];

export default [
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/node_modules/**",
      "docs/**",
      "packages/ui/playground/dist/**",
    ],
  },
  ...base,
  ...reactConfigs(REACT_DIRS),
  // Per-package directory-scoped rules, then test-file entries, then the file-level
  // third-party exceptions (later entries win for the files they match).
  ...boundaryConfigs(),
  // Only @flowaid/env reads process.env; @flowaid/cli builds the env for local runs
  // (ARCHITECTURE.md §1.1, "Environment boundary"). Mirrors their own eslint.config.js.
  { ...allowProcessEnv, files: ["packages/env/**", "packages/cli/**"] },
];
