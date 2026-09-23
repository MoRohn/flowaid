import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "provider-openai",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
