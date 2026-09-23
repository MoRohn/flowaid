import { describe, expect, it } from "vitest";
import {
  CompiledTemplateSchema,
  TemplateFilterSchema,
  type CompiledTemplate,
  type TemplateFilter,
  type TemplatePart,
} from "./bindings.js";
import { ExpressionError } from "./errors.js";
import type { JsonValue } from "./json.js";
import {
  MAX_EVAL_RESULT_BYTES,
  createEvalScope,
  expressionErrorReason,
  type ExpressionErrorReason,
} from "./expr/index.js";
import {
  TEMPLATE_CONTAINER_FILTERS,
  TEMPLATE_HOLE_FILTERS,
  applyTemplateFilter,
  filterAcceptsContainers,
  parseTemplate,
  renderTemplate,
} from "./template.js";
import {
  STRING,
  arrayOf,
  inferExprType,
  mayBeContainer,
  objectOf,
  type TypeEnv,
} from "./expr/typer.js";

const scope = createEvalScope({
  ports: {
    u: {
      name: "Ada",
      age: 36,
      ok: true,
      none: null,
      tags: ["a", "b"],
      obj: { k: 1, l: [2] },
      mixed: [1, "x", null, { a: 1 }],
      big: "x".repeat(600_000),
      text: "  Hi  ",
    },
  },
  vars: { greeting: "Hello" },
  now: () => "2026-01-02T03:04:05.000Z",
});

function tpl(source: string): CompiledTemplate {
  const r = parseTemplate(source);
  if (!r.ok) throw new Error(`expected '${source}' to parse: ${r.message} at ${r.offset}`);
  return r.template;
}
function fail(source: string): { message: string; offset: number } {
  const r = parseTemplate(source);
  if (r.ok) throw new Error(`expected '${source}' to fail`);
  return { message: r.message, offset: r.offset };
}
function render(source: string): string {
  return renderTemplate(tpl(source), scope);
}
function reasonOf(fn: () => unknown): ExpressionErrorReason | undefined {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof ExpressionError)) throw error;
    return expressionErrorReason(error);
  }
  throw new Error("expected an ExpressionError");
}
const text = (t: string): TemplatePart => ({ kind: "text", text: t });

describe("parseTemplate: structure", () => {
  it.each<[string, TemplatePart[]]>([
    ["", []],
    ["plain", [text("plain")]],
    [
      "{{ u.name }}",
      [
        {
          kind: "hole",
          expr: { kind: "ref", ref: { kind: "port", node: "u", port: "name" } },
          filter: "string",
          range: { start: 0, end: 12 },
        },
      ],
    ],
    [
      "{{u.name}}",
      [
        {
          kind: "hole",
          expr: { kind: "ref", ref: { kind: "port", node: "u", port: "name" } },
          filter: "string",
          range: { start: 0, end: 10 },
        },
      ],
    ],
    [
      "a{{ 1 }}b",
      [
        text("a"),
        {
          kind: "hole",
          expr: { kind: "literal", value: 1 },
          filter: "string",
          range: { start: 1, end: 8 },
        },
        text("b"),
      ],
    ],
    [
      "{{ 1 }}{{ 2 }}",
      [
        {
          kind: "hole",
          expr: { kind: "literal", value: 1 },
          filter: "string",
          range: { start: 0, end: 7 },
        },
        {
          kind: "hole",
          expr: { kind: "literal", value: 2 },
          filter: "string",
          range: { start: 7, end: 14 },
        },
      ],
    ],
    [
      "{{ u.tags | json }}",
      [
        {
          kind: "hole",
          expr: { kind: "ref", ref: { kind: "port", node: "u", port: "tags" } },
          filter: "json",
          range: { start: 0, end: 19 },
        },
      ],
    ],
    [
      "{{u.tags|json_pretty}}",
      [
        {
          kind: "hole",
          expr: { kind: "ref", ref: { kind: "port", node: "u", port: "tags" } },
          filter: "json_pretty",
          range: { start: 0, end: 22 },
        },
      ],
    ],
    [
      "{{ u.tags |join_lines }}",
      [
        {
          kind: "hole",
          expr: { kind: "ref", ref: { kind: "port", node: "u", port: "tags" } },
          filter: "join_lines",
          range: { start: 0, end: 24 },
        },
      ],
    ],
    [
      "{{ u.tags | join_comma\n}}",
      [
        {
          kind: "hole",
          expr: { kind: "ref", ref: { kind: "port", node: "u", port: "tags" } },
          filter: "join_comma",
          range: { start: 0, end: 25 },
        },
      ],
    ],
    [
      "{{ u.name | upper }}",
      [
        {
          kind: "hole",
          expr: { kind: "ref", ref: { kind: "port", node: "u", port: "name" } },
          filter: "upper",
          range: { start: 0, end: 20 },
        },
      ],
    ],
    [
      "{{u.name|lower}}",
      [
        {
          kind: "hole",
          expr: { kind: "ref", ref: { kind: "port", node: "u", port: "name" } },
          filter: "lower",
          range: { start: 0, end: 16 },
        },
      ],
    ],
    [
      "{{ u.text | trim }}",
      [
        {
          kind: "hole",
          expr: { kind: "ref", ref: { kind: "port", node: "u", port: "text" } },
          filter: "trim",
          range: { start: 0, end: 19 },
        },
      ],
    ],
    ["\\{{ not a hole }}", [text("{{ not a hole }}")]],
    [
      "a \\{{ b {{ 1 }}",
      [
        text("a {{ b "),
        {
          kind: "hole",
          expr: { kind: "literal", value: 1 },
          filter: "string",
          range: { start: 8, end: 15 },
        },
      ],
    ],
    ["back\\slash", [text("back\\slash")]],
    ["\\\\{{ 1 }}", [text("\\{{ 1 }}")]],
    ["}} alone", [text("}} alone")]],
    ["{ single {", [text("{ single {")]],
    [
      "{{ {a: {b: 1}} }}",
      [
        {
          kind: "hole",
          expr: {
            kind: "object",
            entries: [
              {
                key: "a",
                value: {
                  kind: "object",
                  entries: [{ key: "b", value: { kind: "literal", value: 1 } }],
                },
              },
            ],
          },
          filter: "string",
          range: { start: 0, end: 17 },
        },
      ],
    ],
    [
      "{{{a:1}}}",
      [
        {
          kind: "hole",
          expr: { kind: "object", entries: [{ key: "a", value: { kind: "literal", value: 1 } }] },
          filter: "string",
          range: { start: 0, end: 9 },
        },
      ],
    ],
    [
      "{{ '}}' }}",
      [
        {
          kind: "hole",
          expr: { kind: "literal", value: "}}" },
          filter: "string",
          range: { start: 0, end: 10 },
        },
      ],
    ],
    [
      "{{ 1 }}'s",
      [
        {
          kind: "hole",
          expr: { kind: "literal", value: 1 },
          filter: "string",
          range: { start: 0, end: 7 },
        },
        text("'s"),
      ],
    ],
    [
      "{{ 1 }}}",
      [
        {
          kind: "hole",
          expr: { kind: "literal", value: 1 },
          filter: "string",
          range: { start: 0, end: 7 },
        },
        text("}"),
      ],
    ],
    [
      "line1\nline2 {{ 1 }}\n",
      [
        text("line1\nline2 "),
        {
          kind: "hole",
          expr: { kind: "literal", value: 1 },
          filter: "string",
          range: { start: 12, end: 19 },
        },
        text("\n"),
      ],
    ],
    [
      '{{ u.ok ? "y" : "n" }}',
      [
        {
          kind: "hole",
          expr: {
            kind: "ternary",
            test: { kind: "ref", ref: { kind: "port", node: "u", port: "ok" } },
            then: { kind: "literal", value: "y" },
            else: { kind: "literal", value: "n" },
          },
          filter: "string",
          range: { start: 0, end: 22 },
        },
      ],
    ],
    [
      "😀 {{ 1 }}",
      [
        text("😀 "),
        {
          kind: "hole",
          expr: { kind: "literal", value: 1 },
          filter: "string",
          range: { start: 3, end: 10 },
        },
      ],
    ],
  ])("parses %j", (source, parts) => {
    const template = tpl(source);
    expect(template).toEqual({ parts });
    expect(CompiledTemplateSchema.parse(template)).toEqual(template);
  });

  it("keeps ranges that slice back to the hole source", () => {
    const source = "Hello {{ $vars.greeting }}, {{ u.tags | json }}!";
    for (const part of tpl(source).parts) {
      if (part.kind === "hole")
        expect(source.slice(part.range.start, part.range.end)).toMatch(/^\{\{.*\}\}$/);
    }
  });

  it("exposes every contract filter except the implicit string (RFC-0009)", () => {
    expect(TEMPLATE_HOLE_FILTERS).toEqual([
      "json",
      "json_pretty",
      "join_lines",
      "join_comma",
      "upper",
      "lower",
      "trim",
    ]);
    expect([...TEMPLATE_HOLE_FILTERS, "string"].sort()).toEqual(
      [...TemplateFilterSchema.options].sort(),
    );
    for (const filter of TEMPLATE_HOLE_FILTERS)
      expect(parseTemplate(`{{ u.name | ${filter} }}`).ok, filter).toBe(true);
  });

  it("splits the filters into container-accepting and scalar-coercing", () => {
    expect(TEMPLATE_CONTAINER_FILTERS).toEqual(["json", "json_pretty", "join_lines", "join_comma"]);
    for (const filter of TemplateFilterSchema.options) {
      expect(filterAcceptsContainers(filter), filter).toBe(
        TEMPLATE_CONTAINER_FILTERS.includes(filter),
      );
    }
    const scalarFilters: TemplateFilter[] = ["string", "upper", "lower", "trim"];
    expect(scalarFilters.map(filterAcceptsContainers)).toEqual([false, false, false, false]);
  });

  it("keeps E_TEMPLATE_OBJECT_COERCION firing for scalar-coercing filters on container-typed holes", () => {
    // The compiler pass: a hole is E_TEMPLATE_OBJECT_COERCION when its static
    // type may be a container and the filter does not accept containers.
    const env: TypeEnv = {
      schemaOf: (ref) => {
        if (ref.kind !== "port") return undefined;
        return ref.port === "tags"
          ? { type: "array", items: { type: "string" } }
          : ref.port === "obj"
            ? { type: "object" }
            : { type: "string" };
      },
    };
    const coercion = (source: string): boolean[] =>
      tpl(source).parts.flatMap((part) =>
        part.kind === "hole"
          ? [
              mayBeContainer(inferExprType(part.expr, env).type) &&
                !filterAcceptsContainers(part.filter),
            ]
          : [],
      );
    expect(
      coercion("{{ u.tags | upper }}{{ u.obj | lower }}{{ u.tags | trim }}{{ u.obj }}"),
    ).toEqual([true, true, true, true]);
    expect(
      coercion("{{ u.name | upper }}{{ u.name | lower }}{{ u.name | trim }}{{ u.name }}"),
    ).toEqual([false, false, false, false]);
    expect(
      coercion(
        "{{ u.tags | json }}{{ u.obj | json_pretty }}{{ u.tags | join_lines }}{{ u.tags | join_comma }}",
      ),
    ).toEqual([false, false, false, false]);
    expect(mayBeContainer(arrayOf(STRING)) && mayBeContainer(objectOf({}))).toBe(true);
  });
});

describe("parseTemplate: errors", () => {
  it.each<[string, string, number]>([
    ["{{", "unterminated template hole", 0],
    ["{{ ", "unterminated template hole", 0],
    ["{{ u.name", "unterminated template hole", 0],
    ["{{ u.name }", "expected '}}'", 10],
    ["{{ u.name | json", "unterminated template hole", 0],
    ["{{ u.name | json }", "expected '}}'", 17],
    ["{{ }}", "expected expression", 3],
    ["{{ u.name | string }}", "unknown template filter", 12],
    ["{{ u.name | UPPER }}", "unknown template filter", 12],
    ["{{ u.name | upper | lower }}", "expected '}}'", 18],
    ["{{ u.name | nope }}", "unknown template filter", 12],
    ["{{ u.name | }}", "unknown template filter", 12],
    ["{{ u.name | 1 }}", "unknown template filter", 12],
    ["{{ u.name json }}", "expected '}}'", 10],
    ["{{ 1 + }}", "expected expression", 7],
    ["{{ x }}", "unknown identifier 'x'", 3],
    ["{{ 'oops }}", "unterminated string", 3],
    ["ok {{ 1 }} then {{ 1 < 2 < 3 }}", "do not chain", 25],
    ["{{ 1 } }}", "expected '}}'", 5],
    ["{{ u.name || json }}", "expected '(' after function name", 18],
  ])("rejects %j at %d", (source, message, offset) => {
    const error = fail(source);
    expect(error.message).toContain(message);
    expect(error.offset).toBe(offset);
  });
});

describe("renderTemplate", () => {
  it.each<[string, string]>([
    ["", ""],
    ["plain", "plain"],
    ["{{ u.name }}", "Ada"],
    ["{{ $vars.greeting }}, {{ u.name }}!", "Hello, Ada!"],
    ["{{ u.age }}", "36"],
    ["{{ u.age + 1 }}", "37"],
    ["{{ u.ok }}", "true"],
    ["{{ !u.ok }}", "false"],
    ["{{ u.none }}", ""],
    ["[{{ u.none }}]", "[]"],
    ["{{ 1.5 }}", "1.5"],
    ["{{ 1e21 }}", "1e+21"],
    ["{{ u.tags }}", '["a","b"]'],
    ["{{ u.obj }}", '{"k":1,"l":[2]}'],
    ["{{ u.tags | json }}", '["a","b"]'],
    ["{{ u.obj | json_pretty }}", '{\n  "k": 1,\n  "l": [\n    2\n  ]\n}'],
    ["{{ u.tags | join_lines }}", "a\nb"],
    ["{{ u.tags | join_comma }}", "a, b"],
    ["{{ u.mixed | join_comma }}", '1, x, , {"a":1}'],
    ["{{ [] | join_lines }}", ""],
    ["{{ u.name | json }}", '"Ada"'],
    ["{{ u.age | json }}", "36"],
    ["{{ u.none | json }}", "null"],
    ["{{ u.none | json_pretty }}", "null"],
    ["{{ u.name | upper }}", "ADA"],
    ["{{ u.name | lower }}", "ada"],
    ["{{ u.text | trim }}", "Hi"],
    ["[{{ u.text | upper }}]", "[  HI  ]"],
    ["{{ u.age | upper }}", "36"],
    ["{{ u.ok | upper }}", "TRUE"],
    ["{{ u.none | upper }}", ""],
    ["{{ u.none | trim }}", ""],
    ['{{ "  Mixed Case " | lower }}', "  mixed case "],
    ["{{ u.tags | upper }}", '["A","B"]'],
    ["{{ u.obj | trim }}", '{"k":1,"l":[2]}'],
    ["{{ upper(u.name) }}", "ADA"],
    ["{{ trim(u.text) }}", "Hi"],
    ["{{ map(u.tags, t => upper(t)) | join_comma }}", "A, B"],
    ["{{ len(u.tags) }} tags: {{ u.tags | join_comma }}", "2 tags: a, b"],
    ["\\{{ literal }} {{ u.name }}", "{{ literal }} Ada"],
    ['{{ "}}" }}', "}}"],
    ["{{ now() }}", "2026-01-02T03:04:05.000Z"],
    ['{{ u.ok ? "yes" : "no" }}', "yes"],
    ["a\n{{ u.name }}\nb", "a\nAda\nb"],
  ])("renders %j", (source, expected) => {
    expect(render(source)).toBe(expected);
  });

  it.each<[string, ExpressionErrorReason]>([
    ["{{ u.nope }}", "UNKNOWN_REF"],
    ["{{ u.age + u.name }}", "TYPE"],
    ["{{ 1 / 0 }}", "DIVISION_BY_ZERO"],
    ["{{ u.name | join_lines }}", "TYPE"],
    ["{{ u.obj | join_comma }}", "TYPE"],
    ["{{ u.none | join_lines }}", "TYPE"],
    ["{{ u.big + u.big }}", "RESULT_TOO_LARGE"],
    ["{{ u.big }}{{ u.big }}", "RESULT_TOO_LARGE"],
  ])("%j fails with %s", (source, reason) => {
    expect(reasonOf(() => render(source))).toBe(reason);
  });

  it("adds the failing hole range to the error details", () => {
    try {
      render("ok {{ u.name }} then {{ 1 / 0 }}");
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionError);
      if (error instanceof ExpressionError) {
        expect(error.details).toMatchObject({
          reason: "DIVISION_BY_ZERO",
          range: { start: 21, end: 32 },
        });
        expect(error.cause).toBeInstanceOf(ExpressionError);
        expect(error.toInfo().cause?.code).toBe("EXPRESSION_ERROR");
      }
    }
  });

  it("caps the rendered size at MAX_EVAL_RESULT_BYTES", () => {
    const many: CompiledTemplate = {
      parts: Array.from({ length: 3 }, () => ({
        kind: "hole",
        expr: { kind: "ref", ref: { kind: "port", node: "u", port: "big" } },
        filter: "string",
        range: { start: 0, end: 0 },
      })),
    };
    expect(reasonOf(() => renderTemplate(many, scope))).toBe("RESULT_TOO_LARGE");
    const one: CompiledTemplate = { parts: [many.parts[0] ?? { kind: "text", text: "" }] };
    expect(renderTemplate(one, scope)).toHaveLength(600_000);
    expect(600_000).toBeLessThan(MAX_EVAL_RESULT_BYTES);
  });

  it("renders every contract filter through applyTemplateFilter", () => {
    const cases: [TemplateFilter, JsonValue, string][] = [
      ["string", "x", "x"],
      ["string", 5, "5"],
      ["string", null, ""],
      ["string", [1], "[1]"],
      ["string", { a: 1 }, '{"a":1}'],
      ["json", "x", '"x"'],
      ["json_pretty", [1], "[\n  1\n]"],
      ["join_lines", ["a", 1, null], "a\n1\n"],
      ["join_comma", [[1], { b: 2 }], '[1], {"b":2}'],
      ["upper", "ab", "AB"],
      ["upper", 5, "5"],
      ["lower", "AB", "ab"],
      ["trim", "  x ", "x"],
      ["trim", null, ""],
    ];
    for (const [filter, value, expected] of cases)
      expect(applyTemplateFilter(value, filter)).toBe(expected);
  });
});
