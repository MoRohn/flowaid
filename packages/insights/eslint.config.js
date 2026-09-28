import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// Change detection: pure statistics over data the caller loads. Browser-safe.
export default [...base, boundaryConfig("insights"), testBoundaryConfig("insights")];
