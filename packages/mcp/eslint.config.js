import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// The mcp package. src/test/ holds test-only fixtures
// (never exported, excluded from the build), so it gets the same allowance as the tests.
export default [
  // fixtures/ holds plain Node scripts the tests spawn as MCP servers, outside the TypeScript
  // project; `eslint src` never reaches them, and the pre-commit hook should not either.
  { ignores: ["fixtures/**"] },
  ...base,
  boundaryConfig("mcp"),
  testBoundaryConfig("mcp"),
  {
    ...testBoundaryConfig("mcp"),
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
