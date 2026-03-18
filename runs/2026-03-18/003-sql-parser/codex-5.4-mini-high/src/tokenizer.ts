export type TokenType = 'identifier' | 'number' | 'string' | 'operator' | 'punctuation' | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

const TWO_CHAR_OPERATORS = new Set(['<=', '>=', '!=', '<>']);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  const push = (type: TokenType, value: string, position: number) => {
    tokens.push({ type, value, position });
  };

  while (index < input.length) {
    const char = input[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === '-' && input[index + 1] === '-') {
      index += 2;
      while (index < input.length && input[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if (char === '/' && input[index + 1] === '*') {
      index += 2;
      while (index < input.length && !(input[index] === '*' && input[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }

    const two = input.slice(index, index + 2);
    if (TWO_CHAR_OPERATORS.has(two)) {
      push('operator', two, index);
      index += 2;
      continue;
    }

    if ('(),.*'.includes(char)) {
      push('punctuation', char, index);
      index += 1;
      continue;
    }

    if ('=<>+-'.includes(char)) {
      push('operator', char, index);
      index += 1;
      continue;
    }

    if (char === "'") {
      const start = index;
      index += 1;
      let value = '';
      while (index < input.length) {
        const current = input[index];
        if (current === "'") {
          if (input[index + 1] === "'") {
            value += "'";
            index += 2;
            continue;
          }
          index += 1;
          push('string', value, start);
          break;
        }
        value += current;
        index += 1;
      }
      if (tokens[tokens.length - 1]?.position !== start) {
        throw new Error(`Unterminated string literal at position ${start}`);
      }
      continue;
    }

    if (/[0-9]/.test(char)) {
      const start = index;
      let value = char;
      index += 1;
      while (index < input.length && /[0-9.]/.test(input[index])) {
        value += input[index];
        index += 1;
      }
      if ((value.match(/\./g) ?? []).length > 1) {
        throw new Error(`Invalid number literal "${value}" at position ${start}`);
      }
      push('number', value, start);
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      let value = char;
      index += 1;
      while (index < input.length && /[A-Za-z0-9_]/.test(input[index])) {
        value += input[index];
        index += 1;
      }
      push('identifier', value, start);
      continue;
    }

    throw new Error(`Unexpected character "${char}" at position ${index}`);
  }

  tokens.push({ type: 'eof', value: '', position: input.length });
  return tokens;
}
