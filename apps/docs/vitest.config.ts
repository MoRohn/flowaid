import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "docs", include: ["src/**/*.test.ts"], environment: "node" },
});
