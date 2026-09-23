import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  formatRef,
  parseRef,
  RefSchema,
  BindingSchema,
  RUN_FIELDS,
  SCOPE_FIELDS,
  type Ref,
} from "./bindings.js";
import { RESERVED_IDS } from "./ids.js";
import { parseExpression } from "./expr/parser.js";
import { escapePointerToken } from "./schema/pointer.js";

function ok(source: string): Ref {
  const r = parseRef(source);
  if (!r.ok) throw new Error(`expected '${source}' to parse: ${r.message}`);
  return r.ref;
}
function fail(source: string): string {
  const r = parseRef(source);
  if (r.ok) throw new Error(`expected '${source}' to fail, got ${JSON.stringify(r.ref)}`);
  return r.message;
}

describe("parseRef", () => {
  it("parses node.port without a path", () => {
    expect(ok("start.message")).toEqual({ kind: "port", node: "start", port: "message" });
    expect(Object.keys(ok("start.message"))).not.toContain("path");
  });

  it("maps dotted path segments to a JSON pointer", () => {
    expect(ok("intent.decision.value")).toEqual({
      kind: "port",
      node: "intent",
      port: "decision",
      path: "/value",
    });
    expect(ok("judgments.answers.urgency.levelLabel")).toEqual({
      kind: "port",
      node: "judgments",
      port: "answers",
      path: "/urgency/levelLabel",
    });
    expect(ok("safe.decision.pYes")).toEqual({
      kind: "port",
      node: "safe",
      port: "decision",
      path: "/pYes",
    });
  });

  it("accepts integer and string bracket indexes", () => {
    expect(ok("similar.hits[0].metadata.number")).toEqual({
      kind: "port",
      node: "similar",
      port: "hits",
      path: "/0/metadata/number",
    });
    expect(ok("web.body['x-total-count']")).toEqual({
      kind: "port",
      node: "web",
      port: "body",
      path: "/x-total-count",
    });
    expect(ok('web.body["a b"]')).toEqual({
      kind: "port",
      node: "web",
      port: "body",
      path: "/a b",
    });
    expect(ok("web.body['']")).toEqual({ kind: "port", node: "web", port: "body", path: "/" });
  });

  it("escapes ~ and / in string keys per RFC 6901", () => {
    expect(ok("n.p['a/b']")).toEqual({ kind: "port", node: "n", port: "p", path: "/a~1b" });
    expect(ok("n.p['a~b']")).toEqual({ kind: "port", node: "n", port: "p", path: "/a~0b" });
    expect(ok("n.p['~/']")).toEqual({ kind: "port", node: "n", port: "p", path: "/~0~1" });
  });

  it("decodes JSON string escapes in bracket keys", () => {
    expect(ok("n.p['it\\'s']")).toEqual({ kind: "port", node: "n", port: "p", path: "/it's" });
    expect(ok('n.p["q\\"q"]')).toEqual({ kind: "port", node: "n", port: "p", path: '/q"q' });
    expect(ok("n.p['a\\nb']")).toEqual({ kind: "port", node: "n", port: "p", path: "/a\nb" });
    expect(ok("n.p['\\u0041']")).toEqual({ kind: "port", node: "n", port: "p", path: "/A" });
    expect(ok("n.p['back\\\\slash']")).toEqual({
      kind: "port",
      node: "n",
      port: "p",
      path: "/back\\slash",
    });
  });

  it("parses $vars", () => {
    expect(ok("$vars.threshold")).toEqual({ kind: "var", name: "threshold" });
    expect(ok("$vars.crmBaseUrl")).toEqual({ kind: "var", name: "crmBaseUrl" });
  });

  it("parses $scope with and without a path", () => {
    expect(ok("$scope.item")).toEqual({ kind: "scope", field: "item" });
    expect(ok("$scope.index")).toEqual({ kind: "scope", field: "index" });
    expect(ok("$scope.iteration")).toEqual({ kind: "scope", field: "iteration" });
    expect(ok("$scope.carry")).toEqual({ kind: "scope", field: "carry" });
    expect(ok("$scope.item.title")).toEqual({ kind: "scope", field: "item", path: "/title" });
    expect(ok("$scope.carry.evidence[2].url")).toEqual({
      kind: "scope",
      field: "carry",
      path: "/evidence/2/url",
    });
  });

  it("parses every $run field", () => {
    for (const field of [
      "id",
      "workflowId",
      "workflowVersionId",
      "environment",
      "startedAt",
      "sessionId",
    ] as const) {
      expect(ok(`$run.${field}`)).toEqual({ kind: "run", field });
    }
  });

  it("produces refs that satisfy RefSchema", () => {
    for (const src of ["a.b", "a.b.c[0]", "$vars.x", "$scope.item.a", "$run.id"]) {
      expect(RefSchema.safeParse(ok(src)).success).toBe(true);
    }
  });

  it("rejects malformed sources with a message", () => {
    expect(fail("")).toMatch(/empty/);
    expect(fail("start")).toMatch(/expected '\.<port>'/);
    expect(fail("start.")).toMatch(/expected identifier/);
    expect(fail(".start")).toMatch(/expected identifier/);
    expect(fail("start..message")).toMatch(/expected identifier/);
    expect(fail("start.message.")).toMatch(/expected identifier/);
    expect(fail("start[0]")).toMatch(/expected '\.<port>'/);
    expect(fail("start.message[")).toMatch(/expected integer or string/);
    expect(fail("start.message[0")).toMatch(/expected '\]'/);
    expect(fail("start.message[01]")).toMatch(/invalid array index/);
    expect(fail("start.message[-1]")).toMatch(/expected integer or string/);
    expect(fail("start.message['abc")).toMatch(/unterminated/);
    expect(fail("start.message['a\\q']")).toMatch(/invalid escape/);
    expect(fail("start.message['\\u12']")).toMatch(/invalid \\u escape/);
    expect(fail("start.message ")).toMatch(/unexpected character/);
    expect(fail("start message")).toMatch(/unexpected character/);
    expect(fail("start.message.a-b")).toMatch(/unexpected character/);
  });

  it("rejects invalid node ids, port names and variable names", () => {
    expect(fail("Start.message")).toMatch(/invalid node id/);
    expect(fail("start.Message")).toMatch(/invalid port name/);
    expect(fail("_start.message")).toMatch(/invalid node id/);
    expect(fail("$vars.Threshold")).toMatch(/invalid variable name/);
    expect(fail("$vars._x")).toMatch(/invalid variable name/);
    expect(fail(`${"a".repeat(65)}.p`)).toMatch(/invalid node id/);
  });

  it("rejects unknown roots and fields", () => {
    expect(fail("$foo.bar")).toMatch(/unknown root/);
    expect(fail("$vars")).toMatch(/expected '\.<field>'/);
    expect(fail("$vars.a.b")).toMatch(/take no path/);
    expect(fail("$vars[0]")).toMatch(/expected '\.<field>'/);
    expect(fail("$run.foo")).toMatch(/unknown \$run field/);
    expect(fail("$run.id.x")).toMatch(/take no path/);
    expect(fail("$scope.other")).toMatch(/unknown \$scope field/);
    expect(fail("$scope")).toMatch(/expected '\.<field>'/);
    expect(fail("$")).toMatch(/expected identifier/);
    expect(fail("$1")).toMatch(/expected identifier/);
  });
});

describe("formatRef", () => {
  it("formats each kind", () => {
    expect(formatRef({ kind: "port", node: "start", port: "message" })).toBe("start.message");
    expect(formatRef({ kind: "port", node: "intent", port: "decision", path: "/value" })).toBe(
      "intent.decision.value",
    );
    expect(formatRef({ kind: "port", node: "intent", port: "decision", path: "" })).toBe(
      "intent.decision",
    );
    expect(formatRef({ kind: "var", name: "threshold" })).toBe("$vars.threshold");
    expect(formatRef({ kind: "scope", field: "carry", path: "/gaps" })).toBe("$scope.carry.gaps");
    expect(formatRef({ kind: "scope", field: "index" })).toBe("$scope.index");
    expect(formatRef({ kind: "run", field: "sessionId" })).toBe("$run.sessionId");
  });

  it("uses brackets for numeric and non-identifier tokens", () => {
    expect(formatRef({ kind: "port", node: "a", port: "b", path: "/0/x" })).toBe("a.b[0].x");
    expect(formatRef({ kind: "port", node: "a", port: "b", path: "/x-y" })).toBe("a.b['x-y']");
    expect(formatRef({ kind: "port", node: "a", port: "b", path: "/a b" })).toBe("a.b['a b']");
    expect(formatRef({ kind: "port", node: "a", port: "b", path: "/01" })).toBe("a.b['01']");
    expect(formatRef({ kind: "port", node: "a", port: "b", path: "/" })).toBe("a.b['']");
    expect(formatRef({ kind: "port", node: "a", port: "b", path: "/a~1b/c~0d" })).toBe(
      "a.b['a/b']['c~d']",
    );
    expect(formatRef({ kind: "port", node: "a", port: "b", path: "/it's" })).toBe("a.b['it\\'s']");
    expect(formatRef({ kind: "port", node: "a", port: "b", path: "/l1\nl2" })).toBe(
      "a.b['l1\\nl2']",
    );
    expect(formatRef({ kind: "port", node: "a", port: "b", path: "/\u0001" })).toBe(
      "a.b['\\u0001']",
    );
  });

  it("round-trips through parseRef", () => {
    const refs: Ref[] = [
      { kind: "port", node: "start", port: "message" },
      { kind: "port", node: "intent", port: "decision", path: "/value" },
      { kind: "port", node: "similar", port: "hits", path: "/0/metadata/number" },
      { kind: "port", node: "web", port: "body", path: "/x-total-count" },
      { kind: "port", node: "web", port: "body", path: "/a~1b/c~0d/e f" },
      { kind: "port", node: "web", port: "body", path: '/it\'s/"q"/\\/\n/\t/\r/\u0007' },
      { kind: "port", node: "web", port: "body", path: "/" },
      { kind: "port", node: "web", port: "body", path: "/007" },
      { kind: "var", name: "autoSendThreshold" },
      { kind: "scope", field: "item" },
      { kind: "scope", field: "item", path: "/query" },
      { kind: "scope", field: "carry", path: "/evidence/3" },
      { kind: "run", field: "startedAt" },
    ];
    for (const ref of refs) {
      const source = formatRef(ref);
      const back = parseRef(source);
      expect(back, source).toEqual({ ok: true, ref });
    }
  });

  describe("round-trips arbitrary refs (property)", () => {
    const lowerIdent = (pattern: RegExp): fc.Arbitrary<string> =>
      fc.stringMatching(pattern).filter((s) => s.length <= 64 && !RESERVED_IDS.has(s));
    const arbNodeId = lowerIdent(/^[a-z][a-z0-9_]{0,15}$/);
    const arbPortName = lowerIdent(/^[a-z][a-z0-9_]{0,15}$/);
    const arbVarName = lowerIdent(/^[a-z][a-zA-Z0-9_]{0,15}$/);
    /** Pointer tokens: arbitrary strings, seeded with the awkward ones ('', '~', '/', quotes, control chars, digits). */
    const arbToken = fc.oneof(
      { arbitrary: fc.string(), weight: 4 },
      fc.string({ unit: "binary" }),
      fc.constantFrom(
        "",
        "~",
        "/",
        "~0",
        "~1",
        "'",
        '"',
        "\\",
        "\n",
        "\r",
        "\t",
        "\u0000",
        "\u0007",
        "\u001f",
        "0",
        "007",
        "-1",
        "1.5",
        " ",
        "a b",
        ".",
        "[",
        "]",
        "x-y",
        "ünï",
        "😀",
      ),
    );
    const arbPath = fc.option(
      fc
        .array(arbToken, { minLength: 1, maxLength: 5 })
        .map((tokens) => tokens.map(escapePointerToken).join("/"))
        .map((s) => "/" + s),
      { nil: undefined },
    );
    const withPath = <T extends object>(
      base: T,
      path: string | undefined,
    ): T & { path?: string } => (path === undefined ? base : { ...base, path });
    const arbRef: fc.Arbitrary<Ref> = fc.oneof(
      fc
        .tuple(arbNodeId, arbPortName, arbPath)
        .map(([node, port, path]) => withPath({ kind: "port" as const, node, port }, path)),
      arbVarName.map((name): Ref => ({ kind: "var", name })),
      fc
        .tuple(fc.constantFrom(...SCOPE_FIELDS), arbPath)
        .map(([field, path]) => withPath({ kind: "scope" as const, field }, path)),
      fc.constantFrom(...RUN_FIELDS).map((field): Ref => ({ kind: "run", field })),
    );

    it("generated refs satisfy RefSchema", () => {
      fc.assert(
        fc.property(arbRef, (ref) => {
          expect(RefSchema.parse(ref)).toEqual(ref);
        }),
        { numRuns: 300 },
      );
    });

    it("parseRef(formatRef(ref)) deep-equals ref", () => {
      fc.assert(
        fc.property(arbRef, (ref) => {
          const source = formatRef(ref);
          expect(parseRef(source), source).toEqual({ ok: true, ref });
        }),
        { numRuns: 1000 },
      );
    });

    it("parseExpression(formatRef(ref)) yields { kind: 'ref', ref }", () => {
      fc.assert(
        fc.property(arbRef, (ref) => {
          const source = formatRef(ref);
          expect(parseExpression(source), source).toEqual({ ok: true, ast: { kind: "ref", ref } });
        }),
        { numRuns: 1000 },
      );
    });

    it("formatRef is stable under a second round trip", () => {
      fc.assert(
        fc.property(arbRef, (ref) => {
          const source = formatRef(ref);
          const back = parseRef(source);
          expect(back.ok).toBe(true);
          if (back.ok) expect(formatRef(back.ref)).toBe(source);
        }),
        { numRuns: 300 },
      );
    });

    it("treats a path of '' as absent (the documented caveat)", () => {
      const ref: Ref = { kind: "port", node: "a", port: "b", path: "" };
      expect(formatRef(ref)).toBe("a.b");
      expect(parseRef("a.b")).toEqual({ ok: true, ref: { kind: "port", node: "a", port: "b" } });
      expect(parseRef(formatRef({ kind: "scope", field: "item", path: "" }))).toEqual({
        ok: true,
        ref: { kind: "scope", field: "item" },
      });
    });
  });

  it("round-trips the other way for compact sources", () => {
    for (const src of [
      "start.message",
      "intent.decision.value",
      "a.b[0].c",
      "a.b['x-y']",
      "$vars.x",
      "$scope.carry.gap",
      "$run.id",
    ]) {
      expect(formatRef(ok(src))).toBe(src);
    }
  });
});

describe("BindingSchema", () => {
  it("accepts nested bindings and rejects unknown kinds", () => {
    const binding = {
      kind: "object",
      fields: {
        a: { kind: "literal", value: { x: [1, null] } },
        b: { kind: "ref", ref: { kind: "port", node: "n", port: "p", path: "/q" }, default: null },
        c: { kind: "template", source: "hello {{ n.p }}" },
        d: { kind: "expr", source: "1 + 1" },
        e: { kind: "array", items: [{ kind: "literal", value: 1 }] },
      },
    };
    expect(BindingSchema.parse(binding)).toEqual(binding);
    expect(BindingSchema.safeParse({ kind: "nope" }).success).toBe(false);
    expect(BindingSchema.safeParse({ kind: "expr", source: "" }).success).toBe(false);
  });
});
