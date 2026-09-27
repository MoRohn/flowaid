import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "create-flowaid-node",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
