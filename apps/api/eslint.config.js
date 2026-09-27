import base from "@flowaid/config/eslint";
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
    },
  },
];
