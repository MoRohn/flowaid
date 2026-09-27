import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "evaluation",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
