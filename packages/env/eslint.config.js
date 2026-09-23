import base, { allowProcessEnv } from "@flowaid/config/eslint";
import { boundaryConfig } from "../../eslint.boundaries.js";

// @flowaid/env is the only package that reads process.env (ARCHITECTURE.md §1.1).
export default [...base, allowProcessEnv, boundaryConfig("env")];
