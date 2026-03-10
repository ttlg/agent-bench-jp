export interface Token {
  kind: "identifier" | "number" | "string" | "operator" | "punctuation" | "eof";
  value: string;
  position: number;
}

const isIdentifierStart = (char: string): boolean => /[A-Za-z_]/.test(char);
const isIdentifierPart = (char: string): boolean => /[A-Za-z0-9_]/.test(char);
const isDigit = (char: string): boolean => /[0-9]/.test(char);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (index < input.length && isIdentifierPart(input[index])) {
        index += 1;
      }
      tokens.push({
        kind: "identifier",
        value: input.slice(start, index),
        position: start,
      });
      continue;
    }

    if (isDigit(char)) {
      const start = index;
      index += 1;
      while (index < input.length && isDigit(input[index])) {
        index += 1;
      }
      if (input[index] === ".") {
        index += 1;
        while (index < input.length && isDigit(input[index])) {
          index += 1;
        }
      }
      tokens.push({
        kind: "number",
        value: input.slice(start, index),
        position: start,
      });
      continue;
    }

    if (char === "'") {
      const start = index;
      index += 1;
      let value = "";
      while (index < input.length) {
        if (input[index] === "'" && input[index + 1] === "'") {
          value += "'";
          index += 2;
          continue;
        }
        if (input[index] === "'") {
          index += 1;
          break;
        }
        value += input[index];
        index += 1;
      }
      if (input[index - 1] !== "'") {
        throw new Error(`Unterminated string literal at position ${start}`);
      }
      tokens.push({
        kind: "string",
        value,
        position: start,
      });
      continue;
    }

    const twoCharacterOperator = input.slice(index, index + 2);
    if (["!=", "<=", ">="].includes(twoCharacterOperator)) {
      tokens.push({
        kind: "operator",
        value: twoCharacterOperator,
        position: index,
      });
      index += 2;
      continue;
    }

    if (["=", "<", ">"].includes(char)) {
      tokens.push({
        kind: "operator",
        value: char,
        position: index,
      });
      index += 1;
      continue;
    }

    if ([",", "(", ")", ".", "*", ";"].includes(char)) {
      tokens.push({
        kind: "punctuation",
        value: char,
        position: index,
      });
      index += 1;
      continue;
    }

    throw new Error(`Unexpected character "${char}" at position ${index}`);
  }

  tokens.push({
    kind: "eof",
    value: "",
    position: input.length,
  });

  return tokens;
}
