import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "provider-ollama",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
