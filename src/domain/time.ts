// 年月・年齢・学齢の計算（calculation-spec §2）。
// 年月は通し月番号 MonthIndex = year * 12 + (month - 1) で表す。

export type MonthIndex = number;

const YM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isYearMonth(s: string): boolean {
  return YM_RE.test(s);
}

export function parseYm(s: string): MonthIndex {
  const m = YM_RE.exec(s);
  if (!m) throw new Error(`年月の形式が不正です: ${s}`);
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

export function formatYm(m: MonthIndex): string {
  const year = Math.floor(m / 12);
  const month = (m % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function yearOf(m: MonthIndex): number {
  return Math.floor(m / 12);
}

/** 1〜12 */
export function calendarMonthOf(m: MonthIndex): number {
  return (m % 12) + 1;
}

export function monthIndexOf(year: number, month: number): MonthIndex {
  return year * 12 + (month - 1);
}

/** 月 m における満年齢。誕生月に加算される。 */
export function ageAt(birth: MonthIndex, m: MonthIndex): number {
  return Math.floor((m - birth) / 12);
}

export type SchoolStage = 'kindergarten' | 'elementary' | 'junior' | 'high' | 'university';

export const STAGE_OFFSET_YEARS: Record<SchoolStage, number> = {
  kindergarten: -3,
  elementary: 0,
  junior: 6,
  high: 9,
  university: 12,
};

export const STAGE_YEARS: Record<SchoolStage, number> = {
  kindergarten: 3,
  elementary: 6,
  junior: 3,
  high: 3,
  university: 4,
};

/**
 * 小学校入学年月（4月）。日本の学齢規則（4/2〜翌4/1 生まれが同学年）に基づく。
 * 日を持たないため 4 月生まれは 4/2 以降生まれとみなす（calculation-spec §2.5）。
 */
export function elementaryEntry(birth: MonthIndex): MonthIndex {
  const by = yearOf(birth);
  const bm = calendarMonthOf(birth);
  const entryYear = bm >= 4 ? by + 7 : by + 6;
  return monthIndexOf(entryYear, 4);
}

export function stageEntry(birth: MonthIndex, stage: SchoolStage): MonthIndex {
  return elementaryEntry(birth) + STAGE_OFFSET_YEARS[stage] * 12;
}
