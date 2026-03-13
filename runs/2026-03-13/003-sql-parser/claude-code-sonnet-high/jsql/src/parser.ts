import { Token, TokenType, tokenize } from './lexer';
import {
  Statement, SelectStatement, SelectItem, JoinClause, OrderByItem,
  Expr, ColumnRef, StarRef, FuncCall, Literal
} from './ast';

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(sql: string) {
    this.tokens = tokenize(sql);
  }

  private peek(): Token { return this.tokens[this.pos]; }
  private advance(): Token { return this.tokens[this.pos++]; }

  private check(...types: TokenType[]): boolean {
    return types.includes(this.peek().type);
  }

  private eat(type: TokenType): Token {
    const t = this.peek();
    if (t.type !== type) throw new Error(`Expected ${type} but got ${t.type} ('${t.value}')`);
    return this.advance();
  }

  private match(...types: TokenType[]): boolean {
    if (this.check(...types)) { this.advance(); return true; }
    return false;
  }

  parse(): Statement {
    const stmt = this.parseSelect();
    this.eat('EOF');
    return stmt;
  }

  private parseSelect(): SelectStatement {
    this.eat('SELECT');
    const columns = this.parseSelectList();
    this.eat('FROM');
    const fromIdent = this.eat('IDENT');
    const from = fromIdent.value;
    let fromAlias: string | undefined;
    if (this.check('IDENT')) fromAlias = this.advance().value;

    const joins: JoinClause[] = [];
    while (this.check('JOIN', 'INNER', 'LEFT')) {
      joins.push(this.parseJoin());
    }

    let where: Expr | undefined;
    if (this.match('WHERE')) where = this.parseExpr();

    let groupBy: ColumnRef[] | undefined;
    if (this.check('GROUP')) {
      this.advance(); // GROUP
      this.eat('BY');
      groupBy = [this.parseColumnRef()];
      while (this.match('COMMA')) groupBy.push(this.parseColumnRef());
    }

    let having: Expr | undefined;
    if (this.match('HAVING')) having = this.parseExpr();

    let orderBy: OrderByItem[] | undefined;
    if (this.check('ORDER')) {
      this.advance(); // ORDER
      this.eat('BY');
      orderBy = [this.parseOrderItem()];
      while (this.match('COMMA')) orderBy.push(this.parseOrderItem());
    }

    let limit: number | undefined;
    if (this.match('LIMIT')) limit = Number(this.eat('NUMBER').value);

    let offset: number | undefined;
    if (this.match('OFFSET')) offset = Number(this.eat('NUMBER').value);

    return { kind: 'SELECT', columns, from, fromAlias, joins, where, groupBy, having, orderBy, limit, offset };
  }

  private parseSelectList(): SelectItem[] {
    const items: SelectItem[] = [];
    items.push(this.parseSelectItem());
    while (this.match('COMMA')) items.push(this.parseSelectItem());
    return items;
  }

  private parseSelectItem(): SelectItem {
    // table.*
    if (this.check('IDENT') && this.tokens[this.pos + 1]?.type === 'DOT' && this.tokens[this.pos + 2]?.type === 'STAR') {
      const table = this.advance().value;
      this.advance(); // DOT
      this.advance(); // STAR
      return { type: 'star', table };
    }
    // *
    if (this.check('STAR')) { this.advance(); return { type: 'star' }; }
    // aggregate function
    if (this.check('COUNT', 'SUM', 'AVG', 'MIN', 'MAX')) {
      return this.parseFuncCall();
    }
    // column ref (possibly table.col)
    return this.parseColumnRef();
  }

  private parseFuncCall(): FuncCall {
    const name = this.advance().value.toUpperCase();
    this.eat('LPAREN');
    let arg: ColumnRef | StarRef;
    if (this.check('STAR')) { this.advance(); arg = { type: 'star' }; }
    else arg = this.parseColumnRef();
    this.eat('RPAREN');
    return { type: 'func', name, arg };
  }

  private parseColumnRef(): ColumnRef {
    const first = this.eat('IDENT').value;
    if (this.check('DOT')) {
      this.advance(); // DOT
      const col = this.eat('IDENT').value;
      return { type: 'column', table: first, name: col };
    }
    return { type: 'column', name: first };
  }

  private parseJoin(): JoinClause {
    let joinType: 'INNER' | 'LEFT' = 'INNER';
    if (this.check('LEFT')) { this.advance(); joinType = 'LEFT'; this.match('OUTER'); }
    else if (this.check('INNER')) { this.advance(); }
    this.eat('JOIN');
    const table = this.eat('IDENT').value;
    let alias: string | undefined;
    if (this.check('IDENT')) alias = this.advance().value;
    this.eat('ON');
    const on = this.parseExpr();
    return { type: joinType, table, alias, on };
  }

  private parseOrderItem(): OrderByItem {
    const col = this.parseColumnRef();
    let direction: 'ASC' | 'DESC' = 'ASC';
    if (this.match('DESC')) direction = 'DESC';
    else this.match('ASC');
    return { expr: col, direction };
  }

  // Expression parsing with operator precedence
  private parseExpr(): Expr { return this.parseOr(); }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.match('OR')) {
      const right = this.parseAnd();
      left = { type: 'binary', op: 'OR', left, right };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.match('AND')) {
      const right = this.parseNot();
      left = { type: 'binary', op: 'AND', left, right };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.match('NOT')) {
      return { type: 'unary', op: 'NOT', expr: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    const left = this.parsePrimary();
    const opMap: Record<string, string> = {
      EQ: '=', NEQ: '!=', LT: '<', GT: '>', LTE: '<=', GTE: '>=', LIKE: 'LIKE',
    };
    if (this.check('EQ', 'NEQ', 'LT', 'GT', 'LTE', 'GTE', 'LIKE')) {
      const op = opMap[this.peek().type];
      this.advance();
      const right = this.parsePrimary();
      return { type: 'binary', op, left, right };
    }
    return left;
  }

  private parsePrimary(): Expr {
    // Parenthesized expression
    if (this.check('LPAREN')) {
      this.advance();
      const expr = this.parseExpr();
      this.eat('RPAREN');
      return expr;
    }
    // String literal
    if (this.check('STRING')) {
      const val = this.advance().value;
      return { type: 'literal', value: val };
    }
    // Number literal
    if (this.check('NUMBER')) {
      const val = this.advance().value;
      return { type: 'literal', value: Number(val) };
    }
    // Aggregate function
    if (this.check('COUNT', 'SUM', 'AVG', 'MIN', 'MAX')) {
      return this.parseFuncCall();
    }
    // Column reference
    return this.parseColumnRef();
  }
}

export function parse(sql: string): Statement {
  return new Parser(sql).parse();
}
