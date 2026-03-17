export type TokenType =
  | "identifier"
  | "keyword"
  | "number"
  | "string"
  | "operator"
  | "comma"
  | "dot"
  | "paren_open"
  | "paren_close"
  | "asterisk"
  | "eof";

export type Token = {
  type: TokenType;
  value: string;
  pos: number;
};

const KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "LIKE",
  "ORDER",
  "BY",
  "ASC",
  "DESC",
  "LIMIT",
  "OFFSET",
  "INNER",
  "LEFT",
  "JOIN",
  "ON",
  "AS",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "GROUP",
  "HAVING",
  "IS",
  "NULL",
  "DISTINCT"
]);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === "," || ch === "." || ch === "(" || ch === ")" || ch === "*") {
      tokens.push({
        type:
          ch === ","
            ? "comma"
            : ch === "."
              ? "dot"
              : ch === "("
                ? "paren_open"
                : ch === ")"
                  ? "paren_close"
                  : "asterisk",
        value: ch,
        pos: i
      });
      i += 1;
      continue;
    }

    const two = input.slice(i, i + 2);
    if (["<=", ">=", "!=", "<>"].includes(two)) {
      tokens.push({ type: "operator", value: two, pos: i });
      i += 2;
      continue;
    }

    if (["=", "<", ">", "+", "-", "/"].includes(ch)) {
      tokens.push({ type: "operator", value: ch, pos: i });
      i += 1;
      continue;
    }

    if (ch === "'") {
      let value = "";
      let j = i + 1;
      while (j < input.length) {
        if (input[j] === "'" && input[j + 1] === "'") {
          value += "'";
          j += 2;
          continue;
        }
        if (input[j] === "'") {
          break;
        }
        value += input[j];
        j += 1;
      }
      if (input[j] !== "'") {
        throw new Error(`Unterminated string at ${i}`);
      }
      tokens.push({ type: "string", value, pos: i });
      i = j + 1;
      continue;
    }

    if (/\d/.test(ch)) {
      let j = i + 1;
      while (j < input.length && /[\d.]/.test(input[j])) {
        j += 1;
      }
      tokens.push({ type: "number", value: input.slice(i, j), pos: i });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) {
        j += 1;
      }
      const value = input.slice(i, j);
      const upper = value.toUpperCase();
      tokens.push({
        type: KEYWORDS.has(upper) ? "keyword" : "identifier",
        value,
        pos: i
      });
      i = j;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at ${i}`);
  }

  tokens.push({ type: "eof", value: "", pos: input.length });
  return tokens;
}
