function cellString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) {
    return Number.isInteger(v) ? String(v) : String(v);
  }
  return String(v);
}

function columnIsNumeric(rows: Record<string, unknown>[], col: string): boolean {
  for (const r of rows) {
    const v = r[col];
    if (v === null || v === undefined) continue;
    return typeof v === "number";
  }
  return false;
}

export function formatTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const numeric = new Set(cols.filter((c) => columnIsNumeric(rows, c)));
  const widths = cols.map((c) => {
    const headerW = c.length;
    const dataW = Math.max(
      ...rows.map((r) => cellString(r[c]).length),
      headerW,
    );
    return Math.max(dataW, headerW);
  });

  const sep = "|" + cols.map((_, i) => "-".repeat(widths[i]! + 2)).join("|") + "|";
  const header =
    "|" +
    cols
      .map((c, i) => {
        const w = widths[i]!;
        const pad = c.length <= w ? " ".repeat(w - c.length) + c : c;
        return ` ${pad} `;
      })
      .join("|") +
    "|";

  const lines = rows.map((r) => {
    return (
      "|" +
      cols
        .map((c, i) => {
          const w = widths[i]!;
          const raw = cellString(r[c]);
          const inner = numeric.has(c) ? raw.padStart(w) : raw.padEnd(w);
          return ` ${inner} `;
        })
        .join("|") +
      "|"
    );
  });

  return [header, sep, ...lines].join("\n");
}
