/**
 * FlowExpr parser (ARCHITECTURE.md §2.3): recursive descent over the on-demand
 * {@link Lexer}, no `eval`, no `Function`.
 *
 * ```
 * expr     := ternary
 * ternary  := or ('?' expr ':' expr)?
 * or       := and ('||' and)*
 * and      := cmp ('&&' cmp)*
 * cmp      := add (('==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'matches') add)?
 * add      := mul (('+' | '-') mul)*
 * mul      := unary (('*' | '/' | '%') unary)*
 * unary    := ('!' | '-') unary | postfix
 * postfix  := primary ('.' IDENT | '[' expr ']')*
 * primary  := NUMBER | STRING | 'true' | 'false' | 'null' | ref | call | lambda | '(' expr ')' | '[' args? ']' | '{' pairs? '}'
 * ref      := IDENT ('.' IDENT)+ ('[' (INT|STRING) ']' | '.' IDENT)*        -- node.port.path…
 *           | '$vars' '.' IDENT | '$scope' '.' ('item'|'index'|'iteration'|'carry') ('.' IDENT | '[' … ']')* | '$run' '.' IDENT
 * call     := FN '(' args? ')'
 * lambda   := IDENT '=>' expr                                              -- only as an argument of filter/map/any/all/sort
 * ```
 *
 * Normalisations the parser applies (so that every AST has one source form):
 * static path segments after a port or `$scope` reference (`.ident`,
 * `[0]`, `['key']`) become the reference's JSON Pointer `path`; a bracketed
 * string literal on any other value (`x['k']`) becomes a `member` node;
 * `-5` stays `unary(-, 5)`. Comparison operators do not chain
 * (`a < b < c` is a syntax error). A bare identifier is only valid when it
 * names an enclosing lambda parameter. An object literal may not repeat a
 * key (`{a: 1, a: 2}` is a syntax error rather than "last one wins").
 *
 * Depth: the parser tracks the height of every AST node it builds (a
 * left-associative chain `1 + 1 + …` nests one level per operator, a postfix
 * chain one level per segment) and rejects any expression whose AST would be
 * taller than {@link MAX_EXPR_DEPTH} with one syntax error, so that what the
 * parser accepts the typer and the evaluator (which count the same height)
 * accept too. Source nesting that recurses before a node exists
 * (parentheses, unary chains) is bounded by the same limit.
 */
import { NodeIdSchema, PortNameSchema, VarNameSchema } from "../ids.js";
import {
  RUN_FIELDS,
  RefSchema,
  SCOPE_FIELDS,
  isRunField,
  isScopeField,
  type ExprAst,
  type Ref,
} from "../bindings.js";
import {
  EXPRESSION_TOO_DEEP_MESSAGE,
  FUNCTION_SIGNATURES,
  MAX_EXPR_DEPTH,
  isExpressionFunction,
  isExpressionKeyword,
} from "./functions.js";
import { ExpressionSyntaxError, Lexer, type Token } from "./lexer.js";

/** Result of {@link parseExpression}. */
export type ParseExpressionResult =
  { ok: true; ast: ExprAst } | { ok: false; message: string; offset: number };

const INT_RE = /^(0|[1-9][0-9]*)$/;
const CMP_OPS = new Set(["==", "!=", "<", "<=", ">", ">="]);
type CmpOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "matches";
function isCmpOp(token: Token): token is Token & { text: CmpOp } {
  return (
    (token.kind === "punct" && CMP_OPS.has(token.text)) ||
    (token.kind === "ident" && (token.text === "in" || token.text === "matches"))
  );
}

/** The one depth error: the same limit (and message) the typer and the evaluator enforce on the AST. */
function tooDeep(offset: number): ExpressionSyntaxError {
  return new ExpressionSyntaxError(EXPRESSION_TOO_DEEP_MESSAGE, offset);
}

/** Escapes one RFC 6901 reference token. */
function escapePointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

class Parser {
  /** Recursion depth of the source (parentheses, unary chains, nested `parseExpr`): a stack guard. */
  private depth = 0;
  /** Height of every non-leaf node built so far (leaves are height 1 and are not recorded). */
  private readonly heights = new WeakMap<ExprAst, number>();
  private readonly bound: string[] = [];

  constructor(private readonly lexer: Lexer) {}

  private peek(n = 0): Token {
    return this.lexer.peek(n);
  }
  private next(): Token {
    return this.lexer.next();
  }
  private isPunct(token: Token, text: string): boolean {
    return token.kind === "punct" && token.text === text;
  }
  private acceptPunct(text: string): boolean {
    if (this.isPunct(this.peek(), text)) {
      this.next();
      return true;
    }
    return false;
  }
  private expectPunct(text: string, context: string): Token {
    const token = this.peek();
    if (!this.isPunct(token, text))
      throw new ExpressionSyntaxError(
        `expected '${text}' ${context}, found ${describe(token)}`,
        token.start,
      );
    return this.next();
  }
  private enter(token: Token): void {
    this.depth += 1;
    if (this.depth > MAX_EXPR_DEPTH) throw tooDeep(token.start);
  }
  private leave(): void {
    this.depth -= 1;
  }
  private heightOf(node: ExprAst): number {
    return this.heights.get(node) ?? 1;
  }
  /**
   * Records the height of a freshly built node (1 + its tallest child) and
   * rejects it when the AST would be taller than {@link MAX_EXPR_DEPTH}: the
   * typer and the evaluator count exactly this height.
   */
  private built<T extends ExprAst>(node: T, at: Token, children: readonly ExprAst[]): T {
    let height = 1;
    for (const child of children) height = Math.max(height, this.heightOf(child) + 1);
    if (height > MAX_EXPR_DEPTH) throw tooDeep(at.start);
    this.heights.set(node, height);
    return node;
  }

  /** expr := ternary */
  parseExpr(): ExprAst {
    this.enter(this.peek());
    try {
      const test = this.parseOr();
      const question = this.peek();
      if (this.acceptPunct("?")) {
        const then = this.parseExpr();
        this.expectPunct(":", "in conditional expression");
        const otherwise = this.parseExpr();
        return this.built({ kind: "ternary", test, then, else: otherwise }, question, [
          test,
          then,
          otherwise,
        ]);
      }
      return test;
    } finally {
      this.leave();
    }
  }

  private parseOr(): ExprAst {
    let left = this.parseAnd();
    for (let token = this.peek(); this.acceptPunct("||"); token = this.peek()) {
      const right = this.parseAnd();
      left = this.built({ kind: "binary", op: "||", left, right }, token, [left, right]);
    }
    return left;
  }

  private parseAnd(): ExprAst {
    let left = this.parseCmp();
    for (let token = this.peek(); this.acceptPunct("&&"); token = this.peek()) {
      const right = this.parseCmp();
      left = this.built({ kind: "binary", op: "&&", left, right }, token, [left, right]);
    }
    return left;
  }

  /** cmp := add (op add)? — non-associative. */
  private parseCmp(): ExprAst {
    const left = this.parseAdd();
    const opToken = this.peek();
    if (!isCmpOp(opToken)) return left;
    this.next();
    const right = this.parseAdd();
    const again = this.peek();
    if (isCmpOp(again)) {
      throw new ExpressionSyntaxError(
        `comparison operators do not chain: parenthesise before '${again.text}'`,
        again.start,
      );
    }
    return this.built({ kind: "binary", op: opToken.text, left, right }, opToken, [left, right]);
  }

  private parseAdd(): ExprAst {
    let left = this.parseMul();
    for (;;) {
      const token = this.peek();
      if (this.isPunct(token, "+") || this.isPunct(token, "-")) {
        this.next();
        const right = this.parseMul();
        left = this.built(
          { kind: "binary", op: token.text === "+" ? "+" : "-", left, right },
          token,
          [left, right],
        );
      } else {
        return left;
      }
    }
  }

  private parseMul(): ExprAst {
    let left = this.parseUnary();
    for (;;) {
      const token = this.peek();
      if (this.isPunct(token, "*") || this.isPunct(token, "/") || this.isPunct(token, "%")) {
        this.next();
        const op = token.text === "*" ? "*" : token.text === "/" ? "/" : "%";
        const right = this.parseUnary();
        left = this.built({ kind: "binary", op, left, right }, token, [left, right]);
      } else {
        return left;
      }
    }
  }

  private parseUnary(): ExprAst {
    const token = this.peek();
    if (this.isPunct(token, "!") || this.isPunct(token, "-")) {
      this.next();
      this.enter(token);
      try {
        const operand = this.parseUnary();
        return this.built({ kind: "unary", op: token.text === "!" ? "!" : "-", operand }, token, [
          operand,
        ]);
      } finally {
        this.leave();
      }
    }
    return this.parsePostfix();
  }

  /** postfix := primary ('.' IDENT | '[' expr ']')* — every segment adds one level of height. */
  private parsePostfix(): ExprAst {
    let node = this.parsePrimary();
    for (;;) {
      const token = this.peek();
      if (this.isPunct(token, ".")) {
        this.next();
        const key = this.next();
        if (key.kind !== "ident")
          throw new ExpressionSyntaxError(
            `expected property name after '.', found ${describe(key)}`,
            key.start,
          );
        node = this.built({ kind: "member", object: node, key: key.text }, token, [node]);
      } else if (this.isPunct(token, "[")) {
        this.next();
        const index = this.parseExpr();
        this.expectPunct("]", "after index expression");
        node =
          index.kind === "literal" && typeof index.value === "string"
            ? this.built({ kind: "member", object: node, key: index.value }, token, [node])
            : this.built({ kind: "index", object: node, index }, token, [node, index]);
      } else {
        return node;
      }
    }
  }

  private parsePrimary(): ExprAst {
    const token = this.peek();
    switch (token.kind) {
      case "number": {
        this.next();
        return { kind: "literal", value: Number(token.text) };
      }
      case "string": {
        this.next();
        return { kind: "literal", value: token.text };
      }
      case "punct": {
        if (this.isPunct(token, "(")) {
          this.next();
          const inner = this.parseExpr();
          this.expectPunct(")", "to close parenthesised expression");
          return inner;
        }
        if (this.isPunct(token, "[")) return this.parseArrayLiteral();
        if (this.isPunct(token, "{")) return this.parseObjectLiteral();
        throw new ExpressionSyntaxError(
          `expected expression, found ${describe(token)}`,
          token.start,
        );
      }
      case "ident":
        return this.parseIdentStart();
      case "eof":
        throw new ExpressionSyntaxError("expected expression, found end of input", token.start);
    }
  }

  private parseArrayLiteral(): ExprAst {
    const open = this.expectPunct("[", "to open array literal");
    const items: ExprAst[] = [];
    if (this.acceptPunct("]")) return this.built({ kind: "array", items }, open, items);
    for (;;) {
      items.push(this.parseExpr());
      if (this.acceptPunct("]")) return this.built({ kind: "array", items }, open, items);
      this.expectPunct(",", "between array items");
    }
  }

  private parseObjectLiteral(): ExprAst {
    const open = this.expectPunct("{", "to open object literal");
    const entries: { key: string; value: ExprAst }[] = [];
    const finish = (): ExprAst =>
      this.built(
        { kind: "object", entries },
        open,
        entries.map((entry) => entry.value),
      );
    if (this.acceptPunct("}")) return finish();
    const seen = new Set<string>();
    for (;;) {
      const keyToken = this.next();
      if (keyToken.kind !== "ident" && keyToken.kind !== "string") {
        throw new ExpressionSyntaxError(
          `expected object key (identifier or string), found ${describe(keyToken)}`,
          keyToken.start,
        );
      }
      if (seen.has(keyToken.text))
        throw new ExpressionSyntaxError(
          `duplicate key ${JSON.stringify(keyToken.text)} in object literal`,
          keyToken.start,
        );
      seen.add(keyToken.text);
      this.expectPunct(":", "after object key");
      entries.push({ key: keyToken.text, value: this.parseExpr() });
      if (this.acceptPunct("}")) return finish();
      this.expectPunct(",", "between object entries");
    }
  }

  /** Everything that starts with an identifier: keywords, refs, calls, lambda parameters. */
  private parseIdentStart(): ExprAst {
    const token = this.next();
    const name = token.text;
    if (name === "true") return { kind: "literal", value: true };
    if (name === "false") return { kind: "literal", value: false };
    if (name === "null") return { kind: "literal", value: null };
    if (name === "in" || name === "matches")
      throw new ExpressionSyntaxError(`expected expression, found keyword '${name}'`, token.start);
    if (name.startsWith("$")) return this.parseDollarRef(token);
    if (this.bound.includes(name)) {
      if (this.isPunct(this.peek(), "=>"))
        throw new ExpressionSyntaxError(
          "lambdas are only allowed as arguments of filter, map, any, all and sort",
          token.start,
        );
      return { kind: "ident", name };
    }
    if (isExpressionFunction(name)) {
      if (!this.isPunct(this.peek(), "("))
        throw new ExpressionSyntaxError(
          `expected '(' after function name '${name}'`,
          this.peek().start,
        );
      return this.parseCall(token);
    }
    if (this.isPunct(this.peek(), "=>"))
      throw new ExpressionSyntaxError(
        "lambdas are only allowed as arguments of filter, map, any, all and sort",
        token.start,
      );
    if (this.isPunct(this.peek(), "("))
      throw new ExpressionSyntaxError(`unknown function '${name}'`, token.start);
    if (!this.isPunct(this.peek(), ".")) {
      throw new ExpressionSyntaxError(
        `unknown identifier '${name}' (expected node.port, $vars.…, $scope.… or $run.…)`,
        token.start,
      );
    }
    this.next();
    const portToken = this.next();
    if (portToken.kind !== "ident")
      throw new ExpressionSyntaxError(
        `expected port name after '${name}.', found ${describe(portToken)}`,
        portToken.start,
      );
    if (!NodeIdSchema.safeParse(name).success)
      throw new ExpressionSyntaxError(`invalid node id '${name}'`, token.start);
    if (!PortNameSchema.safeParse(portToken.text).success)
      throw new ExpressionSyntaxError(`invalid port name '${portToken.text}'`, portToken.start);
    const path = this.parseStaticPath();
    const ref: Ref =
      path === undefined
        ? { kind: "port", node: name, port: portToken.text }
        : { kind: "port", node: name, port: portToken.text, path };
    return { kind: "ref", ref: this.validateRef(ref, token) };
  }

  private parseDollarRef(root: Token): ExprAst {
    this.expectPunct(".", `after '${root.text}'`);
    const field = this.next();
    if (field.kind !== "ident")
      throw new ExpressionSyntaxError(
        `expected field name after '${root.text}.', found ${describe(field)}`,
        field.start,
      );
    switch (root.text) {
      case "$vars": {
        if (!VarNameSchema.safeParse(field.text).success)
          throw new ExpressionSyntaxError(`invalid variable name '${field.text}'`, field.start);
        return { kind: "ref", ref: this.validateRef({ kind: "var", name: field.text }, root) };
      }
      case "$run": {
        if (!isRunField(field.text))
          throw new ExpressionSyntaxError(
            `unknown $run field '${field.text}' (expected ${RUN_FIELDS.join(", ")})`,
            field.start,
          );
        return { kind: "ref", ref: this.validateRef({ kind: "run", field: field.text }, root) };
      }
      case "$scope": {
        if (!isScopeField(field.text))
          throw new ExpressionSyntaxError(
            `unknown $scope field '${field.text}' (expected ${SCOPE_FIELDS.join(", ")})`,
            field.start,
          );
        const path = this.parseStaticPath();
        const ref: Ref =
          path === undefined
            ? { kind: "scope", field: field.text }
            : { kind: "scope", field: field.text, path };
        return { kind: "ref", ref: this.validateRef(ref, root) };
      }
      default:
        throw new ExpressionSyntaxError(
          `unknown root '${root.text}' (expected $vars, $scope or $run)`,
          root.start,
        );
    }
  }

  /** Greedily consumes `.ident`, `[INT]` and `[STRING]` segments and returns them as a JSON Pointer. */
  private parseStaticPath(): string | undefined {
    const tokens: string[] = [];
    for (;;) {
      const token = this.peek();
      if (this.isPunct(token, ".") && this.peek(1).kind === "ident") {
        this.next();
        tokens.push(this.next().text);
      } else if (this.isPunct(token, "[")) {
        const inner = this.peek(1);
        const isStatic =
          (inner.kind === "number" && INT_RE.test(inner.text)) || inner.kind === "string";
        if (!isStatic || !this.isPunct(this.peek(2), "]"))
          return tokens.length === 0 ? undefined : toPointer(tokens);
        this.next();
        tokens.push(this.next().text);
        this.next();
      } else {
        return tokens.length === 0 ? undefined : toPointer(tokens);
      }
      if (tokens.length > MAX_EXPR_DEPTH)
        throw new ExpressionSyntaxError(
          `reference path longer than ${MAX_EXPR_DEPTH} segments`,
          token.start,
        );
    }
  }

  private validateRef(ref: Ref, at: Token): Ref {
    const parsed = RefSchema.safeParse(ref);
    if (!parsed.success)
      throw new ExpressionSyntaxError(
        `invalid reference: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        at.start,
      );
    return parsed.data;
  }

  private parseCall(fnToken: Token): ExprAst {
    const fn = fnToken.text;
    if (!isExpressionFunction(fn))
      throw new ExpressionSyntaxError(`unknown function '${fn}'`, fnToken.start);
    const signature = FUNCTION_SIGNATURES[fn];
    this.expectPunct("(", `after function name '${fn}'`);
    const args: ExprAst[] = [];
    if (!this.acceptPunct(")")) {
      for (;;) {
        const index = args.length;
        const argToken = this.peek();
        const looksLikeLambda = argToken.kind === "ident" && this.isPunct(this.peek(1), "=>");
        if (signature.lambdaArg === index) {
          if (!looksLikeLambda)
            throw new ExpressionSyntaxError(
              `argument ${index + 1} of ${fn} must be a lambda (x => …)`,
              argToken.start,
            );
          args.push(this.parseLambda());
        } else {
          args.push(this.parseExpr());
        }
        if (this.acceptPunct(")")) break;
        this.expectPunct(",", `between arguments of ${fn}`);
      }
    }
    if (args.length < signature.minArgs || args.length > signature.maxArgs) {
      const expected =
        signature.maxArgs === Number.POSITIVE_INFINITY
          ? `at least ${signature.minArgs}`
          : signature.minArgs === signature.maxArgs
            ? `${signature.minArgs}`
            : `${signature.minArgs} to ${signature.maxArgs}`;
      throw new ExpressionSyntaxError(
        `${fn} expects ${expected} argument(s), got ${args.length}`,
        fnToken.start,
      );
    }
    return this.built({ kind: "call", fn, args }, fnToken, args);
  }

  private parseLambda(): ExprAst {
    const param = this.next();
    if (param.kind !== "ident")
      throw new ExpressionSyntaxError(
        `expected lambda parameter, found ${describe(param)}`,
        param.start,
      );
    if (
      param.text.startsWith("$") ||
      isExpressionKeyword(param.text) ||
      isExpressionFunction(param.text)
    ) {
      throw new ExpressionSyntaxError(`'${param.text}' cannot be a lambda parameter`, param.start);
    }
    this.expectPunct("=>", "after lambda parameter");
    this.bound.push(param.text);
    this.enter(param);
    try {
      const body = this.parseExpr();
      return this.built({ kind: "lambda", param: param.text, body }, param, [body]);
    } finally {
      this.leave();
      this.bound.pop();
    }
  }
}

function toPointer(tokens: readonly string[]): string {
  return tokens.map((t) => "/" + escapePointerToken(t)).join("");
}

function describe(token: Token): string {
  switch (token.kind) {
    case "eof":
      return "end of input";
    case "string":
      return `string ${JSON.stringify(token.text)}`;
    case "number":
      return `number ${token.text}`;
    case "ident":
      return `'${token.text}'`;
    case "punct":
      return `'${token.text}'`;
  }
}

/**
 * Parses one expression from `lexer` (which may sit inside a larger text, as
 * in a template hole) and leaves the lexer positioned on the first token after
 * it. Throws {@link ExpressionSyntaxError} with an absolute offset.
 */
export function parseEmbeddedExpression(lexer: Lexer): ExprAst {
  return new Parser(lexer).parseExpr();
}

/**
 * Parses FlowExpr source text into an {@link ExprAst}. Never throws: syntax
 * errors are returned with the offset they were detected at.
 */
export function parseExpression(source: string): ParseExpressionResult {
  try {
    const lexer = new Lexer(source);
    const ast = parseEmbeddedExpression(lexer);
    const trailing = lexer.peek();
    if (trailing.kind !== "eof")
      return {
        ok: false,
        message: `unexpected ${describe(trailing)} after expression`,
        offset: trailing.start,
      };
    return { ok: true, ast };
  } catch (error) {
    if (error instanceof ExpressionSyntaxError)
      return { ok: false, message: error.message, offset: error.offset };
    throw error;
  }
}
