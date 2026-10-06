import { defineConfig } from "vitest/config";
import path from "node:path";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "src"),
      "@": path.resolve(import.meta.dirname, "../../packages/ui/src"),
    },
  },
  test: {
    name: "web",
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
