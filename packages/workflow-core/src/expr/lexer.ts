/**
 * FlowExpr lexer (ARCHITECTURE.md §2.3): hand-written, one character of
 * lookahead, produced on demand so a template scanner can lex an embedded
 * expression without touching the text after it.
 *
 * Token kinds: JSON numbers (unsigned; `-` is the unary operator; a literal
 * whose value is not a finite double, such as `1e999`, is a syntax error so
 * no AST ever holds `Infinity`), single- or double-quoted strings with JSON escapes, identifiers (including the `$vars`,
 * `$scope` and `$run` roots and every keyword; the parser tells them apart),
 * punctuation and `eof`.
 */

/** Token kinds produced by {@link tokenize}. */
export type TokenKind = "number" | "string" | "ident" | "punct" | "eof";
/** A lexical token with its source range. For strings `text` is the decoded value. */
export interface Token {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
}

/** A lexical or syntactic error with the source offset it was detected at. */
export class ExpressionSyntaxError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(message);
    this.name = "ExpressionSyntaxError";
    this.offset = offset;
  }
}

/** Multi-character punctuation, longest first so `||` wins over `|` and `<=` over `<`. */
const PUNCT_2 = ["=>", "||", "&&", "==", "!=", "<=", ">="] as const;
const PUNCT_1 = new Set([
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ",",
  ".",
  ":",
  "?",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  "!",
  "|",
]);

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}
function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}
function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}
function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/** Scans a quoted string starting at the opening quote; returns the decoded text and the end offset. */
function scanString(source: string, start: number): { text: string; end: number } {
  const quote = source.charAt(start);
  let i = start + 1;
  let out = "";
  while (i < source.length) {
    const ch = source.charAt(i);
    if (ch === quote) return { text: out, end: i + 1 };
    if (ch === "\\") {
      const esc = source.charAt(i + 1);
      switch (esc) {
        case '"':
          out += '"';
          break;
        case "'":
          out += "'";
          break;
        case "\\":
          out += "\\";
          break;
        case "/":
          out += "/";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "u": {
          const hex = source.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex))
            throw new ExpressionSyntaxError("invalid \\u escape: expected four hex digits", i);
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        case "":
          throw new ExpressionSyntaxError("unterminated escape sequence", i);
        default:
          throw new ExpressionSyntaxError(`invalid escape '\\${esc}'`, i);
      }
      i += 2;
      continue;
    }
    if (ch === "\n" || ch === "\r")
      throw new ExpressionSyntaxError("unterminated string (line break inside string)", i);
    out += ch;
    i += 1;
  }
  throw new ExpressionSyntaxError("unterminated string", start);
}

/** Scans a JSON number (without sign) starting at `start`; returns the end offset. */
function scanNumber(source: string, start: number): number {
  let i = start;
  if (source.charAt(i) === "0") {
    i += 1;
    if (isDigit(source.charAt(i)))
      throw new ExpressionSyntaxError("numbers may not have leading zeros", start);
  } else {
    while (isDigit(source.charAt(i))) i += 1;
  }
  if (source.charAt(i) === "." && isDigit(source.charAt(i + 1))) {
    i += 1;
    while (isDigit(source.charAt(i))) i += 1;
  }
  const e = source.charAt(i);
  if (e === "e" || e === "E") {
    let j = i + 1;
    if (source.charAt(j) === "+" || source.charAt(j) === "-") j += 1;
    if (!isDigit(source.charAt(j)))
      throw new ExpressionSyntaxError("invalid number: exponent needs digits", start);
    while (isDigit(source.charAt(j))) j += 1;
    i = j;
  }
  if (isIdentStart(source.charAt(i)))
    throw new ExpressionSyntaxError("invalid number: unexpected character after number", i);
  if (!Number.isFinite(Number(source.slice(start, i))))
    throw new ExpressionSyntaxError("number literal out of range", start);
  return i;
}

/**
 * On-demand token stream over `source`, starting at `offset`. Tokens are only
 * produced as far as the parser peeks, so text after an embedded expression
 * (template holes) is never lexed.
 */
export class Lexer {
  private readonly buffer: Token[] = [];
  private pos: number;

  constructor(
    private readonly source: string,
    offset = 0,
  ) {
    this.pos = offset;
  }

  /** The `n`-th unconsumed token (0 = the next one). */
  peek(n = 0): Token {
    while (this.buffer.length <= n) this.buffer.push(this.scan());
    const token = this.buffer[n];
    if (token === undefined) throw new ExpressionSyntaxError("internal lexer error", this.pos);
    return token;
  }

  /** Consumes and returns the next token. */
  next(): Token {
    const token = this.peek();
    this.buffer.shift();
    return token;
  }

  private scan(): Token {
    const src = this.source;
    let i = this.pos;
    while (i < src.length && isWhitespace(src.charAt(i))) i += 1;
    if (i >= src.length) {
      this.pos = i;
      return { kind: "eof", text: "", start: i, end: i };
    }
    const ch = src.charAt(i);
    let token: Token;
    if (isDigit(ch)) {
      const end = scanNumber(src, i);
      token = { kind: "number", text: src.slice(i, end), start: i, end };
    } else if (ch === '"' || ch === "'") {
      const { text, end } = scanString(src, i);
      token = { kind: "string", text, start: i, end };
    } else if (isIdentStart(ch) || ch === "$") {
      let j = i + 1;
      if (ch === "$" && !isIdentStart(src.charAt(j)))
        throw new ExpressionSyntaxError("expected identifier after '$'", i);
      while (isIdentPart(src.charAt(j))) j += 1;
      token = { kind: "ident", text: src.slice(i, j), start: i, end: j };
    } else {
      const two = src.slice(i, i + 2);
      if ((PUNCT_2 as readonly string[]).includes(two)) {
        token = { kind: "punct", text: two, start: i, end: i + 2 };
      } else if (PUNCT_1.has(ch)) {
        token = { kind: "punct", text: ch, start: i, end: i + 1 };
      } else {
        throw new ExpressionSyntaxError(`unexpected character '${ch}'`, i);
      }
    }
    this.pos = token.end;
    return token;
  }
}

/** Splits FlowExpr source text into tokens (the trailing `eof` token included). Throws {@link ExpressionSyntaxError}. */
export function tokenize(source: string): Token[] {
  const lexer = new Lexer(source);
  const tokens: Token[] = [];
  for (;;) {
    const token = lexer.next();
    tokens.push(token);
    if (token.kind === "eof") return tokens;
  }
}
