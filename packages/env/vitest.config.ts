import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "env",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
