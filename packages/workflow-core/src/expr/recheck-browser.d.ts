/**
 * Declarations for `recheck`'s pure-JS build (`recheck/lib/browser.js`), which
 * the package ships without types. Its API is the one `recheck/index.d.ts`
 * declares; `regex.ts` explains why the pure build is imported directly.
 */
declare module "recheck/lib/browser.js" {
  import type { check, checkSync } from "recheck";

  const recheck: { readonly check: typeof check; readonly checkSync: typeof checkSync };
  export default recheck;
}
