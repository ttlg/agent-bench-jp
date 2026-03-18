export type CellValue = unknown;

export interface QueryResult {
  columns: string[];
  rows: Record<string, CellValue>[];
}

interface Token {
  type:
    | 'identifier'
    | 'keyword'
    | 'number'
    | 'string'
    | 'comma'
    | 'dot'
    | 'star'
    | 'lparen'
    | 'rparen'
    | 'operator'
    | 'semicolon'
    | 'eof';
  value: string | number;
  index: number;
}

interface TableSource {
  table: string;
  alias: string;
}

interface JoinClause {
  joinType: 'inner' | 'left';
  source: TableSource;
  on: Expr;
}

interface OrderItem {
  expr: Expr;
  direction: 'ASC' | 'DESC';
}

interface SelectQuery {
  type: 'select';
  select: SelectItem[];
  from: TableSource;
  joins: JoinClause[];
  where?: Expr;
  groupBy: Expr[];
  having?: Expr;
  orderBy: OrderItem[];
  limit?: number;
  offset?: number;
}

type SelectItem =
  | {
      kind: 'star';
      source?: string;
    }
  | {
      kind: 'expr';
      expr: Expr;
      alias?: string;
    };

type BinaryOperator = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'AND' | 'OR' | 'LIKE';

type Expr =
  | {
      kind: 'literal';
      value: CellValue;
    }
  | {
      kind: 'column';
      table?: string;
      name: string;
    }
  | {
      kind: 'star';
    }
  | {
      kind: 'function';
      name: string;
      args: Expr[];
    }
  | {
      kind: 'unary';
      op: 'NOT';
      expr: Expr;
    }
  | {
      kind: 'binary';
      op: BinaryOperator;
      left: Expr;
      right: Expr;
    };

interface SourceMeta {
  table: string;
  alias: string;
  columns: string[];
}

interface SourceBinding {
  table: string;
  alias: string;
  row: Record<string, CellValue> | null;
}

interface EvalScope {
  bindings: SourceBinding[];
  groupRows?: SourceBinding[][];
  projectedRow?: Record<string, CellValue>;
}

interface ProjectionField {
  label: string;
  compute: (scope: EvalScope) => CellValue;
}

interface QueryRecord {
  bindings: SourceBinding[];
  groupRows?: SourceBinding[][];
  projectedRow?: Record<string, CellValue>;
}

const KEYWORDS = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'AS',
  'JOIN',
  'INNER',
  'LEFT',
  'OUTER',
  'ON',
  'GROUP',
  'BY',
  'HAVING',
  'ORDER',
  'LIMIT',
  'OFFSET',
  'ASC',
  'DESC',
  'AND',
  'OR',
  'NOT',
  'LIKE',
  'NULL',
  'TRUE',
  'FALSE',
]);

const AGGREGATE_FUNCTIONS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);

const COMPARISON_OPERATORS = new Set<BinaryOperator>(['=', '!=', '<', '>', '<=', '>=']);

export function parseSql(sql: string): SelectQuery {
  const parser = new Parser(tokenize(sql));
  return parser.parseQuery();
}

export function executeSql(data: unknown, sql: string): QueryResult {
  const dataset = normalizeDataset(data);
  const schemas = buildSchemas(dataset);
  const query = parseSql(sql);
  const sources = buildSources(query, dataset, schemas);
  const records = buildInitialRecords(sources, dataset);
  const joined = applyJoins(query.joins, records, dataset);
  const filtered = applyWhere(query.where, joined);
  const aggregated = isAggregatedQuery(query);
  const grouped = aggregated ? groupRecords(query, filtered, sources) : filtered.map((bindings) => ({ bindings }));
  const projection = buildProjectionPlan(query, sources, schemas);
  const projected = grouped
    .filter((record) => applyHaving(query.having, record))
    .map((record) => {
      const scope: EvalScope = {
        bindings: record.bindings,
        groupRows: record.groupRows,
      };
      const projectedRow = projectRecord(scope, projection);
      return {
        bindings: record.bindings,
        groupRows: record.groupRows,
        projectedRow,
      };
    });
  const sorted = query.orderBy.length > 0 ? sortRecords(projected, query.orderBy) : projected;
  const sliced = sliceRecords(sorted, query.limit, query.offset);
  return {
    columns: projection.map((field) => field.label),
    rows: sliced.map((record) => record.projectedRow ?? {}),
  };
}

export function formatTable(result: QueryResult): string {
  if (result.columns.length === 0) {
    return '(empty result set)';
  }

  const widths = result.columns.map((column) => displayWidth(column));
  const numericColumns = result.columns.map((column) =>
    result.rows.length > 0 &&
    result.rows.every((row) => {
      const value = row[column];
      return value === null || value === undefined || (typeof value === 'number' && Number.isFinite(value));
    }),
  );

  for (const row of result.rows) {
    for (let i = 0; i < result.columns.length; i += 1) {
      const text = formatCell(row[result.columns[i]]);
      widths[i] = Math.max(widths[i], displayWidth(text));
    }
  }

  const renderRow = (values: string[], alignRight: boolean[]): string =>
    `| ${values
      .map((value, index) => padCell(value, widths[index], alignRight[index]))
      .join(' | ')} |`;

  const header = renderRow(result.columns, result.columns.map(() => false));
  const separator = `|${widths.map((width) => '-'.repeat(width + 2)).join('|')}|`;
  const body = result.rows.map((row) =>
    renderRow(
      result.columns.map((column) => formatCell(row[column])),
      numericColumns,
    ),
  );

  return [header, separator, ...body].join('\n');
}

export function formatJson(result: QueryResult): string {
  return JSON.stringify(result.rows);
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  const push = (type: Token['type'], value: string | number) => {
    tokens.push({ type, value, index });
  };

  while (index < sql.length) {
    const char = sql[index];

    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    if (char === "'") {
      const start = index;
      index += 1;
      let value = '';
      while (index < sql.length) {
        const current = sql[index];
        if (current === "'") {
          if (sql[index + 1] === "'") {
            value += "'";
            index += 2;
            continue;
          }
          index += 1;
          tokens.push({ type: 'string', value, index: start });
          break;
        }
        value += current;
        index += 1;
      }
      if (tokens[tokens.length - 1]?.type !== 'string' || tokens[tokens.length - 1]?.index !== start) {
        throw new Error(`Unterminated string literal at index ${start}`);
      }
      continue;
    }

    if (isDigit(char)) {
      const start = index;
      index += 1;
      while (index < sql.length && isDigit(sql[index])) {
        index += 1;
      }
      if (sql[index] === '.' && isDigit(sql[index + 1] ?? '')) {
        index += 1;
        while (index < sql.length && isDigit(sql[index])) {
          index += 1;
        }
      }
      push('number', Number(sql.slice(start, index)));
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (index < sql.length && isIdentifierPart(sql[index])) {
        index += 1;
      }
      const text = sql.slice(start, index);
      const upper = text.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: 'keyword', value: upper, index: start });
      } else {
        tokens.push({ type: 'identifier', value: text, index: start });
      }
      continue;
    }

    if (char === ',') {
      push('comma', char);
      index += 1;
      continue;
    }
    if (char === '.') {
      push('dot', char);
      index += 1;
      continue;
    }
    if (char === '*') {
      push('star', char);
      index += 1;
      continue;
    }
    if (char === '(') {
      push('lparen', char);
      index += 1;
      continue;
    }
    if (char === ')') {
      push('rparen', char);
      index += 1;
      continue;
    }
    if (char === ';') {
      push('semicolon', char);
      index += 1;
      continue;
    }
    if (char === '=' || char === '!' || char === '<' || char === '>' || char === '-') {
      const start = index;
      const next = sql[index + 1];
      if (char === '!' && next === '=') {
        tokens.push({ type: 'operator', value: '!=', index: start });
        index += 2;
        continue;
      }
      if (char === '<' && next === '=') {
        tokens.push({ type: 'operator', value: '<=', index: start });
        index += 2;
        continue;
      }
      if (char === '>' && next === '=') {
        tokens.push({ type: 'operator', value: '>=', index: start });
        index += 2;
        continue;
      }
      if (char === '<' && next === '>') {
        tokens.push({ type: 'operator', value: '!=', index: start });
        index += 2;
        continue;
      }
      if (char === '=' || char === '<' || char === '>' || char === '-') {
        tokens.push({ type: 'operator', value: char, index: start });
        index += 1;
        continue;
      }
    }

    throw new Error(`Unexpected character "${char}" at index ${index}`);
  }

  tokens.push({ type: 'eof', value: '', index: sql.length });
  return tokens;
}

class Parser {
  tokens: Token[];
  position = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parseQuery(): SelectQuery {
    this.expectKeyword('SELECT');
    const select = this.parseSelectList();
    this.expectKeyword('FROM');
    const from = this.parseTableSource();
    const joins: JoinClause[] = [];

    while (true) {
      const join = this.tryParseJoin();
      if (!join) {
        break;
      }
      joins.push(join);
    }

    let where: Expr | undefined;
    let groupBy: Expr[] = [];
    let having: Expr | undefined;
    let orderBy: OrderItem[] = [];
    let limit: number | undefined;
    let offset: number | undefined;

    if (this.matchKeyword('WHERE')) {
      where = this.parseExpression();
    }

    if (this.matchKeyword('GROUP')) {
      this.expectKeyword('BY');
      groupBy = this.parseExpressionList();
    }

    if (this.matchKeyword('HAVING')) {
      having = this.parseExpression();
    }

    if (this.matchKeyword('ORDER')) {
      this.expectKeyword('BY');
      orderBy = this.parseOrderList();
    }

    if (this.matchKeyword('LIMIT')) {
      limit = this.expectNumber('Expected numeric LIMIT value');
      if (this.matchKeyword('OFFSET')) {
        offset = this.expectNumber('Expected numeric OFFSET value');
      }
    }

    while (this.matchType('semicolon')) {
      // Allow a trailing semicolon.
    }

    this.expectType('eof', 'Unexpected trailing input');

    return {
      type: 'select',
      select,
      from,
      joins,
      where,
      groupBy,
      having,
      orderBy,
      limit,
      offset,
    };
  }

  parseSelectList(): SelectItem[] {
    const items: SelectItem[] = [];
    do {
      items.push(this.parseSelectItem());
    } while (this.matchType('comma'));
    return items;
  }

  parseSelectItem(): SelectItem {
    if (this.matchType('star')) {
      return { kind: 'star' };
    }

    if (
      this.peek().type === 'identifier' &&
      this.peek(1).type === 'dot' &&
      this.peek(2).type === 'star'
    ) {
      const source = String(this.consume().value);
      this.consume();
      this.consume();
      return { kind: 'star', source };
    }

    const expr = this.parseExpression();
    let alias: string | undefined;
    if (this.matchKeyword('AS')) {
      alias = this.expectIdentifier('Expected alias after AS');
    }
    return { kind: 'expr', expr, alias };
  }

  parseTableSource(): TableSource {
    const table = this.expectIdentifier('Expected table name after FROM');
    let alias = table;
    if (this.matchKeyword('AS')) {
      alias = this.expectIdentifier('Expected alias after AS');
    } else if (this.peek().type === 'identifier') {
      alias = String(this.consume().value);
    }
    return { table, alias };
  }

  tryParseJoin(): JoinClause | null {
    let joinType: 'inner' | 'left' | null = null;
    if (this.matchKeyword('JOIN')) {
      joinType = 'inner';
    } else if (this.matchKeyword('INNER')) {
      this.expectKeyword('JOIN');
      joinType = 'inner';
    } else if (this.matchKeyword('LEFT')) {
      joinType = 'left';
      this.matchKeyword('OUTER');
      this.expectKeyword('JOIN');
    }

    if (!joinType) {
      return null;
    }

    const source = this.parseTableSource();
    this.expectKeyword('ON');
    const on = this.parseExpression();
    return { joinType, source, on };
  }

  parseExpressionList(): Expr[] {
    const items: Expr[] = [];
    do {
      items.push(this.parseExpression());
    } while (this.matchType('comma'));
    return items;
  }

  parseOrderList(): OrderItem[] {
    const items: OrderItem[] = [];
    do {
      items.push(this.parseOrderItem());
    } while (this.matchType('comma'));
    return items;
  }

  parseOrderItem(): OrderItem {
    const expr = this.parseExpression();
    let direction: 'ASC' | 'DESC' = 'ASC';
    if (this.matchKeyword('ASC')) {
      direction = 'ASC';
    } else if (this.matchKeyword('DESC')) {
      direction = 'DESC';
    }
    return { expr, direction };
  }

  parseExpression(): Expr {
    return this.parseOr();
  }

  parseOr(): Expr {
    let expr = this.parseAnd();
    while (this.matchKeyword('OR')) {
      expr = {
        kind: 'binary',
        op: 'OR',
        left: expr,
        right: this.parseAnd(),
      };
    }
    return expr;
  }

  parseAnd(): Expr {
    let expr = this.parseNot();
    while (this.matchKeyword('AND')) {
      expr = {
        kind: 'binary',
        op: 'AND',
        left: expr,
        right: this.parseNot(),
      };
    }
    return expr;
  }

  parseNot(): Expr {
    if (this.matchKeyword('NOT')) {
      return {
        kind: 'unary',
        op: 'NOT',
        expr: this.parseNot(),
      };
    }
    return this.parseComparison();
  }

  parseComparison(): Expr {
    let expr = this.parsePrimary();
    const token = this.peek();
    if (token.type === 'operator' && COMPARISON_OPERATORS.has(String(token.value) as BinaryOperator)) {
      this.consume();
      expr = {
        kind: 'binary',
        op: String(token.value) as BinaryOperator,
        left: expr,
        right: this.parsePrimary(),
      };
    } else if (token.type === 'keyword' && token.value === 'LIKE') {
      this.consume();
      expr = {
        kind: 'binary',
        op: 'LIKE',
        left: expr,
        right: this.parsePrimary(),
      };
    }
    return expr;
  }

  parsePrimary(): Expr {
    const token = this.peek();

    if (token.type === 'number') {
      this.consume();
      return { kind: 'literal', value: token.value };
    }

    if (token.type === 'string') {
      this.consume();
      return { kind: 'literal', value: token.value };
    }

    if (token.type === 'keyword' && token.value === 'NULL') {
      this.consume();
      return { kind: 'literal', value: null };
    }

    if (token.type === 'keyword' && token.value === 'TRUE') {
      this.consume();
      return { kind: 'literal', value: true };
    }

    if (token.type === 'keyword' && token.value === 'FALSE') {
      this.consume();
      return { kind: 'literal', value: false };
    }

    if (token.type === 'identifier') {
      const name = String(this.consume().value);
      if (this.matchType('lparen')) {
        return this.parseFunctionCall(name);
      }
      if (this.matchType('dot')) {
        const column = this.expectIdentifier('Expected column name after "."');
        return { kind: 'column', table: name, name: column };
      }
      return { kind: 'column', name };
    }

    if (this.matchType('lparen')) {
      const expr = this.parseExpression();
      this.expectType('rparen', 'Expected closing ")"');
      return expr;
    }

    if (token.type === 'star') {
      throw this.error('Star is only allowed in SELECT * or COUNT(*)');
    }

    throw this.error(`Unexpected token ${describeToken(token)}`);
  }

  parseFunctionCall(name: string): Expr {
    const args: Expr[] = [];
    if (!this.matchType('rparen')) {
      do {
        if (this.matchType('star')) {
          args.push({ kind: 'star' });
        } else {
          args.push(this.parseExpression());
        }
      } while (this.matchType('comma'));
      this.expectType('rparen', 'Expected closing ")" in function call');
    }
    return { kind: 'function', name, args };
  }

  expectNumber(message: string): number {
    const token = this.peek();
    if (token.type !== 'number') {
      throw this.error(message);
    }
    this.consume();
    if (!Number.isInteger(token.value)) {
      throw this.error('LIMIT/OFFSET values must be integers');
    }
    return token.value;
  }

  expectIdentifier(message: string): string {
    const token = this.peek();
    if (token.type !== 'identifier') {
      throw this.error(message);
    }
    this.consume();
    return String(token.value);
  }

  expectKeyword(keyword: string): void {
    if (!this.matchKeyword(keyword)) {
      throw this.error(`Expected keyword ${keyword}`);
    }
  }

  matchKeyword(keyword: string): boolean {
    const token = this.peek();
    if (token.type === 'keyword' && token.value === keyword) {
      this.consume();
      return true;
    }
    return false;
  }

  matchType(type: Token['type']): boolean {
    if (this.peek().type === type) {
      this.consume();
      return true;
    }
    return false;
  }

  expectType(type: Token['type'], message = `Expected token type ${type}`): void {
    if (!this.matchType(type)) {
      throw this.error(message);
    }
  }

  peek(offset = 0): Token {
    return this.tokens[this.position + offset] ?? this.tokens[this.tokens.length - 1];
  }

  consume(): Token {
    const token = this.peek();
    if (this.position < this.tokens.length - 1) {
      this.position += 1;
    }
    return token;
  }

  error(message: string): Error {
    return new Error(`${message} at index ${this.peek().index}`);
  }
}

function normalizeDataset(data: unknown): Record<string, Record<string, CellValue>[]> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('JSON data must be an object whose values are arrays of rows');
  }

  const dataset: Record<string, Record<string, CellValue>[]> = {};
  for (const [table, rows] of Object.entries(data as Record<string, unknown>)) {
    if (!Array.isArray(rows)) {
      throw new Error(`Table "${table}" must be an array`);
    }
    dataset[table] = rows.map((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`Row ${index} in table "${table}" must be an object`);
      }
      return row as Record<string, CellValue>;
    });
  }
  return dataset;
}

function buildSchemas(dataset: Record<string, Record<string, CellValue>[]>): Record<string, string[]> {
  const schemas: Record<string, string[]> = {};
  for (const [table, rows] of Object.entries(dataset)) {
    const columns: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key);
          columns.push(key);
        }
      }
    }
    schemas[table] = columns;
  }
  return schemas;
}

function buildSources(
  query: SelectQuery,
  dataset: Record<string, Record<string, CellValue>[]>,
  schemas: Record<string, string[]>,
): SourceMeta[] {
  const sources: SourceMeta[] = [];
  const seenAliases = new Set<string>();
  const pushSource = (source: TableSource) => {
    if (!Object.prototype.hasOwnProperty.call(dataset, source.table)) {
      throw new Error(`Unknown table: ${source.table}`);
    }
    if (seenAliases.has(source.alias)) {
      throw new Error(`Duplicate table alias: ${source.alias}`);
    }
    seenAliases.add(source.alias);
    sources.push({
      table: source.table,
      alias: source.alias,
      columns: schemas[source.table] ?? [],
    });
  };

  pushSource(query.from);
  for (const join of query.joins) {
    pushSource(join.source);
  }
  return sources;
}

function buildInitialRecords(
  sources: SourceMeta[],
  dataset: Record<string, Record<string, CellValue>[]>,
): SourceBinding[][] {
  const base = sources[0];
  const rows = dataset[base.table] ?? [];
  return rows.map((row) => [
    {
      table: base.table,
      alias: base.alias,
      row,
    },
  ]);
}

function applyWhere(where: Expr | undefined, records: SourceBinding[][]): SourceBinding[][] {
  if (!where) {
    return records;
  }
  return records.filter((bindings) => truthy(evaluateExpr(where, { bindings })));
}

function applyJoins(
  joins: JoinClause[],
  records: SourceBinding[][],
  dataset: Record<string, Record<string, CellValue>[]>,
): SourceBinding[][] {
  let current = records;

  for (const join of joins) {
    const rightRows = dataset[join.source.table] ?? [];
    const next: SourceBinding[][] = [];

    for (const bindings of current) {
      let matched = false;
      for (const row of rightRows) {
        const candidate = [
          ...bindings,
          {
            table: join.source.table,
            alias: join.source.alias,
            row,
          },
        ];
        if (truthy(evaluateExpr(join.on, { bindings: candidate }))) {
          next.push(candidate);
          matched = true;
        }
      }

      if (join.joinType === 'left' && !matched) {
        next.push([
          ...bindings,
          {
            table: join.source.table,
            alias: join.source.alias,
            row: null,
          },
        ]);
      }
    }

    current = next;
  }

  return current;
}

function groupRecords(
  query: SelectQuery,
  records: SourceBinding[][],
  sources: SourceMeta[],
): QueryRecord[] {
  if (query.groupBy.length === 0) {
    if (records.length === 0) {
      return [{ bindings: makeNullBindings(sources), groupRows: [] }];
    }
    return [
      {
        bindings: records[0],
        groupRows: records,
      },
    ];
  }

  const groups = new Map<string, QueryRecord>();
  for (const bindings of records) {
    const scope: EvalScope = { bindings };
    const keyValues = query.groupBy.map((expr) => normalizeKeyValue(evaluateExpr(expr, scope)));
    const key = JSON.stringify(keyValues);
    const existing = groups.get(key);
    if (existing) {
      existing.groupRows ??= [];
      existing.groupRows.push(bindings);
      continue;
    }
    groups.set(key, {
      bindings,
      groupRows: [bindings],
    });
  }
  return Array.from(groups.values());
}

function applyHaving(having: Expr | undefined, record: QueryRecord): boolean {
  if (!having) {
    return true;
  }
  const scope: EvalScope = {
    bindings: record.bindings,
    groupRows: record.groupRows,
  };
  return truthy(evaluateExpr(having, scope));
}

function buildProjection(
  query: SelectQuery,
  sources: SourceMeta[],
  schemas: Record<string, string[]>,
): ProjectionField[] {
  const fields: ProjectionField[] = [];
  const sourceCount = sources.length;

  for (const item of query.select) {
    if (item.kind === 'star') {
      if (item.source) {
        const source = findSourceByQualifier(sources, item.source);
        for (const column of source.columns) {
          fields.push({
            label: `${source.alias}.${column}`,
            compute: (scope) => normalizeOutputValue(readBindingValue(scope.bindings, source, column)),
          });
        }
        continue;
      }

      if (sourceCount === 1) {
        const source = sources[0];
        for (const column of source.columns) {
          fields.push({
            label: column,
            compute: (scope) => normalizeOutputValue(readBindingValue(scope.bindings, source, column)),
          });
        }
        continue;
      }

      for (const source of sources) {
        for (const column of source.columns) {
          fields.push({
            label: `${source.alias}.${column}`,
            compute: (scope) => normalizeOutputValue(readBindingValue(scope.bindings, source, column)),
          });
        }
      }
      continue;
    }

    fields.push({
      label: item.alias ?? expressionLabel(item.expr),
      compute: (scope) => normalizeOutputValue(evaluateExpr(item.expr, scope)),
    });
  }

  return dedupeFields(fields);
}

function projectRecord(scope: EvalScope, fields: ProjectionField[]): Record<string, CellValue> {
  const row: Record<string, CellValue> = {};
  for (const field of fields) {
    row[field.label] = normalizeOutputValue(field.compute(scope));
  }
  return row;
}

function sortRecords(records: QueryRecord[], orderBy: OrderItem[]): QueryRecord[] {
  return [...records].sort((left, right) => {
    const leftScope: EvalScope = {
      bindings: left.bindings,
      groupRows: left.groupRows,
      projectedRow: left.projectedRow,
    };
    const rightScope: EvalScope = {
      bindings: right.bindings,
      groupRows: right.groupRows,
      projectedRow: right.projectedRow,
    };

    for (const item of orderBy) {
      const a = evaluateExpr(item.expr, leftScope);
      const b = evaluateExpr(item.expr, rightScope);
      const comparison = compareValues(a, b);
      if (comparison !== 0) {
        return item.direction === 'DESC' ? -comparison : comparison;
      }
    }
    return 0;
  });
}

function sliceRecords(records: QueryRecord[], limit?: number, offset?: number): QueryRecord[] {
  const start = offset ?? 0;
  const end = limit === undefined ? undefined : start + limit;
  return records.slice(start, end);
}

function evaluateExpr(expr: Expr, scope: EvalScope): CellValue {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'star':
      throw new Error('Star can only be used as COUNT(*)');
    case 'column':
      return resolveColumn(expr, scope);
    case 'unary':
      return !truthy(evaluateExpr(expr.expr, scope));
    case 'binary':
      return evaluateBinary(expr, scope);
    case 'function':
      return evaluateFunction(expr, scope);
    default:
      return never(expr);
  }
}

function evaluateBinary(expr: Extract<Expr, { kind: 'binary' }>, scope: EvalScope): CellValue {
  if (expr.op === 'AND') {
    return truthy(evaluateExpr(expr.left, scope)) && truthy(evaluateExpr(expr.right, scope));
  }
  if (expr.op === 'OR') {
    return truthy(evaluateExpr(expr.left, scope)) || truthy(evaluateExpr(expr.right, scope));
  }

  const left = evaluateExpr(expr.left, scope);
  const right = evaluateExpr(expr.right, scope);

  if (expr.op === 'LIKE') {
    if (left === null || left === undefined || right === null || right === undefined) {
      return false;
    }
    const pattern = String(right);
    const regex = new RegExp(
      `^${Array.from(pattern)
        .map((char) => (char === '%' ? '.*' : escapeRegExpChar(char)))
        .join('')}$`,
      'u',
    );
    return regex.test(String(left));
  }

  if (left === null || left === undefined || right === null || right === undefined) {
    return expr.op === '!=' ? left !== right : false;
  }

  if (expr.op === '=') {
    return Object.is(left, right);
  }
  if (expr.op === '!=') {
    return !Object.is(left, right);
  }

  const comparison = compareValues(left, right);
  switch (expr.op) {
    case '<':
      return comparison < 0;
    case '>':
      return comparison > 0;
    case '<=':
      return comparison <= 0;
    case '>=':
      return comparison >= 0;
    default:
      return never(expr.op);
  }
}

function evaluateFunction(expr: Extract<Expr, { kind: 'function' }>, scope: EvalScope): CellValue {
  const name = expr.name.toUpperCase();
  if (!AGGREGATE_FUNCTIONS.has(name)) {
    throw new Error(`Unsupported function: ${expr.name}`);
  }
  if (!scope.groupRows) {
    throw new Error(`Aggregate function ${name} used outside an aggregate query`);
  }
  if (expr.args.some((arg) => containsAggregate(arg))) {
    throw new Error(`Nested aggregate function ${name} is not supported`);
  }

  if (name === 'COUNT') {
    if (expr.args.length !== 1) {
      throw new Error('COUNT expects exactly one argument');
    }
    if (expr.args[0].kind === 'star') {
      return scope.groupRows.length;
    }
    let count = 0;
    for (const bindings of scope.groupRows) {
      const value = evaluateExpr(expr.args[0], {
        bindings,
        groupRows: scope.groupRows,
      });
      if (value !== null && value !== undefined) {
        count += 1;
      }
    }
    return count;
  }

  if (expr.args.length !== 1) {
    throw new Error(`${name} expects exactly one argument`);
  }

  const values: CellValue[] = [];
  for (const bindings of scope.groupRows) {
    const value = evaluateExpr(expr.args[0], {
      bindings,
      groupRows: scope.groupRows,
    });
    if (value !== null && value !== undefined) {
      values.push(value);
    }
  }

  if (name === 'SUM' || name === 'AVG') {
    const numbers = values
      .map((value) => toFiniteNumber(value))
      .filter((value): value is number => value !== null);
    if (numbers.length === 0) {
      return null;
    }
    const total = numbers.reduce((sum, value) => sum + value, 0);
    return name === 'SUM' ? total : total / numbers.length;
  }

  if (values.length === 0) {
    return null;
  }

  let best = values[0];
  for (let i = 1; i < values.length; i += 1) {
    const comparison = compareValues(values[i], best);
    if ((name === 'MIN' && comparison < 0) || (name === 'MAX' && comparison > 0)) {
      best = values[i];
    }
  }
  return best;
}

function resolveColumn(expr: Extract<Expr, { kind: 'column' }>, scope: EvalScope): CellValue {
  if (scope.projectedRow) {
    const projectedKey = expr.table ? `${expr.table}.${expr.name}` : expr.name;
    if (hasOwn(scope.projectedRow, projectedKey)) {
      return scope.projectedRow[projectedKey];
    }
    if (!expr.table && hasOwn(scope.projectedRow, expr.name)) {
      return scope.projectedRow[expr.name];
    }
  }

  if (expr.table) {
    return resolveQualified(scope.bindings, expr.table, expr.name);
  }
  return resolveUnqualified(scope.bindings, expr.name);
}

function resolveQualified(bindings: SourceBinding[], qualifier: string, column: string): CellValue {
  const aliasMatch = bindings.find((binding) => binding.alias === qualifier);
  if (aliasMatch) {
    return readBindingRow(aliasMatch, column);
  }

  const tableMatches = bindings.filter((binding) => binding.table === qualifier);
  if (tableMatches.length === 1) {
    return readBindingRow(tableMatches[0], column);
  }
  if (tableMatches.length > 1) {
    throw new Error(`Ambiguous table reference: ${qualifier}`);
  }

  return undefined;
}

function resolveUnqualified(bindings: SourceBinding[], column: string): CellValue {
  const matches: CellValue[] = [];
  for (const binding of bindings) {
    if (binding.row && hasOwn(binding.row, column)) {
      matches.push(binding.row[column]);
    }
  }
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous column reference: ${column}`);
  }
  return matches[0];
}

function readBindingValue(
  bindings: SourceBinding[],
  source: SourceMeta,
  column: string,
): CellValue {
  const binding = bindings.find((item) => item.alias === source.alias) ?? bindings.find((item) => item.table === source.table);
  if (!binding || !binding.row || !hasOwn(binding.row, column)) {
    return null;
  }
  return binding.row[column];
}

function readBindingRow(binding: SourceBinding, column: string): CellValue {
  if (!binding.row || !hasOwn(binding.row, column)) {
    return undefined;
  }
  return binding.row[column];
}

function findSourceByQualifier(sources: SourceMeta[], qualifier: string): SourceMeta {
  const aliasMatch = sources.find((source) => source.alias === qualifier);
  if (aliasMatch) {
    return aliasMatch;
  }
  const tableMatches = sources.filter((source) => source.table === qualifier);
  if (tableMatches.length === 1) {
    return tableMatches[0];
  }
  if (tableMatches.length > 1) {
    throw new Error(`Ambiguous table reference: ${qualifier}`);
  }
  throw new Error(`Unknown table reference: ${qualifier}`);
}

function makeNullBindings(sources: SourceMeta[]): SourceBinding[] {
  return sources.map((source) => ({
    table: source.table,
    alias: source.alias,
    row: null,
  }));
}

function containsAggregate(expr: Expr): boolean {
  switch (expr.kind) {
    case 'function':
      return AGGREGATE_FUNCTIONS.has(expr.name.toUpperCase()) || expr.args.some((arg) => containsAggregate(arg));
    case 'binary':
      return containsAggregate(expr.left) || containsAggregate(expr.right);
    case 'unary':
      return containsAggregate(expr.expr);
    default:
      return false;
  }
}

function isAggregatedQuery(query: SelectQuery): boolean {
  return query.groupBy.length > 0 || query.having !== undefined || query.select.some((item) => item.kind === 'expr' && containsAggregate(item.expr));
}

function compareValues(left: CellValue, right: CellValue): number {
  const leftRank = sortRank(left);
  const rightRank = sortRank(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  if (left === null || left === undefined || right === null || right === undefined) {
    return 0;
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return Number(left) - Number(right);
  }
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortRank(value: CellValue): number {
  if (value === null || value === undefined) {
    return 2;
  }
  return 0;
}

function normalizeKeyValue(value: CellValue): CellValue {
  if (value === undefined) {
    return null;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function normalizeOutputValue(value: CellValue): CellValue {
  if (value === undefined) {
    return null;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function buildProjectionPlan(
  query: SelectQuery,
  sources: SourceMeta[],
  schemas: Record<string, string[]>,
): ProjectionField[] {
  const fields: ProjectionField[] = [];
  const sourceCount = sources.length;

  for (const item of query.select) {
    if (item.kind === 'star') {
      if (item.source) {
        const source = findSourceByQualifier(sources, item.source);
        for (const column of schemas[source.table] ?? source.columns) {
          fields.push({
            label: `${source.alias}.${column}`,
            compute: (scope) => normalizeOutputValue(readBindingValue(scope.bindings, source, column)),
          });
        }
        continue;
      }

      if (sourceCount === 1) {
        const source = sources[0];
        for (const column of schemas[source.table] ?? source.columns) {
          fields.push({
            label: column,
            compute: (scope) => normalizeOutputValue(readBindingValue(scope.bindings, source, column)),
          });
        }
        continue;
      }

      for (const source of sources) {
        for (const column of schemas[source.table] ?? source.columns) {
          fields.push({
            label: `${source.alias}.${column}`,
            compute: (scope) => normalizeOutputValue(readBindingValue(scope.bindings, source, column)),
          });
        }
      }
      continue;
    }

    fields.push({
      label: item.alias ?? expressionLabel(item.expr),
      compute: (scope) => normalizeOutputValue(evaluateExpr(item.expr, scope)),
    });
  }

  return dedupeFields(fields);
}

function dedupeFields(fields: ProjectionField[]): ProjectionField[] {
  const used = new Set<string>();
  return fields.map((field) => {
    let label = field.label;
    let suffix = 2;
    while (used.has(label)) {
      label = `${field.label}_${suffix}`;
      suffix += 1;
    }
    used.add(label);
    return {
      ...field,
      label,
    };
  });
}

function expressionLabel(expr: Expr): string {
  switch (expr.kind) {
    case 'literal':
      return formatCell(expr.value);
    case 'column':
      return expr.table ? `${expr.table}.${expr.name}` : expr.name;
    case 'star':
      return '*';
    case 'function':
      return `${expr.name.toUpperCase()}(${expr.args.map((arg) => expressionLabel(arg)).join(', ')})`;
    case 'unary':
      return `${expr.op} ${expressionLabel(expr.expr)}`;
    case 'binary':
      return `${expressionLabel(expr.left)} ${expr.op} ${expressionLabel(expr.right)}`;
    default:
      return never(expr);
  }
}

function formatCell(value: CellValue): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (isControl(code) || isCombining(code)) {
      continue;
    }
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

function padCell(text: string, width: number, alignRight: boolean): string {
  const padding = Math.max(0, width - displayWidth(text));
  if (alignRight) {
    return `${' '.repeat(padding)}${text}`;
  }
  return `${text}${' '.repeat(padding)}`;
}

function formatCellValue(value: CellValue): string {
  return formatCell(value);
}

function isWhitespace(char: string): boolean {
  return /\s/u.test(char);
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/u.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_]/u.test(char);
}

function isControl(code: number): boolean {
  return (code >= 0x0000 && code <= 0x001f) || (code >= 0x007f && code <= 0x009f);
}

function isCombining(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  );
}

function isWide(code: number): boolean {
  return (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1f64f) ||
      (code >= 0x1f900 && code <= 0x1f9ff) ||
      (code >= 0x20000 && code <= 0x3fffd))
  );
}

function escapeRegExpChar(char: string): string {
  return /[\\^$.*+?()[\]{}|]/u.test(char) ? `\\${char}` : char;
}

function truthy(value: CellValue): boolean {
  return Boolean(value);
}

function toFiniteNumber(value: CellValue): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasOwn(object: Record<string, CellValue>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function never(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
