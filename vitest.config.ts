import { defineConfig } from "vitest/config";

// Root Vitest configuration: discovers every workspace package/app that ships a
// vitest.config.ts and adds the repository-level checks under scripts/ and docker/.
export default defineConfig({
  test: {
    projects: [
      "packages/*/vitest.config.ts",
      "apps/*/vitest.config.ts",
      {
        test: {
          name: "root",
          include: ["scripts/**/*.test.ts", "docker/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
