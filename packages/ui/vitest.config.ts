import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    name: "ui",
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // `vitest run --coverage` (`pnpm test:coverage`) enforces the ui thresholds (UI.md §9,
    // upgrade plan P0-05/P0-20). Galleries are visual fixtures covered by the Playwright
    // gallery suite (e2e/), not unit tests.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/gallery.tsx",
        "src/**/*.d.ts",
        "src/**/testStubs.ts",
        "src/**/flowTestStubs.ts",
      ],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
