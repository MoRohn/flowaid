import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// The node SDK is browser-safe (no Node built-ins); its co-located tests may read fixtures from disk.
// src/test/ holds test-only helpers (never exported, excluded from the build), so it gets the same
// allowance as the test files that import it.
export default [
  ...base,
  boundaryConfig("node-sdk"),
  testBoundaryConfig("node-sdk"),
  {
    ...testBoundaryConfig("node-sdk"),
    name: "flowaid/boundaries:node-sdk:test-helpers",
    files: ["src/test/**"],
  },
  {
    // Tests edit workflow documents as loose JSON (`Record<string, any>`) to build each case.
    name: "flowaid/node-sdk:tests-edit-json",
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
];
