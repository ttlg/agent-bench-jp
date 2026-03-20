export type TokenKind =
  | "eof"
  | "ident"
  | "number"
  | "string"
  | "star"
  | "dot"
  | "comma"
  | "lparen"
  | "rparen"
  | "eq"
  | "neq"
  | "lt"
  | "gt"
  | "lte"
  | "gte"
  | "keyword";

export type Keyword =
  | "select"
  | "from"
  | "where"
  | "join"
  | "inner"
  | "left"
  | "right"
  | "outer"
  | "on"
  | "as"
  | "and"
  | "or"
  | "not"
  | "order"
  | "by"
  | "asc"
  | "desc"
  | "limit"
  | "offset"
  | "group"
  | "having"
  | "like"
  | "count"
  | "sum"
  | "avg"
  | "min"
  | "max";

export type Token =
  | { kind: "eof" }
  | { kind: "ident"; value: string }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "star" }
  | { kind: "dot" }
  | { kind: "comma" }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "eq" }
  | { kind: "neq" }
  | { kind: "lt" }
  | { kind: "gt" }
  | { kind: "lte" }
  | { kind: "gte" }
  | { kind: "keyword"; value: Keyword };

const KEYWORDS = new Map<string, Keyword>([
  ["select", "select"],
  ["from", "from"],
  ["where", "where"],
  ["join", "join"],
  ["inner", "inner"],
  ["left", "left"],
  ["right", "right"],
  ["outer", "outer"],
  ["on", "on"],
  ["as", "as"],
  ["and", "and"],
  ["or", "or"],
  ["not", "not"],
  ["order", "order"],
  ["by", "by"],
  ["asc", "asc"],
  ["desc", "desc"],
  ["limit", "limit"],
  ["offset", "offset"],
  ["group", "group"],
  ["having", "having"],
  ["like", "like"],
  ["count", "count"],
  ["sum", "sum"],
  ["avg", "avg"],
  ["min", "min"],
  ["max", "max"],
]);

function isIdentStart(c: string): boolean {
  return /[A-Za-z_]/.test(c);
}

function isIdentChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c);
}

export class LexError extends Error {
  constructor(
    message: string,
    public offset: number,
  ) {
    super(message);
    this.name = "LexError";
  }
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const peek = () => input[i];
  const advance = () => input[i++];

  while (i < input.length) {
    const c = peek();
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      advance();
      continue;
    }
    if (c === "-" && input[i + 1] === "-") {
      while (i < input.length && peek() !== "\n") advance();
      continue;
    }

    const start = i;

    if (isIdentStart(c)) {
      let s = advance();
      while (i < input.length && isIdentChar(peek())) s += advance();
      const lower = s.toLowerCase();
      const kw = KEYWORDS.get(lower);
      if (kw) tokens.push({ kind: "keyword", value: kw });
      else tokens.push({ kind: "ident", value: s });
      continue;
    }

    if (c >= "0" && c <= "9") {
      let s = "";
      while (i < input.length && /[0-9.]/.test(peek())) s += advance();
      const n = Number(s);
      if (Number.isNaN(n)) throw new LexError(`Invalid number: ${s}`, start);
      tokens.push({ kind: "number", value: n });
      continue;
    }

    if (c === "'") {
      advance();
      let s = "";
      let closed = false;
      while (i < input.length) {
        const ch = peek();
        if (ch === "'") {
          if (input[i + 1] === "'") {
            i += 2;
            s += "'";
          } else {
            advance();
            closed = true;
            break;
          }
        } else {
          s += advance();
        }
      }
      if (!closed) throw new LexError("Unterminated string", start);
      tokens.push({ kind: "string", value: s });
      continue;
    }

    switch (c) {
      case "*":
        advance();
        tokens.push({ kind: "star" });
        continue;
      case ".":
        advance();
        tokens.push({ kind: "dot" });
        continue;
      case ",":
        advance();
        tokens.push({ kind: "comma" });
        continue;
      case "(":
        advance();
        tokens.push({ kind: "lparen" });
        continue;
      case ")":
        advance();
        tokens.push({ kind: "rparen" });
        continue;
      case "=":
        advance();
        tokens.push({ kind: "eq" });
        continue;
      case "!":
        if (input[i + 1] === "=") {
          advance();
          advance();
          tokens.push({ kind: "neq" });
        } else throw new LexError(`Unexpected '${c}'`, start);
        continue;
      case "<":
        if (input[i + 1] === "=") {
          advance();
          advance();
          tokens.push({ kind: "lte" });
        } else if (input[i + 1] === ">") {
          advance();
          advance();
          tokens.push({ kind: "neq" });
        } else {
          advance();
          tokens.push({ kind: "lt" });
        }
        continue;
      case ">":
        if (input[i + 1] === "=") {
          advance();
          advance();
          tokens.push({ kind: "gte" });
        } else {
          advance();
          tokens.push({ kind: "gt" });
        }
        continue;
      default:
        throw new LexError(`Unexpected character '${c}'`, start);
    }
  }

  tokens.push({ kind: "eof" });
  return tokens;
}
