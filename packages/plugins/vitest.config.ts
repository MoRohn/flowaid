import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "plugins",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
