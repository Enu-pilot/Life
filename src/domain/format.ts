// 入力値の正規化と表示用の整形（ui-design.md §5）。表示時の丸めは計算に影響させない。

export type DisplayUnit = 'yen' | 'man';

function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９．，－ー−]/g, (c) => {
      if (c === '．') return '.';
      if (c === '，') return ',';
      if (c === '－' || c === 'ー' || c === '−') return '-';
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    })
    .replace(/　/g, ' ');
}

/**
 * 金額入力を円の数値に変換する。「30万」「1億2000万」「300,000」「３０万円」を受け付ける。
 * 空文字は null、解釈できない場合は NaN を返す（検証でエラー表示する）。
 */
export function parseYenInput(input: string, defaultUnit: DisplayUnit = 'yen'): number | null {
  let s = toHalfWidth(input).trim().replace(/[,\s]/g, '').replace(/円$/, '');
  if (s === '') return null;
  let total = 0;
  let matched = false;
  const oku = /^(-?\d+(?:\.\d+)?)億/.exec(s);
  if (oku) {
    total += Number(oku[1]) * 1e8;
    s = s.slice(oku[0].length);
    matched = true;
  }
  const man = /^(-?\d+(?:\.\d+)?)万/.exec(s);
  if (man) {
    total += Number(man[1]) * 1e4;
    s = s.slice(man[0].length);
    matched = true;
  }
  if (s !== '') {
    if (!/^-?\d+(?:\.\d+)?$/.test(s)) return NaN;
    const n = Number(s);
    total += matched ? n : defaultUnit === 'man' ? n * 1e4 : n;
  }
  // 浮動小数の誤差（例: 0.1万）を円単位に正規化する
  return Math.round(total * 1e6) / 1e6;
}

/** パーセント入力（"1.5" → 0.015）。空は null、不正は NaN。 */
export function parsePercentInput(input: string): number | null {
  const s = toHalfWidth(input).trim().replace(/%$/, '').replace(/％$/, '');
  if (s === '') return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return NaN;
  return Math.round(Number(s) * 1e6) / 1e8;
}

export function formatPercent(rate: number, digits = 2): string {
  const v = Math.round(rate * 100 * 10 ** digits) / 10 ** digits;
  return `${v}%`;
}

const yenFmt = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });
const manFmt = new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatMoney(yen: number, unit: DisplayUnit): string {
  if (unit === 'man') return `${manFmt.format(yen / 1e4)}万円`;
  return `${yenFmt.format(yen)}円`;
}

/** 入力欄の初期表示用（円単位、カンマ区切り） */
export function formatYenInput(yen: number): string {
  return yenFmt.format(yen);
}

export function formatYmJa(ym: string): string {
  const [y, m] = ym.split('-');
  return `${y}年${Number(m)}月`;
}
