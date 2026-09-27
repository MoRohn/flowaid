import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "advisor",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
