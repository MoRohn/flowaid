import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../src") } },
  server: { port: 5178, strictPort: true, host: "127.0.0.1" },
  build: { outDir: path.resolve(import.meta.dirname, "dist"), emptyOutDir: true },
});
