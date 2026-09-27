import { describe, expect, it } from "vitest";
import { DefaultModelCatalog } from "./catalog/index.js";
import { ProviderRegistry } from "./registry.js";
import { RerankClient, rerankFactories } from "./rerank.js";

const ctx = {
  signal: new AbortController().signal,
  runId: "r",
  nodeRunId: "n",
  idempotencyKey: null,
};

function fetchOf(respond: (url: string, body: Record<string, unknown>) => Response) {
  const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  const http = (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    const href = url instanceof Request ? url.url : url.toString();
    calls.push({ url: href, body, headers: new Headers(init?.headers) });
    return Promise.resolve(respond(href, body));
  };
  return { http, calls };
}

describe("RerankClient", () => {
  it("posts the Cohere v2 shape and returns scores in input order", async () => {
    const { http, calls } = fetchOf(() =>
      Response.json({
        results: [
          { index: 2, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.4 },
          { index: 1, relevance_score: 0.1 },
        ],
        meta: { billed_units: { search_units: 1 } },
      }),
    );
    const factory = rerankFactories().find((f) => f.id === "cohere");
    const client = factory?.create({
      model: "rerank-v3.5",
      credential: { apiKey: "co-key" },
      http,
      catalog: new DefaultModelCatalog(),
    });
    const r = await client?.rerank("refund", ["a", "b", "c"], ctx);
    expect(r?.scores).toEqual([0.4, 0.1, 0.9]);
    expect(calls[0]?.url).toBe("https://api.cohere.com/v2/rerank");
    expect(calls[0]?.body).toMatchObject({
      model: "rerank-v3.5",
      query: "refund",
      documents: ["a", "b", "c"],
    });
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer co-key");
  });

  it("reads Jina's usage and splits large inputs into batches", async () => {
    const { http, calls } = fetchOf((_url, body) => {
      const docs = body.documents as string[];
      return Response.json({
        results: docs.map((_, i) => ({ index: i, relevance_score: i / 10 })),
        usage: { total_tokens: 7 },
      });
    });
    const client = new RerankClient({
      id: "jina",
      model: "jina-reranker-v2-base-multilingual",
      endpoint: "https://api.jina.ai/v1/rerank",
      apiKey: "j",
      http,
      maxDocuments: 2,
    });
    const r = await client.rerank("q", ["a", "b", "c"], ctx);
    expect(calls).toHaveLength(2);
    expect(r.scores).toEqual([0, 0.1, 0]);
    expect(r.usage).toEqual({ inputTokens: 14, outputTokens: 0 });
  });

  it("maps HTTP errors and rejects malformed results", async () => {
    const denied = new RerankClient({
      id: "cohere",
      model: "m",
      endpoint: "https://x.test/rerank",
      http: fetchOf(() => Response.json({ message: "invalid api token" }, { status: 401 })).http,
    });
    await expect(denied.rerank("q", ["a"], ctx)).rejects.toMatchObject({
      code: "CREDENTIAL_ERROR",
    });
    const broken = new RerankClient({
      id: "cohere",
      model: "m",
      endpoint: "https://x.test/rerank",
      http: fetchOf(() => Response.json({ results: [{ index: 5, relevance_score: 1 }] })).http,
    });
    await expect(broken.rerank("q", ["a"], ctx)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("rerank-compatible needs a baseUrl", () => {
    const f = rerankFactories().find((x) => x.id === "rerank-compatible");
    expect(() =>
      f?.create({
        model: "bge",
        credential: { apiKey: "k" },
        http: fetch,
        catalog: new DefaultModelCatalog(),
      }),
    ).toThrow(/baseUrl/);
  });
});

describe("ProviderRegistry.rerank", () => {
  it("resolves a registered rerank factory with its credential", async () => {
    const registry = new ProviderRegistry({ catalog: new DefaultModelCatalog() });
    for (const f of rerankFactories()) registry.register(f);
    const { http, calls } = fetchOf(() =>
      Response.json({ results: [{ index: 0, relevance_score: 0.5 }] }),
    );
    const provider = await registry.rerank(
      { provider: "jina", model: "jina-reranker-v2-base-multilingual" },
      {
        workspaceId: "ws",
        http,
        credential: (id, type) =>
          Promise.resolve(
            id === "jina" && type === "jina.api_key"
              ? { id: "c1", value: { apiKey: "jk" } }
              : undefined,
          ),
      },
    );
    expect((await provider.rerank("q", ["a"], ctx)).scores).toEqual([0.5]);
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer jk");
    await expect(
      registry.rerank(
        { provider: "cohere", model: "m" },
        { workspaceId: "ws", http, credential: () => Promise.resolve(undefined) },
      ),
    ).rejects.toMatchObject({ code: "CREDENTIAL_ERROR" });
  });
});
