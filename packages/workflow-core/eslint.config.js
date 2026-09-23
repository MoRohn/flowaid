import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// Tests may read fixtures and docs/design/CONTRACTS.ts from disk (Node built-ins); the
// shipped sources stay browser-safe (tsconfig.build.json excludes *.test.ts).
export default [...base, boundaryConfig("workflow-core"), testBoundaryConfig("workflow-core")];
