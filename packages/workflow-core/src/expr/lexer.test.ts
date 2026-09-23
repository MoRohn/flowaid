import { describe, expect, it } from "vitest";
import { ExpressionSyntaxError, tokenize, type Token } from "./lexer.js";

function kinds(source: string): string[] {
  return tokenize(source).map((t) => `${t.kind}:${t.text}`);
}
function fail(source: string): { message: string; offset: number } {
  try {
    tokenize(source);
  } catch (error) {
    if (error instanceof ExpressionSyntaxError)
      return { message: error.message, offset: error.offset };
    throw error;
  }
  throw new Error(`expected '${source}' to fail`);
}

describe("tokenize", () => {
  it.each<[string, string[]]>([
    ["1 + 2", ["number:1", "punct:+", "number:2", "eof:"]],
    ["a.b", ["ident:a", "punct:.", "ident:b", "eof:"]],
    ["$vars.x", ["ident:$vars", "punct:.", "ident:x", "eof:"]],
    ["x => x", ["ident:x", "punct:=>", "ident:x", "eof:"]],
    ["a || b && c", ["ident:a", "punct:||", "ident:b", "punct:&&", "ident:c", "eof:"]],
    ["a == b != c", ["ident:a", "punct:==", "ident:b", "punct:!=", "ident:c", "eof:"]],
    [
      "a <= b >= c < d > e",
      [
        "ident:a",
        "punct:<=",
        "ident:b",
        "punct:>=",
        "ident:c",
        "punct:<",
        "ident:d",
        "punct:>",
        "ident:e",
        "eof:",
      ],
    ],
    ["!a", ["punct:!", "ident:a", "eof:"]],
    ["a-b", ["ident:a", "punct:-", "ident:b", "eof:"]],
    ["a--b", ["ident:a", "punct:-", "punct:-", "ident:b", "eof:"]],
    [
      "[1,{a:2}]",
      [
        "punct:[",
        "number:1",
        "punct:,",
        "punct:{",
        "ident:a",
        "punct::",
        "number:2",
        "punct:}",
        "punct:]",
        "eof:",
      ],
    ],
    ["a ? b : c", ["ident:a", "punct:?", "ident:b", "punct::", "ident:c", "eof:"]],
    ["x | json", ["ident:x", "punct:|", "ident:json", "eof:"]],
    ["  \t\n\r a ", ["ident:a", "eof:"]],
    ["", ["eof:"]],
    ["in matches true", ["ident:in", "ident:matches", "ident:true", "eof:"]],
    ["_a1 A_b", ["ident:_a1", "ident:A_b", "eof:"]],
    [
      "a * b / c % d",
      ["ident:a", "punct:*", "ident:b", "punct:/", "ident:c", "punct:%", "ident:d", "eof:"],
    ],
  ])("lexes %j", (source, expected) => {
    expect(kinds(source)).toEqual(expected);
  });

  it.each<[string, string]>([
    ["0", "0"],
    ["42", "42"],
    ["3.14", "3.14"],
    ["1e5", "1e5"],
    ["1E+5", "1E+5"],
    ["2.5e-3", "2.5e-3"],
    ["0.5", "0.5"],
  ])("lexes number %s", (source, text) => {
    const [first] = tokenize(source);
    expect(first).toEqual({ kind: "number", text, start: 0, end: source.length });
  });

  it("lexes 5.x as number then member (no trailing-dot numbers)", () => {
    expect(kinds("5.x")).toEqual(["number:5", "punct:.", "ident:x", "eof:"]);
  });

  it.each<[string, string]>([
    ["'abc'", "abc"],
    ['"abc"', "abc"],
    ["'it\\'s'", "it's"],
    ['"say \\"hi\\""', 'say "hi"'],
    ["'a\\nb'", "a\nb"],
    ["'a\\tb\\rc'", "a\tb\rc"],
    ["'\\u0041\\u00e9'", "Aé"],
    ["'\\ud83d\\ude00'", "😀"],
    ["'back\\\\slash'", "back\\slash"],
    ["'\\/\\b\\f'", "/\b\f"],
    ["''", ""],
    ["'{{ }}'", "{{ }}"],
    ['"single \' inside"', "single ' inside"],
    ["'double \" inside'", 'double " inside'],
    ["'emoji 😀 raw'", "emoji 😀 raw"],
  ])("decodes string %s", (source, decoded) => {
    const [first] = tokenize(source);
    expect(first).toEqual({ kind: "string", text: decoded, start: 0, end: source.length });
  });

  it("records source ranges", () => {
    const tokens: Token[] = tokenize('ab + "x"');
    expect(tokens.map((t) => [t.start, t.end])).toEqual([
      [0, 2],
      [3, 4],
      [5, 8],
      [8, 8],
    ]);
  });

  it.each<[string, number, string]>([
    ["01", 0, "leading zeros"],
    ["1e", 0, "exponent needs digits"],
    ["1e+", 0, "exponent needs digits"],
    ["12abc", 2, "unexpected character after number"],
    ["1e999", 0, "number literal out of range"],
    ["-1e999", 1, "number literal out of range"],
    ["1e400 + 1", 0, "number literal out of range"],
    ["2e308", 0, "number literal out of range"],
    ["a.b + 1E999", 6, "number literal out of range"],
    ["'abc", 0, "unterminated string"],
    ['"abc', 0, "unterminated string"],
    ["'a\\q'", 2, "invalid escape '\\q'"],
    ["'a\\u12'", 2, "invalid \\u escape"],
    ["'a\\", 2, "unterminated escape"],
    ["'a\nb'", 2, "line break"],
    ["a @ b", 2, "unexpected character '@'"],
    ["$", 0, "expected identifier after '$'"],
    ["$1", 0, "expected identifier after '$'"],
    ["a # b", 2, "unexpected character '#'"],
    ["a = b", 2, "unexpected character '='"],
  ])("rejects %j at offset %d", (source, offset, message) => {
    const error = fail(source);
    expect(error.offset).toBe(offset);
    expect(error.message).toContain(message);
  });
});
