import { describe, expect, it } from "vitest";
import {
  BUILTIN_MODELS,
  CATALOG_FILES,
  DISCOVERY_TTL_MS,
  DefaultModelCatalog,
  OPENAI_COMPATIBLE_PRESETS,
  costOf,
} from "./catalog/index.js";
import { FakeClock } from "./test/fakes.js";

describe("built-in catalogs", () => {
  it("load, validate and record where their prices come from", () => {
    for (const [provider, file] of Object.entries(CATALOG_FILES)) {
      expect(file.sources.length, provider).toBeGreaterThan(0);
      expect(
        file.models.every((m) => m.provider === provider),
        provider,
      ).toBe(true);
    }
    expect(BUILTIN_MODELS.length).toBeGreaterThan(30);
    expect(OPENAI_COMPATIBLE_PRESETS.map((p) => p.id)).toContain("openai-compatible:groq");
  });

  it("prices TypeSafe at $0.042 per million input tokens with free output (verified contract)", () => {
    const catalog = new DefaultModelCatalog();
    expect(
      catalog.price("typesafe", "jev-latest", { inputTokens: 1_000_000, outputTokens: 5_000 }),
    ).toEqual({
      costUsd: 0.042,
      snapshot: { inputPerMTok: 0.042, outputPerMTok: 0 },
    });
    expect(catalog.resolveAlias("typesafe", "jev-latest")).toBe("jev-1.13.0");
    expect(catalog.rateLimitRpm("typesafe", "jev-latest")).toBe(1200);
  });
});

describe("pricing", () => {
  it("bills cache reads and writes at their own rates", () => {
    const snapshot = {
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheReadPerMTok: 0.3,
      cacheWritePerMTok: 3.75,
    };
    // 10k input of which 6k cache reads and 1k cache writes; 2k output.
    const cost = costOf(
      { inputTokens: 10_000, outputTokens: 2_000, cacheReadTokens: 6_000, cacheWriteTokens: 1_000 },
      snapshot,
    );
    expect(cost).toBeCloseTo((3_000 * 3 + 6_000 * 0.3 + 1_000 * 3.75 + 2_000 * 15) / 1e6, 10);
  });

  it("switches to the long-context tier above its threshold", () => {
    const catalog = new DefaultModelCatalog();
    const small = catalog.price("openai", "gpt-5.5", { inputTokens: 100_000, outputTokens: 1_000 });
    const large = catalog.price("openai", "gpt-5.5", { inputTokens: 300_000, outputTokens: 1_000 });
    expect(small.snapshot).toMatchObject({ inputPerMTok: 5, outputPerMTok: 30 });
    expect(large.snapshot).toMatchObject({ inputPerMTok: 10, outputPerMTok: 45 });
    expect(large.costUsd).toBeCloseTo((300_000 * 10 + 1_000 * 45) / 1e6, 10);
  });

  it("prices unknown models at zero with no snapshot", () => {
    expect(
      new DefaultModelCatalog().price("acme", "x", { inputTokens: 10, outputTokens: 10 }),
    ).toEqual({ costUsd: 0, snapshot: null });
  });
});

describe("DefaultModelCatalog", () => {
  it("resolves aliases and lets workspace overrides win", () => {
    const catalog = new DefaultModelCatalog({
      overrides: [
        {
          provider: "openai",
          model: "gpt-4.1-mini",
          kind: "chat",
          capabilities: {},
          pricing: { inputPerMTok: 0.3, outputPerMTok: 1.2 },
        },
      ],
    });
    expect(catalog.resolveAlias("openai", "gpt-4.1-mini-2025-04-14")).toBe("gpt-4.1-mini");
    expect(catalog.get("openai", "gpt-4.1-mini")?.pricing?.inputPerMTok).toBe(0.3);
    expect(catalog.list({ provider: "openai", kind: "embedding" }).map((m) => m.model)).toEqual([
      "text-embedding-3-small",
      "text-embedding-3-large",
    ]);
    catalog.setOverrides([]);
    expect(catalog.get("openai", "gpt-4.1-mini")?.pricing?.inputPerMTok).toBe(0.4);
  });

  it("caches discovery for ten minutes", async () => {
    const clock = new FakeClock();
    let calls = 0;
    const catalog = new DefaultModelCatalog({
      clock,
      discovery: [
        {
          provider: "ollama",
          list: () => (
            (calls += 1),
            Promise.resolve(["deepseek-r1:8b", { model: "phi4", contextTokens: 16000 }])
          ),
        },
      ],
    });
    await catalog.discover("ollama");
    await catalog.discover("ollama");
    expect(calls).toBe(1);
    expect(catalog.get("ollama", "phi4")?.contextTokens).toBe(16000);
    expect(catalog.list().some((m) => m.model === "deepseek-r1:8b")).toBe(true);
    clock.advance(DISCOVERY_TTL_MS);
    await catalog.discover("ollama");
    expect(calls).toBe(2);
    expect(await catalog.discover("unknown")).toEqual([]);
  });
});
