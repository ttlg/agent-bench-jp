import { Token, TokenType } from "./types";

const KEYWORDS: Record<string, TokenType> = {
  SELECT: TokenType.SELECT,
  FROM: TokenType.FROM,
  WHERE: TokenType.WHERE,
  AND: TokenType.AND,
  OR: TokenType.OR,
  NOT: TokenType.NOT,
  JOIN: TokenType.JOIN,
  INNER: TokenType.INNER,
  LEFT: TokenType.LEFT,
  OUTER: TokenType.OUTER,
  ON: TokenType.ON,
  ORDER: TokenType.ORDER,
  BY: TokenType.BY,
  ASC: TokenType.ASC,
  DESC: TokenType.DESC,
  LIMIT: TokenType.LIMIT,
  OFFSET: TokenType.OFFSET,
  GROUP: TokenType.GROUP,
  HAVING: TokenType.HAVING,
  LIKE: TokenType.LIKE,
  COUNT: TokenType.COUNT,
  SUM: TokenType.SUM,
  AVG: TokenType.AVG,
  MIN: TokenType.MIN,
  MAX: TokenType.MAX,
  AS: TokenType.AS,
};

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < input.length) {
    // Skip whitespace
    if (/\s/.test(input[pos])) {
      pos++;
      continue;
    }

    const start = pos;

    // Single-quoted string
    if (input[pos] === "'") {
      pos++;
      let value = "";
      while (pos < input.length && input[pos] !== "'") {
        if (input[pos] === "'" && pos + 1 < input.length && input[pos + 1] === "'") {
          value += "'";
          pos += 2;
        } else {
          value += input[pos];
          pos++;
        }
      }
      if (pos >= input.length) {
        throw new Error(`Unterminated string literal at position ${start}`);
      }
      pos++; // closing quote
      tokens.push({ type: TokenType.STRING, value, position: start });
      continue;
    }

    // Numbers
    if (/\d/.test(input[pos]) || (input[pos] === "-" && pos + 1 < input.length && /\d/.test(input[pos + 1]))) {
      let num = input[pos];
      pos++;
      while (pos < input.length && /[\d.]/.test(input[pos])) {
        num += input[pos];
        pos++;
      }
      tokens.push({ type: TokenType.NUMBER, value: num, position: start });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_\u3000-\u9FFF\uF900-\uFAFF]/.test(input[pos])) {
      let ident = "";
      while (pos < input.length && /[a-zA-Z0-9_\u3000-\u9FFF\uF900-\uFAFF]/.test(input[pos])) {
        ident += input[pos];
        pos++;
      }
      const upper = ident.toUpperCase();
      const kwType = KEYWORDS[upper];
      if (kwType) {
        tokens.push({ type: kwType, value: upper, position: start });
      } else {
        tokens.push({ type: TokenType.IDENTIFIER, value: ident, position: start });
      }
      continue;
    }

    // Symbols
    switch (input[pos]) {
      case "*":
        tokens.push({ type: TokenType.STAR, value: "*", position: start });
        pos++;
        break;
      case ",":
        tokens.push({ type: TokenType.COMMA, value: ",", position: start });
        pos++;
        break;
      case ".":
        tokens.push({ type: TokenType.DOT, value: ".", position: start });
        pos++;
        break;
      case "(":
        tokens.push({ type: TokenType.LPAREN, value: "(", position: start });
        pos++;
        break;
      case ")":
        tokens.push({ type: TokenType.RPAREN, value: ")", position: start });
        pos++;
        break;
      case "=":
        tokens.push({ type: TokenType.EQ, value: "=", position: start });
        pos++;
        break;
      case "!":
        if (pos + 1 < input.length && input[pos + 1] === "=") {
          tokens.push({ type: TokenType.NEQ, value: "!=", position: start });
          pos += 2;
        } else {
          throw new Error(`Unexpected character '!' at position ${pos}`);
        }
        break;
      case "<":
        if (pos + 1 < input.length && input[pos + 1] === "=") {
          tokens.push({ type: TokenType.LTE, value: "<=", position: start });
          pos += 2;
        } else {
          tokens.push({ type: TokenType.LT, value: "<", position: start });
          pos++;
        }
        break;
      case ">":
        if (pos + 1 < input.length && input[pos + 1] === "=") {
          tokens.push({ type: TokenType.GTE, value: ">=", position: start });
          pos += 2;
        } else {
          tokens.push({ type: TokenType.GT, value: ">", position: start });
          pos++;
        }
        break;
      default:
        throw new Error(`Unexpected character '${input[pos]}' at position ${pos}`);
    }
  }

  tokens.push({ type: TokenType.EOF, value: "", position: pos });
  return tokens;
}
