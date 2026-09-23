import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// The compiler is browser-safe (no Node built-ins); its co-located tests may read fixtures from disk.
// src/test/ holds test-only helpers (never exported, excluded from the build), so it gets the same
// allowance as the test files that import it.
export default [
  ...base,
  boundaryConfig("workflow-compiler"),
  testBoundaryConfig("workflow-compiler"),
  {
    ...testBoundaryConfig("workflow-compiler"),
    name: "flowaid/boundaries:workflow-compiler:test-helpers",
    files: ["src/test/**"],
  },
  {
    // Tests edit workflow documents as loose JSON (`Record<string, any>`) to build each case.
    name: "flowaid/workflow-compiler:tests-edit-json",
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
