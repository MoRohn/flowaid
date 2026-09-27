import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// Knowledge/RAG building blocks. src/testing.ts is the adapter contract suite other packages'
// tests import, so it gets the tests' allowance (vitest).
export default [
  ...base,
  boundaryConfig("knowledge"),
  testBoundaryConfig("knowledge"),
  {
    ...testBoundaryConfig("knowledge"),
    name: "flowaid/boundaries:knowledge:testing",
    files: ["src/testing.ts"],
  },
];
