import { SelectStmt, Expr, JoinClause, OrderByItem, SelectItem, ColumnRef } from './types';

type Row = Record<string, any>;
type DataSet = Record<string, Row[]>;

export class Engine {
  private data: DataSet;

  constructor(data: DataSet) {
    this.data = data;
  }

  public execute(stmt: SelectStmt): any[] {
    const mainTable = this.data[stmt.from.name];
    if (!mainTable) throw new Error(`Table not found: ${stmt.from.name}`);

    // Initial rows with table alias namespaced if necessary
    let rows = mainTable.map(row => {
      const res: Row = {};
      const prefix = stmt.from.alias || stmt.from.name;
      for (const key of Object.keys(row)) {
        res[`${prefix}.${key}`] = row[key];
        res[key] = row[key]; // also keep un-prefixed for simple queries
      }
      return res;
    });

    // Joins
    for (const join of stmt.joins) {
      const joinTableData = this.data[join.table.name];
      if (!joinTableData) throw new Error(`Table not found: ${join.table.name}`);
      const prefix = join.table.alias || join.table.name;

      const newRows: Row[] = [];
      for (const row of rows) {
        let matched = false;
        for (const joinRow of joinTableData) {
          const combinedRow = { ...row };
          for (const key of Object.keys(joinRow)) {
            combinedRow[`${prefix}.${key}`] = joinRow[key];
            if (!(key in combinedRow)) {
              combinedRow[key] = joinRow[key];
            }
          }
          if (this.evalExpr(join.on, combinedRow)) {
            newRows.push(combinedRow);
            matched = true;
          }
        }
        if (!matched && join.type === 'LEFT') {
           const combinedRow = { ...row };
           for (const key of Object.keys(joinTableData[0] || {})) {
             combinedRow[`${prefix}.${key}`] = null;
           }
           newRows.push(combinedRow);
        }
      }
      rows = newRows;
    }

    // Where
    if (stmt.where) {
      rows = rows.filter(row => this.evalExpr(stmt.where!, row));
    }

    // Group By & Aggregation
    const isAgg = stmt.select.some(item => item.isAggregate) || stmt.groupBy;
    let groupedData: { key: string; rows: Row[] }[] = [];

    if (isAgg) {
      if (stmt.groupBy) {
        const groups = new Map<string, Row[]>();
        for (const row of rows) {
          const keyVals = stmt.groupBy.map(expr => this.evalExpr(expr, row));
          const keyStr = JSON.stringify(keyVals);
          if (!groups.has(keyStr)) groups.set(keyStr, []);
          groups.get(keyStr)!.push(row);
        }
        groupedData = Array.from(groups.entries()).map(([k, v]) => ({ key: k, rows: v }));
      } else {
        groupedData = [{ key: 'all', rows }];
      }

      // Having
      if (stmt.having) {
        groupedData = groupedData.filter(group => {
           // Create a representative row for the group for HAVING evaluation
           // It needs to evaluate aggregate functions over group.rows
           return this.evalExpr(stmt.having!, group.rows[0], group.rows);
        });
      }

      // Select for Aggregated
      rows = groupedData.map(group => {
         const res: Row = {};
         for (const item of stmt.select) {
           if (item.type === 'Star') {
             if (item.isAggregate && item.aggregateFunc === 'COUNT') {
                res['COUNT(*)'] = group.rows.length;
             } else {
                Object.assign(res, group.rows[0]); // fallback
             }
           } else {
             const colName = item.alias || (item.isAggregate ? `${item.aggregateFunc}(${item.column})` : (item.table ? `${item.table}.${item.column}` : item.column));
             if (item.isAggregate) {
                res[colName] = this.evalAggregate(item, group.rows);
             } else {
                res[colName] = this.evalExpr({ type: 'ColumnRef', table: item.table, column: item.column }, group.rows[0]);
             }
           }
         }
         return res;
      });

    } else {
      // Select for non-aggregated
      rows = rows.map(row => {
         const res: Row = {};
         for (const item of stmt.select) {
           if (item.type === 'Star') {
             if (item.table) {
               // select table.*
               for (const key of Object.keys(row)) {
                 if (key.startsWith(`${item.table}.`)) {
                   res[key.substring(item.table.length + 1)] = row[key];
                 }
               }
             } else {
               // select *
               // only return original properties, not prefixed ones to avoid duplication if no join
               // actually, for simplicity, let's just return unprefixed if there are no dots
               for (const key of Object.keys(row)) {
                  if (!key.includes('.')) res[key] = row[key];
               }
               // if table was aliased but no join, maybe everything has dots?
               // Ensure we have some data
               if (Object.keys(res).length === 0) {
                 for (const key of Object.keys(row)) {
                    res[key] = row[key];
                 }
               }
             }
           } else {
             const colName = item.alias || (item.isAggregate ? `${item.aggregateFunc}(${item.column})` : (item.table ? `${item.table}.${item.column}` : item.column));
             const val = this.evalExpr({ type: 'ColumnRef', table: item.table, column: item.column }, row);
             res[colName] = val;
           }
         }
         return res;
      });
    }

    // Order By
    if (stmt.orderBy) {
       rows.sort((a, b) => {
          for (const order of stmt.orderBy!) {
            let valA = this.evalExpr(order.column, a);
            let valB = this.evalExpr(order.column, b);
            
            if (valA === valB) continue;
            
            if (valA < valB) return order.direction === 'ASC' ? -1 : 1;
            if (valA > valB) return order.direction === 'ASC' ? 1 : -1;
          }
          return 0;
       });
    }

    // Limit / Offset
    if (stmt.offset !== undefined) {
      rows = rows.slice(stmt.offset);
    }
    if (stmt.limit !== undefined) {
      rows = rows.slice(0, stmt.limit);
    }

    return rows;
  }

  private evalAggregate(item: ColumnRef, rows: Row[]): any {
     const func = item.aggregateFunc?.toUpperCase();
     if (func === 'COUNT') {
       if (item.column === '*') return rows.length;
       return rows.filter(r => this.evalExpr({ type: 'ColumnRef', table: item.table, column: item.column }, r) != null).length;
     }

     const vals = rows.map(r => this.evalExpr({ type: 'ColumnRef', table: item.table, column: item.column }, r)).filter(v => v != null && typeof v === 'number');
     
     if (vals.length === 0) return null;

     if (func === 'SUM') return vals.reduce((a, b) => a + b, 0);
     if (func === 'AVG') return vals.reduce((a, b) => a + b, 0) / vals.length;
     if (func === 'MIN') return Math.min(...vals);
     if (func === 'MAX') return Math.max(...vals);

     throw new Error(`Unsupported aggregate function: ${func}`);
  }

  private evalExpr(expr: Expr, row: Row, groupRows?: Row[]): any {
    switch (expr.type) {
      case 'ColumnRef': {
        if (expr.table) {
          return row[`${expr.table}.${expr.column}`];
        }
        return row[expr.column] !== undefined ? row[expr.column] : row[`${expr.column}`];
      }
      case 'StringLiteral':
      case 'NumberLiteral':
        return expr.value;
      case 'LogicalExpr': {
        const left = this.evalExpr(expr.left, row, groupRows);
        if (expr.operator === 'AND') {
          return left && this.evalExpr(expr.right, row, groupRows);
        } else {
          return left || this.evalExpr(expr.right, row, groupRows);
        }
      }
      case 'UnaryExpr': {
        if (expr.operator === 'NOT') {
          return !this.evalExpr(expr.expr, row, groupRows);
        }
        break;
      }
      case 'BinaryExpr': {
        const left = this.evalExpr(expr.left, row, groupRows);
        const right = this.evalExpr(expr.right, row, groupRows);
        switch (expr.operator) {
          case '=': return left == right;
          case '!=': return left != right;
          case '>': return left > right;
          case '>=': return left >= right;
          case '<': return left < right;
          case '<=': return left <= right;
          case 'LIKE': {
             if (typeof left !== 'string' || typeof right !== 'string') return false;
             const regexStr = '^' + right.replace(/%/g, '.*') + '$';
             return new RegExp(regexStr).test(left);
          }
          default: throw new Error(`Unsupported operator ${expr.operator}`);
        }
      }
      case 'FunctionCall': {
         // Functions in WHERE/HAVING like AVG(age) > 30
         if (groupRows) {
           const func = expr.name.toUpperCase();
           if (func === 'COUNT') {
              return groupRows.length;
           }
           const arg = expr.args[0] as ColumnRef;
           const vals = groupRows.map(r => this.evalExpr(arg, r)).filter(v => typeof v === 'number');
           if (vals.length === 0) return null;
           if (func === 'AVG') return vals.reduce((a, b) => a + b, 0) / vals.length;
           if (func === 'SUM') return vals.reduce((a, b) => a + b, 0);
           if (func === 'MIN') return Math.min(...vals);
           if (func === 'MAX') return Math.max(...vals);
         }
         throw new Error(`Unsupported function call ${expr.name}`);
      }
    }
    throw new Error(`Unsupported expression type: ${(expr as any).type}`);
  }
}
