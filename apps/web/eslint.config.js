import react from "@flowaid/config/eslint-react";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

// The web app: browser code plus Next.js config (next.config.ts may read process.env; config
// files are exempt from the ban, see packages/config/eslint.base.js).
export default [
  ...react,
  { ignores: [".next/**", "next-env.d.ts", "public/**"] },
  boundaryConfig("web"),
  testBoundaryConfig("web"),
];
