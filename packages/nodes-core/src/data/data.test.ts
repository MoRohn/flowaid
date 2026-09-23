import { describe, expect, it } from "vitest";
import { runNode } from "@flowaid/node-sdk/testing";
import type { JsonValue } from "@flowaid/workflow-core";
import { extractNode } from "./extract.js";
import { filterNode } from "./filter.js";
import { jsonNode } from "./json.js";
import { mapNode } from "./map.js";
import { mergeNode } from "./merge.js";
import { schemaValidateNode } from "./schema_validate.js";
import { splitNode, splitText } from "./split.js";
import { templateNode } from "./template.js";
import { transformNode } from "./transform.js";

const output = async (...args: Parameters<typeof runNode>) => {
  const r = await runNode(...args);
  if (r.result.kind !== "ok") throw new Error(JSON.stringify(r.result));
  return { output: r.result.output as Record<string, unknown>, route: r.result.route };
};

describe("data nodes", () => {
  it("transform returns the runtime-evaluated expression as result", async () => {
    // The runtime replaces config.expr with the expression's value before execute().
    expect((await output(transformNode, { config: { expr: { total: 3 } } })).output).toEqual({
      result: { total: 3 },
    });
  });

  it("template returns the rendered text", async () => {
    expect((await output(templateNode, { config: { template: "Hello Ada" } })).output).toEqual({
      text: "Hello Ada",
    });
  });

  it("json parses and stringifies with sorted keys", async () => {
    expect(
      (await output(jsonNode, { config: { mode: "parse" }, input: { value: '{"a":[1]}' } })).output,
    ).toEqual({ result: { a: [1] } });
    expect(
      (
        await output(jsonNode, {
          config: { mode: "stringify", sortKeys: true },
          input: { value: { b: 1, a: { d: 1, c: 2 } } },
        })
      ).output,
    ).toEqual({
      result: '{"a":{"c":2,"d":1},"b":1}',
    });
    const bad = await runNode(jsonNode, { config: { mode: "parse" }, input: { value: "{nope" } });
    expect(bad.result.kind === "error" && bad.result.error.code).toBe("SCHEMA_VALIDATION_ERROR");
  });

  it("schema_validate routes valid/invalid with every issue", async () => {
    const schema = {
      type: "object",
      properties: { n: { type: "integer", minimum: 1 } },
      required: ["n", "m"],
    };
    const good = await output(schemaValidateNode, {
      config: { schema },
      input: { value: { n: 2, m: 0 } },
    });
    expect(good.route).toBe("valid");
    const bad = await output(schemaValidateNode, {
      config: { schema },
      input: { value: { n: 0 } },
    });
    expect(bad.route).toBe("invalid");
    expect((bad.output.errors as unknown[]).length).toBe(2);
    const strict = await runNode(schemaValidateNode, {
      config: { schema, failOnInvalid: true },
      input: { value: {} },
    });
    expect(strict.result.kind).toBe("error");
  });

  it("merge supports shallow, deep, concat and first", async () => {
    const values: JsonValue[] = [
      { a: 1, o: { x: 1, l: [1] } },
      null,
      { b: 2, o: { y: 2, l: [2] } },
    ];
    expect(
      (await output(mergeNode, { config: { strategy: "shallow" }, input: { values } })).output
        .result,
    ).toEqual({ a: 1, b: 2, o: { y: 2, l: [2] } });
    expect(
      (
        await output(mergeNode, {
          config: { strategy: "deep", arrays: "concat" },
          input: { values },
        })
      ).output.result,
    ).toEqual({
      a: 1,
      b: 2,
      o: { x: 1, y: 2, l: [1, 2] },
    });
    expect(
      (
        await output(mergeNode, {
          config: { strategy: "concat" },
          input: { values: [[1], 2, null, [3]] },
        })
      ).output.result,
    ).toEqual([1, 2, 3]);
    expect(
      (await output(mergeNode, { config: { strategy: "first" }, input: { values: [null, 0, 1] } }))
        .output.result,
    ).toBe(0);
  });

  it("filter and map evaluate per item with $scope.item and $scope.index", async () => {
    const items = [{ n: 1 }, { n: 5 }, { n: 9 }];
    const f = await output(filterNode, {
      config: { predicate: "$scope.item.n > 2" },
      input: { items },
    });
    expect(f.output).toEqual({ items: [{ n: 5 }, { n: 9 }], rejected: [{ n: 1 }], count: 2 });
    const limited = await output(filterNode, {
      config: { predicate: "true", limit: 1 },
      input: { items },
    });
    expect(limited.output.count).toBe(1);
    const m = await output(mapNode, {
      config: { expr: "$scope.item.n * 10 + $scope.index" },
      input: { items },
    });
    expect(m.output).toEqual({ items: [10, 51, 92] });
    const bad = await runNode(mapNode, { config: { expr: "$scope.item.n +" }, input: { items } });
    expect(bad.result.kind === "error" && bad.result.error.code).toBe("EXPRESSION_ERROR");
  });

  it("split chunks text within the size with overlap", async () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const chunks = splitText(text, 120, 30);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(120);
    // Every sentence survives, and neighbours share context.
    for (let i = 0; i < 40; i++) expect(chunks.some((c) => c.includes(`number ${i} `))).toBe(true);
    expect(
      chunks
        .slice(1)
        .some(
          (c, i) =>
            (chunks[i] ?? "").endsWith(c.split(" ").slice(0, 2).join(" ")) ||
            (chunks[i] ?? "").includes(c.slice(0, 15)),
        ),
    ).toBe(true);
    const para = splitText("para one\n\npara two\n\npara three", 12, 0);
    expect(para).toEqual(["para one", "para two", "para three"]);
    const node = await output(splitNode, {
      config: { chunkSize: 5, chunkOverlap: 0 },
      input: { text: "abcdefghij" },
    });
    expect(node.output).toEqual({ chunks: ["abcde", "fghij"], count: 2 });
    const invalid = await runNode(splitNode, {
      config: { chunkSize: 10, chunkOverlap: 10 },
      input: { text: "x" },
    });
    expect(invalid.result.kind).toBe("error");
  });

  it("extract reads pointers and regex named groups", async () => {
    const r = await output(extractNode, {
      config: { fields: { email: "/customer/email", missing: "/nope" } },
      input: { value: { customer: { email: "a@b.co" } } },
    });
    expect(r.output.fields).toEqual({ email: "a@b.co", missing: null });
    const re = await output(extractNode, {
      config: { pattern: "order #(?<order>\\d+)", all: true },
      input: { value: "order #12 and order #34" },
    });
    expect(re.output.fields).toEqual({ order: "12" });
    expect(re.output.matches).toEqual([
      { order: "12", $0: "order #12" },
      { order: "34", $0: "order #34" },
    ]);
    const req = await runNode(extractNode, {
      config: { fields: { x: "/x" }, required: true },
      input: { value: {} },
    });
    expect(req.result.kind).toBe("error");
  });
});
