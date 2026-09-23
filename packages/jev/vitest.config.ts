import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "jev",
    include: ["src/**/*.test.ts", "templates/**/*.test.ts"],
    environment: "node",
  },
});
