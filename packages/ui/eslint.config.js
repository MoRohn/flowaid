import react, { processEnvRestrictedSyntax } from "@flowaid/config/eslint-react";
import { boundaryConfig, testBoundaryConfig } from "../../eslint.boundaries.js";

const TYPE_FLOOR_MESSAGE =
  "Arbitrary text sizes (`text-[…]`) bypass the type scale and its 11px floor (brand/IDENTITY.md): use text-2xs … text-2xl.";
const TITLE_HINT_MESSAGE =
  "A native `title` hint is not keyboard reachable and is read inconsistently: use the Tooltip primitive (interactive elements) or Hint / sr-only text (UI.md §9).";
const RAW_COLOUR_MESSAGE =
  "Raw `rgba(…)` colours bypass the tokens: use a token (shadow-1…3, var(--…)) or color-mix() over one.";

/**
 * Brand and accessibility conformance selectors for @flowaid/ui (UI.md, brand/IDENTITY.md):
 * no arbitrary Tailwind text sizes and no raw `rgba(` colours in any string or template
 * literal, and no native `title` hints on DOM elements.
 * `no-restricted-syntax` options replace (not merge with) the base config's, so the
 * `process.env` ban is restated alongside them.
 */
export const uiBrandRestrictedSyntax = Object.freeze([
  { selector: "Literal[value=/text-\\[/]", message: TYPE_FLOOR_MESSAGE },
  { selector: "TemplateElement[value.raw=/text-\\[/]", message: TYPE_FLOOR_MESSAGE },
  { selector: "Literal[value=/rgba\\(/]", message: RAW_COLOUR_MESSAGE },
  {
    // `title` on a DOM element (an <iframe>'s title is its accessible name, so it stays).
    selector: 'JSXOpeningElement[name.type="JSXIdentifier"][name.name=/^(?!iframe$)[a-z]/] > JSXAttribute[name.name="title"]',
    message: TITLE_HINT_MESSAGE,
  },
  { selector: "TemplateElement[value.raw=/rgba\\(/]", message: RAW_COLOUR_MESSAGE },
]);

// ui is browser-safe (no Node built-ins) and may import only @flowaid/workflow-core; its
// co-located tests may still read fixtures from disk.
export default [
  ...react,
  { ignores: ["playground/dist/**"] },
  {
    name: "flowaid/ui-brand",
    rules: {
      "no-restricted-syntax": ["error", ...processEnvRestrictedSyntax, ...uiBrandRestrictedSyntax],
    },
  },
  boundaryConfig("ui"),
  testBoundaryConfig("ui"),
];
