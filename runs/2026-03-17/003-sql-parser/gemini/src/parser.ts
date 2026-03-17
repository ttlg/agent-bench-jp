import { Token, TokenType, SelectStmt, SelectItem, Expr, JoinClause, OrderByItem } from './types';

export class Parser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : { type: 'EOF', value: '' };
  }

  private advance(): Token {
    return this.pos < this.tokens.length ? this.tokens[this.pos++] : { type: 'EOF', value: '' };
  }

  private match(type: TokenType): boolean {
    if (this.peek().type === type) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(type: TokenType, err: string): Token {
    if (this.peek().type === type) {
      return this.advance();
    }
    throw new Error(`Parse error: Expected ${type}, got ${this.peek().type}. ${err}`);
  }

  public parse(): SelectStmt {
    this.expect('SELECT', 'Query must start with SELECT');
    const select = this.parseSelectItems();
    this.expect('FROM', 'Expected FROM after SELECT list');
    const from = this.parseTableRef();

    const joins: JoinClause[] = [];
    while (this.peek().type === 'INNER' || this.peek().type === 'LEFT' || this.peek().type === 'JOIN') {
      joins.push(this.parseJoin());
    }

    let where: Expr | undefined;
    if (this.match('WHERE')) {
      where = this.parseExpr();
    }

    let groupBy: Expr[] | undefined;
    if (this.match('GROUP')) {
      this.expect('BY', 'Expected BY after GROUP');
      groupBy = [];
      do {
        groupBy.push(this.parseExpr());
      } while (this.match('COMMA'));
    }

    let having: Expr | undefined;
    if (this.match('HAVING')) {
      having = this.parseExpr();
    }

    let orderBy: OrderByItem[] | undefined;
    if (this.match('ORDER')) {
      this.expect('BY', 'Expected BY after ORDER');
      orderBy = [];
      do {
        const col = this.parseExpr();
        let direction: 'ASC' | 'DESC' = 'ASC';
        if (this.match('ASC')) direction = 'ASC';
        else if (this.match('DESC')) direction = 'DESC';
        orderBy.push({ column: col, direction });
      } while (this.match('COMMA'));
    }

    let limit: number | undefined;
    let offset: number | undefined;

    if (this.match('LIMIT')) {
      limit = parseInt(this.expect('NUMBER', 'Expected number after LIMIT').value, 10);
      if (this.match('OFFSET')) {
        offset = parseInt(this.expect('NUMBER', 'Expected number after OFFSET').value, 10);
      }
    }

    return { select, from, joins, where, groupBy, having, orderBy, limit, offset };
  }

  private parseSelectItems(): SelectItem[] {
    const items: SelectItem[] = [];
    do {
      if (this.peek().type === 'STAR') {
        this.advance();
        items.push({ type: 'Star' });
      } else {
        const expr = this.parseExpr();
        if (expr.type === 'ColumnRef') {
          // Check for alias (not supported yet in Expr, but needed for SELECT list)
          let alias: string | undefined;
          if (this.peek().type === 'IDENTIFIER' && !['FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'ON', 'ORDER', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET'].includes(this.peek().value.toUpperCase())) {
             alias = this.advance().value;
          }
          items.push({ type: 'ColumnRef', table: expr.table, column: expr.column, alias });
        } else if (expr.type === 'FunctionCall') {
          // handle COUNT(*) etc as ColumnRef with aggregation for simplicity in SelectItem
          if (expr.args.length === 1 && (expr.args[0].type === 'ColumnRef' || expr.args[0] as any === 'STAR')) {
             if ((expr.args[0] as any) === 'STAR') {
               items.push({ type: 'Star', isAggregate: true, aggregateFunc: expr.name });
             } else {
               const colRef = expr.args[0] as any;
               items.push({ type: 'ColumnRef', table: colRef.table, column: colRef.column, isAggregate: true, aggregateFunc: expr.name });
             }
          } else {
             throw new Error('Unsupported expression in SELECT list');
          }
        } else {
          throw new Error('Unsupported expression in SELECT list');
        }
      }
    } while (this.match('COMMA'));
    return items;
  }

  private parseTableRef() {
    const name = this.expect('IDENTIFIER', 'Expected table name').value;
    let alias: string | undefined;
    if (this.peek().type === 'IDENTIFIER' && !['WHERE', 'JOIN', 'INNER', 'LEFT', 'ON', 'ORDER', 'GROUP', 'HAVING', 'LIMIT'].includes(this.peek().value.toUpperCase())) {
      alias = this.advance().value;
    }
    return { name, alias };
  }

  private parseJoin(): JoinClause {
    let type: 'INNER' | 'LEFT' = 'INNER';
    if (this.match('INNER')) {
      this.expect('JOIN', 'Expected JOIN after INNER');
    } else if (this.match('LEFT')) {
      this.expect('JOIN', 'Expected JOIN after LEFT');
      type = 'LEFT';
    } else {
      this.expect('JOIN', 'Expected JOIN');
    }

    const table = this.parseTableRef();
    this.expect('ON', 'Expected ON after JOIN table');
    const on = this.parseExpr();

    return { type, table, on };
  }

  private parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let expr = this.parseAnd();
    while (this.match('OR')) {
      expr = { type: 'LogicalExpr', left: expr, operator: 'OR', right: this.parseAnd() };
    }
    return expr;
  }

  private parseAnd(): Expr {
    let expr = this.parseNot();
    while (this.match('AND')) {
      expr = { type: 'LogicalExpr', left: expr, operator: 'AND', right: this.parseNot() };
    }
    return expr;
  }

  private parseNot(): Expr {
    if (this.match('NOT')) {
      return { type: 'UnaryExpr', operator: 'NOT', expr: this.parseComparison() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    let expr = this.parsePrimary();
    if (this.peek().type === 'OPERATOR') {
      const op = this.advance().value;
      expr = { type: 'BinaryExpr', left: expr, operator: op, right: this.parsePrimary() };
    } else if (this.match('LIKE')) {
      expr = { type: 'BinaryExpr', left: expr, operator: 'LIKE', right: this.parsePrimary() };
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const token = this.peek();
    
    if (token.type === 'LPAREN') {
      this.advance();
      const expr = this.parseExpr();
      this.expect('RPAREN', 'Expected )');
      return expr;
    }

    if (token.type === 'NUMBER') {
      this.advance();
      return { type: 'NumberLiteral', value: parseFloat(token.value) };
    }

    if (token.type === 'STRING') {
      this.advance();
      return { type: 'StringLiteral', value: token.value };
    }

    if (token.type === 'IDENTIFIER') {
      const name = this.advance().value;
      if (this.peek().type === 'LPAREN') {
        this.advance(); // consume (
        const args: any[] = [];
        if (this.peek().type !== 'RPAREN') {
          if (this.peek().type === 'STAR') {
             this.advance();
             args.push('STAR');
          } else {
             args.push(this.parseExpr());
             // ignoring multiple args for now (like COUNT(a, b))
          }
        }
        this.expect('RPAREN', 'Expected ) after function args');
        return { type: 'FunctionCall', name: name.toUpperCase(), args };
      }

      let column = name;
      let table: string | undefined;

      if (this.match('DOT')) {
        table = name;
        if (this.peek().type === 'STAR') {
           this.advance();
           // A bit hacky: we return ColumnRef with column = '*' for table.*
           return { type: 'ColumnRef', table, column: '*' };
        }
        column = this.expect('IDENTIFIER', 'Expected column name after dot').value;
      }
      return { type: 'ColumnRef', table, column };
    }

    throw new Error(`Parse error: Unexpected token ${token.type} (${token.value})`);
  }
}
