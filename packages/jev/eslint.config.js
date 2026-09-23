import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// jev is browser-safe (no Node built-ins); its co-located tests may read docs and examples from disk.
// src/test-fixtures.ts is a test-only helper (never exported, excluded from the build), so it gets the
// same allowance as the test files that import it.
export default [
  ...base,
  boundaryConfig("jev"),
  testBoundaryConfig("jev"),
  { ...testBoundaryConfig("jev"), name: "flowaid/boundaries:jev:test-fixtures", files: ["src/test-fixtures.ts"] },
];
