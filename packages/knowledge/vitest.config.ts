import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "knowledge", include: ["src/**/*.test.ts"], environment: "node" },
});
