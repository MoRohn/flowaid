/**
 * Next.js config. The browser talks to the API through this server (`/v1/*`, `/hooks/*` and
 * `/mcp/*` are rewritten to FLOWAID_API_INTERNAL_URL), so the session cookie is first-party and no
 * CORS is involved. Config files are the one place outside @flowaid/env that read process.env.
 */
import path from "node:path";
import type { NextConfig } from "next";

const api = (process.env.FLOWAID_API_INTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  // @flowaid/ui ships TypeScript source; the NodeNext libraries (whose sources import "./x.js")
  // are consumed from their tsc output, which turbo builds before this app.
  transpilePackages: ["@flowaid/ui"],
  typescript: { ignoreBuildErrors: true }, // `pnpm typecheck` gates types; the build does not repeat it
  turbopack: {
    root: path.resolve(import.meta.dirname, "../.."),
    resolveAlias: {
      "@/*": "../../packages/ui/src/*",
      "@flowaid/workflow-core": "../../packages/workflow-core/dist/index.js",
      "@flowaid/workflow-compiler": "../../packages/workflow-compiler/dist/index.js",
      "@flowaid/shared": "../../packages/shared/dist/index.js",
    },
  },
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: `${api}/v1/:path*` },
      { source: "/hooks/:path*", destination: `${api}/hooks/:path*` },
      { source: "/mcp/:path*", destination: `${api}/mcp/:path*` },
      { source: "/.well-known/jwks.json", destination: `${api}/.well-known/jwks.json` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/review",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default config;
