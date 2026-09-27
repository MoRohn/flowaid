import base from "@flowaid/config/eslint";
import {
  boundaryConfig,
  testBoundaryConfig,
  thirdPartyExceptionConfigs,
} from "../../eslint.boundaries.js";

// Code export. The generated package's static sources are templates/*.tmpl (TypeScript for
// another project, never imported or linted here). src/test/ holds test-only helpers.
export default [
  ...base,
  boundaryConfig("codegen"),
  testBoundaryConfig("codegen"),
  ...thirdPartyExceptionConfigs("codegen"),
  {
    ...testBoundaryConfig("codegen"),
    name: "flowaid/boundaries:codegen:test-helpers",
    files: ["src/test/**"],
  },
  {
    // Tests match partial objects with `expect.any()` / `expect.objectContaining()`.
    name: "flowaid/codegen:tests-match-partially",
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
];
