// Shared flat ESLint config for React packages (packages/ui, apps/web): the base config
// plus the React Hooks rules (including the React Compiler checks) and jsx-a11y.
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";

import base from "./eslint.base.js";

export {
  PROCESS_ENV_SELECTORS,
  allowProcessEnv,
  processEnvRestrictedSyntax,
} from "./eslint.base.js";

const REACT_FILES = ["**/*.{jsx,tsx}"];
const ALL_FILES = ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];

/**
 * The React-only entries of this preset (React Hooks, jsx-a11y and their overrides), without
 * the base config. `dirs` scopes them to those repo-relative directories, for the root
 * eslint.config.js (`reactConfigs(["packages/ui", "apps/web"])`); a package's own config uses
 * the default export instead.
 * @param {readonly string[]} [dirs]
 * @returns {import("eslint").Linter.Config[]}
 */
export function reactConfigs(dirs) {
  /** @param {readonly string[]} globs */
  const scope = (globs) =>
    dirs === undefined ? [...globs] : dirs.flatMap((dir) => globs.map((g) => `${dir}/${g}`));
  return [
    {
      ...reactHooks.configs.flat.recommended,
      name: "flowaid/react-hooks",
      files: scope(ALL_FILES),
    },
    {
      ...jsxA11y.flatConfigs.recommended,
      name: "flowaid/jsx-a11y",
      files: scope(REACT_FILES),
    },
    {
      name: "flowaid/jsx-a11y-overrides",
      files: scope(REACT_FILES),
      rules: {
        // Explicit roles that are *not* redundant in practice: `list-style: none` (Tailwind's
        // preflight) strips the list role from <ul>/<ol> in WebKit/VoiceOver, and
        // `display: block|flex` on table sections strips their table semantics, so these roles
        // are restated on purpose (the rule's documented option for exactly this case).
        "jsx-a11y/no-redundant-roles": [
          "error",
          { ul: ["list"], ol: ["list"], thead: ["rowgroup"], tbody: ["rowgroup"] },
        ],
        // The @flowaid/ui form primitives render native labelable controls (input, textarea,
        // button[role=switch|checkbox]), so a <label> wrapping one of them is associated.
        "jsx-a11y/label-has-associated-control": [
          "error",
          {
            controlComponents: [
              "Checkbox",
              "Input",
              "NumberInput",
              "SearchInput",
              "Select",
              "Slider",
              "Switch",
              "Textarea",
            ],
            depth: 3,
          },
        ],
        // A focusable `separator` is a widget in WAI-ARIA 1.2 (the window-splitter pattern,
        // e.g. a column resize handle with aria-valuenow); jsx-a11y models it as structure only.
        "jsx-a11y/no-noninteractive-tabindex": [
          "error",
          { tags: [], roles: ["tabpanel", "separator"], allowExpressionValues: true },
        ],
      },
    },
  ];
}

export default [...base, ...reactConfigs()];
