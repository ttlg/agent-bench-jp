export type TokenType = "identifier" | "number" | "string" | "symbol" | "eof";

export type Token = {
  type: TokenType;
  value: string;
  position: number;
};

const SYMBOLS = new Set([",", ".", "(", ")", "*", ";"]);
const TWO_CHAR_OPERATORS = new Set(["<=", ">=", "<>", "!="]);
const ONE_CHAR_OPERATORS = new Set(["=", "<", ">"]);

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    const twoChar = sql.slice(index, index + 2);
    if (TWO_CHAR_OPERATORS.has(twoChar)) {
      tokens.push({ type: "symbol", value: twoChar, position: index });
      index += 2;
      continue;
    }

    if (SYMBOLS.has(char) || ONE_CHAR_OPERATORS.has(char)) {
      tokens.push({ type: "symbol", value: char, position: index });
      index += 1;
      continue;
    }

    if (char === "'" || char === "\"") {
      const quote = char;
      const start = index;
      index += 1;
      let value = "";

      while (index < sql.length) {
        const current = sql[index];
        if (current === quote) {
          if (sql[index + 1] === quote) {
            value += quote;
            index += 2;
            continue;
          }

          index += 1;
          break;
        }

        value += current;
        index += 1;
      }

      if (sql[index - 1] !== quote) {
        throw new Error(`Unterminated string starting at position ${start}`);
      }

      tokens.push({ type: "string", value, position: start });
      continue;
    }

    if (/[0-9]/.test(char)) {
      const start = index;
      index += 1;
      while (index < sql.length && /[0-9.]/.test(sql[index])) {
        index += 1;
      }
      tokens.push({
        type: "number",
        value: sql.slice(start, index),
        position: start
      });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_]/.test(sql[index])) {
        index += 1;
      }
      tokens.push({
        type: "identifier",
        value: sql.slice(start, index),
        position: start
      });
      continue;
    }

    throw new Error(`Unexpected character "${char}" at position ${index}`);
  }

  tokens.push({ type: "eof", value: "", position: sql.length });
  return tokens;
}
