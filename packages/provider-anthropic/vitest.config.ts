import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "provider-anthropic",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
