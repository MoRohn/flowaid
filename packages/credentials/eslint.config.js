import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// Credential security (Node only); its co-located tests may read fixtures from disk.
// src/test/ holds test-only helpers (never exported, excluded from the build), so it gets the same
// allowance as the test files that import it.
export default [
  ...base,
  boundaryConfig("credentials"),
  testBoundaryConfig("credentials"),
  {
    ...testBoundaryConfig("credentials"),
    name: "flowaid/boundaries:credentials:test-helpers",
    files: ["src/test/**"],
  },
  {
    // Tests edit workflow documents as loose JSON (`Record<string, any>`) to build each case.
    name: "flowaid/providers:tests-edit-json",
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
