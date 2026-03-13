import { Token, TokenType } from './lexer';

export interface ColumnRef {
  table?: string;
  column: string;
  aggFunc?: string;  // COUNT, SUM, AVG, MIN, MAX
  alias?: string;
}

export interface JoinClause {
  type: 'INNER' | 'LEFT';
  table: string;
  alias?: string;
  on: Expr;
}

export interface OrderByItem {
  column: ColumnRef;
  direction: 'ASC' | 'DESC';
}

export type Expr =
  | { kind: 'column'; ref: ColumnRef }
  | { kind: 'literal'; value: string | number }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'not'; expr: Expr }
  | { kind: 'like'; expr: Expr; pattern: string };

export interface SelectStatement {
  columns: ColumnRef[];
  from: { table: string; alias?: string };
  joins: JoinClause[];
  where?: Expr;
  groupBy: ColumnRef[];
  having?: Expr;
  orderBy: OrderByItem[];
  limit?: number;
  offset?: number;
}

export class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token { return this.tokens[this.pos]; }
  private advance(): Token { return this.tokens[this.pos++]; }

  private expect(type: TokenType): Token {
    const t = this.advance();
    if (t.type !== type) throw new Error(`Expected ${type} but got ${t.type} (${t.value})`);
    return t;
  }

  private match(...types: TokenType[]): Token | null {
    if (types.includes(this.peek().type)) return this.advance();
    return null;
  }

  parse(): SelectStatement {
    this.expect('SELECT');
    const columns = this.parseColumns();
    this.expect('FROM');
    const from = this.parseTableRef();
    const joins = this.parseJoins();
    const where = this.peek().type === 'WHERE' ? (this.advance(), this.parseExpr()) : undefined;
    const groupBy = this.parseGroupBy();
    const having = this.peek().type === 'HAVING' ? (this.advance(), this.parseExpr()) : undefined;
    const orderBy = this.parseOrderBy();
    let limit: number | undefined;
    let offset: number | undefined;
    if (this.match('LIMIT')) limit = Number(this.expect('NUMBER').value);
    if (this.match('OFFSET')) offset = Number(this.expect('NUMBER').value);
    return { columns, from, joins, where, groupBy, having, orderBy, limit, offset };
  }

  private parseColumns(): ColumnRef[] {
    const cols: ColumnRef[] = [];
    cols.push(this.parseColumnRef());
    while (this.match('COMMA')) cols.push(this.parseColumnRef());
    return cols;
  }

  private parseColumnRef(): ColumnRef {
    // Check for aggregate functions
    const aggFuncs: TokenType[] = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
    if (aggFuncs.includes(this.peek().type)) {
      const func = this.advance().type;
      this.expect('LPAREN');
      let column = '*';
      if (this.match('STAR')) {
        column = '*';
      } else {
        column = this.parseSimpleColumnRef().column;
      }
      this.expect('RPAREN');
      return { column, aggFunc: func };
    }

    if (this.peek().type === 'STAR') {
      this.advance();
      return { column: '*' };
    }

    return this.parseSimpleColumnRef();
  }

  private parseSimpleColumnRef(): ColumnRef {
    const name = this.expect('IDENTIFIER').value;
    if (this.match('DOT')) {
      const col = this.peek().type === 'IDENTIFIER' ? this.advance().value : this.expect('IDENTIFIER').value;
      return { table: name, column: col };
    }
    return { column: name };
  }

  private parseTableRef(): { table: string; alias?: string } {
    const table = this.expect('IDENTIFIER').value;
    let alias: string | undefined;
    if (this.peek().type === 'IDENTIFIER') alias = this.advance().value;
    return { table, alias };
  }

  private parseJoins(): JoinClause[] {
    const joins: JoinClause[] = [];
    while (true) {
      let joinType: 'INNER' | 'LEFT' | null = null;
      if (this.match('INNER')) { joinType = 'INNER'; this.expect('JOIN'); }
      else if (this.match('LEFT')) { joinType = 'LEFT'; this.match('OUTER'); this.expect('JOIN'); }
      else if (this.peek().type === 'JOIN') { this.advance(); joinType = 'INNER'; }
      else break;

      const { table, alias } = this.parseTableRef();
      this.expect('ON');
      const on = this.parseExpr();
      joins.push({ type: joinType, table, alias, on });
    }
    return joins;
  }

  private parseGroupBy(): ColumnRef[] {
    if (!this.match('GROUP')) return [];
    this.expect('BY');
    const cols: ColumnRef[] = [];
    cols.push(this.parseSimpleColumnRef());
    while (this.match('COMMA')) cols.push(this.parseSimpleColumnRef());
    return cols;
  }

  private parseOrderBy(): OrderByItem[] {
    if (!this.match('ORDER')) return [];
    this.expect('BY');
    const items: OrderByItem[] = [];
    const col = this.parseSimpleColumnRef();
    let dir: 'ASC' | 'DESC' = 'ASC';
    if (this.match('DESC')) dir = 'DESC';
    else this.match('ASC');
    items.push({ column: col, direction: dir });
    while (this.match('COMMA')) {
      const c = this.parseSimpleColumnRef();
      let d: 'ASC' | 'DESC' = 'ASC';
      if (this.match('DESC')) d = 'DESC';
      else this.match('ASC');
      items.push({ column: c, direction: d });
    }
    return items;
  }

  private parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.match('OR')) {
      left = { kind: 'binary', op: 'OR', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.match('AND')) {
      left = { kind: 'binary', op: 'AND', left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.match('NOT')) return { kind: 'not', expr: this.parseNot() };
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    const left = this.parsePrimary();
    const opMap: Record<string, string> = {
      'EQ': '=', 'NEQ': '!=', 'LT': '<', 'GT': '>', 'LTE': '<=', 'GTE': '>=',
    };
    if (this.peek().type === 'LIKE') {
      this.advance();
      const pattern = this.expect('STRING').value;
      return { kind: 'like', expr: left, pattern };
    }
    const opToken = opMap[this.peek().type];
    if (opToken) {
      this.advance();
      return { kind: 'binary', op: opToken, left, right: this.parsePrimary() };
    }
    return left;
  }

  private parsePrimary(): Expr {
    if (this.match('LPAREN')) {
      const expr = this.parseExpr();
      this.expect('RPAREN');
      return expr;
    }
    if (this.peek().type === 'NUMBER') {
      return { kind: 'literal', value: Number(this.advance().value) };
    }
    if (this.peek().type === 'STRING') {
      return { kind: 'literal', value: this.advance().value };
    }
    // Aggregate in expression (e.g., HAVING AVG(age) > 30)
    const aggFuncs: TokenType[] = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
    if (aggFuncs.includes(this.peek().type)) {
      const ref = this.parseColumnRef();
      return { kind: 'column', ref };
    }
    // Column reference
    const name = this.expect('IDENTIFIER').value;
    if (this.match('DOT')) {
      const col = this.expect('IDENTIFIER').value;
      return { kind: 'column', ref: { table: name, column: col } };
    }
    return { kind: 'column', ref: { column: name } };
  }
}
