import { describe, expect, it } from "vitest";
import { parseRef, type ExprAst, type Ref } from "../bindings.js";
import { parseTemplate } from "../template.js";
import { parseExpression } from "./parser.js";
import { collectRefs, collectTemplateRefs } from "./refs.js";

function ast(source: string): ExprAst {
  const r = parseExpression(source);
  if (!r.ok) throw new Error(`parse failed for '${source}': ${r.message}`);
  return r.ast;
}
function ref(source: string): Ref {
  const r = parseRef(source);
  if (!r.ok) throw new Error(r.message);
  return r.ref;
}

describe("collectRefs", () => {
  it.each<[string, string[]]>([
    ["1 + 2", []],
    ["a.b", ["a.b"]],
    ["a.b + a.b", ["a.b"]],
    ["a.b + a.c", ["a.b", "a.c"]],
    ["a.b.x + a.b", ["a.b.x", "a.b"]],
    [
      "$vars.t * $scope.index + len($scope.carry.gaps)",
      ["$vars.t", "$scope.index", "$scope.carry.gaps"],
    ],
    ["map(a.list, x => x.y + b.z)", ["a.list", "b.z"]],
    ["{k: a.b, l: [c.d, a.b]}", ["a.b", "c.d"]],
    ["a.b ? c.d : e.f", ["a.b", "c.d", "e.f"]],
    ["-a.b + !c.d", ["a.b", "c.d"]],
    ["a.b[c.d].e", ["a.b", "c.d"]],
    ["$run.id == $run.id", ["$run.id"]],
    ["a.b['x-y'] + a.b.x_y", ["a.b['x-y']", "a.b.x_y"]],
  ])("%s → %j", (source, expected) => {
    expect(collectRefs(ast(source))).toEqual(expected.map(ref));
  });
});

describe("collectTemplateRefs", () => {
  it("collects across holes in order without duplicates", () => {
    const r = parseTemplate(
      "Hi {{ user.name }}, you have {{ len(inbox.items) }} items ({{ user.name | json }}) {{ $vars.x }}",
    );
    if (!r.ok) throw new Error(r.message);
    expect(collectTemplateRefs(r.template)).toEqual([
      ref("user.name"),
      ref("inbox.items"),
      ref("$vars.x"),
    ]);
  });
  it("returns nothing for text-only templates", () => {
    const r = parseTemplate("plain text");
    if (!r.ok) throw new Error(r.message);
    expect(collectTemplateRefs(r.template)).toEqual([]);
  });
});
