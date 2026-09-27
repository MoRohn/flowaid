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
    // `test` runs with v8 coverage; the instrumented canvas and axe tests need more than 5 s on
    // a busy machine
    testTimeout: 15_000,
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
      // A ratchet: the floor sits at the measured coverage (2026-09-27: lines 80.5 %,
      // statements 78.0 %, functions 74.9 %, branches 67.7 %) and only moves up; branches
      // were never at the 80 % goal, so they rise with each new test file.
      thresholds: { lines: 80, statements: 77.5, functions: 74.5, branches: 67.5 },
    },
  },
});
