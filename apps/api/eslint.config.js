import base, { allowProcessEnv } from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// The HTTP API. src/test/ holds test-only fixtures
// (never exported, excluded from the build), so it gets the same allowance as the tests.
export default [
  ...base,
  boundaryConfig("api"),
  testBoundaryConfig("api"),
  {
    ...testBoundaryConfig("api"),
    name: "flowaid/boundaries:observability:test-helpers",
    files: ["src/test/**"],
  },
  {
    // Tests match partial objects with `expect.any()` / `expect.objectContaining()`.
    name: "flowaid/observability:tests-match-partially",
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      // HTTP tests read untyped JSON bodies (res.json()).
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      // res.json() is `any`; casts document the expected shape even when lint calls them redundant.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
  {
    // `pnpm eval:assistant` is a developer command (excluded from the build), like the `pnpm
    // start` launcher: it reads the provider key the person running it exported.
    ...allowProcessEnv,
    files: ["src/evals/**"],
  },
];
