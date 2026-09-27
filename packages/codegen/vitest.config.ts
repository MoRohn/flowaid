import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "codegen",
    include: ["src/**/*.test.ts"],
    environment: "node",
    // The package test installs and runs a generated package.
    testTimeout: 120_000,
  },
});
