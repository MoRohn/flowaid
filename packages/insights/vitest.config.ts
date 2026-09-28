import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "insights",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
