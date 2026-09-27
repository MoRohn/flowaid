import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// The docs site generator: reads the repository's docs and manifests, writes static HTML.
export default [...base, boundaryConfig("docs"), testBoundaryConfig("docs")];
