/**
 * The internal Prometheus listener (`PROMETHEUS_PORT`, ARCHITECTURE.md §10.5): a bare HTTP server
 * that answers `GET /metrics` with the exposition of `setupTelemetry`'s Prometheus reader and 404
 * elsewhere. It binds its own port so the scrape endpoint never shares the public API.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface MetricsListener {
  port: number;
  close(): Promise<void>;
}

export async function startMetricsListener(options: {
  port: number;
  host?: string;
  handler: (request: IncomingMessage, response: ServerResponse) => void;
}): Promise<MetricsListener> {
  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0];
    if (request.method === "GET" && path === "/metrics") {
      options.handler(request, response);
      return;
    }
    response.statusCode = 404;
    response.end("not found\n");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host ?? "0.0.0.0", () => resolve());
  });
  const address = server.address();
  return {
    port: typeof address === "object" && address ? address.port : options.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
