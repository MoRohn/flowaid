import { defineConfig } from "vitest/config";

/**
 * Two projects run the same files: `node` under the machine's time zone and
 * `tz-new-york` with `TZ=America/New_York`, so anything that silently depends
 * on the process zone (`format_date` parsing, `now()`) fails in one of them.
 * `pnpm test:tz` runs the second project alone.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "tz-new-york",
          include: ["src/expr/dates.test.ts", "src/expr/functions.test.ts"],
          environment: "node",
          env: { TZ: "America/New_York" },
          provide: { expectedTimeZone: "America/New_York" },
        },
      },
    ],
  },
});
