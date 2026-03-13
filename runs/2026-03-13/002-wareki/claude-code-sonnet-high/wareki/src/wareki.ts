#!/usr/bin/env node

// ============================================================
// 元号定義
// ============================================================

interface Era {
  name: string;
  short: string;
  startYear: number; // 元年に対応するグレゴリオ暦の年
  start: readonly [number, number, number]; // [year, month, day]
  end: readonly [number, number, number] | null;
}

// 新しい元号が先頭に来るよう降順で定義
const ERAS: readonly Era[] = [
  { name: '令和', short: 'R', startYear: 2019, start: [2019, 5, 1],  end: null },
  { name: '平成', short: 'H', startYear: 1989, start: [1989, 1, 8],  end: [2019, 4, 30] },
  { name: '昭和', short: 'S', startYear: 1926, start: [1926, 12, 25], end: [1989, 1, 7] },
  { name: '大正', short: 'T', startYear: 1912, start: [1912, 7, 30], end: [1926, 12, 24] },
  { name: '明治', short: 'M', startYear: 1868, start: [1868, 10, 23], end: [1912, 7, 29] },
];

const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

// ============================================================
// 日付ユーティリティ（外部ライブラリ不使用）
// ============================================================

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

/**
 * Tomohiko Sakamoto's algorithm
 * 戻り値: 0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土
 */
function getDayOfWeek(year: number, month: number, day: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  let y = year;
  if (month < 3) y--;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[month - 1] + day) % 7;
}

/** 日付を数値で比較。正=d1が後、負=d1が前、0=同日 */
function compareDates(
  y1: number, m1: number, d1: number,
  ref: readonly [number, number, number]
): number {
  const [y2, m2, d2] = ref;
  if (y1 !== y2) return y1 - y2;
  if (m1 !== m2) return m1 - m2;
  return d1 - d2;
}

function findEra(year: number, month: number, day: number): Era | null {
  for (const era of ERAS) {
    if (compareDates(year, month, day, era.start) < 0) continue;
    if (era.end !== null && compareDates(year, month, day, era.end) > 0) continue;
    return era;
  }
  return null;
}

// ============================================================
// サブコマンド: to-wareki（西暦 → 和暦）
// ============================================================

function toWareki(dateStr: string, shortFormat: boolean): void {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    console.error('エラー: 無効な日付形式です。YYYY-MM-DD 形式で入力してください（例: 2026-03-10）');
    process.exit(1);
  }

  const year  = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day   = parseInt(match[3], 10);

  if (!isValidDate(year, month, day)) {
    console.error(`エラー: 無効な日付です: ${dateStr}`);
    process.exit(1);
  }

  const era = findEra(year, month, day);
  if (!era) {
    console.error('エラー: 対応していない日付です。明治元年（1868-10-23）以降の日付を入力してください。');
    process.exit(1);
  }

  const eraYear    = year - era.startYear + 1;
  const eraYearStr = eraYear === 1 ? '元' : String(eraYear);
  const dow        = getDayOfWeek(year, month, day);

  if (shortFormat) {
    // 短縮表記: R8.3.10
    console.log(`${era.short}${eraYear}.${month}.${day}`);
  } else {
    console.log(`${era.name}${eraYearStr}年${month}月${day}日（${DAYS_JA[dow]}）`);
  }
}

// ============================================================
// サブコマンド: to-seireki（和暦 → 西暦）
// ============================================================

function toSeireki(warekiStr: string, shortFormat: boolean): void {
  // 「令和8年3月10日」または「令和元年3月10日」にマッチ
  const match = warekiStr.match(/^(.{2})(元|\d+)年(\d+)月(\d+)日$/);
  if (!match) {
    console.error('エラー: 無効な和暦形式です（例: 令和8年3月10日）');
    process.exit(1);
  }

  const eraName    = match[1];
  const eraYearStr = match[2];
  const eraYear    = eraYearStr === '元' ? 1 : parseInt(eraYearStr, 10);
  const month      = parseInt(match[3], 10);
  const day        = parseInt(match[4], 10);

  const era = ERAS.find(e => e.name === eraName);
  if (!era) {
    console.error(`エラー: 不明な元号です: ${eraName}。対応元号: 明治・大正・昭和・平成・令和`);
    process.exit(1);
  }

  if (eraYear < 1) {
    console.error(`エラー: 年は1以上で入力してください。`);
    process.exit(1);
  }

  const year = era.startYear + eraYear - 1;

  if (!isValidDate(year, month, day)) {
    console.error(`エラー: 無効な日付です: ${warekiStr}`);
    process.exit(1);
  }

  // 元号の範囲チェック
  if (compareDates(year, month, day, era.start) < 0) {
    const [sy, sm, sd] = era.start;
    console.error(`エラー: ${eraName}元年の開始は ${sy}-${String(sm).padStart(2,'0')}-${String(sd).padStart(2,'0')} です。`);
    process.exit(1);
  }
  if (era.end !== null && compareDates(year, month, day, era.end) > 0) {
    const [ey, em, ed] = era.end;
    console.error(`エラー: ${eraName}の終了日は ${ey}-${String(em).padStart(2,'0')}-${String(ed).padStart(2,'0')} です。`);
    process.exit(1);
  }

  const dow = getDayOfWeek(year, month, day);
  const mm  = String(month).padStart(2, '0');
  const dd  = String(day).padStart(2, '0');

  if (shortFormat) {
    console.log(`${year}-${mm}-${dd}`);
  } else {
    console.log(`${year}-${mm}-${dd} (${DAYS_EN[dow]})`);
  }
}

// ============================================================
// ヘルプ
// ============================================================

function printHelp(): void {
  console.log(`使用方法:
  wareki to-wareki <日付>          西暦 → 和暦に変換
  wareki to-seireki <和暦文字列>   和暦 → 西暦に変換

引数:
  <日付>         ISO 8601 形式（例: 2026-03-10）
  <和暦文字列>   和暦形式（例: 令和8年3月10日）

オプション:
  --format short   短縮表記（例: R8.3.10 / 2026-03-10）
  --help, -h       このヘルプを表示

例:
  wareki to-wareki 2026-03-10
  wareki to-wareki 2026-03-10 --format short
  wareki to-seireki 令和8年3月10日
  wareki to-seireki 令和8年3月10日 --format short
  wareki to-wareki 1989-01-07    # 昭和64年1月7日（土）
  wareki to-wareki 1989-01-08    # 平成元年1月8日（日）`);
}

// ============================================================
// エントリポイント
// ============================================================

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  // --format short を解析してから除去
  const fmtIdx = args.indexOf('--format');
  const shortFormat = fmtIdx !== -1 && args[fmtIdx + 1] === 'short';
  const filteredArgs = fmtIdx === -1
    ? args
    : args.filter((_, i) => i !== fmtIdx && i !== fmtIdx + 1);

  const subcommand = filteredArgs[0];

  if (subcommand === 'to-wareki') {
    if (filteredArgs.length < 2) {
      console.error('エラー: 日付を指定してください（例: wareki to-wareki 2026-03-10）');
      process.exit(1);
    }
    toWareki(filteredArgs[1], shortFormat);
  } else if (subcommand === 'to-seireki') {
    if (filteredArgs.length < 2) {
      console.error('エラー: 和暦文字列を指定してください（例: wareki to-seireki 令和8年3月10日）');
      process.exit(1);
    }
    toSeireki(filteredArgs[1], shortFormat);
  } else {
    console.error(`エラー: 不明なサブコマンドです: ${subcommand}`);
    console.error('使用可能なサブコマンド: to-wareki, to-seireki');
    process.exit(1);
  }
}

main();
