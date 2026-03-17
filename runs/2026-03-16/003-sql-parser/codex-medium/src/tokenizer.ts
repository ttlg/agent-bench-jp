import type { Token } from "./types.ts";

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
  "JOIN",
  "INNER",
  "LEFT",
  "ON",
  "AS",
  "GROUP",
  "HAVING",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "TRUE",
  "FALSE",
  "NULL"
]);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "-" && input[index + 1] === "-") {
      while (index < input.length && input[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (/[(),.*]/.test(char)) {
      tokens.push({ type: "punctuation", value: char, position: index });
      index += 1;
      continue;
    }

    const twoCharOperator = input.slice(index, index + 2);
    if (["<=", ">=", "!=", "<>"].includes(twoCharOperator)) {
      tokens.push({ type: "operator", value: twoCharOperator, position: index });
      index += 2;
      continue;
    }

    if (["=", "<", ">"].includes(char)) {
      tokens.push({ type: "operator", value: char, position: index });
      index += 1;
      continue;
    }

    if (char === "'" || char === "\"") {
      const quote = char;
      const start = index;
      index += 1;
      let value = "";
      while (index < input.length) {
        if (input[index] === quote && input[index + 1] === quote) {
          value += quote;
          index += 2;
          continue;
        }
        if (input[index] === quote) {
          break;
        }
        value += input[index];
        index += 1;
      }
      if (input[index] !== quote) {
        throw new Error(`Unterminated string starting at position ${start}`);
      }
      index += 1;
      tokens.push({ type: "string", value, position: start });
      continue;
    }

    if (/[0-9]/.test(char)) {
      const start = index;
      index += 1;
      while (index < input.length && /[0-9.]/.test(input[index])) {
        index += 1;
      }
      tokens.push({ type: "number", value: input.slice(start, index), position: start });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (index < input.length && /[A-Za-z0-9_]/.test(input[index])) {
        index += 1;
      }
      const value = input.slice(start, index);
      const upper = value.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: "keyword", value: upper, position: start });
      } else {
        tokens.push({ type: "identifier", value, position: start });
      }
      continue;
    }

    throw new Error(`Unexpected character '${char}' at position ${index}`);
  }

  tokens.push({ type: "eof", value: "", position: input.length });
  return tokens;
}
