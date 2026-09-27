import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// The SDK. src/generated/ is written by scripts/gen-sdk-types.ts (checked by `pnpm sdk:check`).
export default [
  { ignores: ["src/generated/**"] },
  ...base,
  boundaryConfig("workflow-sdk"),
  testBoundaryConfig("workflow-sdk"),
  {
    // Tests read untyped JSON bodies and match partial objects.
    name: "flowaid/workflow-sdk:tests",
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
];
