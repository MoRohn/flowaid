import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// Postgres persistence (Node only). src/test/ holds test-only fixtures
// (never exported, excluded from the build), so it gets the same allowance as the tests.
export default [
  ...base,
  boundaryConfig("database"),
  testBoundaryConfig("database"),
  {
    ...testBoundaryConfig("database"),
    name: "flowaid/boundaries:database:test-helpers",
    files: ["src/test/**"],
  },
  {
    // Tests match partial objects with `expect.any()` / `expect.objectContaining()`.
    name: "flowaid/database:tests-match-partially",
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
];
