import base from "@flowaid/config/eslint";
import {
  boundaryConfig,
  testBoundaryConfig,
  thirdPartyExceptionConfigs,
} from "../../eslint.boundaries.js";

// The FlowAId importer: pure translation of external flow exports into workflow definitions.
export default [
  ...base,
  boundaryConfig("importer"),
  testBoundaryConfig("importer"),
  ...thirdPartyExceptionConfigs("importer"),
  {
    name: "flowaid/importer:tests-match-partially",
    files: ["src/**/*.test.ts"],
    rules: { "@typescript-eslint/no-unsafe-assignment": "off" },
  },
];
