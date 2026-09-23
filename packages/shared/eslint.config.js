import base from "@flowaid/config/eslint";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// shared is browser-safe (no Node built-ins); its co-located tests may still use them.
export default [...base, boundaryConfig("shared"), testBoundaryConfig("shared")];
