import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// The TypeSafe decision provider. src/test/ holds test-only fixtures
// (never exported, excluded from the build), so it gets the same allowance as the tests.
export default [
  ...base,
  boundaryConfig("provider-typesafe"),
  testBoundaryConfig("provider-typesafe"),
  {
    ...testBoundaryConfig("provider-typesafe"),
    name: "flowaid/boundaries:observability:test-helpers",
    files: ["src/test/**"],
  },
  {
    // Tests match partial objects with `expect.any()` / `expect.objectContaining()`.
    name: "flowaid/observability:tests-match-partially",
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
];
