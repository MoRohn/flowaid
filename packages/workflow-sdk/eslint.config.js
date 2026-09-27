import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

export default [...base, boundaryConfig("workflow-sdk"), testBoundaryConfig("workflow-sdk")];
