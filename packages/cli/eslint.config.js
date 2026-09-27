import base, { allowProcessEnv } from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// The CLI. It builds the environment for local runs, so it may read process.env
// (ARCHITECTURE.md §1.1). src/generated/ is written by scripts/gen-sdk-types.ts.
export default [
  { ignores: ["src/generated/**"] },
  ...base,
  boundaryConfig("cli"),
  testBoundaryConfig("cli"),
  { ...allowProcessEnv, files: ["src/**"] },
  {
    name: "flowaid/cli:tests",
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
];
