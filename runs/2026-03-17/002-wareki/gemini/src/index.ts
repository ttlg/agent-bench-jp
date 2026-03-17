#!/usr/bin/env node
declare var process: any;

interface Era {
    name: string;
    short: string;
    y: number;
    m: number;
    d: number;
}

const eras: Era[] = [
    { name: '令和', short: 'R', y: 2019, m: 5, d: 1 },
    { name: '平成', short: 'H', y: 1989, m: 1, d: 8 },
    { name: '昭和', short: 'S', y: 1926, m: 12, d: 25 },
    { name: '大正', short: 'T', y: 1912, m: 7, d: 30 },
    { name: '明治', short: 'M', y: 1868, m: 1, d: 25 } // 明治元年は1月25日から（グレゴリオ暦換算での1868年の始まり）
];

const jaDays = ['日', '月', '火', '水', '木', '金', '土'];
const enDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad(n: number) {
    return n.toString().padStart(2, '0');
}

function getDayOfWeek(y: number, m: number, d: number) {
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
        return -1; // invalid date
    }
    return date.getDay();
}

function toWareki(dateStr: string, isShort: boolean) {
    const parts = dateStr.split('-');
    if (parts.length !== 3) {
        console.error('エラー: 不正な日付形式です。YYYY-MM-DDで入力してください。');
        process.exit(1);
    }
    const y = parseInt(parts[0] || '', 10);
    const m = parseInt(parts[1] || '', 10);
    const d = parseInt(parts[2] || '', 10);

    if (isNaN(y) || isNaN(m) || isNaN(d)) {
        console.error('エラー: 不正な日付です。');
        process.exit(1);
    }
    
    const dow = getDayOfWeek(y, m, d);
    if (dow === -1) {
        console.error('エラー: 存在しない日付です。');
        process.exit(1);
    }

    let targetEra: Era | undefined;
    for (const era of eras) {
        if (y > era.y || (y === era.y && m > era.m) || (y === era.y && m === era.m && d >= era.d)) {
            targetEra = era;
            break;
        }
    }

    if (!targetEra) {
        console.error('エラー: 対応していない古い日付です。');
        process.exit(1);
        return; // For TS flow control
    }

    const eraYear = y - targetEra.y + 1;
    const eraYearStr = eraYear === 1 && !isShort ? '元' : eraYear.toString();

    if (isShort) {
        console.log(`${targetEra.short}${eraYear}.${m}.${d}`);
    } else {
        console.log(`${targetEra.name}${eraYearStr}年${m}月${d}日（${jaDays[dow]}）`);
    }
}

function toSeireki(warekiStr: string, isShort: boolean) {
    let eraStr = '';
    let yearStr = '';
    let mStr = '';
    let dStr = '';

    const shortMatch = warekiStr.match(/^([RHSMT])(\d+)\.(\d+)\.(\d+)$/);
    const longMatch = warekiStr.match(/^(令和|平成|昭和|大正|明治)(元|\d+)年(\d+)月(\d+)日$/);

    if (shortMatch) {
        eraStr = shortMatch[1] || '';
        yearStr = shortMatch[2] || '';
        mStr = shortMatch[3] || '';
        dStr = shortMatch[4] || '';
    } else if (longMatch) {
        eraStr = longMatch[1] || '';
        yearStr = longMatch[2] === '元' ? '1' : (longMatch[2] || '');
        mStr = longMatch[3] || '';
        dStr = longMatch[4] || '';
    } else {
        console.error('エラー: 不正な和暦形式です。');
        process.exit(1);
        return; // For TS flow control
    }

    const targetEra = eras.find(e => e.name === eraStr || e.short === eraStr);
    if (!targetEra) {
        console.error('エラー: 不明な元号です。');
        process.exit(1);
        return; // For TS flow control
    }

    const eraYear = parseInt(yearStr, 10);
    const m = parseInt(mStr, 10);
    const d = parseInt(dStr, 10);

    const y = targetEra.y + eraYear - 1;

    const dow = getDayOfWeek(y, m, d);
    if (dow === -1) {
        console.error('エラー: 存在しない日付です。');
        process.exit(1);
        return; // For TS flow control
    }

    // Checking if it exceeds the era end
    const eraIndex = eras.findIndex(e => e === targetEra);
    if (eraIndex > 0) {
        const nextEra = eras[eraIndex - 1];
        if (nextEra && (y > nextEra.y || (y === nextEra.y && m > nextEra.m) || (y === nextEra.y && m === nextEra.m && d >= nextEra.d))) {
             console.error('エラー: 存在しない和暦の日付です（次の元号に変わっています）。');
             process.exit(1);
             return;
        }
    }
    // Checking if it is before the era start
    if (y < targetEra.y || (y === targetEra.y && m < targetEra.m) || (y === targetEra.y && m === targetEra.m && d < targetEra.d)) {
         console.error('エラー: 存在しない和暦の日付です（前の元号の期間です）。');
         process.exit(1);
         return;
    }

    if (isShort) {
        console.log(`${y}-${pad(m)}-${pad(d)}`);
    } else {
        console.log(`${y}-${pad(m)}-${pad(d)} (${enDays[dow]})`);
    }
}

const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('使用法:');
    console.error('  wareki to-wareki <西暦日付> [--format short]');
    console.error('  wareki to-seireki <和暦文字列> [--format short]');
    process.exit(1);
}

const command = args[0] || '';
const input = args[1] || '';
const isShort = args.includes('--format') && args[args.indexOf('--format') + 1] === 'short';

if (command === 'to-wareki') {
    toWareki(input, isShort);
} else if (command === 'to-seireki') {
    toSeireki(input, isShort);
} else {
    console.error('エラー: 不明なコマンドです。');
    process.exit(1);
}