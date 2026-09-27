import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// The advisor: optimizer, AI builder and critic. Pure; generation and decisions are injected.
export default [
  ...base,
  boundaryConfig("advisor"),
  testBoundaryConfig("advisor"),
  {
    // src/test/ holds test-only fixtures (never exported, excluded from the build)
    ...testBoundaryConfig("advisor"),
    name: "flowaid/boundaries:advisor:test-helpers",
    files: ["src/test/**"],
  },
  {
    // Tests match partial objects with `expect.any()` / `expect.objectContaining()`.
    name: "flowaid/advisor:tests-match-partially",
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
];
