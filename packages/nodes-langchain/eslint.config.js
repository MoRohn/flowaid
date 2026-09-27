import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// The LangChain node package, one of the two places allowed to import `@langchain/*`
// (boundaries.json `thirdParty`). src/test/ holds test-only fakes (never exported, excluded from
// the build), so it gets the same allowance as the tests.
export default [
  ...base,
  boundaryConfig("nodes-langchain"),
  testBoundaryConfig("nodes-langchain"),
  {
    ...testBoundaryConfig("nodes-langchain"),
    name: "flowaid/boundaries:nodes-langchain:test-helpers",
    files: ["src/test/**"],
  },
  {
    // Tests match partial objects with `expect.any()` / `expect.objectContaining()`.
    name: "flowaid/nodes-langchain:tests-match-partially",
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
];
