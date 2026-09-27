import base from "@flowaid/config/eslint";
import {
  boundaryConfig,
  testBoundaryConfig,
  thirdPartyExceptionConfigs,
} from "../../eslint.boundaries.js";

// The worker. src/test/ holds test-only fixtures
// (never exported, excluded from the build), so it gets the same allowance as the tests.
export default [
  ...base,
  boundaryConfig("worker"),
  testBoundaryConfig("worker"),
  ...thirdPartyExceptionConfigs("worker"),
  {
    ...testBoundaryConfig("worker"),
    name: "flowaid/boundaries:observability:test-helpers",
    files: ["src/test/**"],
  },
  {
    // Tests match partial objects with `expect.any()` / `expect.objectContaining()`.
    name: "flowaid/observability:tests-match-partially",
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      // HTTP tests read untyped JSON bodies (res.json()).
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      // res.json() is `any`; casts document the expected shape even when lint calls them redundant.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
];
