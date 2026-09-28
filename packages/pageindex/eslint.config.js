import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// PageIndex: the service client, tree-navigation retrieval and citation checks. Decisions and
// page reads are injected, so the logic runs the same in the worker, the API and tests.
export default [
  ...base,
  boundaryConfig("pageindex"),
  testBoundaryConfig("pageindex"),
  {
    // Tests match partial objects with `expect.objectContaining()`.
    name: "flowaid/pageindex:tests-match-partially",
    files: ["src/**/*.test.ts"],
    rules: { "@typescript-eslint/no-unsafe-assignment": "off" },
  },
];
